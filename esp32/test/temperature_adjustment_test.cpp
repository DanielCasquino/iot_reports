#include <cassert>
#include <limits>
#include "temperature_adjustment.h"
using State = TemperatureAdjustment::State;

int main() {
    TemperatureAdjustment a;
    a.select(1, 40, 0);
    a.select(1, 40, 1000);
    a.select(-1, 40, 2000);
    assert(a.target == 41 && !a.locked());
    assert(a.tick(6999) == 0);
    assert(a.tick(7000) == 1 && a.locked());
    a.completedPress(7150);
    a.select(1, 40, 7200);
    assert(a.target == 41 && a.state == State::Verifying);
    assert(!a.needsVerification(13149));
    assert(!a.verify(a.requestId, 41)); // No capture requested yet.
    assert(a.needsVerification(13150));
    assert(!a.verify(a.requestId - 1, 41));
    assert(!a.verify(a.requestId, NAN));
    assert(a.locked());
    assert(!a.needsVerification(18149));
    assert(a.needsVerification(18150));
    assert(a.verify(a.requestId, 41) && !a.locked());

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
    bounds.select(-1, 35, 20000);
    assert(bounds.target == 35);
    assert(bounds.tick(25000) == 0 && bounds.state == State::Idle);

    TemperatureAdjustment multiple;
    multiple.select(-1, 40, 0);
    multiple.select(-1, 40, 10);
    multiple.select(-1, 40, 20);
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
    multiple.select(1, 37, 70000);
    assert(multiple.target == 37);
    multiple.cancel();
    assert(!multiple.locked());

    TemperatureAdjustment bad;
    bad.select(1, NAN, 0);
    bad.select(1, 76, 0);
    bad.select(1, 40.5, 0);
    assert(bad.state == State::Idle);

    TemperatureAdjustment zero;
    zero.select(1, 40, 0);
    zero.select(-1, 40, 100);
    assert(zero.tick(5100) == 0 && zero.state == State::Idle);

    TemperatureAdjustment retry;
    retry.select(1, 40, 0);
    uint32_t now = 5000;
    for (unsigned i = 0; i <= TEMPERATURE_MAX_CORRECTIONS; ++i) {
        assert(retry.tick(now) == 1);
        retry.completedPress(now + 150);
        now += 150 + TEMPERATURE_ADJUST_SETTLE_MS;
        assert(retry.needsVerification(now));
        assert(!retry.verify(retry.requestId, 40));
    }
    assert(retry.state == State::Error && retry.locked());

    TemperatureAdjustment wrap;
    uint32_t start = UINT32_MAX - 1000;
    wrap.select(1, 40, start);
    assert(wrap.tick(start + 4999) == 0);
    assert(wrap.tick(start + 5000) == 1);

    TemperatureAdjustment web;
    assert(!web.applyTarget(76, 43));
    assert(!web.applyTarget(34, 43));
    assert(web.applyTarget(46, 43) && web.locked());
    assert(!web.applyTarget(40, 43)); // A second client cannot change an active batch.
    assert(web.tick(0) == 1); web.completedPress(150);
    assert(web.tick(999) == 0);
    assert(web.tick(1000) == 1); web.completedPress(1150);
    assert(web.tick(2000) == 1); web.completedPress(2150);
    assert(web.locked() && !web.finishWithoutCamera(8149));
    assert(web.finishWithoutCamera(8150) && !web.locked());
    assert(web.applyTarget(43, 46));
    assert(web.tick(9000) == -1);
    web.cancel();
    assert(web.applyTarget(45, 45) && !web.locked());
}
