#pragma once
#include "temperature_module.h"
#include "servo_module.h"
#include "flow_module.h"
#include "color_module.h"
#include "button_module.h"
#include "temperature_adjustment.h"
#include <esp_system.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include "config.h"

class HeaterModule
{
public:
    HeaterModule() {}
    void setup()
    {
        adjustment.requestId = esp_random();
        observations = xQueueCreate(8, sizeof(Observation));
        powerRequests = xQueueCreate(4, sizeof(bool));
        pinMode(LED_BUILTIN, OUTPUT);
        temperatureModule.setup();
        servoModuleA.setup(SERVO_PIN_A);
        servoModuleB.setup(SERVO_PIN_B);
        servoModuleC.setup(SERVO_PIN_C);
        flowModule.setup();
        colorModule.setup();
        buttonA.setup(BUTTON_PIN_A);
        buttonB.setup(BUTTON_PIN_B);
        buttonC.setup(BUTTON_PIN_C);
    }

    bool loop()
    {
        bool requestedPower;
        if (powerRequests && xQueueReceive(powerRequests, &requestedPower, 0) == pdTRUE && setPower(requestedPower))
            return true;
        Observation observation;
        while (observations && xQueueReceive(observations, &observation, 0) == pdTRUE) {
            if (observation.verification) {
                if (adjustment.verify(observation.id, observation.value))
                    temperatureModule.update(observation.value);
            } else temperatureModule.update(observation.value);
        }
        flowModule.poll();
        colorModule.poll();
        bool powerPressed = buttonA.pressed();
        bool increasePressed = buttonB.pressed();
        bool decreasePressed = buttonC.pressed();
        if (int(powerPressed) + int(increasePressed) + int(decreasePressed) == 1) {
            if (powerPressed) {
                if (powerKnown) return setPower(!power);
                if (!tapPowerButton()) return false;
                temperatureModule.invalidate();
                return true;
            }
            if (powerKnown && power)
                adjustment.select(increasePressed ? 1 : -1, temperatureModule.read(), millis());
        }
        if (powerKnown && power) {
            int direction = adjustment.tick(millis());
            if (direction) {
                temperatureModule.invalidate();
                if (direction > 0) servoModuleB.tap();
                else servoModuleC.tap();
                adjustment.completedPress(millis());
            }
        }
        return false;
    }

    bool monitorAutoShutdown()
    {
        float temp = temperatureModule.read();
        if (isAutoShutdownEnabled && temperatureModule.isAvailable() && temp >= AUTO_SHUTDOWN_TEMPERATURE_C && powerKnown && power)
        {
            return setPower(false);
        }
        return false;
    }

    bool getPower() { return power; }
    bool isPowerKnown() { return powerKnown; }
    void observePowerOn()
    {
        power = true;
        powerKnown = true;
        digitalWrite(LED_BUILTIN, HIGH);
    }
    void requestPower(bool p) { if (powerRequests) xQueueSend(powerRequests, &p, 0); }
    bool setPower(bool p)
    {
        if (!powerKnown || power == p || !tapPowerButton())
            return false;
        adjustment.cancel();
        power = p;
        digitalWrite(LED_BUILTIN, p);
        temperatureModule.invalidate();
        return true;
    }

    bool getIsAutoShutdownEnabled() { return isAutoShutdownEnabled; }
    void setIsAutoShutdownEnabled(bool iase)
    {
        isAutoShutdownEnabled = iase;
    }

    void setTemperature(float value)
    {
        enqueueObservation({value, 0, false});
    }
    void verifyTemperature(uint32_t id, float value) { enqueueObservation({value, id, true}); }
    bool needsTemperatureVerification() { return adjustment.needsVerification(millis()); }
    uint32_t temperatureVerificationId() { return adjustment.requestId; }
    const char *getAdjustmentStatus() { return adjustment.status(); }
    bool isTemperatureLocked() { return adjustment.locked(); }
    int getTargetTemperature() { return adjustment.target; }
    void invalidateTemperature() { temperatureModule.invalidate(); }
    bool isTemperatureAvailable() { return temperatureModule.isAvailable(); }
    ColorModule &getColor() { return colorModule; }

    float getTemperature() { return temperatureModule.read(); }

    float getFlowrate() { return flowModule.read(); }
    float getVolume() { return flowModule.getTotalVolume(); }

private:
    bool reserveServoPress()
    {
        unsigned long now = millis();
        if (hasTapped && now - lastTap_ms < 1000UL)
            return false;
        hasTapped = true;
        lastTap_ms = now;
        return true;
    }

    bool tapPowerButton()
    {
        if (!reserveServoPress()) return false;
        servoModuleA.tap();
        return true;
    }

    struct Observation { float value; uint32_t id; bool verification; };
    QueueHandle_t observations = nullptr;
    QueueHandle_t powerRequests = nullptr;
    void enqueueObservation(Observation observation) {
        if (observations) xQueueSend(observations, &observation, 0);
    }
    TemperatureAdjustment adjustment;
    unsigned long lastTap_ms = 0;
    bool hasTapped = false;
    ButtonModule buttonA, buttonB, buttonC;
    TemperatureModule temperatureModule;
    ServoModule servoModuleA, servoModuleB, servoModuleC;
    FlowModule flowModule;
    ColorModule colorModule;

    bool powerKnown = false;
    bool power = false;
    bool isAutoShutdownEnabled = false;
};