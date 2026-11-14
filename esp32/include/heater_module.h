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
    enum class PilotState
    {
        Unknown,
        Unlit,
        Awake
    };
    HeaterModule() {}
    void setup()
    {
        adjustment.requestId = esp_random();
        observations = xQueueCreate(8, sizeof(Observation));
        pilotObservations = xQueueCreate(8, sizeof(PilotObservation));
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
        servoModuleA.setup(SERVO_PIN_A, SERVO_REST_A, SERVO_PRESS_A);
        servoModuleB.setup(SERVO_PIN_B, SERVO_REST_B, SERVO_PRESS_B);
        servoModuleC.setup(SERVO_PIN_C, SERVO_REST_C, SERVO_PRESS_C);
        flowModule.setup();
        colorModule.setup();
        buttonA.setup(BUTTON_PIN_A);
        buttonB.setup(BUTTON_PIN_B);
        buttonC.setup(BUTTON_PIN_C);
    }

    bool loop()
    {
        bool previousPowerKnown = powerKnown;
        bool previousPower = power;
        temperatureModule.poll();
        PilotObservation pilot;
        while (pilotObservations && xQueueReceive(pilotObservations, &pilot, 0) == pdTRUE)
        {
            pilotState = pilot.state;
            pilotObservedAt = pilot.at;
            hasPilotObservation = true;
            if (pilotIs(PilotState::Awake) && !powerKnown)
                observePowerOn();
            if (wakeFailed && pilotIs(PilotState::Awake) &&
                static_cast<int32_t>(pilot.at - wakeStartedAt) > 0)
                resetWakeFailure();
            if (waking && pilotIs(PilotState::Awake) &&
                static_cast<int32_t>(pilot.at - wakeStartedAt) > 0)
            {
                waking = false;
                temperatureControlChanged = true;
                Serial.println("Heater wake confirmed by pilot");
            }
        }
        if (waking && millis() - wakeStartedAt >= PILOT_WAKE_TIMEOUT_MS)
            failWake();
        if (pendingPowerOff && !waking && !wakeFailed && setPower(false))
            return true;
        bool requestedPower;
        if (powerRequests && xQueuePeek(powerRequests, &requestedPower, 0) == pdTRUE &&
            (!requestedPower || power || !hasTapped || millis() - lastTap_ms >= 1000UL))
        {
            xQueueReceive(powerRequests, &requestedPower, 0);
            resetWakeFailure();
            if (setPower(requestedPower))
                return true;
        }
        TemperatureRequest request;
        if (temperatureRequests && xQueueReceive(temperatureRequests, &request, 0) == pdTRUE)
        {
            if (request.id != lastTemperatureCommandId)
            {
                lastTemperatureCommandId = request.id;
                resetWakeFailure();
                temperatureCommandResult = "accepted";
                if (isTemperatureLocked() || adjustment.state != TemperatureAdjustment::State::Idle)
                    temperatureCommandResult = "busy";
                else if (request.target < MIN_TEMPERATURE_C || request.target > MAX_TEMPERATURE_C)
                    temperatureCommandResult = "invalid";
                else if (request.calibrate)
                    setpoint = request.target;
                else if (!powerKnown || !power)
                    temperatureCommandResult = "off";
                else if (request.base != setpoint)
                    temperatureCommandResult = "base_mismatch";
                else if (!adjustment.applyTarget(request.target, setpoint))
                    temperatureCommandResult = "invalid";
            }
            temperatureControlChanged = true;
        }
        auto previousAdjustmentState = adjustment.state;
        Observation observation;
        while (observations && xQueueReceive(observations, &observation, 0) == pdTRUE)
        {
#if !TEMPORARY_SENSOR_TEST_MODE
            if (observation.verification)
            {
                auto beforeReading = adjustment.state;
                adjustment.verify(observation.id, observation.value, millis());
                if (beforeReading == TemperatureAdjustment::State::Reading &&
                    adjustment.state != beforeReading && adjustment.state != TemperatureAdjustment::State::Error)
                    setpoint = adjustment.estimated;
            }
            else if (!isTemperatureLocked())
            {
                temperatureModule.update(observation.value);
                if (!powerKnown && pilotIs(PilotState::Unlit) && temperatureModule.isAvailable())
                {
                    power = true;
                    powerKnown = true;
                    digitalWrite(LED_BUILTIN, HIGH);
                    Serial.println("Power observed on from readable display");
                }
            }
#endif
        }
        flowModule.poll();
        colorModule.poll();
        bool powerPressed = buttonA.pressed();
        bool increasePressed = buttonB.pressed();
        bool decreasePressed = buttonC.pressed();
        if (int(powerPressed) + int(increasePressed) + int(decreasePressed) == 1 && reserveServoPress())
        {
            resetWakeFailure();
            waking = pendingPowerOff = false;
            if (powerRequests) xQueueReset(powerRequests);
            if (temperatureRequests) xQueueReset(temperatureRequests);
            if (observations) xQueueReset(observations);
            if (pilotObservations) xQueueReset(pilotObservations);
            hasPilotObservation = false;
            adjustment.cancel();
            if (powerPressed) servoModuleA.tap();
            else if (increasePressed) servoModuleB.tap();
            else servoModuleC.tap();
            if (powerPressed) powerKnown = false;
            setpoint = -1;
            adjustment.target = 0;
            adjustment.waitForDisplay(millis());
            invalidateTemperature();
            temperatureControlChanged = true;
            return true;
        }
        if (powerKnown && power && !waking && !wakeFailed && !pendingPowerOff &&
            ((adjustment.state != TemperatureAdjustment::State::Applying &&
              adjustment.state != TemperatureAdjustment::State::Selecting &&
              adjustment.state != TemperatureAdjustment::State::Reading) ||
             prepareControls()))
        {
            int direction = adjustment.tick(millis());
            if (direction)
            {
                invalidateTemperature();
                if (direction > 0)
                    servoModuleB.tap();
                else
                    servoModuleC.tap();
                if (adjustment.state != TemperatureAdjustment::State::Reading)
                    setpoint = adjustment.estimated;
                adjustment.completedPress(millis());
            }
        }
        adjustment.finishWithoutCamera(millis());
        if (adjustment.state == TemperatureAdjustment::State::Error) setpoint = -1;
        if (previousAdjustmentState != adjustment.state)
            temperatureControlChanged = true;
        return powerKnown != previousPowerKnown || power != previousPower;
    }

    bool monitorAutoShutdown()
    {
        float temp = temperatureModule.read();
        if (!waking && !wakeFailed && !pendingPowerOff && isAutoShutdownEnabled && temperatureModule.isAvailable() && temp >= AUTO_SHUTDOWN_TEMPERATURE_C && powerKnown && power)
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
        return;
#endif
        if (!powerKnown || !power)
            Serial.println("Power observed on from pilot");
        power = true;
        powerKnown = true;
        pilotState = PilotState::Awake;
        pilotObservedAt = millis();
        hasPilotObservation = true;
        digitalWrite(LED_BUILTIN, HIGH);
    }
    void observePilot(PilotState state)
    {
#if !TEMPORARY_SENSOR_TEST_MODE
        PilotObservation observation{state, millis()};
        if (pilotObservations)
            xQueueSend(pilotObservations, &observation, 0);
#else
        (void)state;
#endif
    }
    void requestPower(bool p)
    {
        if (powerRequests)
            xQueueSend(powerRequests, &p, 0);
    }
    bool setPower(bool p)
    {
        if (!powerKnown || wakeFailed)
            return false;
        if (power == p)
        {
            if (pendingPowerOff)
            {
                pendingPowerOff = false;
                waking = false;
                temperatureControlChanged = true;
            }
            return false;
        }
        if (waking)
        {
            pendingPowerOff = !p;
            adjustment.cancel();
            temperatureControlChanged = true;
            return false;
        }
        if (!p)
        {
            adjustment.cancel();
            pendingPowerOff = true;
            if (!prepareControls())
                return false;
        }
        if (!tapPowerButton())
            return false;
        pendingPowerOff = false;
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
        return (adjustment.state == TemperatureAdjustment::State::Reading ||
                adjustment.state == TemperatureAdjustment::State::Confirming) && adjustment.needsVerification(millis());
    }
    uint32_t temperatureVerificationId() { return adjustment.requestId; }
    const char *getAdjustmentStatus()
    {
        if (wakeFailed)
            return "error";
        if (waking || pendingPowerOff)
            return "applying";
        if (adjustment.state == TemperatureAdjustment::State::Verifying)
            return "settling";
        return adjustment.status();
    }
    void requestTemperatureControl(uint32_t id, int base, int target, bool calibrate)
    {
        TemperatureRequest request{id, base, target, calibrate};
        if (temperatureRequests)
            xQueueSend(temperatureRequests, &request, 0);
    }
    int getSetpoint()
    {
        return setpoint;
    }
    uint32_t getTemperatureCommandId() { return lastTemperatureCommandId; }
    const char *getTemperatureCommandResult() { return temperatureCommandResult; }
    bool takeTemperatureControlChanged()
    {
        bool changed = temperatureControlChanged;
        temperatureControlChanged = false;
        return changed;
    }
    bool isTemperatureLocked() { return waking || wakeFailed || pendingPowerOff || adjustment.locked(); }
    int getTargetTemperature() { return adjustment.target; }
    void invalidateTemperature()
    {
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
    bool pilotIs(PilotState state) const
    {
        return hasPilotObservation && pilotState == state && millis() - pilotObservedAt <= PILOT_MAX_AGE_MS;
    }
    bool prepareControls()
    {
#if TEMPORARY_SENSOR_TEST_MODE
        return true;
#else
        if (waking || wakeFailed)
            return false;
        if (pilotIs(PilotState::Awake))
            return true;
        if (!pilotIs(PilotState::Unlit))
        {
            failWake();
            return false;
        }
        if (!tapPowerButton())
            return false;
        waking = true;
        wakeStartedAt = millis();
        invalidateTemperature();
        temperatureControlChanged = true;
        Serial.println("Waking heater before applying command");
        return false;
#endif
    }
    void failWake()
    {
        waking = false;
        wakeFailed = true;
        pendingPowerOff = false;
        adjustment.cancel();
        temperatureControlChanged = true;
        Serial.println("Heater wake unconfirmed; command cancelled");
    }
    void resetWakeFailure()
    {
        if (!wakeFailed)
            return;
        wakeFailed = false;
        temperatureControlChanged = true;
    }
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
        if (!reserveServoPress())
            return false;
        servoModuleA.tap();
        return true;
    }

    struct TemperatureRequest
    {
        uint32_t id;
        int base;
        int target;
        bool calibrate;
    };
    QueueHandle_t temperatureRequests = nullptr;
    uint32_t lastTemperatureCommandId = 0;
    const char *temperatureCommandResult = "none";
    bool temperatureControlChanged = true;
    struct PilotObservation
    {
        PilotState state;
        unsigned long at;
    };
    QueueHandle_t pilotObservations = nullptr;
    PilotState pilotState = PilotState::Unknown;
    unsigned long pilotObservedAt = 0, wakeStartedAt = 0;
    bool hasPilotObservation = false;
    bool waking = false, wakeFailed = false, pendingPowerOff = false;
    struct Observation
    {
        float value;
        uint32_t id;
        bool verification;
    };
    QueueHandle_t observations = nullptr;
    QueueHandle_t powerRequests = nullptr;
    void enqueueObservation(Observation observation)
    {
        if (observations)
            xQueueSend(observations, &observation, 0);
    }
    TemperatureAdjustment adjustment;
#if TEMPORARY_SENSOR_TEST_MODE
    int setpoint = TEMPORARY_INITIAL_SETPOINT_C;
#else
    int setpoint = -1;
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
