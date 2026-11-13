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
        temperatureRequests = xQueueCreate(4, sizeof(TemperatureRequest));
        pinMode(LED_BUILTIN, OUTPUT);
#if TEMPORARY_SENSOR_TEST_MODE
        // TEMPORARY: do not wait for the RGB pilot to establish initial power.
        // Start this test with the physical heater OFF.
        powerKnown = true;
        power = false;
        digitalWrite(LED_BUILTIN, LOW);
#endif
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
        temperatureModule.poll();
        bool requestedPower;
        if (powerRequests && xQueueReceive(powerRequests, &requestedPower, 0) == pdTRUE && setPower(requestedPower))
            return true;
        TemperatureRequest request;
        if (temperatureRequests && xQueueReceive(temperatureRequests, &request, 0) == pdTRUE) {
            if (request.id != lastTemperatureCommandId) {
                lastTemperatureCommandId = request.id;
                temperatureCommandResult = "accepted";
#if TEMPORARY_SENSOR_TEST_MODE
                if (adjustment.state != TemperatureAdjustment::State::Idle) temperatureCommandResult = "busy";
                else if (request.target < MIN_TEMPERATURE_C || request.target > MAX_TEMPERATURE_C) temperatureCommandResult = "invalid";
                else if (request.calibrate) testSetpoint = request.target;
                else if (!powerKnown || !power) temperatureCommandResult = "off";
                else if (request.base != testSetpoint) temperatureCommandResult = "base_mismatch";
                else if (!adjustment.applyTarget(request.target, testSetpoint)) temperatureCommandResult = "invalid";
#else
                temperatureCommandResult = "disabled";
#endif
            }
            temperatureControlChanged = true;
        }
        auto previousAdjustmentState = adjustment.state;
        Observation observation;
        while (observations && xQueueReceive(observations, &observation, 0) == pdTRUE) {
#if !TEMPORARY_SENSOR_TEST_MODE
            // TEMPORARILY bypass OCR updates/verification; probe owns temperature.
            if (observation.verification) {
                if (adjustment.verify(observation.id, observation.value))
                    temperatureModule.update(observation.value);
            } else temperatureModule.update(observation.value);
#endif
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
                invalidateTemperature();
                return true;
            }
            if (powerKnown && power) {
#if TEMPORARY_SENSOR_TEST_MODE
                // Water temperature is not the display setpoint. Track test presses
                // separately from the actual probe measurement.
                adjustment.select(increasePressed ? 1 : -1, testSetpoint, millis());
                temperatureControlChanged = true;
#else
                adjustment.select(increasePressed ? 1 : -1, temperatureModule.read(), millis());
#endif
            }
        }
        if (powerKnown && power) {
            int direction = adjustment.tick(millis());
            if (direction) {
                invalidateTemperature();
                if (direction > 0) servoModuleB.tap();
                else servoModuleC.tap();
#if TEMPORARY_SENSOR_TEST_MODE
                testSetpoint += direction * TEMPERATURE_STEP_C;
#endif
                adjustment.completedPress(millis());
            }
        }
#if TEMPORARY_SENSOR_TEST_MODE
        // Camera remains bypassed; wait for the physical panel to save first.
        adjustment.finishWithoutCamera(millis());
#endif
        if (previousAdjustmentState != adjustment.state) temperatureControlChanged = true;
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
#if TEMPORARY_SENSOR_TEST_MODE
        // TEMPORARILY ignore RGB-derived power observations.
        return;
#endif
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
        temperatureControlChanged = true;
        power = p;
        digitalWrite(LED_BUILTIN, p);
        invalidateTemperature();
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
    bool needsTemperatureVerification() {
#if TEMPORARY_SENSOR_TEST_MODE
        // TEMPORARY: camera remains available, but cannot block the controls.
        return false;
#else
        return adjustment.needsVerification(millis());
#endif
    }
    uint32_t temperatureVerificationId() { return adjustment.requestId; }
    const char *getAdjustmentStatus() {
#if TEMPORARY_SENSOR_TEST_MODE
        if (adjustment.state == TemperatureAdjustment::State::Verifying) return "settling";
#endif
        return adjustment.status();
    }
    void requestTemperatureControl(uint32_t id, int base, int target, bool calibrate) {
        TemperatureRequest request{id, base, target, calibrate};
        if (temperatureRequests) xQueueSend(temperatureRequests, &request, 0);
    }
    int getSetpoint() {
#if TEMPORARY_SENSOR_TEST_MODE
        return testSetpoint;
#else
        return -1;
#endif
    }
    uint32_t getTemperatureCommandId() { return lastTemperatureCommandId; }
    const char *getTemperatureCommandResult() { return temperatureCommandResult; }
    bool takeTemperatureControlChanged() {
        bool changed = temperatureControlChanged;
        temperatureControlChanged = false;
        return changed;
    }
    bool isTemperatureLocked() { return adjustment.locked(); }
    int getTargetTemperature() { return adjustment.target; }
    void invalidateTemperature() {
#if !TEMPORARY_SENSOR_TEST_MODE
        // TEMPORARILY preserve the probe reading across power/OCR events.
        temperatureModule.invalidate();
#endif
    }
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

    struct TemperatureRequest { uint32_t id; int base; int target; bool calibrate; };
    QueueHandle_t temperatureRequests = nullptr;
    uint32_t lastTemperatureCommandId = 0;
    const char *temperatureCommandResult = "none";
    bool temperatureControlChanged = true;
    struct Observation { float value; uint32_t id; bool verification; };
    QueueHandle_t observations = nullptr;
    QueueHandle_t powerRequests = nullptr;
    void enqueueObservation(Observation observation) {
        if (observations) xQueueSend(observations, &observation, 0);
    }
    TemperatureAdjustment adjustment;
#if TEMPORARY_SENSOR_TEST_MODE
    int testSetpoint = TEMPORARY_INITIAL_SETPOINT_C;
#endif
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