import "dotenv/config";

import { mqttClient } from "./mqtt/client.js";
import { wss, broadcast } from "./websocket/server.js";

import { fileURLToPath } from "url";
import express from "express";
import path from "path";
import { CameraModule } from "./camera/module.js";
import { HeaterObservation, type PilotState } from "./heater/state.js";
import { pilotCommand } from "./heater/pilot-command.js";
import { parseTemperatureControl, type TemperatureControl } from "./heater/temperature-control.js";
import { parseCommand } from "./websocket/command.js";
import { temperatureTransport } from "./heater/temperature-transport.js";
import { TemperatureReconciliation } from "./heater/temperature-reconciliation.js";
import { HeaterPanelState, type PanelEffect } from "./heater/panel-state.js";
import { DisplayPowerObservation } from "./heater/display-power.js";
import { PowerOperation } from "./heater/power-operation.js";
import { controlLog, logServoSequence } from "./heater/control-log.js";
import { DesiredState } from "./heater/desired-state.js";
import { buildStatusResponse } from "./heater/status-response.js";
import { PresentationHistory, WATER_HISTORY, POWER_HISTORY, MAXIMUM_HISTORY } from "./heater/presentation-history.js";
import { ObservedMaximum } from "./heater/observed-max.js";

const waterHistory = new PresentationHistory(WATER_HISTORY, (value): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 75);
const powerHistory = new PresentationHistory(POWER_HISTORY, (value): value is boolean => typeof value === "boolean");

const maximumHistory = new PresentationHistory(MAXIMUM_HISTORY, (value): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 30 && value <= 75);
const presentationTopics = new Map<string, PresentationHistory<number> | PresentationHistory<boolean>>([
  [WATER_HISTORY, waterHistory], [POWER_HISTORY, powerHistory], [MAXIMUM_HISTORY, maximumHistory],
]);

function presentationSnapshot() {
  return { lastWater: waterHistory.snapshot(), lastPower: powerHistory.snapshot(), lastMaximum: maximumHistory.snapshot() };
}

interface HeaterState {
  temperatureControl: TemperatureControl | null;
  autoShutdown: boolean | null;
  color: string | null;
  flowrate: number | null;
  volume: number | null;
}

const heaterState: HeaterState = {
  temperatureControl: null,
  autoShutdown: null,
  color: null,
  flowrate: null,
  volume: null
};

const desiredState = new DesiredState(path.resolve(process.env.HEATER_DESIRED_STATE_FILE ?? ".runtime/desired-state.json"));

const temperatureReconciliation = new TemperatureReconciliation(path.resolve(".runtime/temperature-operation.json"));

const sensorTestMode = process.env.TEMPORARY_SENSOR_TEST_MODE === "true";
const observation = new HeaterObservation(sensorTestMode);
const panel = new HeaterPanelState();
const observedMaximum = new ObservedMaximum();
let lastMaximumSignature = "";
function publishMaximumIfChanged() {
  const data = observedMaximum.snapshot();
  const signature = JSON.stringify(data);
  if (signature !== lastMaximumSignature) {
    lastMaximumSignature = signature;
    if (data.temperatureMax !== null && data.temperatureMaxObservedAt !== null)
      maximumHistory.observe(data.temperatureMax, Date.parse(data.temperatureMaxObservedAt), mqttClient);
    broadcast({ event: "temperature_max", data: { ...data, lastMaximum: maximumHistory.snapshot() } });
  }
}
const displayPower = new DisplayPowerObservation();
const powerOperation = new PowerOperation();
let brokerConnected = false;
let lastPilot: PilotState | null = null;
let lastControlDiagnostic = "";
let temperatureTokenReceivedAt = 0;
let lastAutoShutdownDiagnostic = "";
const logTelemetry = process.env.HEATER_DEBUG_TELEMETRY === "true";

function interruptTemperature() {
  try {
    temperatureReconciliation.interrupt();
  } catch {
    console.error("Could not save interrupted temperature operation");
  }
}

function observedState() {
  const water = panel.snapshot();
  const state = observation.snapshot({ available: water.waterFresh, value: water.water,
    observedAt: water.waterObservedAt === null ? null : new Date(water.waterObservedAt).toISOString() });
  const control = heaterState.temperatureControl;
  const waterAccepted = (sensorTestMode || (control?.status === "idle" && !control.locked && panel.snapshot().waterFresh)) &&
    !observedMaximum.snapshot().temperatureMaxSelected;
  return { ...state, displayState: displayPower.snapshot(), powerControl: powerOperation.snapshot(), temperature: waterAccepted ? state.temperature : null };
}

