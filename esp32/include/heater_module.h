#pragma once
#include "temperature_module.h"
#include "servo_module.h"
#include "flow_module.h"
#include "color_module.h"
#include "button_module.h"
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
        buttonA.setup(BUTTON_PIN_A);
        buttonB.setup(BUTTON_PIN_B);
        buttonC.setup(BUTTON_PIN_C);
    }

    bool loop()
    {
        flowModule.poll();
        colorModule.poll();
        bool powerPressed = buttonA.pressed();
        bool increasePressed = buttonB.pressed();
        bool decreasePressed = buttonC.pressed();
        if (int(powerPressed) + int(increasePressed) + int(decreasePressed) != 1) return false;
        if (powerPressed)
        {
            if (powerKnown) return setPower(!power);
            if (!tapPowerButton()) return false;
            temperatureModule.invalidate();
            return true;
        }
        if (!powerKnown || !power || !reserveServoPress()) return false;
        if (increasePressed) servoModuleB.tap();
        else servoModuleC.tap();
        temperatureModule.invalidate();
        adjustingTemperature = true;
        adjustedAt_ms = millis();
        return false;
    }

    bool monitorAutoShutdown()
    {
        float temp = temperatureModule.read();
        if (isAutoShutdownEnabled && temperatureModule.isAvailable() && temp >= MAX_TEMPERATURE_C && powerKnown && power)
        {
            return setPower(false);
        }
        return false;
    }

    bool getPower() { return power; }
    bool isPowerKnown() { return powerKnown; }
    void observePowerOn()
    {
        if (!powerKnown || !power)
            Serial.println("Power observed on from pilot");
        power = true;
        powerKnown = true;
        digitalWrite(LED_BUILTIN, HIGH);
    }
    bool setPower(bool p)
    {
        if (!powerKnown || power == p || !tapPowerButton())
            return false;
        power = p;
        digitalWrite(LED_BUILTIN, p);
        temperatureModule.invalidate();
        return true;
    }

    bool getIsAutoShutdownEnabled() { return isAutoShutdownEnabled; }
    void setIsAutoShutdownEnabled(bool iase)
    {
        isAutoShutdownEnabled = iase;
    }

    void setTemperature(float value)
    {
        if (adjustingTemperature)
        {
            if (millis() - adjustedAt_ms < TEMPERATURE_ADJUST_SETTLE_MS)
                return;
            adjustingTemperature = false;
        }
        temperatureModule.update(value);
    }
    void invalidateTemperature() { temperatureModule.invalidate(); }
    bool isTemperatureAvailable() { return temperatureModule.isAvailable(); }
    ColorModule &getColor() { return colorModule; }

    float getTemperature() { return temperatureModule.read(); }

    float getFlowrate() { return flowModule.read(); }
    float getVolume() { return flowModule.getTotalVolume(); }

private:
    bool reserveServoPress()
    {
        unsigned long now = millis();
        if (hasTapped && now - lastTap_ms < 1000UL)
            return false;
        hasTapped = true;
        lastTap_ms = now;
        return true;
    }

    bool tapPowerButton()
    {
        if (!reserveServoPress()) return false;
        servoModuleA.tap();
        return true;
    }

    bool adjustingTemperature = false;
    unsigned long adjustedAt_ms = 0;
    unsigned long lastTap_ms = 0;
    bool hasTapped = false;
    ButtonModule buttonA, buttonB, buttonC;
    TemperatureModule temperatureModule;
    ServoModule servoModuleA, servoModuleB, servoModuleC;
    FlowModule flowModule;
    ColorModule colorModule;

    bool powerKnown = false;
    bool power = false;
    bool isAutoShutdownEnabled = false;
};