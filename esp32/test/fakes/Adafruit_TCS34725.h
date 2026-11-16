#pragma once
#include <cstdint>
#include "Wire.h"
#define TCS34725_ADDRESS 0x29
#define TCS34725_INTEGRATIONTIME_154MS 0
#define TCS34725_GAIN_4X 0
class Adafruit_TCS34725 {public: Adafruit_TCS34725(int,int){} bool begin(int,FakeWire*){return true;} void getRawData(uint16_t*r,uint16_t*g,uint16_t*b,uint16_t*c){*r=*g=*b=*c=0;} };
