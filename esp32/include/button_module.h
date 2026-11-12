#pragma once
#include <Arduino.h>

class ButtonModule
{
public:
    void setup(int button_pin)
    {
        pin = button_pin;
        if (pin < 0) return;
        pinMode(pin, INPUT_PULLUP);
        pendingLevel = stableLevel = digitalRead(pin);
        levelChangedAt_ms = millis();
    }

    bool pressed()
    {
        if (pin < 0) return false;
        bool value = digitalRead(pin);
        unsigned long now = millis();
        if (value != pendingLevel)
        {
            pendingLevel = value;
            levelChangedAt_ms = now;
        }
        if (now - levelChangedAt_ms < 40UL || stableLevel == pendingLevel) return false;
        stableLevel = pendingLevel;
        return stableLevel == LOW;
    }

private:
    int pin = -1;
    bool pendingLevel = HIGH;
    bool stableLevel = HIGH;
    unsigned long levelChangedAt_ms = 0;
};
