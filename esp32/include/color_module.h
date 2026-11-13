#pragma once
#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_TCS34725.h>

#include "config.h"

class ColorModule
{
public:
    ColorModule() {}

    void setup()
    {
        available = false;
        hasSample = false;
        red = green = blue = clear = 0;
        if (!Wire.begin(COLOR_SDA_PIN, COLOR_SCL_PIN))
        {
            Serial.println("Color module I2C initialization failed");
            return;
        }

        available = sensor.begin(TCS34725_ADDRESS, &Wire);
        last_ms = millis();
        Serial.println(available ? "Color module initialized" : "Color sensor not found; continuing");
    }

    void poll()
    {
        unsigned long curr_ms = millis();
        if (!available)
        {
            if (curr_ms - last_ms >= 5000UL)
            {
                last_ms = curr_ms;
                available = Wire.begin(COLOR_SDA_PIN, COLOR_SCL_PIN) && sensor.begin(TCS34725_ADDRESS, &Wire);
                if (available) Serial.println("Color sensor reconnected");
            }
            return;
        }
        if (curr_ms - last_ms < 1000UL)
            return;

        last_ms = curr_ms;
        Wire.beginTransmission(TCS34725_ADDRESS);
        if (Wire.endTransmission() != 0)
        {
            available = false;
            hasSample = false;
            Serial.println("Color sensor disconnected");
            return;
        }
        sensor.getRawData(&red, &green, &blue, &clear);
        hasSample = true;
        Serial.printf("Color raw R=%u G=%u B=%u C=%u\n",
                      unsigned(red), unsigned(green), unsigned(blue), unsigned(clear));
    }

    bool isAvailable() const { return available; }
    bool hasReading() const { return hasSample; }
    uint16_t getRed() const { return red; }
    uint16_t getGreen() const { return green; }
    uint16_t getBlue() const { return blue; }
    uint16_t getClear() const { return clear; }

private:
    Adafruit_TCS34725 sensor{TCS34725_INTEGRATIONTIME_154MS, TCS34725_GAIN_4X};
    unsigned long last_ms = 0;
    bool available = false;
    bool hasSample = false;
    uint16_t red = 0;
    uint16_t green = 0;
    uint16_t blue = 0;
    uint16_t clear = 0;
};
