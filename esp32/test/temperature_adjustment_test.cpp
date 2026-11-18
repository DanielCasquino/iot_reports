#include <cassert>
#include <cmath>
#include <initializer_list>
#include "temperature_adjustment.h"
using State = TemperatureAdjustment::State;
void open(TemperatureAdjustment &a) {
    assert(a.tick(0) == 1);
    a.completedPress(500);
    assert(!a.needsVerification(600));
    assert(a.tick(6499) == 0);
    assert(a.tick(6500) == 1);
    a.completedPress(7000);
    assert(!a.needsVerification(7999));
    assert(a.needsVerification(8000));
}
int main() {
    {
        for (int base = 30; base <= 75; ++base) {
            for (int target = 30; target <= 75; ++target) {
                TemperatureAdjustment a;
                assert(a.applyTarget(target, base));
                open(a);
                int shown = base;
                assert(!a.verify(a.requestId - 1, shown, 8000));
                assert(!a.verify(a.requestId, NAN, 8000));
                assert(!a.verify(a.requestId, shown, 8000));
                assert(a.state == State::Reading); // First capture cannot select a base.
                assert(a.needsVerification(8500));
                a.verify(a.requestId, shown, 8500);
                assert(a.estimated == shown);
                unsigned presses = 0;
                uint32_t now = 9500;
                while (a.state == State::Applying) {
                    assert(a.tick(now) != 0);
                    a.completedPress(now + 500);
                    now += 1500;
                    assert(++presses <= 23);
                }
                assert(a.estimated == target);
                if (shown != target) {
                    assert(a.state == State::Confirming);
                    assert(a.needsVerification(now));
                    assert(!a.verify(a.requestId, target, now));
                    assert(a.state == State::Confirming);
                    assert(a.needsVerification(now + 500));
                    assert(!a.verify(a.requestId, target, now + 500));
                }
                assert(a.state == State::Settling && a.locked());
                assert(a.finishSettling(now + 6500));
                assert(!a.locked());
            }
        }
    }
    // First press opened selection: accept fresh two-frame evidence and skip
    // the second plus rather than always waiting six seconds.
    TemperatureAdjustment fast;
    assert(fast.applyTarget(45, -1));
    assert(fast.tick(0) == 1);
    assert(!fast.needsVerification(1000)); // servo not yet returned
    fast.completedPress(500);
    assert(!fast.needsVerification(1499));
    assert(fast.needsVerification(1500));
    const uint32_t firstId = fast.requestId;
    fast.verify(firstId, 37, 1500);
    assert(fast.state == State::Opening);
    fast.verify(firstId, 37, 1750);
    assert(fast.state == State::Applying && fast.estimated == 37);
    assert(fast.tick(1751) == 1);
    fast.completedPress(2251);

    TemperatureAdjustment oneStep;
    assert(oneStep.applyTarget(38, 37));
    assert(oneStep.tick(0) == 1);
    oneStep.completedPress(500);
    assert(oneStep.needsVerification(1500));
    oneStep.verify(oneStep.requestId, 37, 1500);
    oneStep.verify(oneStep.requestId, 37, 1750);
    assert(oneStep.tick(1751) == 1);
    oneStep.completedPress(2251);
    assert(oneStep.needsVerification(3351));
    oneStep.verify(oneStep.requestId, 38, 3351);
    oneStep.verify(oneStep.requestId, 38, 3751);
    assert(oneStep.state == State::Settling);
    assert(!oneStep.finishSettling(8250));
    assert(oneStep.finishSettling(8251));

    // First press merely wakes: after timeout use the second press and a new
    // request ID. A late reply from the first window must never set the base.
    TemperatureAdjustment waking;
    assert(waking.applyTarget(45, -1));
    assert(waking.tick(0) == 1);
    waking.completedPress(500);
    assert(waking.needsVerification(1500));
    const uint32_t oldId = waking.requestId;
    waking.verify(oldId, 38, 1500); // one candidate is insufficient
    assert(waking.tick(6499) == 0);
    assert(waking.tick(6500) == 1);
    assert(waking.requestId != oldId);
    waking.completedPress(7000);
    assert(waking.needsVerification(8000));
    waking.verify(oldId, 38, 8000);
    waking.verify(oldId, 38, 8300);
    assert(waking.state == State::Reading);
    waking.verify(waking.requestId, 37, 8300);
    waking.verify(waking.requestId, 37, 8550);
    assert(waking.state == State::Applying && waking.estimated == 37);

    TemperatureAdjustment timeout;
    timeout.applyTarget(44, 43); open(timeout);
    assert(timeout.tick(11500) == 0 && timeout.state == State::Error);
    assert(!timeout.verify(timeout.requestId, 43, 11501));
    assert(!timeout.finishSettling(17499));
    assert(timeout.finishSettling(17500));
    assert(timeout.applyTarget(44, 43));
    TemperatureAdjustment late;
    late.applyTarget(44, 43); open(late);
    assert(!late.verify(late.requestId, 43, 11500));
    late.tick(11500); assert(late.state == State::Error);
    TemperatureAdjustment mismatch;
    mismatch.applyTarget(44, 43); open(mismatch);
    mismatch.verify(mismatch.requestId, 43, 8000);
    mismatch.needsVerification(8500); mismatch.verify(mismatch.requestId, 43, 8500);
    assert(mismatch.tick(9500) == 1); mismatch.completedPress(10000);
    mismatch.needsVerification(11000); mismatch.verify(mismatch.requestId, 43, 11000);
    assert(mismatch.state == State::Confirming);
    mismatch.needsVerification(11500); mismatch.verify(mismatch.requestId, 43, 11500);
    assert(mismatch.state == State::Error);
    TemperatureAdjustment stale;
    stale.applyTarget(50, -1); open(stale);
    stale.verify(stale.requestId, 54, 8000); // Old water frame, then actual target31.
    stale.needsVerification(8500); stale.verify(stale.requestId, 31, 8500);
    assert(stale.state == State::Reading);
    stale.needsVerification(9000); stale.verify(stale.requestId, 31, 9000);
    assert(stale.state == State::Applying && stale.estimated == 31);
    TemperatureAdjustment invalid;
    assert(!invalid.applyTarget(76, 43)); assert(!invalid.applyTarget(29, 43));
}