if (!process.env.COLOR_RED_REFERENCE && !process.env.COLOR_GREEN_REFERENCE && !process.env.COLOR_UNLIT_REFERENCE) {
  console.warn(
    "Pilot RGB classification is disabled: set COLOR_RED_REFERENCE and/or " +
    "COLOR_GREEN_REFERENCE plus COLOR_MAX_DISTANCE in .env, then restart the backend.",
  );
} else if (!Number.isFinite(Number(process.env.COLOR_MAX_DISTANCE)) || Number(process.env.COLOR_MAX_DISTANCE) <= 0) {
  console.warn(
    "Pilot RGB classification is disabled: COLOR_MAX_DISTANCE must be a positive " +
    "normalized distance, then restart the backend.",
  );
}

mqttClient.on("message", (topic, payload, packet) => {
  const history = presentationTopics.get(topic);
  if (history) {
    if (packet.retain && history.restore(payload))
      broadcast({ event: "presentation_history", data: presentationSnapshot() });
    return;
  }
  const value = payload.toString();
  if (topic === "heater/diagnostic/servo") {
    if (packet.retain) return;
    const tap = logServoSequence(value);
    if (tap?.button === "plus" && tap.reason === "manual_plus") cameraModule.observeManualPlus();
    return;
  }
  observation.update(topic, value, packet.retain);
  if (packet.retain && !(topic === "heater/status" && value === "offline")) return;

  switch (topic) {
    case "heater/state/power":
      if (value !== "true" && value !== "false") displayPower.reset(Date.now() + 1000, true);
      break;
    case "heater/state/temperature_control":
      heaterState.temperatureControl = parseTemperatureControl(value);
      temperatureTokenReceivedAt = Date.now();
      if (heaterState.temperatureControl) {
        const { temperatureV2Token: _token, ...diagnostic } = heaterState.temperatureControl;
        const signature = JSON.stringify(diagnostic);
        if (signature !== lastControlDiagnostic) {
          lastControlDiagnostic = signature;
          controlLog("temperature_controller_state", { ...diagnostic,
            requestAcceptedOnly: diagnostic.result === "accepted" });
        }
      }
      if (heaterState.temperatureControl?.status !== "idle" || heaterState.temperatureControl.locked) displayPower.reset();
      break;
    case "heater/state/autoshutdown": {
      heaterState.autoShutdown = value === "true" ? true : value === "false" ? false : null;
      const details = { enabled: heaterState.autoShutdown, target: heaterState.temperatureControl?.autoShutdownTarget ?? null };
      const signature = JSON.stringify(details);
      if (signature !== lastAutoShutdownDiagnostic) {
        lastAutoShutdownDiagnostic = signature;
        controlLog("auto_shutdown_state", details);
      }
      break;
    }
    case "heater/state/flowrate":
    case "heater/state/volume": {
      const numeric = value.trim() === "" ? NaN : Number(value);
      heaterState[topic.endsWith("/flowrate") ? "flowrate" : "volume"] = Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
      break;
    }
    case "heater/state/color": {
      heaterState.color = value === "unavailable" ? null : value;
      const observed = observedState();
      const pilot = observed.pilot;
      if (pilot !== lastPilot) {
        const sample = heaterState.color;
        controlLog("pilot_observation", { previousPilot: lastPilot, pilot,
          rawRgbClear: sample && /^\d{1,5}(,\d{1,5}){3}$/.test(sample) ? sample : null });
        lastPilot = pilot;
      }
      const command = pilotCommand(pilot, {
        retained: packet.retain,
        sensorTestMode,
        brokerConnected,
        controllerOnline: observed.online,
      });
      if (command) mqttClient.publish(command.topic, command.payload, command.options);
      if (command && observed.power === null && (pilot === "heating" || pilot === "ready")) {
        mqttClient.publish("heater/input/power", "true", { qos: 0, retain: false });
      }
      break;
    }
    case "heater/status":
      interruptTemperature();
      powerOperation.disconnect();
      panel.disconnect();
      displayPower.reset();
      heaterState.flowrate = null;
      heaterState.volume = null;
      // A (re)connecting controller starts without a known power observation.
      heaterState.temperatureControl = null;
      temperatureTokenReceivedAt = 0;
      heaterState.autoShutdown = null;
      heaterState.color = null;
      break;
  }

  if (logTelemetry) console.log(`Received ${value} from ${topic}. Broadcasting...`);
  broadcast({
    event: "mqtt_message",
    data: { topic, payload: value, timestamp: Date.now() },
  });
});

