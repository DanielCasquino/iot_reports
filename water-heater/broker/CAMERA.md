# Camera + OCR + MQTT test

## Native SSOCR for the mounted seven-segment display

`CAMERA_READER=ssocr` selects the native [SSOCR reader](https://www.unix-ag.uni-kl.de/~auerswal/ssocr/).
It corrects digit slant and compares iterative thresholding with two fixed
thresholds. At least two complete readings must agree, and a contradictory
complete reading rejects the frame. Dark blink phases do not become numbers.
Images are processed locally; no cloud API or new npm package is used.

On Debian/Raspberry Pi OS, install the native dependency separately:

```sh
sudo apt update
sudo apt install ssocr
ssocr --version
```

Update the existing broker `.env` without replacing its MQTT, camera address,
pilot calibration or desired-state settings. For the current 320x240 mounting:

```ini
CAMERA_READER=ssocr
SSOCR_PATH=/usr/bin/ssocr
CAMERA_CROP=140,0,180,240
CAMERA_ROTATION=90
CAMERA_SSOCR_SHEAR=0.06
```

Crop coordinates apply to the original camera JPEG. Shear is the horizontal
bottom-edge displacement divided by the cropped, rotated image height;0.06
means11 pixels for the current240x180 result. These are mounting calibration
values, not universal settings. `CAMERA_READER` overrides the old
`CAMERA_SEVEN_SEGMENT` flag. Without it the existing reader selection is kept.

After updating this branch, run `npm run check` and `npm run build` inside
`water-heater/broker`, then restart only the backend through its existing
launcher and reload the web page. No camera/controller reflash is needed for
this reader change. `GET /api/camera/status` must report `reader: "ssocr"`;
the processed-image endpoint shows SSOCR's corrected image. A missing binary
produces an actionable error instead of silently selecting another reader.
Each native process has a1.5s deadline and is reaped on failure or shutdown.
Temporary images are private and removed after every read.

The web display keeps its last valid measured number through unavailable
frames and marks it as historical in its tooltip. This cache lasts while the
page is open; it is not fresh telemetry or MQTT-retained control data. Initial
absence still shows dashes. Setpoints, water temperature and blink phases keep
their existing separation in the panel state machine.

Camera capture and optical recognition also work with the controller offline
or MQTT disconnected. `/api/camera/status` describes the latest optical frame;
`/api/heater/status` and WebSocket snapshots expose the same state as `camera`.
The web can show this camera value and enable Read display while the ESP32 is
offline. Its tooltip identifies an optical display reading, which may be a
setpoint rather than water temperature. Water telemetry still comes from the
panel's accepted water observation, and actuator commands still require the
controller. A controller reconnect suppresses delivery of an in-flight old
frame without discarding the independent optical result.

Local validation used one visually checked frame for each value30–75:44
calibration samples and the later49/59 captures,46/46 accepted correctly.
The real three-pass reader took38–82ms per sample on the test laptop. This is
a small corpus from one mounting, not a field accuracy estimate or a latency
measurement on the Raspberry. The observed selection blink train lasted about
4.5s at roughly5fps, consistent with the human observation of about5s.
The backend still reports an unreadable image when evidence is insufficient;
the UI retains the previous value rather than presenting a guessed number.

Rollback: remove `CAMERA_READER` to restore the existing reader flag, restore
the previous mounting configuration if needed, and restart the same backend.
The native dependency can remain installed without being invoked.

Sources: [SSOCR preprocessing and skew guidance](https://www.unix-ag.uni-kl.de/~auerswal/ssocr/),
[OpenCV local versus global thresholds](https://docs.opencv.org/4.13.0/d7/d4d/tutorial_py_thresholding.html),
[Tesseract image quality](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html),
[Debian native package](https://packages.debian.org/trixie/armhf/ssocr).

The ESP32-CAM already serves `GET /capture`: **no camera reflash is required**.
Node requests the JPEG, reads the display and publishes a temperature. The main
ESP32 receives it and publishes its state through the existing path.

Code entry points: `CameraModule.requestCameraJpeg()` only requests a JPEG from
the camera; `readDisplayTemperature()` coordinates capture, OCR and MQTT delivery.
`parseTemperature()` validates OCR text; the `ocrWorker` field holds the OCR
engine. HTTP routes and MQTT topics keep their existing names.

## Run with the current hotspot

1. Pull the project and run `npm install` in `water-heater/broker/` (Node22+).
2. Add these to your existing `.env` (do not overwrite its MQTT configuration):

   ```ini
   CAMERA_URL=http://<IP printed by the camera>
   CAMERA_POLL_MS=0
   CAMERA_MIN_CONFIDENCE=80
   # Crop ONLY the temperature digits in the original VGA image:
   # CAMERA_CROP=200,150,140,80
   # CAMERA_INVERT=true
   # CAMERA_THRESHOLD=128
   ```

3. Flash **only the main ESP32** with the updated `esp32/` project. Wi-Fi and
   broker settings remain in its existing `secrets.h`. This version replaces
   the temperature probe with backend OCR. Keep the old firmware if a probe
   fallback is needed; there is no automatic probe/OCR switch.
4. Start the backend as before (`npm run dev`), open its port3000 page and press
   **Read display**. The display must already be lit. Expand Camera preview;
   `GET /api/camera/processed` shows the exact crop/preprocessing used by OCR.
   Tune the crop to contain just ONE number; avoid labels, other digits and
   reflections. Settings apply when the backend restarts.
5. Compare several captures with the visible digits. Only then set
   `CAMERA_POLL_MS=5000` (or another interval >=1000). Backend schedules the next
   capture after the preceding one finishes; `0` keeps manual requests only.
   Initial OCR startup downloads an English model once; prewarm before losing
   Internet with `npm run test:ocr`, or supply `OCR_LANG_PATH` (see `.env.example`).

ServoA presses the original power button. The team now observes the display
remaining visible (sometimes dimmer), so acquisition never taps power. The old
`wake=1` request is rejected, including from older frontends. The dashboard no
longer exposes a wake control. Keep periodic OCR running when automatic shutdown
uses temperature even if no browser is connected. OCR failure means unavailable;
it does not establish that a display slept or that the heater switched off.

## Data path

### Calibrated optical power observation

`CAMERA_DISPLAY_REGION`, `CAMERA_DISPLAY_DARK_MAX` and
`CAMERA_DISPLAY_LIT_MIN` enable raw light classification before OCR normalization.
Calibrate them on the installed OFF, dim and bright visor with the same crop.
A readable number, or persistent visible segments in a lit region, establishes
ON without assigning an unreadable frame a water temperature. API
`displayState` reports this independent observation and its capture time.

OFF requires at least four valid dark frames spanning6.5s, no capture gap over3s,
an idle controller and no fresh red/green pilot contradicting it. Failed, stale,
ambiguous or pre-command captures reset/interrupt this evidence. Target/wake
verification frames cannot establish OFF. Use continuous mirror capture with
`CAMERA_MIRROR_POLL_MS=250`; occasional manual photos are insufficient.
The confirmation concerns the heater panel's operating state, not mains isolation.
Stable mounting and representative ambient-light calibration remain necessary.

The broker sends fresh non-retained `heater/input/power=true|false`; updated
main firmware applies those observations on its main loop, outside active button
or selection operations. Observed OFF lets the existing web button request ON
again. A servo write alone still does not confirm the result. Updating backend
alone does not add false-power reception to older firmware.

The RGB pilot uses a three-sample median and two matching classifications, with
a wider exit tolerance to avoid oscillation near a boundary. Invalid data or a
long gap resets its history. Low Clear values are not normalized into a colour.
`npm run calibrate:color red|green|unlit` now samples for the full chosen duration;
dark captures produce a Clear ceiling instead of an unreliable RGB reference.
Do not carry an old ambient-light reference into a different mounting/lighting.

Wake confirmation uses a separate exchange: after the controller's existing
6s settle period, `heater/command/verify_wake` requests a **new capture** with a
request ID. The broker replies on `heater/input/wake_verification` as `id,value`,
even while the controller is busy. This only confirms readable digits for the
pending wake; it never enters water telemetry or confirms physical OFF. Both
topics are non-retained. Old-session/retained replies and mismatched IDs cannot
complete the wake. The existing 10s timeout still cancels an unconfirmed action.

This exchange requires updating **both `esp32/` firmware and the backend**.
Restarting the backend alone does not update the controller's wake logic.
Keep the device's existing private Wi-Fi settings and verify that its broker
address matches the Raspberry before uploading. The camera firmware and RGB
calibration are unchanged.

- Manual request: `POST /api/camera/capture`.
- Camera: existing `GET /capture` JPEG (one queued frame is discarded first).
- OCR: single numeric reading0..75°C, configured confidence threshold; cold water below30 remains valid.
- Backend → MQTT: `heater/input/temperature`, numeric text or `unavailable`,
  **not retained**, QoS0, no offline queue. This prevents old queued OCR readings
  from becoming fresh after reconnect. An OCR failure is not encoded as zero.
- Main ESP32: expires the reading after30s and invalidates it on MQTT reconnect.
  Its automatic shutdown only uses an available temperature. This demo logic
  does not replace the heater's physical protections or prove OCR accuracy.
- Existing periodic ESP32 publication: `heater/state/temperature`, numeric text
  or `unavailable`; the app keeps its last seen value separate from availability.
- Camera diagnostics: `GET /api/camera/status` returns OCR text/confidence/error;
  `/api/camera/image` and `/api/camera/processed` return the last images in RAM.

Power now taps **servoA only**; the previous three-servo mapping was a bench test.
ServoB/C initialization and other existing functions remain as before.
No images or credentials are added to Git. No cloud service is required.

## TCS34725

`ColorModule` uses Adafruit TCS34725 and publishes raw red,green,blue,clear as
`heater/state/color` (`R,G,B,C`) or `unavailable`. Values are also printed on
serial and shown in the app. No uncalibrated red/green→heating inference.

Chosen free pins: **SDA23, SCL22**, configurable in `esp32/include/config.h`.
Current mounted servo roles are PowerA25/plusB27/minusC26; keep the explicitly selected SDA23/SCL22. Confirm actual
wiring and module voltage labels; keep I2C signal levels compatible with3.3V.
Absent sensor does not stop the other modules. Current gain1x/integration24ms
is an initial setting; verify lighting and mounting before classifying colors.

Checks: `npm run check`, `npm test`, optional `npm run test:ocr` (synthetic
printed48, not the real display). PlatformIO compiles the main firmware. Physical
OCR, sensor calibration, visor wake action and combined bench behavior still
need verification on the connected hardware.

Sources: [Espressif camera driver](https://github.com/espressif/esp32-camera),
[Tesseract.js](https://github.com/naptha/tesseract.js),
[Sharp](https://sharp.pixelplumbing.com/),
[Adafruit TCS34725](https://github.com/adafruit/Adafruit_TCS34725).

## Pilot/display observations

`GET /api/heater/status` combines fresh controller telemetry (10s), camera OCR
(30s), and an optional calibrated pilot classification. Retained MQTT values do
not establish a fresh observation. The backend requests a live snapshot on
reconnect. Display states are `readable`, `unreadable`, or `unknown`: unreadable
does **not** mean asleep, so it never triggers an automatic power-button tap.
The `power` field is the controller's logical state, not an independently measured
mains state. A dark pilot cannot distinguish OFF from loss of supply.

RGB classification stays `unknown` until at least one reference and a distance
tolerance are provided from repeated measurements with the sensor in its final
position. Only one reference is required: a red match alone reports `heating`
(and recovers `power=on`); a green match reports `ready`. Calibrate both if the
pilot may be green at restart, because red-only cannot confirm a green pilot.

- `COLOR_RED_REFERENCE=R,G,B,C` for the heating pilot.
- `COLOR_GREEN_REFERENCE=R,G,B,C` for the heat-preservation pilot.
- `COLOR_MAX_DISTANCE` is the accepted Euclidean distance between normalized
  `(R/C,G/C,B/C)` vectors. Choose it using measured variation; overlapping matches
  stay unknown. Do not copy arbitrary RGB values as calibration.
- Optional `COLOR_DARK_MAX_CLEAR` is the maximum measured C for an unlit pilot.
  The resulting state is `unlit`, not a power or heating diagnosis.

From `water-heater/broker/`, run `npm run calibrate:color red` with the red pilot
lit (and optionally `green`/`unlit`) to collect live samples and print the values
for `.env`. Restart the backend after editing `.env`; `.env` is not watched. The
backend logs pilot transitions and the `heater/input/power=true` inference, so a
missing reference or an out-of-tolerance sample is visible without guessing.

The TCS retries initialization every five seconds if missing and invalidates its
sample on I2C disconnection. Calibrate/check red, green, unlit and ambient light;
the raw telemetry remains available even without classification.

[Rheem EW1-50RP manual, pp10–11](https://media.rheem.com.pe/blobazrheem/wp-content/uploads/sites/22/2022/01/Manual-de-instrucciones.pdf)
identifies red as heating, green as heat preservation and the displayed value as
water temperature. This source does not establish the display-sleep/wake sequence
reported in the bench discussion: validate that sequence before automating it.
No temperature adjustment command or fake target counter is added.

## Reproducible dependency checks

Use Node22+ and the committed lockfile. `npm ci --ignore-scripts`, `npm run check`,
`npm test`, `npm run security:check` and `npm run test:ocr` verify the clean
installation, types, behavior, known advisories and OCR runtime respectively.
The clean install without lifecycle scripts was checked on Linux/Node22; check
the same commands on the Windows demo machine. No additional npm packages were
needed for the mobile manifest/fullscreen controls. The existing `allowScripts`
policy is retained for npm versions supporting it; do not approve every script
just to hide an installation warning. An audit with zero advisories is not an
assessment of the entire deployment's security.

The WebSocket listener limits messages to4KiB and rejects malformed or nonboolean
commands instead of throwing or interpreting text as an actuator instruction.
Commands are not queued when the broker/controller is unavailable.

Water telemetry uses `heater/state/flowrate` (L/min) and `heater/state/volume`
(litres accumulated since controller restart). The app labels restart scope; it
is not a persistent consumption meter or an electrical-energy measurement.
The current firmware conversion is450pulses/litre and still needs a volume test.
The selected flow pin is GPIO34. [Espressif GPIO documentation](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/peripherals/gpio.html)
specifies no internal pull-up on GPIO34–39; `INPUT_PULLUP` alone cannot provide
it there. Confirm the existing signal conditioning/external pull-up and input
voltage before attributing missing pulses to software. The pin assignment and
flow formula are preserved.

## Restart state synchronization (pending physical calibration)

Controller starts with `heater/state/power=unknown`, not a measured OFF. Absolute
power requests are rejected until observed state is known. While power is unknown,
fresh calibrated RGB classified as heating/ready lets the backend publish non-retained
`heater/input/power=true`; dark, uncalibrated or unreadable data never publish false.
A red reference alone is sufficient for this inference. The backend clears its
cached power whenever the controller reports its status, so a stale `true` from
before a controller restart cannot suppress the inference. It does not infer ON
while power is known to be false, so it cannot race a commanded OFF.
An explicit local A press can operate the mechanical button while state is
unknown, but does not claim its physical result. A commanded change updates the
controller's logical state; it is not a separate physical confirmation. The
OFF observation rule and final UI behavior for unknown still require agreement
and physical evidence. Frontend changes remain subject to José's approval.

## Read-only bench record

From broker/: `node scripts/record-observation.mjs http://localhost:3000 48`
prints a CSV header and one row. Replace48 with a simultaneous human reading
(or omit it). Redirect stdout to a private file outside Git. The script reads
status only; it does not capture images, press buttons, publish MQTT, or modify
the heater. It records failed/unavailable readings rather than inventing zeros.
The human reference is not automatically trusted or a calibration result. Record
lighting, pilot color and actions alongside each sample; do not call software
confidence a measured accuracy. Volume is since controller restart, not lifetime.

### Visor de siete segmentos

`CAMERA_SEVEN_SEGMENT=true` activa el lector geométrico para un visor de dos dígitos enteros claros sobre fondo oscuro. `CAMERA_CROP` es obligatorio y debe contener únicamente los dos dígitos completos, con margen, en coordenadas de la imagen original de la cámara. No reutilizar coordenadas de una foto de celular o de otro encuadre. Reiniciar el backend tras cambiar `.env`.

El lector busca los siete segmentos de cada dígito y compara tres umbrales relativos de brillo. Acepta cuando al menos dos lecturas completas coinciden y ninguna otra lectura completa discrepa; los casos incompletos se rechazan. No convierte números según la temperatura anterior. En este modo CAMERA_INVERT, CAMERA_THRESHOLD y CAMERA_MIN_CONFIDENCE no se aplican: no usa Tesseract y no inventa una confianza estadística. El endpoint de estado informa `reader: "seven-segment"` y `confidence: null`. Sin esta opción, Tesseract conserva su funcionamiento anterior.

Validación local:15 fotos del visor compartidas por el equipo, dos grupos de encuadre con un recorte fijo por grupo; lecturas40,30,34,37,44,42,75,32,38,30,33,42,72,75,40. Las primeras14 se usaron para ajustar; la última se evaluó después sin cambiar parámetros. Se probaron también dígitos generados y fondos vacíos. El conjunto no demuestra desempeño general ni sustituye una prueba de campo. Falta validar la cámara instalada, distintos niveles de luz, reflejos y lectura en vivo contra una persona. Una región recortada incorrectamente puede producir una lectura incorrecta; no habilitar autoapagado durante pruebas.

Inspección: `/api/camera/image` muestra la última captura; `/api/camera/processed` muestra la máscara usada; `/api/camera/status` contiene valor, método y error. El campo `available` sólo indica aceptación por el lector y vigencia, no certifica que coincida con el estado físico ni que la temperatura mostrada sea medida en vez de consigna. No requiere reflashear la ESP32-CAM.

## Montaje vertical y calibración actual

Para las capturas verticales del montaje12Nov: `CAMERA_ROTATION=90` y
`CAMERA_SEVEN_SEGMENT=true`. Crop es opcional si sólo aparecen los dos dígitos.
Si se usa, `CAMERA_CROP=left,top,width,height` está en píxeles del JPEG original,
antes de girarlo. Cambiar resolución exige volver a comprobar coordenadas.
El lector geométrico no usa una confianza estadística inventada: confidence=null.
SSOCR se conserva como alternativa probada localmente; no es dependencia nueva
ni integración automática enWindows. Tesseract continúa disponible.

Referencias derivadas de fotos del sensor montado154ms/4x:

```
TEMPORARY_SENSOR_TEST_MODE=false
COLOR_RED_REFERENCE=301,25,34,331
COLOR_GREEN_REFERENCE=17,22,8,46
COLOR_MAX_DISTANCE=0.07
COLOR_DARK_MAX_CLEAR=7
```

Estas cifras deben comprobarse con lecturas nuevas; reflejan muestras de la
misma sesión, no validación independiente. El canalC es Clear, luz amplia.
La muestra oscura se tomó con la terma apagada, pero no demuestra que no pueda
haber piloto oscuro en otro estado. Conservar unknown cuando no haya evidencia.

## Mounted button direction and failed verification

The current mount places plus on GPIO27 (press16/rest0) and minus on GPIO26
(press18/rest0). Logical B/C follow those roles; each physical servo retains its
calibrated angles. Verify the first requested increase/decrease against the
actual blinking target after remounting. A matching controller verification error
ends that attempt. Up to3attempts are allowed within the90s overall deadline,
only after idle control and fresh readable telemetry return. Every new attempt
reacquires the actual blinking setpoint; a partial movement never becomes a
repeated stale plan. Exhaustion persists failure and asks for a manual mounting/
contact check before an explicit new request. Desired target remains saved.

Target verification waits1s after servo return and requires two new agreeing
readings, separated by at least250ms, within the original selection deadline.
This prevents the first residual water frame from becoming the starting setpoint.
Target requests permit at most6captures perID/window; wake retains its3capture
budget. A conflicting first result restarts the agreement, not the actuator plan.

An active target request also needs a new blank selection phase after that
request began. Ordinary fresh water readings cannot acknowledge a target until
that phase is observed; new IDs/reconnects clear the proof. Capture errors do
not count as a blank phase. This prevents failed opening taps from being followed
by a plan calculated from water temperature.

### GREEN to standby

The explicit panel state follows observed GREEN to a persistent dim visor
with power stillON. A calibrated dim visor plus an unlit pilot also recovers
standby after startup without fabricating an earlier GREEN observation. Heating
clears that transition. Confirmed standby triggers no periodic recovery taps and
does not refresh cached water temperature. A pending user command retains its
own wake/settle/target-reading sequence. No3minute timer infersOFF.

Current bench sequence16Nov: target56 verified on the third bounded attempt,
water60, GREEN. About3minutes after final target confirmation, raw visor
brightness fell244→145, pilot becameunlit and the visor still read59 with
powerON. This is one measured sequence under current mounting/light; raw images
remain private and the interval is not a guaranteed device specification.

### Power operation recovery

Web power requests are verified operations with at most3absolute requests/90s.
A retry needs idle online control and3s of newly advancing optical evidence
that agrees with the controller and still proves the opposite state, after a
15s minimum operation window. Unknown/busy/stale observations never trigger
a Power retry. Disconnect fails the active operation without replay; a new
explicit request is needed. The web shows progress and a mounting/contact/camera
check when confirmation fails, and rejects overlapping actuator requests.

An ESP32 unknown-power acknowledgement also starts a1s post-motion capture
barrier and clears old RGB history. Frames begun before that barrier cannot
restore power or enter water telemetry, even when they arrive after the servo
returned. Optical camera preview remains available independently.

## Control diagnostics

Lines with `"source":"heater-control"` carry an ISO timestamp and correlated command/request IDs. `temperature_requested`/`temperature_retry` show intent and `shortest_wrap` policy; MCU `servo_sequence_sent` reports actual GPIO PWM sequence, reason, before/after **estimates**, calibrated angles and MCU start/end uptime. `mechanicalConfirmed:false` is deliberate: a command or PWM sequence never proves button contact. Reasons `wake_or_open` and `open_target` distinguish the two opening + taps separated by6s from `adjust_target_shortest_wrap`, `wake_before_power`, `power_toggle`, or manual controls. From56 to30 the current shortest route is20plus presses through75→30 instead of26minus presses; it does not mean the target was changed upward.

`camera_verification_started` states the required evidence; `camera_target_frame` shows value, visibility/light, blank proof and `blocked_missing_selection_blink` or `eligible_for_verification`. `camera_candidate_sent` means a fresh candidate went to the controller, still pending its two-image/final-target checks. `temperature_controller_state` reports phase/estimate; its `result:accepted` admits a request only. `temperature_operation`/`power_operation` carries final confirmed/failed status and `manualCheckRequired`. Missing contact cannot always be distinguished from camera visibility; the terminal message asks for inspection rather than naming a proven faulty servo. Telemetry is non-retained and never feeds control observations.

On the Raspberry, from `water-heater/broker`, inspect with `tail -f dev.log | grep '"source":"heater-control"'`. Firmware diagnostics require the matching mainESP32 firmware; old firmware continues without that additional topic. Calibration angles,250ms press/return and bounded recovery are unchanged.

During an active target request, fresh continuous/mirror captures may also deliver candidates **after that request’s blank proof**. This avoids synchronization with the display blink when explicit verification captures repeatedly see blanks. Captures that began before the request, new IDs/reconnects without new proof, and expired windows cannot supply mirror candidates. The MCU still requires two agreeing readings and its original selection deadline; no control timing or recovery budget changes. Candidate logs include `origin:mirror` or `origin:verification`.

Target candidates outside30–75 are logged as `camera_candidate_rejected / outside_target_range` and are not delivered as target observations; wake readings retain their separate valid range.

## Last coherent OLED reading and water presentation

The OLED receives `heater/input/display`. The broker now sends its last coherent0–75number through selection blanks, unreadable captures and capture failures; the next valid number replaces it. This is presentation retention only: blank proof is still derived from raw camera frames, while failed current-water reads continue to publish `unavailable`. An OCR98 is rejected before it reaches mirror, water or verification control; it cannot replace the last valid number. No OLED firmware update is required. The in-memory mirror starts unknown until its first valid capture after broker startup. If the broker/MQTT stops entirely, the existing OLED30s expiry still applies.

`display_mirror_sent` logs actual published `text`, `rawText`, `held`, original coherent `observedAt`, current `capturedAt`, rejected numeric value, and water eligibility. `show_new_reading` versus `show_last_coherent` distinguishes live camera values from held presentation. This records what is sent to the OLED, not optical proof of its physical pixels. Stable repeated payloads are still sent but only changes generate log lines.

When the ESP32 is online, the web temperature/heat effect uses accepted current water, or its last valid water reading while selection/control is active. Raw camera digits can be target settings and cannot overwrite that water display. Camera-only display with the ESP32 offline remains available. The interpolation formula is unchanged.

Current auto-off policy: when enabled, a fresh water reading at or above the last user target admitted by the controller triggers the existing Power path. Unknown targets, stale data and active temperature control do not trigger it. The fixed40C threshold is removed. The selected target is kept separate from intermediate servo estimates and manual base calibration; held OLED readings never enter this decision. Target changes require a new admitted temperature request. The mainESP32 firmware must also be updated to activate this policy. `auto_shutdown_requested` and `auto_shutdown_state` distinguish a UI request from the MCU flag; `/api/heater/status.autoShutdown` reports the flag ornull offline, and `autoShutdownTarget` reports the admitted target ornull when unknown/old firmware. Automatic Power tap diagnostics use `auto_shutdown_at_target`. No automatic-off actuation test is performed just by inspecting these diagnostics.


### Borde del recorte SSOCR

`CAMERA_OCR_GUARD_CROP` es opcional. Usa las mismas coordenadas del JPEG
original que `CAMERA_CROP`, con el mismo `top` y alto, y debe contener el
recorte principal horizontalmente. Ejemplo para el montaje actual:
`CAMERA_CROP=140,0,180,240` y `CAMERA_OCR_GUARD_CROP=90,0,230,240`.
Con SSOCR se revisan franjas de cuatro píxeles junto a cada borde ampliable.
Si tres filas consecutivas cruzan el borde con brillo suficiente, se usa el
recorte amplio para esa imagen; en otro caso se mantiene el principal. Es una
heurística de recorte, no una verificación de dígitos ni de Power. Con la
opción ausente se mantiene exactamente el recorte anterior.
