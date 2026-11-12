# Camera + OCR + MQTT test

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

- Manual request: `POST /api/camera/capture`.
- Camera: existing `GET /capture` JPEG (one queued frame is discarded first).
- OCR: single numeric reading0..100°C, configured confidence threshold.
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
Current servo pins are A25/B26/C27; keep the explicitly selected SDA23/SCL22. Confirm actual
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

RGB classification stays `unknown` until references and a distance tolerance are
provided from repeated measurements with the sensor in its final position:

- `COLOR_RED_REFERENCE=R,G,B,C` for the heating pilot.
- `COLOR_GREEN_REFERENCE=R,G,B,C` for the heat-preservation pilot.
- `COLOR_MAX_DISTANCE` is the accepted Euclidean distance between normalized
  `(R/C,G/C,B/C)` vectors. Choose it using measured variation; overlapping matches
  stay unknown. Do not copy arbitrary RGB values as calibration.
- Optional `COLOR_DARK_MAX_CLEAR` is the maximum measured C for an unlit pilot.
  The resulting state is `unlit`, not a power or heating diagnosis.

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
power requests are rejected until observed state is known. Fresh calibrated RGB
classified as heating/ready lets the backend publish non-retained
`heater/input/power=true`; dark, uncalibrated or unreadable data never publish false.
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
