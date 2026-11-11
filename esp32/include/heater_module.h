#pragma once
#include "temperature_module.h"
#include "servo_module.h"
#include "flow_module.h"
#include "color_module.h"
#include "config.h"

class HeaterModule
{
public:
    HeaterModule() {}
    void setup()
    {
        pinMode(LED_BUILTIN, OUTPUT);
        temperatureModule.setup();
        servoModuleA.setup(SERVO_PIN_A);
        servoModuleB.setup(SERVO_PIN_B);
        servoModuleC.setup(SERVO_PIN_C);
        flowModule.setup();
        colorModule.setup();
    }

    void loop()
    {
        flowModule.poll();
        colorModule.poll();
    }

    bool monitorAutoShutdown()
    {
        float temp = temperatureModule.read();
        if (isAutoShutdownEnabled && temperatureModule.isAvailable() && temp >= MAX_TEMPERATURE_C && power)
        {
            setPower(false);
            return true;
        }
        return false;
    }

    bool getPower() { return power; }
    void setPower(bool p)
    {
        power = p;
        digitalWrite(LED_BUILTIN, p);
        servoModuleA.tap();
        servoModuleB.tap();
        servoModuleC.tap();
    }

    bool getIsAutoShutdownEnabled() { return isAutoShutdownEnabled; }
    void setIsAutoShutdownEnabled(bool iase)
    {
        isAutoShutdownEnabled = iase;
        servoModuleB.tap();
    }

    void setTemperature(float value) { temperatureModule.update(value); }
    void invalidateTemperature() { temperatureModule.invalidate(); }
    bool isTemperatureAvailable() { return temperatureModule.isAvailable(); }
    ColorModule &getColor() { return colorModule; }

    float getTemperature() { return temperatureModule.read(); }

    float getFlowrate() { return flowModule.read(); }
    float getVolume() { return flowModule.getTotalVolume(); }

private:
    TemperatureModule temperatureModule;
    ServoModule servoModuleA, servoModuleB, servoModuleC;
    FlowModule flowModule;
    ColorModule colorModule;

    bool power = false;
    bool isAutoShutdownEnabled = false;
};