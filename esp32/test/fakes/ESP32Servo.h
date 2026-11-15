#pragma once
#include <vector>
#include <utility>
extern std::vector<std::pair<int,int>> movements;
class Servo {int pin=0;public:void setPeriodHertz(int){}void attach(int p,int,int){pin=p;}void write(int angle){movements.push_back({pin,angle});}};
