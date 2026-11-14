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
import { DesiredState } from "./heater/desired-state.js";

interface HeaterState {
  temperatureControl: TemperatureControl | null;
  power: boolean | null;
  autoShutdown: boolean | null;
  temperature: number | null;
  status: "online" | "offline" | null;
  color: string | null;
  flowrate: number | null;
  volume: number | null;
}

const heaterState: HeaterState = {
  temperatureControl: null,
  power: null,
  autoShutdown: null,
  temperature: null,
  color: null,
  flowrate: null,
  volume: null,
  status: null
};

const desiredState = new DesiredState(path.resolve(process.env.HEATER_DESIRED_STATE_FILE ?? ".runtime/desired-state.json"));

const temperatureReconciliation = new TemperatureReconciliation();
const savedTarget = desiredState.snapshot().temperature;
if (savedTarget !== null) temperatureReconciliation.request(savedTarget);

const sensorTestMode = process.env.TEMPORARY_SENSOR_TEST_MODE === "true";
const observation = new HeaterObservation(sensorTestMode);
let brokerConnected = false;
let lastPilot: PilotState | null = null;

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
  if (packet.retain && value !== "offline") return;

  switch (topic) {
    case "heater/state/temperature_control":
      heaterState.temperatureControl = parseTemperatureControl(value);
      break;
    case "heater/state/power":
      heaterState.power = value === "true" ? true : value === "false" ? false : null;
      break;
    case "heater/state/autoshutdown":
      heaterState.autoShutdown = value === "true";
      break;
    case "heater/state/temperature":
      heaterState.temperature = value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
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
      const command = pilotCommand(pilot, {
        retained: packet.retain,
        sensorTestMode,
        brokerConnected,
        controllerOnline: observation.snapshot(cameraModule.getState()).online,
      });
      if (command) mqttClient.publish(command.topic, command.payload, command.options);
      if (command && heaterState.power === null && (pilot === "heating" || pilot === "ready")) {
        mqttClient.publish("heater/input/power", "true", { qos: 0, retain: false });
      }
      break;
    }
    case "heater/status":
      heaterState.status = value === "online" ? "online" : "offline";
      heaterState.flowrate = null;
      heaterState.volume = null;
      // A (re)connecting controller starts without a known power observation.
      heaterState.power = null;
      if (heaterState.status === "offline") heaterState.temperature = null;
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
mqttClient.on("offline", () => {
  brokerConnected = false;
  observation.disconnect();
  heaterState.flowrate = null;
  heaterState.volume = null;
  heaterState.temperatureControl = null;
  heaterState.temperature = null;
  broadcast({ event: "mqtt_message", data: { topic: "heater/state/temperature", payload: "unavailable" } });
})
mqttClient.on("close", () => {
  brokerConnected = false;
  observation.disconnect();
  heaterState.flowrate = null;
  heaterState.volume = null;
  heaterState.temperatureControl = null;
  heaterState.temperature = null;
  broadcast({ event: "mqtt_message", data: { topic: "heater/state/temperature", payload: "unavailable" } });
})

// sends state to front when they connect
wss.on("connection", (ws) => {
  const currentObservation = observation.snapshot(cameraModule.getState());
  ws.send(
    JSON.stringify({
      event: "state_snapshot",
      data: { ...heaterState, desired: desiredState.snapshot(), reconciliation: temperatureReconciliation.snapshot(),
        status: currentObservation.online ? "online" : "offline",
        power: currentObservation.power,
        flowrate: currentObservation.online ? heaterState.flowrate : null,
        volume: currentObservation.online ? heaterState.volume : null,
        temperature: currentObservation.temperature === null ? null : heaterState.temperature,
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
    const currentObservation = observation.snapshot(cameraModule.getState());
    if (!brokerConnected || !currentObservation.online || currentObservation.power === null) {
      ws.send(JSON.stringify({ event: "command_error", data: { error: "Controller unavailable" } }));
      return;
    }
    if (command.topic === "heater/set/temperature" || command.topic === "heater/set/temperature_base") {
      const control = heaterState.temperatureControl;
      if (!control || control.status !== "idle" ||
          (command.topic === "heater/set/temperature" && currentObservation.power !== true)) {
        ws.send(JSON.stringify({ event: "command_error", data: { error: "Temperature control unavailable or busy" } }));
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
      ws.send(JSON.stringify({ event: "command_error", data: { error: "Could not save the requested state" } }));
      return;
    }
    mqttClient.publish(command.topic, command.payload, { qos: 0, retain: false });
  });
});

console.log("Application broker started");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const cameraModule = new CameraModule(mqttClient);
cameraModule.setup(app);
app.get("/api/heater/status", (_req, res) => {
  const state = observation.snapshot(cameraModule.getState());
  res.set("Cache-Control", "no-store").json({ ...state, desired: desiredState.snapshot(), reconciliation: temperatureReconciliation.snapshot(),
    temperatureControl: state.online ? heaterState.temperatureControl : null,
    flowrate: state.online ? heaterState.flowrate : null,
    volume: state.online ? heaterState.volume : null,
  });
});

let lastReconciliationStatus = "";
setInterval(() => {
  const state = observation.snapshot(cameraModule.getState());
  const command = temperatureReconciliation.poll(heaterState.temperatureControl,
    brokerConnected && state.online, state.power === true && state.display === "readable");
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
