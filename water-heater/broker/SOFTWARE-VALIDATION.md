# Software checks before a physical bench test

The backend's existing MQTT, HTTP and WebSocket topics/routes are preserved.
No dependency, service, firmware upload or hardware action is needed for the
checks below. Work from the committed lockfile with Node22+.

## Isolate failures by boundary

| Boundary | Reproduce without hardware | Success means | Still needs the bench |
| --- | --- | --- | --- |
| Payload → state | Malformed, retained, unavailable and expired MQTT sequences | Unknown data cannot become known OFF; reconnect clears observed state | Whether a physical sensor provides the expected observation |
| JPEG → number | Fixed images, blank/blinking/ambiguous crops, rotation fixtures | Reader rejects ambiguity; same input is reproducible | Focus, lighting, mounting and unseen images |
| Number → water/target | Busy/settling controller, verification and mirror-only captures | A readable setpoint never enters water temperature telemetry | Actual panel timing and first-button behavior |
| Async capture → MQTT | Disconnect/reconnect during mocked OCR | A previous session's result is discarded, not published into the new session | Radio/power/network stability |
| Request → actuator command | Application wiring with in-memory transports | One explicit power request produces one command; unknown acknowledgement prevents blind replay | Physical button travel and independent ON/OFF confirmation |
| Recovery → next observation | Fake-time panel recovery and reconnects | Delayed work is cancelled and retries remain bounded | Whether one plus press actually wakes the mounted panel |

`npm run check` checks production TypeScript. `npm test` exercises these
boundaries, including the real application wiring with in-memory transports
in `test/broker-sequence.test.ts`; it does not start servers or connect to MQTT.
`npm run test:ocr` is an optional Tesseract runtime/model smoke, not an accuracy
measurement of the installed camera. Keep real image corpora outside Git.

## Defects addressed in this review

- A normal capture previously published every readable number as water even
  when the panel/controller rejected that frame during adjustment/recovery.
  The panel now explicitly authorizes delivery; the mirror remains separate.
- A recent pre-reconnect camera reading could survive observation reset. Its
  observation timestamp must now belong to the current controller session.
- OCR begun before MQTT/controller reconnection could finish afterward and
  publish into the new session. A session generation invalidates that work.
- Panel recovery and cached temperature-control metadata survived disconnect.
  Disconnect now invalidates observations and delayed recovery without
  replenishing the recovery attempt budget.
- Malformed autoshutdown telemetry was interpreted as false. It is now unknown.
- State and liveness subscriptions were separate. A single subscription batch
  is established before requesting the controller's live snapshot.
- Tesseract treated even empty OCR as a visible display. A failed reading now
  needs calibrated lit evidence before it can authorize an automatic wake probe.
- Legacy mirror captures used a single potentially queued JPEG. All legacy
  reads now flush one frame; cameras advertising `X-Capture-Fresh: 1` already
  flush internally and need only one request. This handshake keeps the backend
  compatible with the installed camera while reducing new-firmware traffic.

The duplicate broker-disconnect branches are consolidated, and duplicate cached
power/temperature/status fields are removed in favor of `HeaterObservation`.
Existing OCR engines are retained, but Tesseract is loaded only when that
fallback is actually used; the seven-segment path does not create an OCR process.
The installed Tesseract6 can throw outside its initialization promise or leave
it pending when a language model is unavailable. Each fallback recognition now
runs in one finite native Node child process: at most1MiB input and128characters
of result, with a15s deadline, explicit close/reaping, and exit on parent IPC
loss. The child owns all Tesseract threads/WASM; initialization failures no
longer kill the broker or strand it awaiting that promise. The worker model is
released when each process ends. This trades repeated initialization CPU/time
for a simple failure boundary and reclaimable resources; it is not claimed to
make recognition faster. Model path/cache/parameters remain unchanged.
One local synthetic48 reading with an existing language-model cache took1018ms
end-to-end through `CameraModule` with confidence94, including process startup,
recognition and reaping. This is one software smoke measurement, not a latency
distribution or accuracy result for the mounted display. Missing-model, hung,
early-exit, oversized-input/output and active-close cases are tested separately.
Deleting a fallback
without representative images would narrow
functionality rather than prove an optimization. No package was added.

## Scope of the conclusion

Desired power and temperature are user intent, separate from observed state.
Persisting `desired.power=false` does not prove the heater switched off.
The backend does not automatically replay power commands on reconnect; a state
of unknown remains unknown until a new observation. A reliable automatic OFF
confirmation still needs a measured optical/electrical criterion. Numeric OCR
alone does not distinguish a water reading from a setpoint without timing/state
context. Green/red pilot classification complements these observations.

