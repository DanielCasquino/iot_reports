#include <cassert>
#include <cstdint>
#include <vector>
#include <utility>
#include <string>
uint32_t testNow=2000;
int levels[40];
std::vector<std::pair<int,int>> movements;
#define BROKER_URI "mqtt://test.invalid"
#include "mqtt_module.h"
TestSerial Serial;
void reset(){testNow=2000;for(auto &level:levels)level=HIGH;movements.clear();}
void receive(const char *topic,const char *payload,bool retained=false){
 esp_mqtt_event_t event;event.topic=topic;event.payload=payload;event.retain=retained;
 handleMQTT(&mqttClient,nullptr,0,&event);
}
int main(){
 reset();
 {
  HeaterModule heater;heater.setup();movements.clear();heater.observePowerOn();
  heater.requestPower(false);assert(heater.loop());
  assert(!heater.isPowerKnown()); // PWM is not physical OFF evidence.
  assert(movements.size()==2 && movements[0].first==SERVO_PIN_A);
  uint32_t completed=testNow;
  heater.observePilot(HeaterModule::PilotState::Awake,completed-1);heater.loop();
  assert(!heater.isPowerKnown()); // Pre-action packet cannot confirm success.
  testNow++;heater.observePilot(HeaterModule::PilotState::Awake);heater.loop();
  assert(heater.isPowerKnown() && heater.getPower());
 }
 reset();
 {
  HeaterModule heater;heater.setup();movements.clear();heater.observePowerOn();
  heater.observePilot(HeaterModule::PilotState::Unknown);heater.loop();
  heater.requestPower(false);heater.loop();
  assert(movements.size()==2 && movements[0].first==SERVO_PIN_B); // Wake with +, never A.
  assert(heater.isPowerKnown() && heater.getPower());
  auto wakeEnd=testNow;
  testNow=wakeEnd+1000;heater.observePilot(HeaterModule::PilotState::Awake);heater.loop();
  assert(movements.size()==2); // Do not press Power inside target-selection window.
  testNow=wakeEnd+6000;heater.setTemperature(42);heater.loop();heater.loop();
  assert(movements.size()==4 && movements[2].first==SERVO_PIN_A);
  assert(!heater.isPowerKnown());
 }
 reset();
 {
  HeaterModule heater;heater.setup();movements.clear();heater.observePowerOn();
  heater.observePilot(HeaterModule::PilotState::Unknown);heater.loop();
  heater.requestPower(false);heater.loop();
  assert(movements.size()==2 && movements[0].first==SERVO_PIN_B);
  testNow+=6000;heater.setTemperature(42);heater.loop();heater.loop();
  assert(movements.size()==4 && movements[2].first==SERVO_PIN_A);
  assert(!heater.isPowerKnown()); // RGB remains unknown; do not manufacture a pilot reading.
 }
 reset();
 {
  HeaterModule heater;heater.setup();movements.clear();heater.observePowerOn();
  heater.observePilot(HeaterModule::PilotState::Unknown);heater.loop();
  heater.requestPower(false);heater.loop();testNow+=10001;heater.loop();
  assert(movements.size()==2 && movements[0].first==SERVO_PIN_B);
  assert(std::string(heater.getAdjustmentStatus())=="error");
  for(unsigned i=0;i<20;i++){testNow+=1000;heater.loop();}
  assert(movements.size()==2); // No infinite or blind Power retry.
 }
 reset();
 {
  HeaterModule heater;heater.setup();DisplayMirror display;display.setup();
  MqttModule mqtt;mqtt.attach(heater);mqtt.attachDisplay(display);mqtt.setup();
  MqttModule::onConnect(nullptr);mqtt.loop();heater.loop();movements.clear();
  receive("heater/input/power","true");
  assert(!heater.isPowerKnown()); // Callback cannot mutate controller state.
  mqtt.loop();heater.loop();assert(heater.isPowerKnown());
  const char *invalidCommands[] = {"-1,43,44", "+1,43,44", "4294967296,43,44", "1,2147483648,44", "1,43,4294967340", "1,43,44junk", "1,43,44,1", "1,43,+44", "1,43, 44", "0,43,44"};
  for (auto command : invalidCommands) { receive("heater/set/temperature",command);mqtt.loop();heater.loop(); }
  assert(movements.empty() && heater.getTemperatureCommandId()==0);
  receive("heater/input/temperature","41");receive("heater/input/temperature","unavailable");receive("heater/input/temperature","42");
  testNow+=20;mqtt.loop();heater.loop();assert(heater.getTemperature()==42);
  receive("heater/set/autoshutdown","true");assert(!heater.getIsAutoShutdownEnabled());
  mqtt.loop();assert(heater.getIsAutoShutdownEnabled());
  receive("heater/set/power","false",true);mqtt.loop();heater.loop();assert(movements.empty());
  receive("heater/command/wake_display","wake",true);mqtt.loop();heater.loop();assert(movements.empty());
  receive("heater/set/power","false");mqtt.loop();heater.loop();assert(movements.size()==2);
  receive("heater/input/power","true"); // Stale event from prior connection is discarded.
  MqttModule::onConnect(nullptr);mqtt.loop();heater.loop();assert(!heater.isPowerKnown());
  receive("heater/input/temperature","42");testNow+=5001;mqtt.loop();heater.loop();
  assert(!heater.isTemperatureAvailable());
 }
 reset();
 {
  HeaterModule heater;heater.setup();MqttModule mqtt;mqtt.attach(heater);mqtt.setup();
  MqttModule::onConnect(nullptr);mqtt.loop();heater.loop();movements.clear();
  receive("heater/input/power","true");mqtt.loop();heater.loop();
  receive("heater/set/temperature","1,-1,44");mqtt.loop();
  mqttClient.connected=false;mqtt.loop();heater.loop();
  assert(movements.empty()); // Queued command cannot run offline or replay on reconnect.
  mqttClient.connected=true;MqttModule::onConnect(nullptr);mqtt.loop();heater.loop();
  assert(movements.empty() && !heater.isPowerKnown());
  receive("heater/input/power","true");mqtt.loop();heater.loop();
  receive("heater/set/power","false");mqtt.loop();
  MqttModule::onConnect(nullptr); // Interleave reconnect between MQTT drain and hardware loop.
  heater.loop();assert(movements.empty() && !heater.isPowerKnown());
 }
 reset();
 {
  HeaterModule heater;heater.setup();MqttModule mqtt;mqtt.attach(heater);mqtt.setup();
  MqttModule::onConnect(nullptr);mqtt.loop();heater.loop();movements.clear();
  receive("heater/input/power","true");mqtt.loop();heater.loop();
  receive("heater/set/temperature","2,-1,44");mqtt.loop();
  testDelayHook()=[](){testDelayHook()=nullptr;receive("heater/input/temperature","42");};
  heater.loop();mqtt.loop();heater.loop();
  assert(movements.size()==2 && !heater.isTemperatureAvailable()); // Captured during press, not after it.
 }
 reset();
 {
  HeaterModule heater;heater.setup();MqttModule mqtt;mqtt.attach(heater);mqtt.setup();
  MqttModule::onConnect(nullptr);mqtt.loop();heater.loop();movements.clear();
  receive("heater/input/power","true");mqtt.loop();heater.loop();
  receive("heater/input/pilot","heating");mqtt.loop();heater.loop(); // Explicit awake-pilot evidence for this direct-press case.
  receive("heater/set/power","false");receive("heater/set/temperature","3,-1,44");
  mqtt.loop();heater.loop();testNow+=2000;heater.loop();
  assert(movements.size()==2 && movements[0].first==SERVO_PIN_A);
  assert(!heater.isPowerKnown()); // OFF cancels a queued temperature job.
 }
 reset();
 {
  MqttInbox inbox;assert(inbox.setup());
  assert(!inbox.push(MqttInbox::Kind::Power,"true",41,testNow));
  const char nul[]={'t','r','u','e','\0','x'};
  assert(!inbox.push(MqttInbox::Kind::Power,nul,sizeof(nul),testNow));
  for(unsigned i=0;i<16;i++)assert(inbox.push(MqttInbox::Kind::Power,"true",4,testNow));
  assert(!inbox.push(MqttInbox::Kind::Power,"true",4,testNow));
  MqttInbox::Message m;for(unsigned i=0;i<16;i++)assert(inbox.next(m));
  assert(!inbox.next(m));
 }
 reset();
 {
  HeaterModule heater;heater.setup();testNow=UINT32_MAX-1000U;
  heater.invalidateTemperature();testNow=100;
  heater.setTemperature(42);heater.loop();assert(heater.isTemperatureAvailable());
 }
}
