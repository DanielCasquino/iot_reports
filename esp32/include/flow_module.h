#include <Arduino.h>
#include "config.h"

class FlowModule{
    public:
    FlowModule(){
        Serial.println("Flow module initialized");
    }
    float read(){
        return{};
    }
    void poll(){

    }
};