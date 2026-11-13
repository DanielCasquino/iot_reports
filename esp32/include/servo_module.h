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
        restAngle = rest;
        pressAngle = press;
        servo.setPeriodHertz(50);
        servo.attach(servo_pin, 500, 2400);
        servo.write(restAngle);
        Serial.println("Servo module initialized");
    }

    void tap()
    {
        servo.write(pressAngle);
        delay(SERVO_PRESS_MS);
        servo.write(restAngle);
        delay(SERVO_RETURN_MS);
    }

private:
    int restAngle = 0;
    int pressAngle = 90;
    Servo servo;
};
