#include <Arduino.h>
#include <ESP32Servo.h>

Servo servo;
int selected = -1;
int angle = 90;
unsigned long releaseAt = 0;
bool driving = false;
String command;
const int pins[] = {25, 26, 27};

void setup()
{
    Serial.begin(115200);
    servo.setPeriodHertz(50);
    Serial.println("A 90, B 90, C 90: select a free servo at center. Then +1, -1, +5, -5. OFF releases.");
}

void execute(String value)
{
    value.trim();
    value.toUpperCase();
    if (value == "OFF")
    {
        servo.detach();
        selected = -1;
        driving = false;
        Serial.println("Released");
        return;
    }
    if (value == "A 90" || value == "B 90" || value == "C 90")
    {
        servo.detach();
        selected = value[0] - 'A';
        angle = 90;
    }
    else if (selected >= 0 && (value == "+1" || value == "-1" || value == "+5" || value == "-5"))
        angle = constrain(angle + value.toInt(), 0, 180);
    else
    {
        Serial.println("Invalid command; select A 90, B 90 or C 90 first");
        return;
    }
    if (!servo.attached()) servo.attach(pins[selected], 500, 2400);
    servo.write(angle);
    releaseAt = millis() + 500;
    driving = true;
    Serial.printf("Servo %c GPIO %d angle %d; release after 500 ms\n", 'A' + selected, pins[selected], angle);
}

void loop()
{
    if (driving && int32_t(millis() - releaseAt) >= 0)
    {
        servo.release();
        driving = false;
    }
    while (Serial.available())
    {
        char value = Serial.read();
        if (value == '\n')
        {
            execute(command);
            command = "";
        }
        else if (command.length() < 24) command += value;
        else command = "";
    }
    delay(1);
}
