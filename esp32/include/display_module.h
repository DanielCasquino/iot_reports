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
        screen.ssd1306_command(SSD1306_DISPLAYOFF);
        panelOn = false;
        last_ms = millis();
        available = true;
        return true;
#else
        return false;
#endif
    }

    void setEnabled(bool enabled) { shouldShow = enabled; }

    void setLines(const char *temperature, const char *state)
    {
        snprintf(temperatureLine, sizeof(temperatureLine), "%s", temperature ? temperature : "");
        snprintf(stateLine, sizeof(stateLine), "%s", state ? state : "");
    }

    void poll()
    {
#if DISPLAY_ENABLED
        uint32_t now = millis();
        if (!available)
        {
            if (now - last_ms >= 5000UL)
            {
                last_ms = now;
                setup();
            }
            return;
        }
        if (now - last_ms < 100UL)
            return;
        last_ms = now;
        // Detect unplug/replug even while we intentionally keep the panel dark.
        if (now - lastProbe_ms >= 1000UL)
        {
            lastProbe_ms = now;
            if (!responds())
            {
                available = false;
                return;
            }
        }
        if (!shouldShow)
        {
            if (panelOn) screen.ssd1306_command(SSD1306_DISPLAYOFF);
            panelOn = false;
            return;
        }
        const bool turningOn = !panelOn;
        if (turningOn || now - lastShift_ms >= 8000UL)
        {
            lastShift_ms = now;
            shift = turningOn ? 0 : (shift + 1) % 5;
            hasRendered = false;
        }
        if (hasRendered && strcmp(temperatureLine, renderedTemperature) == 0 &&
            strcmp(stateLine, renderedState) == 0)
            return;
        constexpr int xOffsets[] = {0, 2, 2, -2, -2};
        constexpr int yOffsets[] = {0, 2, -2, -2, 2};
        screen.clearDisplay();
        screen.setTextSize(stateLine[0] ? 2 : 4);
        screen.setCursor(stateLine[0] ? 0 : (128 - int(strlen(temperatureLine)) * 24) / 2 + xOffsets[shift],
                         stateLine[0] ? 4 : 16 + yOffsets[shift]);
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
        if (turningOn) screen.ssd1306_command(SSD1306_DISPLAYON);
        panelOn = true;
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
    bool shouldShow = false;
    bool panelOn = false;
    unsigned shift = 0;
    uint32_t lastProbe_ms = 0;
    uint32_t lastShift_ms = 0;
    uint32_t last_ms = 0;
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
