#pragma once
#include <cstdint>
#include <cstring>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

// The MQTT task only copies bounded messages. Hardware state belongs to loop().
class MqttInbox
{
public:
    enum class Kind { Connected, WakeDisplay, Display, PowerObservation, Pilot,
                      Temperature, Verification, WakeVerification, Target, TargetV2, Base, Power, AutoShutdown, Snapshot };
    struct Message { Kind kind; uint32_t receivedAt; uint32_t revision; char payload[41]; };
    bool setup() { if (!queue) queue = xQueueCreate(16, sizeof(Message)); return queue != nullptr; }
    bool push(Kind kind, const char *payload, size_t size, uint32_t now, uint32_t revision = 0)
    {
        if (!queue || size > 40 || (size && (!payload || std::memchr(payload, '\0', size)))) return false;
        Message message{};
        message.kind = kind;
        message.receivedAt = now;
        message.revision = revision;
        if (size) std::memcpy(message.payload, payload, size);
        return xQueueSend(queue, &message, 0) == pdTRUE;
    }
    bool next(Message &message) { return queue && xQueueReceive(queue, &message, 0) == pdTRUE; }
    void reset() { if (queue) xQueueReset(queue); }
private:
    QueueHandle_t queue = nullptr;
};
