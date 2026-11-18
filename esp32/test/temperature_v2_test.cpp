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

std::string lastToken()
{
    const auto &state = mqttClient.published.back().second;
    const auto start = state.find("\"temperatureV2Token\":") + 21;
    return state.substr(start, state.find(',', start) - start);
}

int main()
{
    for (auto &level : levels) level = HIGH;
    HeaterModule heater;
    heater.setup();
    heater.observePowerOn();
    MqttModule mqtt;
    mqtt.attach(heater);
    mqtt.renewTemperatureToken();
    mqtt.publishTemperatureControl();
    const auto first = mqttClient.published.back().second;
    const auto start = first.find("\"temperatureV2Token\":") + 21;
    const auto end = first.find(',', start);
    const auto token = first.substr(start, end - start);
    assert(!token.empty());
    movements.clear();
    const auto command = std::string("42,-1,45,") + token;
    mqtt.handleTemperatureControlV2(command);
    heater.loop();
    assert(heater.getTemperatureCommandId() == 42);
    assert(!movements.empty());
    const auto count = movements.size();
    mqtt.handleTemperatureControlV2(command);
    heater.loop();
    assert(movements.size() == count);
    mqtt.publishTemperatureControl();
    const auto state = mqttClient.published.back().second;
    const auto tokenStart = state.find("\"temperatureV2Token\":") + 21;
    const auto nextToken = state.substr(tokenStart, state.find(',', tokenStart) - tokenStart);
    assert(token != nextToken);
    testNow += 6000;
    mqtt.handleTemperatureControlV2(std::string("43,-1,46,") + nextToken);
    heater.loop();
    assert(heater.getTemperatureCommandId() == 42);

    // A snapshot rotation can race a command already on its way to the ESP.
    HeaterModule freshHeater;
    freshHeater.setup();
    freshHeater.observePowerOn();
    mqtt.attach(freshHeater);
    mqtt.renewTemperatureToken();
    mqtt.publishTemperatureControl();
    const auto advertised = lastToken();
    testNow += 3000;
    mqtt.publishTemperatureControl();
    const auto rotated = lastToken();
    assert(advertised != rotated);
    testNow += 100;
    mqtt.handleTemperatureControlV2(std::string("51,-1,45,") + advertised);
    freshHeater.loop();
    assert(freshHeater.getTemperatureCommandId() == 51);
    mqtt.handleTemperatureControlV2(std::string("52,-1,46,") + rotated);
    freshHeater.loop();
    assert(freshHeater.getTemperatureCommandId() == 51);
}
