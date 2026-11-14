#include <cassert>
#include <cmath>
#include "temperature_adjustment.h"
using State = TemperatureAdjustment::State;

int main() {
    for (int base = 30; base <= 75; ++base) {
        for (int target = 30; target <= 75; ++target) {
            TemperatureAdjustment a;
            assert(a.applyTarget(target, 40));
            assert(a.tick(0) == 1 && a.estimated == 40);
            a.completedPress(500);
            assert(a.tick(600) == 0 && a.state == State::Reading);
            assert(a.needsVerification(600));
            assert(!a.verify(a.requestId - 1, base, 600));
            assert(!a.verify(a.requestId, NAN, 600));
            assert(!a.verify(a.requestId, base, 600));
            assert(a.estimated == base);
            unsigned presses = 0;
            uint32_t now = 1500;
            while (a.state == State::Applying) {
                assert(a.tick(now) != 0);
                a.completedPress(now + 500);
                now += 1500;
                assert(++presses <= 23);
            }
            assert(a.estimated == target);
            if (base != target) {
                assert(a.state == State::Confirming);
                assert(a.needsVerification(now - 900));
                assert(!a.verify(a.requestId, target, now - 900));
            }
            assert(a.state == State::Verifying && a.locked());
            assert(a.finishWithoutCamera(now + 6000));
            assert(!a.locked());
        }
    }
    TemperatureAdjustment timeout;
    assert(timeout.applyTarget(46, 40));
    assert(timeout.tick(0) == 1);
    timeout.completedPress(500);
    assert(timeout.needsVerification(600));
    assert(timeout.tick(5000) == 0 && timeout.state == State::Error);
    assert(!timeout.verify(timeout.requestId, 43, 5001));
    TemperatureAdjustment late;
    assert(late.applyTarget(46, 40));
    late.tick(0); late.completedPress(500); late.needsVerification(600);
    assert(!late.verify(late.requestId, 43, 5000));
    assert(late.state == State::Reading);
    late.tick(5000); assert(late.state == State::Error);
    TemperatureAdjustment mismatch;
    mismatch.applyTarget(44, 40); mismatch.tick(0); mismatch.completedPress(500);
    mismatch.needsVerification(600); mismatch.verify(mismatch.requestId, 43, 600);
    assert(mismatch.tick(1500) == 1); mismatch.completedPress(2000);
    mismatch.needsVerification(2100); mismatch.verify(mismatch.requestId, 43, 2100);
    assert(mismatch.state == State::Error);
    TemperatureAdjustment stalled;
    stalled.applyTarget(46, 40); stalled.tick(0); stalled.completedPress(500);
    stalled.needsVerification(600); stalled.verify(stalled.requestId, 43, 600);
    assert(stalled.tick(5000) == 0 && stalled.state == State::Error);
    TemperatureAdjustment invalid;
    assert(!invalid.applyTarget(76, 43));
    assert(!invalid.applyTarget(29, 43));
}
