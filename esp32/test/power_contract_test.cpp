#include <cassert>
#include <cstdint>
#include <vector>
#include <utility>
uint32_t testNow=2000;
int levels[40];
std::vector<std::pair<int,int>> movements;
#include "heater_module.h"
TestSerial Serial;
int main(){
 for(auto &level:levels)level=HIGH;
 HeaterModule heater;heater.setup();movements.clear();heater.observePowerOn();
 heater.requestPower(false);heater.loop();
 assert(movements.size()==2);
 assert(!heater.isPowerKnown()); // A servo write cannot certify the physical power state.
}
