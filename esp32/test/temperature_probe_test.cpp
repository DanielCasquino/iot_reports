#include <cassert>
#include "temperature_module.h"
unsigned long testNow = 0;
TestSerial Serial;
float probeValue = 28.5;
unsigned conversions = 0, probeReads = 0;
bool waitForConversion = true;
int main() {
#if TEMPORARY_SENSOR_TEST_MODE
    TemperatureModule probe;
    probe.setup();
    assert(!waitForConversion && conversions == 1);
    assert(!probe.isAvailable());
    testNow = 749;
    probe.poll();
    assert(probeReads == 0); // No premature read, no delay in polling.
    testNow = 750;
    probe.poll();
    assert(probe.read() == 28.5 && probeReads == 1);
    testNow = 2000;
    probe.poll();
    assert(conversions == 2 && probeReads == 1);
    probeValue = DEVICE_DISCONNECTED_C;
    testNow = 2750;
    probe.poll();
    assert(!probe.isAvailable() && isnan(probe.read()));
    testNow = 4000;
    probe.poll();
    probeValue = 32.25;
    testNow = 4750;
    probe.poll();
    assert(probe.read() == 32.25);
    testNow += TEMPERATURE_MAX_AGE_MS + 1;
    assert(!probe.isAvailable());
#else
    TemperatureModule ocr;
    ocr.setup();
    assert(!ocr.isAvailable());
    ocr.update(48);
    ocr.poll();
    assert(ocr.read() == 48 && conversions == 0);
    ocr.invalidate();
    assert(!ocr.isAvailable());
#endif
}
