#pragma once
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

class DisplayMirror
{
public:
    void setup()
    {
        if (!mailbox) mailbox = xQueueCreate(1, sizeof(Sample));
    }

    void receive(const char *payload, uint32_t now)
    {
        int value = -2;
        if (payload) {
            if (std::strcmp(payload, "blank") == 0) value = -1;
            else if (payload[0] >= '0' && payload[0] <= '9' &&
                     (payload[1] == '\0' ||
                      (payload[1] >= '0' && payload[1] <= '9' && payload[2] == '\0'))) {
                value = payload[0] - '0';
                if (payload[1]) value = value * 10 + payload[1] - '0';
            }
        }
        Sample sample{value, now};
        if (mailbox) xQueueOverwrite(mailbox, &sample);
    }

    const char *text(uint32_t now)
    {
        Sample sample;
        while (mailbox && xQueueReceive(mailbox, &sample, 0) == pdTRUE) {
            latest = sample;
            hasSample = true;
        }
        if (!hasSample || uint32_t(now - latest.observedAt) > 2000U || latest.value == -2)
            std::strcpy(buffer, "--");
        else if (latest.value == -1)
            buffer[0] = '\0';
        else
            std::snprintf(buffer, sizeof(buffer), "%d", latest.value);
        return buffer;
    }

private:
    struct Sample { int value; uint32_t observedAt; };
    QueueHandle_t mailbox = nullptr;
    Sample latest{-2, 0};
    bool hasSample = false;
    char buffer[3] = "--";
};
