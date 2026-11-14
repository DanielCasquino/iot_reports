#include <iostream>
#include <HardwareSerial.h>
#include <WiFi.h>
#include "secrets.h"
#include "config.h"
#include "heater_module.h"
#include "mqtt_module.h"
#include "display_module.h"

using namespace std;

HeaterModule heaterModule;
MqttModule mqttModule;
DisplayModule displayModule(DISPLAY_ADDRESS);

unsigned long last_ms;
unsigned long lastDiagnostic_ms;

// Required global callback for connection events
void onMqttConnect(esp_mqtt_client_handle_t client)
{
  MqttModule::onConnect(client);
}

void setup()
{
  Serial.begin(115200);
  Serial.printf("Boot reset reason: %d\n", int(esp_reset_reason()));
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  heaterModule.setup();
  Serial.println(displayModule.setup() ? "Display initialized at 0x3C" : "Display initialization failed at 0x3C");
  mqttModule.attach(heaterModule);
  mqttModule.setup();

  last_ms = millis();
}

void loop()
{
  if (heaterModule.loop())
    mqttModule.publishPowerState();
  if (heaterModule.takeTemperatureControlChanged())
    mqttModule.publishTemperatureControl();
  mqttModule.requestTemperatureVerification();
  unsigned long curr_ms = millis();
  if (curr_ms - last_ms >= TICK_INTERVAL_MS)
  {
    last_ms = curr_ms;
    if (heaterModule.monitorAutoShutdown())
      mqttModule.publishPowerState();
    mqttModule.publishState();
    char temperature[11], state[22];
    if (heaterModule.isTemperatureAvailable())
      snprintf(temperature, sizeof(temperature), "%.1f C", heaterModule.getTemperature());
    else snprintf(temperature, sizeof(temperature), "-- C");
    const char *power = heaterModule.isPowerKnown() ? (heaterModule.getPower() ? "ON" : "OFF") : "?";
    if (heaterModule.getSetpoint() >= MIN_TEMPERATURE_C)
      snprintf(state, sizeof(state), "%s set %dC", power, heaterModule.getSetpoint());
    else snprintf(state, sizeof(state), "%s set --", power);
    displayModule.setLines(temperature, state);
  }
  displayModule.poll();
  if (curr_ms - lastDiagnostic_ms >= 5000UL)
  {
    lastDiagnostic_ms = curr_ms;
    Serial.printf("Health uptime=%lu heap=%u wifi=%d rssi=%d mqtt=%d display=%d color=%d buttons=%d,%d,%d\n",
                  curr_ms, unsigned(ESP.getFreeHeap()), int(WiFi.status()),
                  WiFi.RSSI(), int(mqttClient.isConnected()), int(displayModule.isAvailable()),
                  int(heaterModule.getColor().isAvailable()), digitalRead(BUTTON_PIN_A),
                  digitalRead(BUTTON_PIN_B), digitalRead(BUTTON_PIN_C));
  }
}
