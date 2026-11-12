#pragma once
#include <Arduino.h>
#include <math.h>
#include "config.h"

#if TEMPORARY_SENSOR_TEST_MODE
#include <OneWire.h>
#include <DallasTemperature.h>
#endif

// Temporary test: DS18B20 probe. Normal mode: backend OCR.
class TemperatureModule
{
public:
    void setup() {
#if TEMPORARY_SENSOR_TEST_MODE
        sensors.begin();
        sensors.setResolution(12);
        sensors.setWaitForConversion(false);
        sensors.requestTemperatures();
        conversionAt = millis();
        converting = true;
        Serial.println("TEMPORARY TEST: DS18B20 temperature on GPIO 4; OCR is diagnostic only");
#else
        Serial.println("Temperature module initialized (MQTT/OCR)");
#endif
    }

    // Nonblocking conversion: buttons and power remain responsive.
    void poll() {
#if TEMPORARY_SENSOR_TEST_MODE
        unsigned long now = millis();
        if (converting && now - conversionAt >= 750UL) {
            float reading = sensors.getTempCByIndex(0);
            if (reading == DEVICE_DISCONNECTED_C) invalidate();
            else update(reading);
            converting = false;
        }
        if (!converting && now - conversionAt >= TEMPERATURE_PROBE_INTERVAL_MS) {
            sensors.requestTemperatures();
            conversionAt = now;
            converting = true;
        }
#endif
    }

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
#if TEMPORARY_SENSOR_TEST_MODE
    OneWire oneWire{TEMPERATURE_SENSOR_PIN};
    DallasTemperature sensors{&oneWire};
    unsigned long conversionAt = 0;
    bool converting = false;
#endif
    float value = NAN;
    unsigned long observedAt = 0;
    bool available = false;
};
