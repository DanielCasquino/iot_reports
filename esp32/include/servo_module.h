#pragma once
#include <Arduino.h>
#include <ESP32Servo.h>

class ServoModule
{
public:
    ServoModule() {}

    void setup(int servo_pin)
    {
        servo.setPeriodHertz(50);
        servo.attach(servo_pin, 500, 2400);
        servo.write(0);
        Serial.println("Servo module initialized");
    }

    void tap()
    {
        servo.write(90);
        delay(150);
        servo.write(0);
    }

private:
    Servo servo;
};
