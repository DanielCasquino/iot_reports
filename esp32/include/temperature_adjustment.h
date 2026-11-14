#pragma once
#include <math.h>
#include <stdint.h>
#include "config.h"

// Owned by the main loop. Camera replies must carry the current request ID.
class TemperatureAdjustment
{
public:
    enum class State { Idle, Selecting, Reading, Applying, Confirming, Verifying, Error };
    State state = State::Idle;
    int target = 0;
    int estimated = 0;
    uint32_t requestId = 0;

    bool locked() const { return state != State::Idle && state != State::Selecting; }
    const char *status() const {
        switch (state) {
        case State::Selecting: return "selecting";
        case State::Reading: return "verifying";
        case State::Confirming: return "verifying";
        case State::Applying: return "applying";
        case State::Verifying: return "verifying";
        case State::Error: return "error";
        default: return "idle";
        }
    }
    void cancel() { state = State::Idle; }
    bool applyTarget(int value, int base) {
        if (state != State::Idle || value < MIN_TEMPERATURE_C || value > MAX_TEMPERATURE_C ||
            base < MIN_TEMPERATURE_C || base > MAX_TEMPERATURE_C) return false;
        target = value;
        estimated = base;
        corrections = 0;
        hasPressed = false;
        state = State::Reading;
        requested = false;
        readingStarted = false;
        ++requestId;
        return true;
    }
    bool finishWithoutCamera(uint32_t now) {
        if (state != State::Verifying || uint32_t(now - verifyingAt) < TEMPERATURE_ADJUST_SETTLE_MS) return false;
        state = State::Idle;
        return true;
    }
    void select(int direction, float observed, uint32_t now) {
        if (locked()) return;
        if (state == State::Idle) {
            if (!isfinite(observed) || observed < MIN_TEMPERATURE_C ||
                observed > MAX_TEMPERATURE_C || observed != roundf(observed)) return;
            estimated = target = int(observed);
            corrections = 0;
            state = State::Selecting;
        }
        target = nextSetpoint(target, direction);
        selectedAt = now; // Even a press at a limit restarts the window.
    }
    // Returns at most one physical press per tick, keeping other polling alive.
    int tick(uint32_t now) {
        if (state == State::Reading && !readingStarted) {
            readingStarted = true;
            pressedAt = now;
            return 1;
        }
        if ((state == State::Reading || state == State::Confirming) &&
            uint32_t(now - pressedAt) >= TEMPERATURE_SELECT_MS - 500UL) {
            state = State::Error;
            return 0;
        }
        if (state == State::Selecting && uint32_t(now - selectedAt) >= TEMPERATURE_SELECT_MS) {
            if (target == estimated) { state = State::Idle; return 0; }
            state = State::Applying;
            hasPressed = false;
        }
        if (state == State::Verifying && uint32_t(now - verifyingAt) >= TEMPERATURE_VERIFY_TIMEOUT_MS)
            state = State::Error;
        if (state != State::Applying || (hasPressed && uint32_t(now - pressedAt) < TEMPERATURE_PRESS_INTERVAL_MS)) return 0;
        if (hasPressed && uint32_t(now - pressedAt) >= TEMPERATURE_SELECT_MS - 500UL) {
            state = State::Error;
            return 0;
        }
        int count = (MAX_TEMPERATURE_C - MIN_TEMPERATURE_C) / TEMPERATURE_STEP_C + 1;
        int increase = (target - estimated + count * TEMPERATURE_STEP_C) % (count * TEMPERATURE_STEP_C);
        int decrease = (estimated - target + count * TEMPERATURE_STEP_C) % (count * TEMPERATURE_STEP_C);
        int direction = increase <= decrease ? 1 : -1;
        estimated = nextSetpoint(estimated, direction);
        pressedAt = now;
        hasPressed = true;
        return direction;
    }
    // Call after the servo has returned, so settle time starts after completion.
    void completedPress(uint32_t now) {
        pressedAt = now;
        if (state == State::Reading) return;
        if (estimated == target) {
            state = State::Confirming;
            requested = false;
            ++requestId;
        }
    }
    void waitForDisplay(uint32_t now) {
        state = State::Verifying;
        verifyingAt = now;
        requested = false;
        ++requestId;
    }
    bool needsVerification(uint32_t now) {
        if (state == State::Reading || state == State::Confirming) {
            if (!readingStarted || uint32_t(now - pressedAt) >= TEMPERATURE_SELECT_MS - 500UL) return false;
            if (requested && uint32_t(now - requestedAt) < 500UL) return false;
            requested = true;
            requestedAt = now;
            return true;
        }
        if (state != State::Verifying || uint32_t(now - verifyingAt) < TEMPERATURE_ADJUST_SETTLE_MS) return false;
        if (requested && uint32_t(now - requestedAt) < TEMPERATURE_VERIFY_RETRY_MS) return false;
        requested = true;
        requestedAt = now;
        return true;
    }
    bool verify(uint32_t id, float observed, uint32_t now = 0) {
        if (state == State::Reading || state == State::Confirming) {
            if (!requested || id != requestId || !isfinite(observed) ||
                observed < MIN_TEMPERATURE_C || observed > MAX_TEMPERATURE_C || observed != roundf(observed) ||
                uint32_t(now - pressedAt) >= TEMPERATURE_SELECT_MS - 500UL) return false;
            if (state == State::Confirming && int(observed) != target) { state = State::Error; return false; }
            estimated = int(observed);
            hasPressed = true;
            if (estimated == target) waitForDisplay(now);
            else state = State::Applying;
            return false;
        }
        if (state != State::Verifying || !requested || id != requestId || !isfinite(observed) ||
            observed < MIN_TEMPERATURE_C || observed > MAX_TEMPERATURE_C || observed != roundf(observed)) return false;
        if (observed == target) { state = State::Idle; return true; }
        if (++corrections > TEMPERATURE_MAX_CORRECTIONS) { state = State::Error; return false; }
        estimated = int(observed);
        state = State::Applying;
        hasPressed = false;
        return false;
    }
private:
    static int nextSetpoint(int value, int direction) {
        int next = value + direction * TEMPERATURE_STEP_C;
        if (next < MIN_TEMPERATURE_C) return MAX_TEMPERATURE_C;
        if (next > MAX_TEMPERATURE_C) return MIN_TEMPERATURE_C;
        return next;
    }
    uint32_t selectedAt = 0, pressedAt = 0, verifyingAt = 0, requestedAt = 0;
    bool hasPressed = false, requested = false, readingStarted = false;
    unsigned corrections = 0;
};
