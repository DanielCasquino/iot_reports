#include <iostream>
#include <HardwareSerial.h>
#include <WiFi.h>
#include "ESP32MQTTClient.h"
#include "secrets.h"
#include "temperature_module.h"
#include "config.h"

using namespace std;

const int WIFI_RECONNECT_MS = 2000;
const unsigned long TICKRATE_MS = 2000;

struct HeaterState
{
public:
  bool power = false;
  bool isAutoShutdownEnabled = false;
  float temperature = 20.0; // default temperature
};

HeaterState state;
TemperatureModule temperatureModule;
ESP32MQTTClient mqttClient;
unsigned long start_ms;
unsigned long curr_ms;

void handle_power(const std::string &payload)
{
  bool changed = false;
  Serial.println(payload.c_str());
  if (payload == "true")
  {
    if (state.power)
      return;
    state.power = true;
    digitalWrite(LED_BUILTIN, HIGH);
    changed = true;
  }
  else if (payload == "false")
  {
    if (!state.power)
      return;
    state.power = false;
    digitalWrite(LED_BUILTIN, LOW);
    changed = true;
  }
  else
  {
    Serial.println("Invalid power payload");
  }

  if (!mqttClient.isConnected() || !changed)
    return;

  mqttClient.publish("heater/state/power", state.power ? "true" : "false", 1, true);
}

void handle_auto_shutdown(const std::string &payload)
{
  bool changed = false;
  Serial.println(payload.c_str());
  if (payload == "true")
  {
    if (state.isAutoShutdownEnabled)
      return;
    state.isAutoShutdownEnabled = true;
    changed = true;
  }
  else if (payload == "false")
  {
    if (!state.isAutoShutdownEnabled)
      return;
    state.isAutoShutdownEnabled = false;
    changed = true;
  }
  else
  {
    Serial.println("Invalid autoshutdown payload");
  }

  if (!mqttClient.isConnected() || !changed)
    return;

  mqttClient.publish("heater/state/autoshutdown", state.isAutoShutdownEnabled ? "true" : "false", 1, true);
}

// Required global callback for connection events
void onMqttConnect(esp_mqtt_client_handle_t client)
{
  if (mqttClient.isMyTurn(client))
  {
    // Subscribe to topics here
    mqttClient.subscribe("heater/set/power", [](const std::string &payload)
                         { handle_power(payload); });
    mqttClient.subscribe("heater/set/autoshutdown", [](const std::string &payload)
                         { handle_auto_shutdown(payload); });
  }
}

// Required global event handler - ESP-IDF version dependent
#if ESP_IDF_VERSION < ESP_IDF_VERSION_VAL(5, 0, 0)
esp_err_t handleMQTT(esp_mqtt_event_handle_t event)
{
  mqttClient.onEventCallback(event);
  return ESP_OK;
}
#else
void handleMQTT(void *handler_args, esp_event_base_t base, int32_t event_id, void *event_data)
{
  (void)base;
  (void)event_id;
  auto *client = static_cast<ESP32MQTTClient *>(handler_args);
  auto *event = static_cast<esp_mqtt_event_handle_t>(event_data);
  client->onEventCallback(event);
}
#endif

void connect_wifi()
{
  if (WiFi.status() == WL_CONNECTED)
    return;

  Serial.println("WiFi disconnected. Reconnecting...");
  WiFi.reconnect();

  while (WiFi.status() != WL_CONNECTED)
  {
    delay(WIFI_RECONNECT_MS);
    Serial.println("Waiting for WiFi...");
  }

  Serial.println("WiFi connected succesfully.");
  Serial.println(WiFi.localIP());
  // should probably reconnect mqtt too
}

void tick()
{
  state.temperature = temperatureModule.read();

  if (state.isAutoShutdownEnabled && state.temperature >= MAX_TEMPERATURE_C && state.power)
  {
    state.power = false;
    digitalWrite(LED_BUILTIN, LOW);
    if (mqttClient.isConnected())
      mqttClient.publish("heater/state/power", "false", 1, true);
  }

  if (!mqttClient.isConnected())
    return;

  mqttClient.publish("heater/state/temperature", std::to_string(state.temperature), 1, true);
}

void setup()
{
  Serial.begin(115200);

  state = HeaterState();
  temperatureModule = TemperatureModule();

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  mqttClient.setURI(BROKER_URI);
  mqttClient.loopStart();

  start_ms = millis();

  if (mqttClient.isConnected())
  {
    mqttClient.publish("heater/state/power", "false", 1, true);
    mqttClient.publish("heater/state/autoshutdown", "false", 1, true);
    mqttClient.publish("heater/state/temperature", std::to_string(temperatureModule.read()), 1, true);
  }

  pinMode(LED_BUILTIN, OUTPUT);
}

void loop()
{
  connect_wifi();

  curr_ms = millis();
  if (curr_ms - start_ms >= TICKRATE_MS)
  {
    tick();
    start_ms = curr_ms;
  }
}