#include <iostream>
#include <HardwareSerial.h>
#include <WiFi.h>
#include "secrets.h"
#include "config.h"
#include "heater_module.h"
#include "mqtt_module.h"

using namespace std;

HeaterModule heaterModule;
MqttModule mqttModule;

unsigned long last_ms;

// Required global callback for connection events
void onMqttConnect(esp_mqtt_client_handle_t client)
{
  MqttModule::onConnect(client);
}

void setup()
{
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  heaterModule.setup();
  mqttModule.attach(heaterModule);
  mqttModule.setup();

  last_ms = millis();
}

void loop()
{
  if (heaterModule.loop())
    mqttModule.publishPowerState();
  mqttModule.requestTemperatureVerification();
  unsigned long curr_ms = millis();
  if (curr_ms - last_ms >= TICK_INTERVAL_MS)
  {
    last_ms = curr_ms;
    if (heaterModule.monitorAutoShutdown())
      mqttModule.publishPowerState();
    mqttModule.publishState();
  }
}