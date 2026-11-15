#pragma once
#include <Arduino.h>
#include "config.h"

class FlowModule
{
public:
    static void IRAM_ATTR onPulse(void *arg)
    {
        FlowModule *self = static_cast<FlowModule *>(arg);
        self->count = self->count + 1;
    }

    FlowModule() {}

    void setup()
    {
        // GPIO34 has no internal pull-up; the electrical bias is external.
        pinMode(FLOW_PIN, INPUT);
        attachInterruptArg(digitalPinToInterrupt(FLOW_PIN), onPulse, this, FALLING);
        last_ms = millis();
        Serial.println("Flow module initialized");
    }

    void poll()
    {
        uint32_t curr_ms = millis();
        if (curr_ms - last_ms < TICK_INTERVAL_MS)
            return;

        float elapsed = (curr_ms - last_ms) / 1000.0;
        last_ms = curr_ms;

        noInterrupts();
        uint32_t pulses = count;
        count = 0;
        interrupts();

        float liters = pulses / PPL;

        flowRate = liters / elapsed * 60.0;
        totalVolume += liters;
    }

    float read()
    {
        return flowRate;
    }

    float getTotalVolume()
    {
        return totalVolume;
    }

private:
    static constexpr float PPL = 450.0; // pulses per litre
    uint32_t last_ms = 0;
    volatile uint32_t count = 0;
    float flowRate = 0.0;
    float totalVolume = 0.0;
};