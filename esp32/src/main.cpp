#include <iostream>
#include <HardwareSerial.h>
#include <WiFi.h>
#include "ESP32MQTTClient.h"
#include "secrets.h"

using namespace std;

const float AMBIENT_TEMPERATURE = 24.0;
const int WIFI_RECONNECT_MS = 2000;

const unsigned long TICKRATE_MS = 2000;
const float MAX_TEMPERATURE_C = 40.0;

const float MIN_TEMPERATURE_C = 20.0;
const float COOLRATE_C = 0.1;
const float HEATRATE_C = 0.1;

struct HeaterState
{
public:
  bool power = false;
  bool is_auto_shutdown_enabled = false;
  float temperature = AMBIENT_TEMPERATURE;
};

HeaterState state;
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
    if (state.is_auto_shutdown_enabled)
      return;
    state.is_auto_shutdown_enabled = true;
    changed = true;
  }
  else if (payload == "false")
  {
    if (!state.is_auto_shutdown_enabled)
      return;
    state.is_auto_shutdown_enabled = false;
    changed = true;
  }
  else
  {
    Serial.println("Invalid autoshutdown payload");
  }

  if (!mqttClient.isConnected() || !changed)
    return;

  mqttClient.publish("heater/state/autoshutdown", state.is_auto_shutdown_enabled ? "true" : "false", 1, true);
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
  state.temperature += (state.power ? HEATRATE_C : -COOLRATE_C);
  state.temperature = constrain(state.temperature, MIN_TEMPERATURE_C, MAX_TEMPERATURE_C);

  if (state.is_auto_shutdown_enabled && state.temperature == MAX_TEMPERATURE_C && state.power)
  {
    state.power = false;
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

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  mqttClient.setURI("mqtt://192.168.1.55:1883");
  mqttClient.loopStart();

  start_ms = millis();
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