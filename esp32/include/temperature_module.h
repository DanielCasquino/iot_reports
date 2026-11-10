#pragma once
#include <Arduino.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include "config.h"

class TemperatureModule
{
public:
    TemperatureModule() {}

    void setup()
    {
        oneWire = OneWire(TEMPERATURE_SENSOR_PIN);
        sensors = DallasTemperature(&oneWire);
        sensors.begin();
        Serial.println("Temperature module initialized");
    }

    float read()
    {
        sensors.requestTemperatures();
        float temperature = sensors.getTempCByIndex(0);
        if (temperature != DEVICE_DISCONNECTED_C)
            return temperature;
        return -1.0;
    }

private:
    OneWire oneWire;
    DallasTemperature sensors;
};
