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

int main() {
    for (auto &level : levels) level = HIGH;
    for (int target : {55, 30}) {
        testNow = 2000;
        HeaterModule heater; heater.setup(); heater.observePowerOn();
        MqttModule mqtt; mqtt.attach(heater);
        mqttClient.published.clear(); movements.clear();
        heater.requestTemperatureControl(42, -1, target, false);
        heater.loop();
        assert(mqttClient.published.size() == 1);
        const auto first = mqttClient.published.back();
        assert(first.first == "heater/diagnostic/servo");
        assert(first.second.find("\"reason\":\"wake_or_open\"") != std::string::npos);
        assert(first.second.find("\"commandId\":42") != std::string::npos);
        assert(first.second.find("\"mechanicalConfirmed\":false") != std::string::npos);
        assert(heater.getSetpoint() == -1); // Telemetry never confirms contact.
        testNow += 6000; heater.loop();
        assert(mqttClient.published.size() == 2);
        assert(mqttClient.published.back().second.find("\"reason\":\"open_target\"") != std::string::npos);
        testNow += 1000;
        assert(heater.needsTemperatureVerification());
        const auto verificationId = heater.temperatureVerificationId();
        heater.verifyTemperature(verificationId, 56); heater.loop();
        assert(mqttClient.published.size() == 2); // One image still insufficient.
        testNow += 500;
        assert(heater.needsTemperatureVerification());
        heater.verifyTemperature(verificationId, 56); heater.loop();
        assert(mqttClient.published.size() == 3);
        const auto &move = mqttClient.published.back().second;
        assert(move.find("\"reason\":\"adjust_target_shortest_wrap\"") != std::string::npos);
        assert(move.find("\"estimatedBefore\":56") != std::string::npos);
        assert(move.find("\"mechanicalConfirmed\":false") != std::string::npos);
        const bool up = target == 30; // 20 up with wrap vs 26 down.
        assert(move.find(up ? "\"button\":\"plus\"" : "\"button\":\"minus\"") != std::string::npos);
        assert(move.find(up ? "\"estimatedAfter\":57" : "\"estimatedAfter\":55") != std::string::npos);
        assert(movements.back().first == (up ? 27 : 26) && movements.back().second == 0);
    }
}
