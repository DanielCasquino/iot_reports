#include <cassert>
#include <cstdint>
#include <vector>
#include <utility>
#include <string>
uint32_t testNow = 2000;
int levels[40];
std::vector<std::pair<int, int>> movements;
#define BROKER_URI "mqtt://test.invalid"
#include "mqtt_module.h"
TestSerial Serial;

void receive(const char *topic, const char *payload, bool retained = false) {
    esp_mqtt_event_t event; event.topic = topic; event.payload = payload; event.retain = retained;
    handleMQTT(&mqttClient, nullptr, 0, &event);
}
int main() {
    for (auto &level : levels) level = HIGH;
    HeaterModule heater; heater.setup();
    MqttModule mqtt; mqtt.attach(heater); mqtt.setup();
    MqttModule::onConnect(nullptr); mqtt.loop(); heater.loop(); movements.clear();
    assert(!heater.isPowerKnown());
    receive("heater/input/power", "false", true); mqtt.loop(); heater.loop();
    assert(!heater.isPowerKnown());
    receive("heater/input/power", "false");
    assert(!heater.isPowerKnown()); // Transport callback cannot change hardware state.
    mqtt.loop(); heater.loop();
    assert(heater.isPowerKnown() && !heater.getPower() && movements.empty());
    receive("heater/set/power", "true"); mqtt.loop(); heater.loop();
    assert(movements.size() == 2 && movements[0].first == SERVO_PIN_A);
    assert(!heater.isPowerKnown()); // Actuation waits for actual optical ON.
    testNow++;
    receive("heater/input/power", "true"); mqtt.loop(); heater.loop();
    assert(heater.isPowerKnown() && heater.getPower());
    receive("heater/input/power", "false"); mqtt.loop(); heater.loop();
    assert(heater.isPowerKnown() && !heater.getPower() && movements.size() == 2);
    receive("heater/input/power", "true"); mqtt.loop(); heater.loop();
    assert(heater.isPowerKnown() && heater.getPower()); // Manual ON after known OFF.
    receive("heater/input/power", "false", true); mqtt.loop(); heater.loop();
    receive("heater/input/power", "unknown"); mqtt.loop(); heater.loop();
    assert(heater.getPower());
    receive("heater/input/power", "false"); testNow += 5001; mqtt.loop(); heater.loop();
    assert(heater.getPower()); // Expired inbox message is not a fresh OFF.
    receive("heater/input/power", "false"); mqtt.loop();
    MqttModule::onConnect(nullptr); heater.loop(); mqtt.loop(); heater.loop();
    assert(!heater.isPowerKnown()); // Prior-session OFF cannot survive reconnect.
    testNow++;
    receive("heater/input/power", "true"); mqtt.loop(); heater.loop();
    receive("heater/set/temperature", "1,-1,44"); mqtt.loop(); heater.loop();
    auto before = movements.size();
    receive("heater/input/power", "false"); mqtt.loop(); heater.loop();
    assert(heater.getPower() && movements.size() == before); // Selection is not an OFF observation window.
    HeaterModule dim; dim.setup(); MqttModule dimMqtt; dimMqtt.attach(dim); dimMqtt.setup();
    MqttModule::onConnect(nullptr); dimMqtt.loop(); dim.loop(); movements.clear();
    receive("heater/input/power", "true"); dimMqtt.loop(); dim.loop();
    receive("heater/set/power", "false"); dimMqtt.loop(); dim.loop();
    assert(movements.size() == 2 && movements[0].first == SERVO_PIN_B); // Optical ON still needs the wake handshake.
}