mqttClient.on("connect", () => {
  brokerConnected = true;
})
function disconnectController() {
  interruptTemperature();
  powerOperation.disconnect();
  brokerConnected = false;
  observation.disconnect();
  panel.disconnect();
  displayPower.reset();
  heaterState.autoShutdown = null;
  heaterState.color = null;
  heaterState.flowrate = null;
  heaterState.volume = null;
  heaterState.temperatureControl = null;
  temperatureTokenReceivedAt = 0;
  broadcast({ event: "mqtt_message", data: { topic: "heater/state/temperature", payload: "unavailable" } });
}
mqttClient.on("offline", disconnectController);
mqttClient.on("close", disconnectController);

// sends state to front when they connect
wss.on("connection", (ws) => {
  const currentObservation = observedState();
  ws.send(
    JSON.stringify({
      event: "state_snapshot",
      data: { ...heaterState, panel: panel.snapshot(), desired: desiredState.snapshot(), reconciliation: temperatureReconciliation.snapshot(),
        ...presentationSnapshot(),
        status: currentObservation.online ? "online" : "offline",
        power: currentObservation.power,
        displayState: currentObservation.displayState,
        powerControl: currentObservation.powerControl,
        flowrate: currentObservation.online ? heaterState.flowrate : null,
        volume: currentObservation.online ? heaterState.volume : null,
        temperature: currentObservation.temperature, ...observedMaximum.snapshot(), camera: cameraModule.getState(),
      },
    }),
  );
  // commands from frontend to esp
  ws.on("message", (rawMessage) => {
    const command = parseCommand(rawMessage.toString());
    if (!command) {
      ws.send(JSON.stringify({ event: "command_error", data: { error: "Invalid command" } }));
      return;
    }
    const requestId = command.topic === "heater/set/temperature" || command.topic === "heater/set/temperature_base"
      ? Number(command.payload.split(",")[0]) : undefined;
    const reject = (error: string) => ws.send(JSON.stringify({ event: "command_error", data: { error, requestId, topic: command.topic } }));
    const currentObservation = observedState();
    const disarming = command.topic === "heater/set/autoshutdown" && command.payload === "false";
    if (!disarming && ["settling", "reading"].includes(panel.snapshot().recovery)) {
      reject("Display is waking; please wait");
      return;
    }
    if (!brokerConnected || !currentObservation.online || (!disarming && currentObservation.power === null)) {
      reject("Controller unavailable");
      return;
    }
    if (powerOperation.snapshot().status === "verifying" && command.topic !== "heater/set/autoshutdown") {
      reject("Power control is being verified; please wait");
      return;
    }
    if (command.topic === "heater/set/power" && !controllerIdle()) {
      reject("Power control unavailable or busy");
      return;
    }
    if (command.topic === "heater/set/temperature" || command.topic === "heater/set/temperature_base") {
      const control = heaterState.temperatureControl;
      if (!control || control.status !== "idle" ||
          (command.topic === "heater/set/temperature" && currentObservation.power !== true)) {
        reject("Temperature control unavailable or busy");
        return;
      }
    }
    if (command.topic === "heater/set/autoshutdown" && command.payload === "true") {
      const control = heaterState.temperatureControl;
      if (!control || control.status !== "idle" || control.locked) {
        reject("Controller busy; wait before enabling auto shutdown");
        return;
      }
      if ((control.autoShutdownTarget ?? -1) < 30) {
        if (control.autoShutdownRead !== 1 || currentObservation.power !== true) {
          reject("Enciende la terma para que Low Cortisol pueda comprobar la máxima.");
          return;
        }
        const camera = cameraModule.getState();
        const captureAge = Date.now() - Date.parse(camera.observedAt ?? "");
        if (!panel.snapshot().waterFresh || observedMaximum.snapshot().temperatureMaxSelected ||
            currentObservation.displayState.power !== true || !camera.available ||
            !(captureAge >= 0 && captureAge <= 3000)) {
          reject("Espera a que el visor muestre la temperatura fija antes de activar Low Cortisol.");
          return;
        }
      }
    }
    if (command.topic === "heater/set/temperature" &&
        !temperatureTransport(command.payload, heaterState.temperatureControl, temperatureTokenReceivedAt,
          Date.now(), process.env.MQTT_TEMPERATURE_QOS1 === "true")) {
      reject("Temperature controller token expired; retry shortly");
      return;
    }
    try {
      if (command.topic === "heater/set/autoshutdown")
        controlLog("auto_shutdown_requested", { enabled: command.payload === "true" });
      if (command.topic === "heater/set/power") {
        desiredState.setPower(command.payload === "true");
        powerOperation.request(command.payload === "true");
        controlLog("power_requested", { target: command.payload === "true" });
      }
      if (command.topic === "heater/set/temperature") {
        const values = command.payload.split(",");
        const target = Number(values[2]);
        desiredState.setTemperature(target);
        temperatureReconciliation.request(target, Number(values[0]));
        controlLog("temperature_requested", { commandId: Number(values[0]), target,
          base: heaterState.temperatureControl?.base ?? -1, directionPolicy: "shortest_wrap",
          opening: "verify_after_first_plus_with_second_plus_fallback", physicalConfirmed: false });
      }
    } catch {
      reject("Could not save the requested state");
      return;
    }
    if (!disarming && command.topic !== "heater/set/autoshutdown")
      displayPower.reset(Date.now() + 6000); // Discard in-flight/pre-action images.
    if (command.topic === "heater/set/temperature") publishTemperatureCommand(command.payload);
    else mqttClient.publish(command.topic, command.payload, { qos: 0, retain: false });
  });
});

