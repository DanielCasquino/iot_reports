#pragma once
#include <cstdint>
#include <cmath>
#include <functional>
extern uint32_t testNow;
extern int levels[40];
inline uint32_t millis(){return testNow;}
inline std::function<void()> &testDelayHook(){static std::function<void()> hook;return hook;}
inline void delay(unsigned long ms){testNow+=ms;auto hook=testDelayHook();if(hook)hook();}
inline void pinMode(int,int){}
inline void digitalWrite(int,int){}
inline int digitalRead(int p){return levels[p];}
#define HIGH 1
#define LOW 0
#define INPUT_PULLUP 2
#define OUTPUT 3
#define INPUT 4
#define IRAM_ATTR
#define FALLING 5
inline int digitalPinToInterrupt(int pin){return pin;}
inline void attachInterruptArg(int,void(*)(void*),void*,int){}
inline void noInterrupts(){}
inline void interrupts(){}
#define LED_BUILTIN 2
struct TestSerial {void println(const char*){} template<class... Args> void printf(const char*, Args...){}};
extern TestSerial Serial;
