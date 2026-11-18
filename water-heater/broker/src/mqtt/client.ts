import mqtt from "mqtt";

export const mqttClient = mqtt.connect(
  process.env.MQTT_URL ?? "mqtt://192.168.1.208:1883",
  {
    reconnectPeriod: 2000,
    queueQoSZero: false,
  },
);

mqttClient.on("connect", () => {
  console.log("Connected to Mosquitto");

  // Subscribe to state and liveness together before requesting a live snapshot.
  // Otherwise a retained status delivered by a later subscription can invalidate
  // the fresh state that the controller has just sent.
  mqttClient.subscribe(["heater/state/#", "heater/status", "heater/diagnostic/servo"], { qos: 1 }, (error) => {
    if (error) console.error("Subscription error:", error);
    else {
      console.log("Subscribed to heater topics");
      mqttClient.publish("heater/command/state_snapshot", "get", {
        qos: 0,
        retain: false,
      });
    }
  });
});

mqttClient.on("reconnect", () => {
  console.log("Reconnecting to Mosquitto...");
});

mqttClient.on("error", (error) => {
  console.error("MQTT error:", error);
});