console.log("Application broker started");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
function controllerIdle() {
  const state = observedState();
  return brokerConnected && state.online && heaterState.temperatureControl?.status === "idle" &&
    !heaterState.temperatureControl.locked;
}
const cameraModule = new CameraModule(mqttClient, frame => {
  const idle = controllerIdle();
  const currentCapture = displayPower.acceptsCapture(frame);
  observedMaximum.observe(frame);
  publishMaximumIfChanged();
  panel.observeFrame(frame, idle && currentCapture && !observedMaximum.snapshot().temperatureMaxSelected);
  const state = observedState();
  displayPower.observe(frame, idle, state.pilot);
  const displayObservation = displayPower.snapshot();
  const power = displayObservation.power;
  if (idle && displayObservation.mode === "standby" && displayObservation.observedAt === frame.observedAt)
    panel.observeStandby(frame.observedAt);
  if (idle && !sensorTestMode && power !== null && state.power !== power) {
    if (!power) { panel.observeMode("off", null, frame.observedAt); observedMaximum.clear(); publishMaximumIfChanged(); }
    mqttClient.publish("heater/input/power", String(power), { qos: 0, retain: false });
  }
  if (idle && power !== null && displayObservation.observedAt === frame.observedAt)
    powerHistory.observe(power, frame.observedAt, mqttClient);
  const acceptedWater = frame.purpose === "water" && idle && currentCapture &&
    !observedMaximum.snapshot().temperatureMaxSelected && panel.snapshot(frame.observedAt).waterFresh;
  if (acceptedWater && frame.value !== null && !sensorTestMode)
    waterHistory.observe(frame.value, frame.observedAt, mqttClient);
  return acceptedWater;
});
cameraModule.setup(app);
app.get("/api/heater/status", (_req, res) => {
  const state = observedState();
  res.set("Cache-Control", "no-store").json(buildStatusResponse({
    ...state, ...presentationSnapshot(), ...observedMaximum.snapshot(), panel: panel.snapshot(), desired: desiredState.snapshot(),
    reconciliation: temperatureReconciliation.snapshot(), autoShutdown: heaterState.autoShutdown,
    temperatureControl: heaterState.temperatureControl, flowrate: heaterState.flowrate, volume: heaterState.volume,
    camera: cameraModule.getState(),
  }));
});

