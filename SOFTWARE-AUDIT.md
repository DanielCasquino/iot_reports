# Software review before the next physical test

Scope: the normal controller configuration (TEMPORARY_SENSOR_TEST_MODE=0),
ESP32-CAM and the local broker, reviewed against the latest panel behavior
agreements. Baseline:104bf4a on codex/iot-integration-20261114. This is a local
reviewed candidate; it has not been flashed or deployed by this review.

## What changed

- The broker has one authority for observed power/temperature/status. A numeric
  OCR result enters water telemetry only when panel timing and controller state
  accept it. Selected targets and display-mirror retention are separate.
- Session boundaries invalidate pending OCR, old observations and delayed panel
  recovery. Invalid or retained telemetry cannot manufacture a known state.
- MQTT callbacks only copy bounded messages. The main loop owns controller
  mutation and publishes its snapshots. Session revisions are checked on
  dispatch and before effects; queued old-session commands are cancelled.
- Retained actuator requests, embedded NULs, oversized messages, malformed
  numbers and overflowed request IDs are rejected. Local queued messages expire.
- Power movement is an attempted action, not physical confirmation. Wake uses
  plus, waits6s and accepts a new water/pilot observation. RGB is complementary.
  OFF cancels queued temperature work; there is no blind retry of a Power toggle.
- The controller rejects pre-action and during-action observations. Failed OCR
  invalidates its reading without unnecessarily starting a new action epoch.
- The temperature FSM drops an unused selection branch and unreachable legacy
  water-based correction paths. Settling is explicitly a6s wait after target
  confirmation, separate from measured water. Millisecond arithmetic is32bit.
- Camera capture discards the queued previous framebuffer locally. Preview no
  longer changes production resolution/crop configuration. A fresh-frame header
  avoids transferring a second JPEG to the updated broker; legacy fallback stays.
- Tesseract fallback is isolated in a finite native process. A failed model,
  crashed worker or hang becomes a failed reading, without killing the broker.
  The seven-segment path never starts that process. No dependency was added.
- Firmware framework/libraries are pinned to the versions actually compiled.

## Validation and its limits

Run `python3 esp32/test/run_host_tests.py` with a C++17 compiler (`CXX` optional).
It compiles real owner headers with fake peripherals and clocks. Seven programs
cover the controller/MQTT boundary, independent power confirmation, all2116
source/target combinations30–75, display expiry, flow/debounce/clock wrap and
probe/OCR temperature-source modes. The separate sensor-test controller mode
is experimental; testing its temperature reader does not certify that mode's
complete actuator protocol.

In the broker, use `npm ci`, `npm run check`, `npm test` and the optional
`npm run test:ocr` with a local language-model cache. Tests include real index.ts
wiring with in-memory transports, JPEG fixtures, reconnection during OCR, locked
and selecting states, retained/malformed input, stale snapshots and OCR process
failure/timeout/cleanup. They do not connect to the installed heater.

Both firmwares compiled using the pinned installed toolchain. A regression
fixture against104bf4a fails because baseline declares Power confirmed after
PWM; the current header passes the same behavioral assertion.

A new connection revision cannot undo a servo movement already begun. The
synchronous servo tap still takes250+250ms, and MQTT publish may block during a
network failure. Tests cover modeled interleavings and bounded error paths,
not every possible real task schedule. Do not infer that any remaining failure
must therefore be hardware.

## Reduce the scope of the next failure

| Stage | Evidence required | Keep other variables fixed |
| --- | --- | --- |
| Offline replay | Reproduce the exact command/frame sequence against these tests | Revision, config, images and clock |
| Passive device observation | Compare raw RGB/JPEG, uptime and reset reason with backend state | No servo commands; same mounting and network |
| One unloaded actuator action | One press/return, controller uptime and connection trace | One servo, fixed timings and supply |
| Mounted panel transition | The first plus wakes/opens selection; later steps change target; capture belongs to the correct phase | One commandID and fixed camera configuration |
| Full control | Independent confirmation and bounded failures | Previously verified individual boundaries |

There is still no calibrated observation provingOFF rather than standby/blank.
Therefore desiredPower is preserved as intent, but automatic blind Power replay
is deliberately not used. New lighting/focus, pulse calibration, servo contact,
supply and WiFi must be measured; no thresholds or electrical conclusions are
invented by this software review.

## Sources and practical experience

The review combined the real source and current agreements with author docs and
first-hand implementations. A library's thread-safe API does not protect our
controller state, and a local MQTT publish result is not physical confirmation.

- [ESP-IDF MQTT](https://docs.espressif.com/projects/esp-idf/en/release-v5.5/esp32/api-reference/protocols/mqtt.html)
  and [ESP32MQTTClient](https://github.com/cyijun/ESP32MQTTClient): task boundaries,
  publishing semantics and blocking behavior.
- [Espressif camera FAQ](https://documentation.espressif.com/projects/esp-faq/en/latest/application-solution/camera-application.html):
  frame ownership and fresh capture rather than dating an old buffer as new.
- [Home Assistant MQTT switch](https://www.home-assistant.io/integrations/switch.mqtt/)
  and [an implementer's delayed-state discussion](https://community.home-assistant.io/t/general-optimistic-support/730519):
  command/state separation and why toggles/optimistic updates can desynchronize.
- [Tesseract initialization issue1075](https://github.com/naptha/tesseract.js/issues/1075):
  corroborated with the installed source and a real invalid-model reproduction.
- [Broker validation and further practical sources](water-heater/broker/SOFTWARE-VALIDATION.md),
  [controller contract](esp32/README.md) and [camera checks](esp32cam/README.md).

Validation evidence: controller build1e312b08 passed the seven real-header
programs, baseline regression and the current firmware build (RAM50780/327680,
flash1198799/1310720). Camera buildc9a721c8 passed firmware, framebuffer ownership
and actual-page JavaScript checks. Broker check plus69tests passed; four targeted
OCR lifetime tests passed after adding the child self-deadline/IPC cleanup.
A real synthetic48 was recognized with confidence94 and process reap in1018ms
on this laptop. That latency is one fixture, not a camera-to-panel guarantee.

All processing and fixtures remain local; no paid service or new runtime
framework is introduced. Keep images, calibration, identities and credentials
outside public Git. Per-read OCR isolation trades initialization time for
bounded lifetime and release of its WASM/worker resources; measure it separately
from camera/physical latency before changing the panel's timing windows.