Passing these checks narrows failures to specified physical boundaries. It
cannot prove that every later failure is hardware, nor rule out timing,
integration or environmental faults absent from the fixtures. Record the exact
software revision before the eventual bench test and vary one physical boundary
at a time, starting with passive observations before actuation.

## Code inventory and simplification boundary

| Code | Responsibility | Review decision |
| --- | --- | --- |
| `index.ts` | Wire MQTT/HTTP/WS, persistent intent and recovery | Remove duplicate observed power/temperature/status cache and duplicate disconnect handler; retain wire contracts |
| `heater/state.ts` | Telemetry freshness and calibrated pilot interpretation | Keep one observed-state authority; reject old-session camera observations |
| `heater/panel-state.ts` | Water/target/blank context and bounded wake recovery | Cancel work on disconnect; OFF/standby still require physical classification evidence |
| `heater/desired-state.ts` | Validate and atomically persist user intent | Keep separate from observations; storage success does not confirm actuation |
| `heater/temperature-reconciliation.ts` | Persist attempt budget/deadline, match command IDs and target | Keep bounded; no extra power replay loop is introduced |
| `heater/temperature-control.ts` | Parse coherent firmware lock/base/results | Keep protocol validation before use |
| `heater/pilot-command.ts` | Gate non-retained pilot feedback | Keep pilot complementary to display/state |
| `camera/module.ts` | Serialize capture/recognition and route mirror/water/verification | Add session fence and water authorization; avoid an extra JPEG request after freshness handshake |
| `camera/ocr.ts`, `ocr-child.ts` | Contain Tesseract initialization/recognition failures | One bounded child per fallback read; no OCR child in seven-segment mode |
| `camera/seven-segment.ts`, `temperature.ts`, `display-light.ts` | Optical recognition and calibrated light | Retain deterministic rejection; unseen lighting remains unproven |
| `mqtt/client.ts`, `websocket/*` | Transport setup, bounded messages and command parsing | Keep no offline QoS0 queue; subscribe liveness before snapshot |

This review introduces no service, framework, cloud dependency or alternate
control architecture. A future replacement of the two OCR paths, or unification
of panel and controller observations, needs a representative corpus and explicit
state-transition requirements first. Removing those paths by line count alone
would risk discarding supported behavior. Additional rendering diagnostics,
frontend redesign and academic report changes are outside this software slice.

## Sources consulted, 14–15 November 2026

- **Official library documentation:** [MQTT.js README](https://github.com/mqttjs/MQTT.js/blob/main/README.md).
  `queueQoSZero` defaults to true; this project deliberately keeps it false for
  time-sensitive commands/readings. A local publish callback is not physical
  acknowledgement. Read the installed version/lockfile when changing behavior.
- **First-hand maintainer discussion:** [MQTT.js issue1706](https://github.com/mqttjs/MQTT.js/issues/1706).
  A real application reported stale QoS0 delivery after reconnect; the maintainer
  points to the queue option. This motivates an additional application session
  boundary rather than treating QoS0 alone as a freshness guarantee.
- **First-hand bug report, confirmed against installed source and reproduced:**
  [Tesseract.js issue1075](https://github.com/naptha/tesseract.js/issues/1075).
  Initialization failure may throw asynchronously or leave `createWorker`
  pending even with an error handler. The finite process contains that library
  behavior without patching dependencies or adopting its unverified proposed fix.
- **Comparable working project:** [AI-on-the-edge MQTT API](https://github.com/jomjol/AI-on-the-edge-device-docs/blob/main/docs/MQTT-API.md).
  It publishes connection/uptime, recognition results and errors separately.
  This supports separating transport health, recognition validity and value;
  it does not validate this project's camera or heater.
- **First-hand field experience, anecdotal:** [AI-on-the-edge reflection/ROI discussion](https://www.reddit.com/r/homeassistant/comments/1jgagg8/aiontheedge_help_needed/).
  Users report glare, focus and digit-region alignment issues, including their
  own diffuser/angle adjustments. These are hypotheses for controlled physical
  tests after the software corpus passes, not universal fixes or API guarantees.

All processing remains local in this design. Tests need no paid cloud service;
do not publish images, calibration data, network identities or credentials as
test artifacts. Tesseract's initial language-model download is an existing
runtime integration cost, distinct from the offline behavior tests.
