#pragma once
#include <math.h>
#include <stdint.h>
#include "config.h"

// Owned by the main loop. Camera replies must carry the current request ID.
class TemperatureAdjustment
{
public:
    enum class State { Idle, Opening, Reading, Applying, Confirming, Settling, Error };
    State state = State::Idle;
    int target = 0;
    int estimated = 0;
    uint32_t requestId = 0;

    bool locked() const { return state != State::Idle; }
    const char *status() const {
        switch (state) {
        case State::Opening: return "verifying";
        case State::Reading: return "verifying";
        case State::Confirming: return "verifying";
        case State::Applying: return "applying";
        case State::Settling: return "settling";
        case State::Error: return "error";
        default: return "idle";
        }
    }
    void cancel() { state = State::Idle; clearFailure(); }
    const char *failureReason() const { return failure; }
    int observedMaximumAtFailure() const { return failedMaximum; }
    bool applyTarget(int value, int base) {
        if (state != State::Idle || value < MIN_TEMPERATURE_C || value > MAX_TEMPERATURE_C ||
            (base != -1 && (base < MIN_TEMPERATURE_C || base > MAX_TEMPERATURE_C))) return false;
        beginOpening(value, base, false);
        return true;
    }
    bool acquireMaximum() {
        if (state != State::Idle) return false;
        beginOpening(0, -1, true);
        return true;
    }
    bool finishSettling(uint32_t now) {
        if ((state != State::Settling && state != State::Error) || uint32_t(now - verifyingAt) < TEMPERATURE_ADJUST_SETTLE_MS) return false;
        state = State::Idle;
        return true;
    }
    // Returns at most one physical press per tick, keeping other polling alive.
    int tick(uint32_t now) {
        if (state == State::Opening) {
            if (!hasPressed) { hasPressed = true; pressedAt = now; return 1; }
            if (uint32_t(now - pressedAt) < TEMPERATURE_ADJUST_SETTLE_MS) return 0;
            if (uint32_t(now - pressedAt) >= TEMPERATURE_ADJUST_SETTLE_MS + 2500UL) {
                fail(now, "opening_window_expired");
                return 0;
            }
            // Invalidate the first request before the fallback press.
            ++requestId;
            requested = false;
            candidate = -1;
            state = State::Reading;
            readingStarted = true;
            pressedAt = now;
            return 1;
        }
        if ((state == State::Reading || state == State::Confirming) &&
            uint32_t(now - pressedAt) >= TEMPERATURE_SELECT_MS - 500UL) {
            fail(now, state == State::Reading ? "maximum_read_timeout" : "confirmation_timeout");
            return 0;
        }
        if (state != State::Applying || (hasPressed && uint32_t(now - pressedAt) < TEMPERATURE_PRESS_INTERVAL_MS)) return 0;
        if (hasPressed && uint32_t(now - pressedAt) >= TEMPERATURE_SELECT_MS - 500UL) {
            fail(now, "selection_window_expired");
            return 0;
        }
        const int steps = (MAX_TEMPERATURE_C - MIN_TEMPERATURE_C) / TEMPERATURE_STEP_C + 1;
        const int range = steps * TEMPERATURE_STEP_C;
        const int increase = (target - estimated + range) % range;
        const int decrease = (estimated - target + range) % range;
        int direction = increase <= decrease ? 1 : -1;
        estimated = nextSetpoint(estimated, direction);
        pressedAt = now;
        hasPressed = true;
        return direction;
    }
    // Call after the servo has returned, so settle time starts after completion.
    void completedPress(uint32_t now) {
        pressedAt = now;
        if (state == State::Opening) { readingStarted = true; return; }
        if (state == State::Reading) return;
        if (estimated == target) {
            state = State::Confirming;
            requested = false;
            ++requestId;
        }
    }
    void waitForDisplay(uint32_t lastPressAt) {
        state = State::Settling;
        verifyingAt = lastPressAt;
        requested = false;
        ++requestId;
    }
    bool needsVerification(uint32_t now) {
        if (state == State::Opening || state == State::Reading || state == State::Confirming) {
            if (!readingStarted || uint32_t(now - pressedAt) >= TEMPERATURE_SELECT_MS - 500UL) return false;
            // The heater/camera can still show water immediately after opening
            // selection. Allow the display and capture pipeline to catch up.
            if (uint32_t(now - pressedAt) < 1000UL) return false;
            if (requested && uint32_t(now - requestedAt) < 500UL) return false;
            if (!requested) candidate = -1;
            requested = true;
            requestedAt = now;
            return true;
        }
        return false;
    }
    bool verify(uint32_t id, float observed, uint32_t now = 0) {
        if (state == State::Opening || state == State::Reading || state == State::Confirming) {
            if (!requested || id != requestId || !isfinite(observed) ||
                observed < MIN_TEMPERATURE_C || observed > MAX_TEMPERATURE_C || observed != roundf(observed) ||
                uint32_t(now - pressedAt) >= TEMPERATURE_SELECT_MS - 500UL) return false;
            if (uint32_t(now - pressedAt) < 1000UL) return false;
            if (candidate != int(observed)) {
                candidate = int(observed);
                candidateAt = now;
                return false;
            }
            if (uint32_t(now - candidateAt) < 250UL) return false;
            if (state == State::Confirming && int(observed) != target) {
                fail(now, "maximum_mismatch", int(observed));
                return false;
            }
            estimated = int(observed);
            hasPressed = true;
            // The remaining display selection window runs from the press,
            // including the time already spent confirming its digits.
            if (readOnly || estimated == target) waitForDisplay(pressedAt);
            else state = State::Applying;
            return false;
        }
        return false;
    }
private:
    void beginOpening(int requestedMaximum, int estimatedMaximum, bool observeOnly) {
        clearFailure();
        readOnly = observeOnly;
        target = requestedMaximum;
        estimated = estimatedMaximum;
        hasPressed = false;
        state = State::Opening;
        requested = false;
        readingStarted = false;
        ++requestId;
    }

    void clearFailure() {
        failure = nullptr;
        failedMaximum = -1;
    }
    void fail(uint32_t now, const char *reason, int observedMaximum = -1) {
        state = State::Error;
        verifyingAt = now;
        failure = reason;
        failedMaximum = observedMaximum;
    }

    const char *failure = nullptr;
    int failedMaximum = -1;
    int candidate = -1;
    uint32_t candidateAt = 0;
    static int nextSetpoint(int value, int direction) {
        int next = value + direction * TEMPERATURE_STEP_C;
        if (next < MIN_TEMPERATURE_C) return MAX_TEMPERATURE_C;
        if (next > MAX_TEMPERATURE_C) return MIN_TEMPERATURE_C;
        return next;
    }
    uint32_t pressedAt = 0, verifyingAt = 0, requestedAt = 0;
    bool hasPressed = false, requested = false, readingStarted = false, readOnly = false;
};
