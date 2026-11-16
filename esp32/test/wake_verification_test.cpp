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

void receive(const std::string &payload, bool retained = false) {
    esp_mqtt_event_t event;
    event.topic = "heater/input/wake_verification";
    event.payload = payload;
    event.retain = retained;
    handleMQTT(&mqttClient, nullptr, 0, &event);
}
uint32_t startWake(HeaterModule &heater) {
    heater.observePowerOn();
    heater.observePilot(HeaterModule::PilotState::Unknown);
    heater.loop();
    heater.requestPower(false);
    heater.loop();
    assert(movements.size() == 2 && movements[0].first == SERVO_PIN_B);
    assert(std::string(heater.getAdjustmentStatus()) == "applying");
    assert(!heater.isTemperatureAvailable());
    return testNow;
}
int main() {
    for (auto &level : levels) level = HIGH;
    // Exercise the real MQTT subscription, inbox and controller, with no RGB.
    {
        HeaterModule heater; heater.setup();
        MqttModule mqtt; mqtt.attach(heater); mqtt.setup();
        MqttModule::onConnect(nullptr); mqtt.loop(); heater.loop();
        movements.clear(); mqttClient.published.clear();
        auto start = startWake(heater);
        auto id = std::to_string(heater.wakeVerificationId());
        testNow = start + TEMPERATURE_ADJUST_SETTLE_MS - 1;
        mqtt.requestWakeVerification();
        assert(mqttClient.published.empty());
        // Even a matching unsolicited/early response cannot satisfy the wake.
        receive(id + ",42"); mqtt.loop(); heater.loop();
        testNow++;
        mqtt.requestWakeVerification();
        assert(mqttClient.published.size() == 1);
        assert(mqttClient.published.back().first == "heater/command/verify_wake");
        assert(mqttClient.published.back().second == id);
        mqtt.requestWakeVerification();
        assert(mqttClient.published.size() == 1); // Throttled.
        for (auto bad : {"-1,42", "4294967296,42", "12,42junk", "12,nan"}) {
            receive(bad); mqtt.loop(); heater.loop();
        }
        for (auto value : {NAN, -1.0f, 101.0f}) {
            heater.verifyWake(heater.wakeVerificationId(), value); heater.loop();
        }
        heater.verifyWake(heater.wakeVerificationId() + 1, 42); heater.loop();
        receive(id + ",42", true); mqtt.loop(); heater.loop();
        assert(movements.size() == 2);
        receive(id + ",42");
        heater.loop(); assert(movements.size() == 2); // MQTT callback cannot act.
        mqtt.loop(); heater.loop();
        assert(!heater.isTemperatureAvailable()); // ACK never becomes water.
        heater.loop();
        assert(movements.size() == 4 && movements[2].first == SERVO_PIN_A);
        assert(!heater.isPowerKnown()); // A write still cannot certify physical OFF.
        assert(!heater.isTemperatureAvailable());
    }
    // Timeout cancels the action, including an ACK received too late.
    {
        testNow = 2000; HeaterModule heater; heater.setup(); movements.clear();
        auto start = startWake(heater);
        testNow = start + TEMPERATURE_ADJUST_SETTLE_MS;
        assert(heater.needsWakeVerification());
        auto id = heater.wakeVerificationId();
        testNow = start + PILOT_WAKE_TIMEOUT_MS;
        heater.verifyWake(id, 42); heater.loop(); heater.loop();
        assert(std::string(heater.getAdjustmentStatus()) == "error");
        assert(movements.size() == 2);
        for (int i = 0; i < 20; i++) { testNow += 1000; heater.loop(); }
        assert(movements.size() == 2);
        // An explicit retry gets a new ID; an old ACK cannot authorize it.
        heater.requestPower(false); heater.loop();
        assert(heater.wakeVerificationId() != id);
        testNow += TEMPERATURE_ADJUST_SETTLE_MS;
        assert(heater.needsWakeVerification());
        heater.verifyWake(id, 42); heater.loop(); heater.loop();
        assert(movements.size() == 4 && movements[2].first == SERVO_PIN_B);
    }
    // Reconnect cancels a queued ACK before it can operate the actuator.
    {
        testNow = 2000; HeaterModule heater; heater.setup();
        MqttModule mqtt; mqtt.attach(heater); mqtt.setup();
        MqttModule::onConnect(nullptr); mqtt.loop(); heater.loop(); movements.clear();
        auto start = startWake(heater);
        testNow = start + TEMPERATURE_ADJUST_SETTLE_MS;
        mqtt.requestWakeVerification();
        receive(std::to_string(heater.wakeVerificationId()) + ",42"); mqtt.loop();
        MqttModule::onConnect(nullptr); heater.loop(); mqtt.loop(); heater.loop();
        assert(movements.size() == 2 && !heater.isPowerKnown());
    }
    // millis() wrapping preserves both the settle and timeout windows.
    {
        testNow = UINT32_MAX - 3000U; HeaterModule heater; heater.setup(); movements.clear();
        auto start = startWake(heater);
        testNow = start + TEMPERATURE_ADJUST_SETTLE_MS;
        assert(heater.needsWakeVerification());
        heater.verifyWake(heater.wakeVerificationId(), 42); heater.loop(); heater.loop();
        assert(movements.size() == 4 && movements[2].first == SERVO_PIN_A);
    }
}
