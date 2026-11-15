#pragma once
#include "OneWire.h"
#define DEVICE_DISCONNECTED_C -127
extern float probeValue;
extern unsigned conversions,probeReads;
extern bool waitForConversion;
class DallasTemperature {public: explicit DallasTemperature(OneWire*){} void begin(){} void setResolution(int){} void setWaitForConversion(bool value){waitForConversion=value;} void requestTemperatures(){++conversions;} float getTempCByIndex(int){++probeReads;return probeValue;} };
