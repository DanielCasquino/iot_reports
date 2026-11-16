
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

constexpr unsigned long SHIFTING_PERIOD = 8000UL;

constexpr unsigned long ON_PERIOD = 55UL * 1000UL;
constexpr unsigned long OFF_PERIOD = 5UL * 1000UL;

class DisplayModule
{
public:
    explicit DisplayModule(uint8_t displayAddress = 0x3C)
        : address(displayAddress) {}

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

        setContrast(1);

        screen.ssd1306_command(SSD1306_DISPLAYON);

        unsigned long now = millis();

        last_ms = now;
        last_shift_ms = now;
        displayCycleMs = now;

        displayOn = true;
        available = true;

        return true;
#else
        return false;
#endif
    }

    void setContrast(uint8_t c)
    {
#if DISPLAY_ENABLED
        screen.ssd1306_command(SSD1306_SETCONTRAST);
        screen.ssd1306_command(c);
#endif
    }

    void setLines(const char *temperature, const char *state)
    {
        snprintf(
            temperatureLine,
            sizeof(temperatureLine),
            "%s",
            temperature ? temperature : "");

        snprintf(
            stateLine,
            sizeof(stateLine),
            "%s",
            state ? state : "");
    }

    void poll()
    {
#if DISPLAY_ENABLED
        unsigned long now = millis();

        bool shifted = false;

        if (!available)
        {
            if (now - last_ms >= 5000UL)
            {
                last_ms = now;
                setup();
            }

            return;
        }

        if (displayOn)
        {
            if (now - displayCycleMs >= ON_PERIOD)
            {
                screen.ssd1306_command(SSD1306_DISPLAYOFF);

                displayOn = false;
                displayCycleMs = now;

                return;
            }
        }
        else
        {
            if (now - displayCycleMs < OFF_PERIOD)
                return;

            screen.ssd1306_command(SSD1306_DISPLAYON);

            displayOn = true;
            displayCycleMs = now;

            hasRendered = false;
            last_shift_ms = now;
        }

        if (now - last_ms < 100UL)
            return;

        last_ms = now;

        if (now - last_shift_ms >= SHIFTING_PERIOD)
        {
            last_shift_ms = now;

            xOffset += xDirection;
            yOffset += yDirection;

            if (xOffset >= 5)
            {
                xOffset = 5;
                xDirection = -1;
            }
            else if (xOffset <= -5)
            {
                xOffset = -5;
                xDirection = 1;
            }

            if (yOffset >= 5)
            {
                yOffset = 5;
                yDirection = -1;
            }
            else if (yOffset <= -5)
            {
                yOffset = -5;
                yDirection = 1;
            }

            shifted = true;
        }

        if (!responds())
        {
            available = false;
            return;
        }

        if (hasRendered &&
            strcmp(temperatureLine, renderedTemperature) == 0 &&
            strcmp(stateLine, renderedState) == 0 &&
            !shifted)
        {
            return;
        }

        screen.clearDisplay();

        int textSize = stateLine[0] ? 2 : 4;

        int textWidth = strlen(temperatureLine) * 6 * textSize;
        int textHeight = 8 * textSize;

        while (textSize > 1 && textWidth > 128)
        {
            textSize--;

            textWidth = strlen(temperatureLine) * 6 * textSize;
            textHeight = 8 * textSize;
        }

        int x = (128 - textWidth) / 2;
        int y = stateLine[0] ? 4 : (64 - textHeight) / 2;

        x = constrain(x + xOffset, 0, 128 - textWidth);
        y = constrain(y + yOffset, 0, 64 - textHeight);

        screen.setTextSize(textSize);
        screen.setCursor(x, y);
        screen.print(temperatureLine);

        screen.setTextSize(1);

        int stateWidth = strlen(stateLine) * 6;

        int stateX = constrain(
            xOffset,
            0,
            128 - stateWidth);

        int stateY = constrain(
            40 + yOffset,
            0,
            56);

        screen.setCursor(stateX, stateY);
        screen.print(stateLine);

        screen.display();

        if (!responds())
        {
            available = false;
            return;
        }

        snprintf(
            renderedTemperature,
            sizeof(renderedTemperature),
            "%s",
            temperatureLine);

        snprintf(
            renderedState,
            sizeof(renderedState),
            "%s",
            stateLine);

        hasRendered = true;

#endif
    }

    bool isAvailable() const
    {
        return available;
    }

    const char *getTemperatureLine() const
    {
        return temperatureLine;
    }

    const char *getStateLine() const
    {
        return stateLine;
    }

private:
    uint8_t address;

    bool available = false;
    bool hasRendered = false;

    unsigned long last_ms = 0;

    char temperatureLine[11] = {};
    char stateLine[22] = {};

    char renderedTemperature[11] = {};
    char renderedState[22] = {};

    int8_t xOffset = 0;
    int8_t yOffset = 0;

    int8_t xDirection = 1;
    int8_t yDirection = 1;

    unsigned long last_shift_ms = 0;

    bool displayOn = true;
    unsigned long displayCycleMs = 0;

#if DISPLAY_ENABLED

    Adafruit_SSD1306 screen{
        128,
        64,
        &Wire,
        -1,
        100000UL,
        100000UL};

    bool responds()
    {
        Wire.beginTransmission(address);
        return Wire.endTransmission() == 0;
    }

#endif
};
