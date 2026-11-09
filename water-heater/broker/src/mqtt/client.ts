import mqtt from "mqtt";

export const mqttClient = mqtt.connect(
  process.env.MQTT_URL ?? "mqtt://192.168.1.225:1883",
  {
    reconnectPeriod: 2000,
  },
);

mqttClient.on("connect", () => {
  console.log("Connected to Mosquitto");

  mqttClient.subscribe(["heater/state/#"], (error) => {
    if (error) console.error("Subscription error:", error);
    else console.log("Subscribed to heater topics");
  });
});

mqttClient.on("reconnect", () => {
  console.log("Reconnecting to Mosquitto...");
});

mqttClient.on("error", (error) => {
  console.error("MQTT error:", error);
});
