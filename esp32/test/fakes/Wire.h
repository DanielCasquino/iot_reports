#pragma once
class FakeWire {public: bool begin(int,int){return true;} void beginTransmission(int){} int endTransmission(){return 0;} };
static FakeWire Wire;
