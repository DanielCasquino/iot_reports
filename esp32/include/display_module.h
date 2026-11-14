#pragma once
#include <Arduino.h>
#include <stdio.h>
#include <string.h>

#ifndef DISPLAY_ENABLED
#define DISPLAY_ENABLED 0
#endif

#if DISPLAY_ENABLED
#include <Wire.h>
#include <Adafruit_SSD1306.h>
#endif

class DisplayModule
{
public:
    explicit DisplayModule(uint8_t displayAddress = 0x3C) : address(displayAddress) {}

    bool setup()
    {
        available = false;
        hasRendered = false;
#if DISPLAY_ENABLED
        if (address != 0x3C && address != 0x3D)
            return false;
        if (!responds())
            return false;
        if (!screen.begin(SSD1306_SWITCHCAPVCC, address, true, false))
            return false;
        if (!responds())
            return false;
        screen.clearDisplay();
        screen.setTextColor(SSD1306_WHITE);
        screen.setTextWrap(false);
        last_ms = millis();
        available = true;
        return true;
#else
        return false;
#endif
    }

    void setLines(const char *temperature, const char *state)
    {
        snprintf(temperatureLine, sizeof(temperatureLine), "%s", temperature ? temperature : "");
        snprintf(stateLine, sizeof(stateLine), "%s", state ? state : "");
    }

    void poll()
    {
#if DISPLAY_ENABLED
        unsigned long now = millis();
        if (!available)
        {
            if (now - last_ms >= 5000UL)
            {
                last_ms = now;
                setup();
            }
            return;
        }
        if (now - last_ms < 500UL)
            return;
        last_ms = now;
        if (!responds())
        {
            available = false;
            return;
        }
        if (hasRendered && strcmp(temperatureLine, renderedTemperature) == 0 &&
            strcmp(stateLine, renderedState) == 0)
            return;
        screen.clearDisplay();
        screen.setTextSize(2);
        screen.setCursor(0, 4);
        screen.print(temperatureLine);
        screen.setTextSize(1);
        screen.setCursor(0, 40);
        screen.print(stateLine);
        screen.display();
        if (!responds())
        {
            available = false;
            return;
        }
        snprintf(renderedTemperature, sizeof(renderedTemperature), "%s", temperatureLine);
        snprintf(renderedState, sizeof(renderedState), "%s", stateLine);
        hasRendered = true;
#endif
    }

    bool isAvailable() const { return available; }
    const char *getTemperatureLine() const { return temperatureLine; }
    const char *getStateLine() const { return stateLine; }

private:
    uint8_t address;
    bool available = false;
    bool hasRendered = false;
    unsigned long last_ms = 0;
    char temperatureLine[11] = {};
    char stateLine[22] = {};
    char renderedTemperature[11] = {};
    char renderedState[22] = {};

#if DISPLAY_ENABLED
    Adafruit_SSD1306 screen{128, 64, &Wire, -1, 100000UL, 100000UL};

    bool responds()
    {
        Wire.beginTransmission(address);
        return Wire.endTransmission() == 0;
    }
#endif
};
