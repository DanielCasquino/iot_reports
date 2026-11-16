#include <Arduino.h>
#include <WiFi.h>
#include "secrets.h"
#include "config.h"
#include "heater_module.h"
#include "mqtt_module.h"
#include "display_module.h"


HeaterModule heaterModule;
MqttModule mqttModule;
DisplayModule displayModule(DISPLAY_ADDRESS);
DisplayMirror displayMirror;

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
  WiFi.setSleep(false);

  heaterModule.setup();
  displayMirror.setup();
  Serial.println(displayModule.setup() ? "Display initialized at 0x3C" : "Display initialization failed at 0x3C");
  mqttModule.attach(heaterModule);
  mqttModule.attachDisplay(displayMirror);
  mqttModule.setup();

  last_ms = millis();
}

void loop()
{
  mqttModule.loop();
  if (heaterModule.loop())
    mqttModule.publishPowerState();
  if (heaterModule.takeTemperatureControlChanged())
    mqttModule.publishTemperatureControl();
  mqttModule.requestTemperatureVerification();
  mqttModule.requestWakeVerification();
  unsigned long curr_ms = millis();
  if (curr_ms - last_ms >= TICK_INTERVAL_MS)
  {
    last_ms = curr_ms;
    if (heaterModule.monitorAutoShutdown())
      mqttModule.publishPowerState();
    mqttModule.publishState();
  }
  displayModule.setLines(displayMirror.text(curr_ms), "");
  displayModule.poll();
  if (curr_ms - lastDiagnostic_ms >= 5000UL)
  {
    lastDiagnostic_ms = curr_ms;
    Serial.printf("Health uptime=%lu heap=%u wifi=%d rssi=%d wifi_sleep=%d mqtt=%d display=%d color=%d buttons=%d,%d,%d\n",
                  curr_ms, unsigned(ESP.getFreeHeap()), int(WiFi.status()),
                  WiFi.RSSI(), int(WiFi.getSleep()), int(mqttClient.isConnected()), int(displayModule.isAvailable()),
                  int(heaterModule.getColor().isAvailable()), digitalRead(BUTTON_PIN_A),
                  digitalRead(BUTTON_PIN_B), digitalRead(BUTTON_PIN_C));
  }
}
