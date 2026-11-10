#pragma once
#include "temperature_module.h"
#include "servo_module.h"
#include "flow_module.h"

class HeaterModule
{
public:
    HeaterModule() {}
    void setup()
    {
        pinMode(LED_BUILTIN, OUTPUT);
        temperatureModule.setup();
        servoModule.setup();
        flowModule.setup();
    }

    void loop()
    {
        flowModule.poll();
    }

    bool monitorAutoShutdown()
    {
        float temp = temperatureModule.read();
        if (isAutoShutdownEnabled && temp >= MAX_TEMPERATURE_C && power)
        {
            setPower(false);
            servoModule.tap();
            return true;
        }
        return false;
    }

    bool getPower() { return power; }
    void setPower(bool p)
    {
        power = p;
        digitalWrite(LED_BUILTIN, p);
        servoModule.tap();
    }

    bool getIsAutoShutdownEnabled() { return isAutoShutdownEnabled; }
    void setIsAutoShutdownEnabled(bool iase) { isAutoShutdownEnabled = iase; }

    float getTemperature() { return temperatureModule.read(); }

    float getFlowrate() { return flowModule.read(); }

private:
    TemperatureModule temperatureModule;
    ServoModule servoModule;
    FlowModule flowModule;

    bool power = false;
    bool isAutoShutdownEnabled = false;
};