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
        if (!payload) return;
        int value = -2;
        bool historical = payload[0] == 'h';
        uint32_t ttl = 30000;
        if (historical) {
            const char *p = payload + 1;
            if (*p < '0' || *p > '9') return;
            value = *p++ - '0';
            if (*p >= '0' && *p <= '9') value = value * 10 + (*p++ - '0');
            if (value > 75 || *p++ != ':') return;
            ttl = 0;
            unsigned digits = 0;
            while (*p >= '0' && *p <= '9') {
                if (++digits > 5) return;
                ttl = ttl * 10 + (*p++ - '0');
            }
            if (*p != '\0' || digits == 0 || ttl == 0 || ttl > 30000) return;
        } else if (std::strcmp(payload, "blank") == 0) {
            value = -1;
        } else if (payload[0] >= '0' && payload[0] <= '9' &&
                   (payload[1] == '\0' ||
                    (payload[1] >= '0' && payload[1] <= '9' && payload[2] == '\0'))) {
            value = payload[0] - '0';
            if (payload[1]) value = value * 10 + payload[1] - '0';
        }
        if (value == -2) return;
        Sample sample{value, now, ttl, historical};
        if (mailbox) xQueueOverwrite(mailbox, &sample);
    }

    const char *text(uint32_t now)
    {
        Sample sample;
        while (mailbox && xQueueReceive(mailbox, &sample, 0) == pdTRUE) {
            latest = sample;
            hasSample = true;
        }
        if (!hasSample || (latest.historical ? uint32_t(now - latest.observedAt) >= latest.ttl : uint32_t(now - latest.observedAt) > latest.ttl) || latest.value == -2)
            std::strcpy(buffer, "-.-");
        else if (latest.value == -1)
            buffer[0] = '\0';
        else
            std::snprintf(buffer, sizeof(buffer), latest.historical ? "h%d" : "%d", latest.value);
        return buffer;
    }

private:
    struct Sample { int value; uint32_t observedAt; uint32_t ttl; bool historical; };
    QueueHandle_t mailbox = nullptr;
    Sample latest{-2, 0, 30000, false};
    bool hasSample = false;
    char buffer[4] = "-.-";
};
