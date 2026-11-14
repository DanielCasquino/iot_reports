#include <cassert>
#include <cmath>
#include <initializer_list>
#include "temperature_adjustment.h"
using State = TemperatureAdjustment::State;
void open(TemperatureAdjustment &a) {
    assert(a.tick(0) == 1);
    a.completedPress(500);
    assert(!a.needsVerification(600));
    assert(a.tick(1499) == 0);
    assert(a.tick(1500) == 1);
    a.completedPress(2000);
    assert(a.needsVerification(2100));
}
int main() {
    for (bool awake : {false, true}) {
        for (int base = 30; base <= 75; ++base) {
            for (int target = 30; target <= 75; ++target) {
                TemperatureAdjustment a;
                assert(a.applyTarget(target, base));
                open(a);
                int shown = awake ? (base == 75 ? 30 : base + 1) : base;
                assert(!a.verify(a.requestId - 1, shown, 2100));
                assert(!a.verify(a.requestId, NAN, 2100));
                assert(!a.verify(a.requestId, shown, 2100));
                assert(a.estimated == shown);
                unsigned presses = 0;
                uint32_t now = 3000;
                while (a.state == State::Applying) {
                    assert(a.tick(now) != 0);
                    a.completedPress(now + 500);
                    now += 1500;
                    assert(++presses <= 23);
                }
                assert(a.estimated == target);
                if (shown != target) {
                    assert(a.state == State::Confirming);
                    assert(a.needsVerification(now - 900));
                    assert(!a.verify(a.requestId, target, now - 900));
                }
                assert(a.state == State::Verifying && a.locked());
                assert(a.finishWithoutCamera(now + 6000));
                assert(!a.locked());
            }
        }
    }
    TemperatureAdjustment timeout;
    timeout.applyTarget(44, 43); open(timeout);
    assert(timeout.tick(6500) == 0 && timeout.state == State::Error);
    assert(!timeout.verify(timeout.requestId, 43, 6501));
    assert(!timeout.finishWithoutCamera(12499));
    assert(timeout.finishWithoutCamera(12500));
    assert(timeout.applyTarget(44, 43));
    TemperatureAdjustment late;
    late.applyTarget(44, 43); open(late);
    assert(!late.verify(late.requestId, 43, 6500));
    late.tick(6500); assert(late.state == State::Error);
    TemperatureAdjustment mismatch;
    mismatch.applyTarget(44, 43); open(mismatch);
    mismatch.verify(mismatch.requestId, 43, 2100);
    assert(mismatch.tick(3000) == 1); mismatch.completedPress(3500);
    mismatch.needsVerification(3600); mismatch.verify(mismatch.requestId, 43, 3600);
    assert(mismatch.state == State::Error);
    TemperatureAdjustment invalid;
    assert(!invalid.applyTarget(76, 43)); assert(!invalid.applyTarget(29, 43));
}
