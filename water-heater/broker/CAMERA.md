# Camera + OCR + MQTT test

The ESP32-CAM already serves `GET /capture`: **no camera reflash is required**.
Node requests the JPEG, reads the display and publishes a temperature. The main
ESP32 receives it and publishes its state through the existing path.

## Run with the current hotspot

1. Pull the project and run `npm install` in `water-heater/broker/` (Node20+).
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

ServoA is the power/display button. **Wake display + read** publishes a separate
non-retained `heater/command/wake_display=tap`, waits800ms and then captures.
It is allowed only when ESP32 reports online/powerON; verify actual state before
using it. It does not change logical power. Scheduled captures do not issue wake
commands: automatic wake still requires validated dark-display detection. A dark display
must produce unavailable, not a guessed temperature. Until that wake action is
verified, automatic capture alone cannot guarantee continuously readable data.

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
GPIO21 remains servoC, so do not use the usual default SDA21. Confirm actual
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
