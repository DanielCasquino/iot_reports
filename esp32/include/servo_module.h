#pragma once
#include <Arduino.h>
#include <ESP32Servo.h>
#include "config.h"

class ServoModule
{
public:
    struct TapEvent {
        int pin, press, rest;
        const char *reason;
        uint32_t commandId;
        int estimatedBefore, estimatedAfter, target;
        uint32_t startedAt, completedAt;
    };
    using TapSink = void (*)(const TapEvent &);
    void setTapSink(TapSink sink) { tapSink = sink; }
    ServoModule() {}

    void setup(int servo_pin, int rest = 0, int press = 90)
    {
        pin = servo_pin;
        restAngle = rest;
        pressAngle = press;
        servo.setPeriodHertz(50);
        servo.attach(servo_pin, 500, 2400);
        servo.write(restAngle);
        Serial.println("Servo module initialized");
    }

    void tap(const char *reason = "manual", uint32_t commandId = 0,
             int estimatedBefore = -1, int estimatedAfter = -1, int target = -1)
    {
        const uint32_t startedAt = millis();
        Serial.printf("Servo pin=%d press=%d rest=%d uptime=%lu\n", pin, pressAngle, restAngle, millis());
        servo.write(pressAngle);
        delay(SERVO_PRESS_MS);
        servo.write(restAngle);
        delay(SERVO_RETURN_MS);
        Serial.printf("Servo pin=%d returned uptime=%lu\n", pin, millis());
        // This proves only the PWM sequence was sent. Contact/physical success
        // must be established separately by fresh camera/controller feedback.
        if (tapSink) tapSink({pin, pressAngle, restAngle, reason, commandId,
            estimatedBefore, estimatedAfter, target, startedAt, millis()});
    }

private:
    int pin = -1;
    int restAngle = 0;
    int pressAngle = 90;
    Servo servo;
    TapSink tapSink = nullptr;
};
