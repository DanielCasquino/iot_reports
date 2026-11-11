#pragma once
#include <Arduino.h>
#include <math.h>
#include "config.h"

// Temperature comes from backend OCR; it is not a probe reading anymore.
class TemperatureModule
{
public:
    void setup() { Serial.println("Temperature module initialized (MQTT/OCR)"); }

    void update(float temperature)
    {
        if (!isfinite(temperature) || temperature < 0 || temperature > 100)
        {
            invalidate();
            return;
        }
        value = temperature;
        observedAt = millis();
        available = true;
    }

    void invalidate() { available = false; }
    bool isAvailable() { return available && millis() - observedAt <= TEMPERATURE_MAX_AGE_MS; }
    float read() { return isAvailable() ? value : NAN; }

private:
    float value = NAN;
    unsigned long observedAt = 0;
    bool available = false;
};
