import "dotenv/config";

import { mqttClient } from "./mqtt/client.js";
import { wss, broadcast } from "./websocket/server.js";

import { fileURLToPath } from "url";
import express from "express";
import path from "path";
import { CameraModule } from "./camera/module.js";
import { classifyPilot, HeaterObservation, type PilotState } from "./heater/state.js";
import { pilotCommand } from "./heater/pilot-command.js";
import { parseTemperatureControl, type TemperatureControl } from "./heater/temperature-control.js";
import { parseCommand } from "./websocket/command.js";
import { TemperatureReconciliation } from "./heater/temperature-reconciliation.js";
import { HeaterPanelState, type PanelEffect } from "./heater/panel-state.js";
import { DesiredState } from "./heater/desired-state.js";

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
const savedTarget = desiredState.snapshot().temperature;
if (savedTarget !== null && temperatureReconciliation.snapshot().target !== savedTarget)
  temperatureReconciliation.request(savedTarget);

const sensorTestMode = process.env.TEMPORARY_SENSOR_TEST_MODE === "true";
const observation = new HeaterObservation(sensorTestMode);
const panel = new HeaterPanelState();
let brokerConnected = false;
let lastPilot: PilotState | null = null;

function observedState() {
  const state = observation.snapshot(cameraModule.getState());
  const control = heaterState.temperatureControl;
  const waterAccepted = sensorTestMode || (control?.status === "idle" && !control.locked && panel.snapshot().waterFresh);
  return { ...state, temperature: waterAccepted ? state.temperature : null };
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
  const value = payload.toString();
  observation.update(topic, value, packet.retain);
  if (packet.retain && !(topic === "heater/status" && value === "offline")) return;

  switch (topic) {
    case "heater/state/temperature_control":
      heaterState.temperatureControl = parseTemperatureControl(value);
      break;
    case "heater/state/autoshutdown":
      heaterState.autoShutdown = value === "true" ? true : value === "false" ? false : null;
      break;
    case "heater/state/flowrate":
    case "heater/state/volume": {
      const numeric = value.trim() === "" ? NaN : Number(value);
      heaterState[topic.endsWith("/flowrate") ? "flowrate" : "volume"] = Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
      break;
    }
    case "heater/state/color": {
      heaterState.color = value === "unavailable" ? null : value;
      const pilot = classifyPilot(heaterState.color);
      if (pilot !== lastPilot) {
        console.log(`Pilot state ${lastPilot ?? "none"} -> ${pilot} (raw ${heaterState.color ?? "unavailable"})`);
        lastPilot = pilot;
      }
      const observed = observedState();
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
      panel.disconnect();
      heaterState.flowrate = null;
      heaterState.volume = null;
      // A (re)connecting controller starts without a known power observation.
      heaterState.temperatureControl = null;
      heaterState.autoShutdown = null;
      heaterState.color = null;
      break;
  }

  console.log(`Received ${payload} from ${topic}. Broadcasting...`);
  broadcast({
    event: "mqtt_message",
    data: { topic, payload: value, timestamp: Date.now() },
  });
});

mqttClient.on("connect", () => {
  brokerConnected = true;
})
function disconnectController() {
  brokerConnected = false;
  observation.disconnect();
  panel.disconnect();
  heaterState.autoShutdown = null;
  heaterState.color = null;
  heaterState.flowrate = null;
  heaterState.volume = null;
  heaterState.temperatureControl = null;
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
        status: currentObservation.online ? "online" : "offline",
        power: currentObservation.power,
        flowrate: currentObservation.online ? heaterState.flowrate : null,
        volume: currentObservation.online ? heaterState.volume : null,
        temperature: currentObservation.temperature,
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
    const reject = (error: string) => ws.send(JSON.stringify({ event: "command_error", data: { error, requestId } }));
    const currentObservation = observedState();
    if (["settling", "reading"].includes(panel.snapshot().recovery)) {
      reject("Display is waking; please wait");
      return;
    }
    if (!brokerConnected || !currentObservation.online || currentObservation.power === null) {
      reject("Controller unavailable");
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
    try {
      if (command.topic === "heater/set/power") desiredState.setPower(command.payload === "true");
      if (command.topic === "heater/set/temperature") {
        const values = command.payload.split(",");
        const target = Number(values[2]);
        desiredState.setTemperature(target);
        temperatureReconciliation.request(target, Number(values[0]));
      }
    } catch {
      reject("Could not save the requested state");
      return;
    }
    mqttClient.publish(command.topic, command.payload, { qos: 0, retain: false });
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
  panel.observeFrame(frame, idle);
  return idle && panel.snapshot(frame.observedAt).waterFresh;
});
cameraModule.setup(app);
app.get("/api/heater/status", (_req, res) => {
  const state = observedState();
  res.set("Cache-Control", "no-store").json({ ...state, panel: panel.snapshot(), desired: desiredState.snapshot(), reconciliation: temperatureReconciliation.snapshot(),
    temperatureControl: state.online ? heaterState.temperatureControl : null,
    flowrate: state.online ? heaterState.flowrate : null,
    volume: state.online ? heaterState.volume : null,
  });
});

const panelEffects: Record<PanelEffect, () => void> = {
  press_plus: () => mqttClient.publish("heater/command/wake_display", "wake", { qos: 0, retain: false }),
  capture_water: () => { void cameraModule.readDisplayTemperature(); },
  failed: () => { console.warn("Display wake could not be confirmed"); },
};
let lastReconciliationStatus = "";
setInterval(() => {
  const effect = panel.tick(Date.now(), controllerIdle());
  if (effect) panelEffects[effect]();
  const state = observedState();
  let command;
  try {
    command = temperatureReconciliation.poll(heaterState.temperatureControl,
      brokerConnected && state.online, state.power === true && state.temperature !== null && state.display === "readable" &&
        panel.snapshot().recovery === "idle");
  } catch {
    console.error("Could not save temperature verification state");
    return;
  }
  if (command) mqttClient.publish("heater/set/temperature", `${command.id},${command.base},${command.target}`, { qos: 0, retain: false });
  const reconciliation = temperatureReconciliation.snapshot();
  if (reconciliation.status !== lastReconciliationStatus) {
    lastReconciliationStatus = reconciliation.status;
    broadcast({ event: "temperature_result", data: reconciliation });
  }
}, 1000);

const frontendPath = path.resolve(__dirname, "../../front");

app.use(express.static(frontendPath));

app.listen(3000, "0.0.0.0", () => {
  console.log("Frontend running on port 3000");
});
