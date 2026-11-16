#include <cassert>
#include <cstdint>
#include <vector>
#include <utility>
uint32_t testNow = 2000;
int levels[40];
std::vector<std::pair<int, int>> movements;
#define BROKER_URI "mqtt://test.invalid"
#include "mqtt_module.h"
TestSerial Serial;

void selectTarget(HeaterModule &heater, int target) {
    heater.requestTemperatureControl(42, -1, target, false);
    heater.loop();
    assert(heater.getAutoShutdownTarget() == target);
    testNow += 6000; heater.loop();
    testNow += 1000; assert(heater.needsTemperatureVerification());
    auto id = heater.temperatureVerificationId();
    heater.verifyTemperature(id, target); heater.loop();
    testNow += 500; assert(heater.needsTemperatureVerification());
    heater.verifyTemperature(id, target); heater.loop();
    testNow += 6000; heater.loop();
    assert(!heater.isTemperatureLocked() && heater.getSetpoint() == target);
    heater.observePowerOn(); movements.clear();
}

int main() {
    for (auto &level : levels) level = HIGH;
    {
        HeaterModule heater; heater.setup(); heater.observePowerOn(); movements.clear();
        heater.setIsAutoShutdownEnabled(true);
        heater.setTemperature(75); heater.loop();
        assert(heater.getAutoShutdownTarget() == -1);
        assert(!heater.monitorAutoShutdown() && movements.empty()); // No invented/default target.
    }
    for (int target : {30, 42, 60, 75}) {
        for (int overshoot : {0, 1}) {
            testNow = 2000;
            HeaterModule heater; heater.setup(); heater.observePowerOn();
            MqttModule mqtt; mqtt.attach(heater);
            selectTarget(heater, target); mqttClient.published.clear();
            heater.setTemperature(target); heater.loop();
            assert(!heater.monitorAutoShutdown() && movements.empty()); // Disabled.
            heater.setIsAutoShutdownEnabled(true);
            heater.setTemperature(target - 1); heater.loop();
            assert(!heater.monitorAutoShutdown() && movements.empty());
            heater.setTemperature(target + overshoot); heater.loop();
            assert(heater.monitorAutoShutdown()); // Equality or above, with selected target.
            assert(movements.size() == 2 && movements.front().first == SERVO_PIN_A);
            assert(mqttClient.published.size() == 1);
            assert(mqttClient.published.back().second.find("\"reason\":\"auto_shutdown_at_target\"") != std::string::npos);
            assert(mqttClient.published.back().second.find("\"target\":" + std::to_string(target)) != std::string::npos);
            assert(!heater.isPowerKnown()); // A tap is still not physical OFF evidence.
            assert(!heater.monitorAutoShutdown() && movements.size() == 2);
        }
    }
    {
        testNow = 2000;
        HeaterModule heater; heater.setup(); heater.observePowerOn();
        MqttModule mqtt; mqtt.attach(heater); selectTarget(heater, 42);
        mqttClient.published.clear(); heater.setIsAutoShutdownEnabled(true);
        heater.observePilot(HeaterModule::PilotState::Unknown); heater.loop();
        heater.setTemperature(42); heater.loop();
        assert(!heater.monitorAutoShutdown()); // Wake before Power.
        assert(mqttClient.published.back().second.find("\"reason\":\"wake_before_power\"") != std::string::npos);
        testNow += 6000; heater.setTemperature(42); heater.loop(); heater.loop();
        assert(mqttClient.published.back().second.find("\"reason\":\"auto_shutdown_at_target\"") != std::string::npos);
        assert(!heater.isPowerKnown());
    }
    {
        testNow = 2000;
        HeaterModule heater; heater.setup(); heater.observePowerOn();
        selectTarget(heater, 60); heater.setIsAutoShutdownEnabled(true);
        heater.setTemperature(50); heater.loop();
        assert(!heater.monitorAutoShutdown() && movements.empty()); // The old40C limit is gone.
        heater.setTemperature(60); heater.loop();
        testNow += TEMPERATURE_MAX_AGE_MS + 1;
        assert(!heater.monitorAutoShutdown() && movements.empty());
        heater.setTemperature(NAN); heater.loop();
        assert(!heater.monitorAutoShutdown() && movements.empty());
        // Base calibration changes an estimate, not the selected auto-off goal.
        heater.requestTemperatureControl(43, -1, 42, true); heater.loop();
        assert(heater.getSetpoint() == 42 && heater.getAutoShutdownTarget() == 60);
        heater.observePowerOn(); heater.setTemperature(50); heater.loop();
        assert(!heater.monitorAutoShutdown() && movements.empty());
        heater.requestTemperatureControl(44, -1, 55, false); heater.loop();
        assert(heater.getAutoShutdownTarget() == 55);
        auto before = movements.size();
        heater.requestTemperatureControl(45, -1, 30, false); heater.loop(); // Busy: not admitted.
        assert(heater.getAutoShutdownTarget() == 55);
        assert(!heater.monitorAutoShutdown() && movements.size() == before); // No interruption.
    }
}
