#include <WiFi.h>
#include <PubSubClient.h>
#include "secrets_local.h"



WiFiClient cliente;
PubSubClient mqtt(cliente);

void setup() {
  Serial.begin(115200);
  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println(WiFi.localIP());
  mqtt.setServer(mqtt_broker, 1883);
}

void loop() {
  int valor = analogRead(35);
  Serial.println(valor);

  if (!mqtt.connected()) {
    if (!mqtt.connect(WiFi.macAddress().c_str())) {
      Serial.print("mqtt: ");
      Serial.println(mqtt.state());
      delay(1000);
      return;
    }
  }

  mqtt.loop();
  mqtt.publish("lab/ldr", String(valor).c_str());
  delay(1000);
}
