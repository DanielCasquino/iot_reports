#include <Arduino.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include "config.h"

OneWire oneWire(TEMPERATURE_SENSOR_PIN);
DallasTemperature sensors(&oneWire);

class TemperatureModule
{
public:
    TemperatureModule()
    {
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
};