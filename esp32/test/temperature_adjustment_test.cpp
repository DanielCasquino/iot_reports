#include <cassert>
#include <limits>
#include "temperature_adjustment.h"
using State = TemperatureAdjustment::State;

int main() {
    TemperatureAdjustment a;
    a.select(1, 30, 0);
    a.select(1, 30, 1000);
    a.select(-1, 30, 2000);
    assert(a.target == 31 && !a.locked());
    assert(a.tick(6999) == 0);
    assert(a.tick(7000) == 1 && a.locked());
    a.completedPress(7150);
    a.select(1, 30, 7200);
    assert(a.target == 31 && a.state == State::Verifying);
    assert(!a.needsVerification(13149));
    assert(!a.verify(a.requestId, 31)); // No capture requested yet.
    assert(a.needsVerification(13150));
    assert(!a.verify(a.requestId - 1, 31));
    assert(!a.verify(a.requestId, NAN));
    assert(a.locked());
    assert(!a.needsVerification(18149));
    assert(a.needsVerification(18150));
    assert(a.verify(a.requestId, 31) && !a.locked());

    TemperatureAdjustment bounds;
    bounds.select(1, 74, 0);
    bounds.select(1, 74, 100);
    assert(bounds.target == 75);
    assert(bounds.tick(5099) == 0);
    assert(bounds.tick(5100) == 1);
    bounds.completedPress(5250);
    assert(bounds.needsVerification(11250));
    assert(!bounds.verify(bounds.requestId, 74)); // A missed press is corrected.
    assert(bounds.tick(11250) == 1);
    bounds.completedPress(11400);
    assert(bounds.needsVerification(17400));
    assert(bounds.verify(bounds.requestId, 75));
    bounds.select(-1, 20, 20000);
    assert(bounds.target == 20);
    assert(bounds.tick(25000) == 0 && bounds.state == State::Idle);

    TemperatureAdjustment multiple;
    multiple.select(-1, 30, 0);
    multiple.select(-1, 30, 10);
    multiple.select(-1, 30, 20);
    assert(multiple.tick(5020) == -1);
    multiple.completedPress(5170);
    assert(multiple.tick(6019) == 0);
    assert(multiple.tick(6020) == -1);
    multiple.completedPress(6170);
    assert(multiple.tick(7020) == -1);
    multiple.completedPress(7170);
    assert(multiple.state == State::Verifying);
    multiple.tick(67170);
    assert(multiple.state == State::Error && multiple.locked());
    multiple.select(1, 27, 70000);
    assert(multiple.target == 27);
    multiple.cancel();
    assert(!multiple.locked());

    TemperatureAdjustment bad;
    bad.select(1, NAN, 0);
    bad.select(1, 76, 0);
    bad.select(1, 30.5, 0);
    assert(bad.state == State::Idle);

    TemperatureAdjustment zero;
    zero.select(1, 30, 0);
    zero.select(-1, 30, 100);
    assert(zero.tick(5100) == 0 && zero.state == State::Idle);

    TemperatureAdjustment retry;
    retry.select(1, 30, 0);
    uint32_t now = 5000;
    for (unsigned i = 0; i <= TEMPERATURE_MAX_CORRECTIONS; ++i) {
        assert(retry.tick(now) == 1);
        retry.completedPress(now + 150);
        now += 150 + TEMPERATURE_ADJUST_SETTLE_MS;
        assert(retry.needsVerification(now));
        assert(!retry.verify(retry.requestId, 30));
    }
    assert(retry.state == State::Error && retry.locked());

    TemperatureAdjustment wrap;
    uint32_t start = UINT32_MAX - 1000;
    wrap.select(1, 30, start);
    assert(wrap.tick(start + 4999) == 0);
    assert(wrap.tick(start + 5000) == 1);
}
