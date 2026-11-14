#pragma once
#include <Arduino.h>
#include <ESP32Servo.h>
#include "config.h"

class ServoModule
{
public:
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

    void tap()
    {
        Serial.printf("Servo pin=%d press=%d rest=%d uptime=%lu\n", pin, pressAngle, restAngle, millis());
        servo.write(pressAngle);
        delay(SERVO_PRESS_MS);
        servo.write(restAngle);
        delay(SERVO_RETURN_MS);
        Serial.printf("Servo pin=%d returned uptime=%lu\n", pin, millis());
    }

private:
    int pin = -1;
    int restAngle = 0;
    int pressAngle = 90;
    Servo servo;
};
