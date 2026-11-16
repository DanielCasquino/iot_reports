#include <cassert>
#include <cstdint>
#include <vector>
#include <utility>
uint32_t testNow = 2000;
int levels[40];
std::vector<std::pair<int, int>> movements;
#include "heater_module.h"
TestSerial Serial;

int main() {
    for (auto &level : levels) level = HIGH;
    HeaterModule heater; heater.setup(); heater.observePowerOn(); movements.clear();
    heater.setTemperature(50); heater.loop();
    assert(!heater.monitorAutoShutdown() && movements.empty()); // Disabled by default.
    heater.setIsAutoShutdownEnabled(true);
    heater.setTemperature(39); heater.loop();
    assert(!heater.monitorAutoShutdown() && movements.empty());
    heater.setTemperature(50); heater.loop();
    testNow += TEMPERATURE_MAX_AGE_MS + 1;
    assert(!heater.monitorAutoShutdown() && movements.empty()); // Stale data is insufficient.
    heater.observePowerOn();
    heater.setTemperature(40); heater.loop();
    assert(heater.monitorAutoShutdown()); // Current policy is >=40, not target temperature.
    assert(movements.size() == 2 && movements.front().first == SERVO_PIN_A);
    assert(!heater.isPowerKnown()); // A tap is still not physical OFF confirmation.
    assert(!heater.monitorAutoShutdown() && movements.size() == 2);
}
