import "dotenv/config";

import { mqttClient } from "./mqtt/client.js";
import { wss, broadcast } from "./websocket/server.js";

import { fileURLToPath } from "url";
import express from "express";
import path from "path";

interface HeaterState {
  power: boolean | null;
  autoShutdown: boolean | null;
  temperature: number | null;
}

const heaterState: HeaterState = {
  power: null,
  autoShutdown: null,
  temperature: null,
};

mqttClient.on("message", (topic, payload) => {
  const value = payload.toString();

  switch (topic) {
    case "heater/state/power":
      heaterState.power = value === "true";
      break;
    case "heater/state/autoshutdown":
      heaterState.autoShutdown = value === "true";
      break;
    case "heater/state/temperature":
      heaterState.temperature = Number(value);
      break;
  }

  console.log(`Received ${payload} from ${topic}. Broadcasting...`);
  broadcast({
    event: "mqtt_message",
    data: { topic, payload: value, timestamp: Date.now() },
  });
});

wss.on("connection", (ws) => {
  ws.send(
    JSON.stringify({
      event: "state_snapshot",
      data: heaterState,
    }),
  );
  ws.on("message", (rawMessage) => {
    const message = JSON.parse(rawMessage.toString());
    switch (message.event) {
      case "set_heater_power":
        console.log("sending power publish");
        console.log(String(message.data.enabled));
        mqttClient.publish("heater/set/power", String(message.data.enabled));
        break;

      case "set_auto_shutdown":
        console.log("sending auto shutdown publish");
        console.log(String(message.data.enabled));
        mqttClient.publish(
          "heater/set/autoshutdown",
          String(message.data.enabled),
        );
        break;
    }
  });
});

console.log("Application broker started");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const frontendPath = path.resolve(__dirname, "../../front");

app.use(express.static(frontendPath));

app.listen(3000, "0.0.0.0", () => {
  console.log("Frontend running on port 3000");
});
