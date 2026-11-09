#include <Arduino.h>
#include <ESP32Servo.h>
#include "config.h"

Servo servo;


class ServoModule{
    public:
    ServoModule(){
        servo.setPeriodHertz(50);
        servo.attach(SERVO_PIN, 500, 2400);
        servo.write(0);
        Serial.println("Servo module initialized");
    }
    void tap(){
        servo.write(90);
        delay(150);
        servo.write(0);
    }
};
