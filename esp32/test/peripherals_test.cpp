#include <cassert>
#include <cstdint>
uint32_t testNow=0;
int levels[40];
#include "flow_module.h"
#include "button_module.h"
TestSerial Serial;
int main(){
 for(auto &level:levels)level=HIGH;
 FlowModule flow;flow.setup();
 for(unsigned i=0;i<450;i++)FlowModule::onPulse(&flow);
 testNow=1999;flow.poll();assert(flow.read()==0 && flow.getTotalVolume()==0);
 testNow=2000;flow.poll();assert(flow.read()==30 && flow.getTotalVolume()==1);
 testNow=4000;flow.poll();assert(flow.read()==0 && flow.getTotalVolume()==1);
 testNow=UINT32_MAX-1000;FlowModule wrapped;wrapped.setup();
 for(unsigned i=0;i<450;i++)FlowModule::onPulse(&wrapped);
 testNow=999;wrapped.poll();assert(wrapped.read()==30 && wrapped.getTotalVolume()==1);
 testNow=0;ButtonModule button;button.setup(BUTTON_PIN_A);assert(!button.pressed());
 levels[BUTTON_PIN_A]=LOW;assert(!button.pressed());testNow=39;assert(!button.pressed());
 testNow=40;assert(button.pressed());testNow=100;assert(!button.pressed());
 levels[BUTTON_PIN_A]=HIGH;assert(!button.pressed());testNow=140;assert(!button.pressed());
 levels[BUTTON_PIN_A]=LOW;assert(!button.pressed());testNow=180;assert(button.pressed());
}
