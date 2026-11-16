#pragma once
#include "temperature_module.h"
#include "servo_module.h"
#include "flow_module.h"
#include "color_module.h"
#include "button_module.h"
#include "temperature_adjustment.h"
#include <esp_system.h>
#include <atomic>
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
        Awake,
        ObservedOn,
        ObservedOff
    };
    HeaterModule() {}
    void setup()
    {
        adjustment.requestId = esp_random();
        wakeRequestId = esp_random();
        observations = xQueueCreate(8, sizeof(Observation));
        pilotObservations = xQueueCreate(8, sizeof(PilotObservation));
        powerRequests = xQueueCreate(4, sizeof(bool));
        displayWakeRequests = xQueueCreate(1, sizeof(bool));
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

    void attachTransportRevision(const std::atomic<uint32_t> &revision)
    {
        transportRevision = &revision;
        acceptedTransportRevision = revision.load();
    }
    bool loop()
    {
        synchronizeTransport();
        bool previousPowerKnown = powerKnown;
        bool previousPower = power;
        temperatureModule.poll();
        PilotObservation pilot;
        while (pilotObservations && xQueueReceive(pilotObservations, &pilot, 0) == pdTRUE)
        {
            if (!acceptsObservation(pilot.at)) continue;
            if (pilot.state == PilotState::ObservedOn || pilot.state == PilotState::ObservedOff)
            {
                // Optical state is not a command. Apply it only outside a
                // button/selection operation, on the controller's main loop.
                if (waking || pendingPowerOff || adjustment.locked()) continue;
                if (pilot.state == PilotState::ObservedOn)
                {
                    power = true;
                    powerKnown = true;
                    digitalWrite(LED_BUILTIN, HIGH);
                    // A dim/readable visor proves ON, not awake controls.
                }
                else
                {
                    power = false;
                    powerKnown = true;
                    hasPilotObservation = hasWakeConfirmation = false;
                    resetWakeFailure();
                    setpoint = -1;
                    invalidateTemperature();
                    digitalWrite(LED_BUILTIN, LOW);
                    temperatureControlChanged = true;
                }
                continue;
            }
            pilotState = pilot.state;
            pilotObservedAt = pilot.at;
            hasPilotObservation = true;
            if (pilotIs(PilotState::Awake) && !powerKnown)
                observePowerOn();
            if (wakeFailed && pilotIs(PilotState::Awake) &&
                static_cast<int32_t>(pilot.at - wakeStartedAt) > 0)
                resetWakeFailure();
            if (waking && pilotIs(PilotState::Awake) &&
                uint32_t(pilot.at - wakeStartedAt) >= TEMPERATURE_ADJUST_SETTLE_MS &&
                static_cast<int32_t>(pilot.at - wakeStartedAt) > 0)
            {
                confirmWake();
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
                else if (powerKnown && !power)
                    temperatureCommandResult = "off";
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
            if (!acceptsObservation(observation.at)) continue;
            if (observation.wake)
            {
                if (waking && wakeVerificationRequested && observation.id == wakeRequestId &&
                    static_cast<int32_t>(observation.at - wakeStartedAt) >= int32_t(TEMPERATURE_ADJUST_SETTLE_MS) &&
                    std::isfinite(observation.value) && observation.value >= 0 && observation.value <= 100)
                {
                    confirmWake();
                    Serial.println("Heater wake confirmed by fresh camera capture");
                }
                continue; // Wake evidence is never a water-temperature observation.
            }
            if (observation.verification)
            {
                auto beforeReading = adjustment.state;
                adjustment.verify(observation.id, observation.value, millis());
                if (beforeReading == TemperatureAdjustment::State::Reading &&
                    adjustment.state != beforeReading && adjustment.state != TemperatureAdjustment::State::Error)
                    setpoint = adjustment.estimated;
            }
            else if (!adjustment.locked() && (!waking ||
                     (static_cast<int32_t>(observation.at - wakeStartedAt) >= int32_t(TEMPERATURE_ADJUST_SETTLE_MS))))
            {
                temperatureModule.update(observation.value);
                if (waking && temperatureModule.isAvailable())
                {
                    confirmWake();
                }
                if (!powerKnown && temperatureModule.isAvailable())
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
        bool displayWakeRequested = false;
        if (displayWakeRequests) xQueueReceive(displayWakeRequests, &displayWakeRequested, 0);
        increasePressed = increasePressed || displayWakeRequested;
        bool decreasePressed = buttonC.pressed();
        if (int(powerPressed) + int(increasePressed) + int(decreasePressed) == 1 && reserveServoPress())
        {
            resetWakeFailure();
            waking = pendingPowerOff = false;
            hasWakeConfirmation = false;
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
        if (!waking && !pendingPowerOff)
        {
            int direction = adjustment.tick(millis());
            if (direction && !synchronizeTransport())
            {
                invalidateTemperature();
                if (direction > 0)
                    servoModuleB.tap();
                else
                    servoModuleC.tap();
                if (adjustment.state != TemperatureAdjustment::State::Reading &&
                    adjustment.state != TemperatureAdjustment::State::Opening)
                    setpoint = adjustment.estimated;
                invalidateTemperature(); // Also discard packets received during the tap.
                adjustment.completedPress(millis());
            }
        }
        adjustment.finishSettling(millis());
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
    void observePilot(PilotState state, uint32_t observedAt = millis())
    {
#if !TEMPORARY_SENSOR_TEST_MODE
        PilotObservation observation{state, observedAt};
        if (pilotObservations)
            xQueueSend(pilotObservations, &observation, 0);
#else
        (void)state;
        (void)observedAt;
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
        if (!p && temperatureRequests) xQueueReset(temperatureRequests);
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
            temperatureControlChanged = true;
            if (!prepareControls())
                return false;
        }
        if (!tapPowerButton())
            return false;
        pendingPowerOff = false;
        hasWakeConfirmation = false;
        adjustment.cancel();
        temperatureControlChanged = true;
        power = p; // Requested controller estimate; not a physical confirmation.
#if !TEMPORARY_SENSOR_TEST_MODE
        powerKnown = false;
        hasPilotObservation = false;
        if (pilotObservations) xQueueReset(pilotObservations);
#endif
        digitalWrite(LED_BUILTIN, LOW);
        invalidateTemperature();
        return true;
    }

    void requestDisplayWake()
    {
        bool requested = true;
        if (displayWakeRequests) xQueueOverwrite(displayWakeRequests, &requested);
    }
    bool getIsAutoShutdownEnabled() { return isAutoShutdownEnabled; }
    void setIsAutoShutdownEnabled(bool iase)
    {
        isAutoShutdownEnabled = iase;
    }

    void setTemperature(float value, uint32_t observedAt = millis())
    {
        enqueueObservation({value, 0, false, observedAt});
    }
    void verifyTemperature(uint32_t id, float value, uint32_t observedAt = millis()) { enqueueObservation({value, id, true, observedAt}); }
    void verifyWake(uint32_t id, float value, uint32_t observedAt = millis()) { enqueueObservation({value, id, false, observedAt, true}); }
    bool needsWakeVerification()
    {
        uint32_t now = millis();
        if (!waking || now - wakeStartedAt < TEMPERATURE_ADJUST_SETTLE_MS ||
            now - wakeStartedAt >= PILOT_WAKE_TIMEOUT_MS ||
            (wakeVerificationRequested && now - lastWakeVerificationAt < 500U)) return false;
        wakeVerificationRequested = true;
        lastWakeVerificationAt = now;
        return true;
    }
    uint32_t wakeVerificationId() const { return wakeRequestId; }
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
        if (adjustment.state == TemperatureAdjustment::State::Settling)
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
    bool acceptsObservation(uint32_t observedAt) const
    {
        return !hasObservationBarrier || static_cast<int32_t>(observedAt - observationBarrier) >= 0;
    }
    void invalidateObservations()
    {
        invalidateTemperature();
        if (pilotObservations) xQueueReset(pilotObservations);
        if (powerRequests) xQueueReset(powerRequests);
        if (temperatureRequests) xQueueReset(temperatureRequests);
        if (displayWakeRequests) xQueueReset(displayWakeRequests);
        if (adjustment.locked()) setpoint = -1;
        adjustment.cancel();
        waking = pendingPowerOff = false;
        hasWakeConfirmation = false;
        temperatureControlChanged = true;
        hasPilotObservation = false;
#if !TEMPORARY_SENSOR_TEST_MODE
        powerKnown = false;
#endif
    }
    void invalidateTemperature()
    {
        observationBarrier = millis();
        hasObservationBarrier = true;
        if (observations) xQueueReset(observations);
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
    void confirmWake()
    {
        waking = false;
        hasWakeConfirmation = true;
        controlsAwakeAt = millis();
        temperatureControlChanged = true;
    }
    bool prepareControls()
    {
#if TEMPORARY_SENSOR_TEST_MODE
        return true;
#else
        if (waking || wakeFailed)
            return false;
        if (pilotIs(PilotState::Awake) ||
            (hasWakeConfirmation && millis() - controlsAwakeAt <= PILOT_MAX_AGE_MS))
            return true;
        // The first + only wakes standby or opens selection. Never probe with
        // Power: that could switch an already-awake heater off.
        if (!reserveServoPress()) return false;
        servoModuleB.tap();
        waking = true;
        wakeStartedAt = millis();
        if (++wakeRequestId == 0) ++wakeRequestId;
        wakeVerificationRequested = false;
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
    bool synchronizeTransport()
    {
        if (!transportRevision || acceptedTransportRevision == transportRevision->load()) return false;
        acceptedTransportRevision = transportRevision->load();
        invalidateObservations();
        return true;
    }
    bool reserveServoPress()
    {
        if (synchronizeTransport()) return false;
        uint32_t now = millis();
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
        uint32_t at;
    };
    QueueHandle_t pilotObservations = nullptr;
    PilotState pilotState = PilotState::Unknown;
    uint32_t pilotObservedAt = 0, wakeStartedAt = 0;
    bool hasPilotObservation = false;
    bool waking = false, wakeFailed = false, pendingPowerOff = false;
    bool hasWakeConfirmation = false;
    uint32_t controlsAwakeAt = 0;
    uint32_t wakeRequestId = 0, lastWakeVerificationAt = 0;
    bool wakeVerificationRequested = false;
    struct Observation
    {
        float value;
        uint32_t id;
        bool verification;
        uint32_t at;
        bool wake = false;
    };
    QueueHandle_t observations = nullptr;
    QueueHandle_t powerRequests = nullptr;
    QueueHandle_t displayWakeRequests = nullptr;
    void enqueueObservation(Observation observation)
    {
        if (observations)
            xQueueSend(observations, &observation, 0);
    }
    const std::atomic<uint32_t> *transportRevision = nullptr;
    uint32_t acceptedTransportRevision = 0;
    uint32_t observationBarrier = 0;
    bool hasObservationBarrier = false;
    TemperatureAdjustment adjustment;
#if TEMPORARY_SENSOR_TEST_MODE
    int setpoint = TEMPORARY_INITIAL_SETPOINT_C;
#else
    int setpoint = -1;
#endif
    uint32_t lastTap_ms = 0;
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