function publishTemperatureCommand(payload: string) {
  const transport = temperatureTransport(payload, heaterState.temperatureControl,
    temperatureTokenReceivedAt, Date.now(), process.env.MQTT_TEMPERATURE_QOS1 === "true");
  const commandId = Number(payload.slice(0, payload.indexOf(",")));
  if (!transport) {
    controlLog("temperature_transport_rejected", { commandId, reason: "stale_controller_token" });
    return;
  }
  mqttClient.publish(transport.topic, transport.payload, { qos: transport.qos, retain: false }, error => {
    controlLog("temperature_transport_result", { commandId, qos: transport.qos,
      result: error ? "publish_failed" : transport.qos === 1 ? "broker_acknowledged" : "sent" });
  });
}

const panelEffects: Record<PanelEffect, () => void> = {
  press_plus: () => mqttClient.publish("heater/command/wake_display", "wake", { qos: 0, retain: false }),
  capture_water: () => { void cameraModule.readDisplayTemperature(); },
  failed: () => { console.warn("Display wake could not be confirmed"); },
};
let lastReconciliationStatus = "";
let lastPowerResult = "";
setInterval(() => {
  publishMaximumIfChanged();
  const previousAdjustment = temperatureReconciliation.snapshot();
  const userAdjustmentUnresolved = previousAdjustment.target !== null &&
    previousAdjustment.status !== "confirmed";
  const effect = panel.tick(Date.now(), controllerIdle(), !userAdjustmentUnresolved);
  if (effect) panelEffects[effect]();
  const state = observedState();
  const powerRetry = powerOperation.poll(brokerConnected && state.online, controllerIdle(), state.power, displayPower.snapshot());
  if (powerRetry) {
    displayPower.reset(Date.now() + 6000);
    controlLog("power_retry", { target: powerRetry.power, attempts: powerOperation.snapshot().attempts });
    mqttClient.publish("heater/set/power", String(powerRetry.power), { qos: 0, retain: false });
  }
  const powerResult = powerOperation.snapshot();
  const powerSignature = JSON.stringify(powerResult);
  if (powerSignature !== lastPowerResult) {
    lastPowerResult = powerSignature;
    broadcast({ event: "power_result", data: powerResult });
    const failed = powerResult.status === "failed";
    controlLog("power_operation", { ...powerResult, manualCheckRequired: failed,
      ...(failed ? { display: displayPower.snapshot(), camera: cameraModule.getDiagnosticEvidence(),
        mechanicalConfirmed: false } : {}) });
  }
  let command;
  try {
    command = temperatureReconciliation.poll(heaterState.temperatureControl,
      brokerConnected && state.online, powerResult.status !== "verifying" && state.power === true && state.temperature !== null && state.display === "readable" &&
        panel.snapshot().recovery === "idle" && !!temperatureTransport("0,-1,30", heaterState.temperatureControl,
          temperatureTokenReceivedAt, Date.now(), process.env.MQTT_TEMPERATURE_QOS1 === "true"));
  } catch {
    console.error("Could not save temperature verification state");
    return;
  }
  if (command) {
    controlLog("temperature_retry", { ...temperatureReconciliation.snapshot(), commandId: command.id,
      base: command.base, directionPolicy: "shortest_wrap", reacquireTarget: true });
    publishTemperatureCommand(`${command.id},${command.base},${command.target}`);
  }
  const reconciliation = temperatureReconciliation.snapshot();
  if (reconciliation.status !== lastReconciliationStatus) {
    lastReconciliationStatus = reconciliation.status;
    broadcast({ event: "temperature_result", data: reconciliation });
    const failed = reconciliation.status === "failed";
    const control = heaterState.temperatureControl;
    controlLog("temperature_operation", { ...reconciliation, manualCheckRequired: failed,
      ...(failed ? { requestedTemperature: reconciliation.target,
        controller: control && { commandId: control.commandId, result: control.result, phase: control.status,
          estimatedTemperatureMax: control.base, failureReason: control.failureReason,
          observedMaximumAtFailure: control.observedMaximumAtFailure },
        camera: cameraModule.getDiagnosticEvidence(), mechanicalConfirmed: false } : {}) });
  }
}, 1000);

const frontendPath = path.resolve(__dirname, "../../front");

app.use(express.static(frontendPath));

app.listen(3000, "0.0.0.0", () => {
  console.log("Frontend running on port 3000");
});
