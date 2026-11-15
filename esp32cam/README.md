# ESP32-CAM capture test

Separate PlatformIO project; the existing `esp32/` firmware stays on the main
ESP32. No data wires between the two boards: use the same reachable Wi-Fi.

Configuration: **AI-Thinker ESP32-CAM / OV2640**.
Pin mapping follows Espressif's CameraWebServer AI-Thinker example:
https://github.com/espressif/arduino-esp32/blob/master/libraries/ESP32/examples/Camera/CameraWebServer/camera_pins.h

1. Open `esp32cam/` as a PlatformIO project.
2. Copy `include/secrets.example.h` to `include/secrets.h`; set the same network
   reachable from the phone/laptop. The file is ignored by Git.
3. Confirm the carrier and use its matching USB programmer/upload procedure.
   For a bare AI-Thinker board, GPIO0 is held to GND only to enter programming;
   remove that link and reset to run (GPIO0 then carries the camera clock).
4. Power the camera board through its specified 5V input with suitable regulated
   power. Do not power it from a GPIO or the main ESP32's 3V3 output. Programming
   UART signals must use 3.3V logic. Keep existing sensor/servo wiring unchanged.
5. Open serial monitor at115200. After Wi-Fi connects, open the printed
   `http://<camera-IP>/` from a device on that network. Press Capture to take
   another JPEG. `/capture` returns the image directly.
6. Leave the heater app open in another tab and operate the already working
   setup while capturing. Verify both boards stay connected and images refresh.

First test is image acquisition only: no OCR, temperature inference, MQTT image
payloads, public exposure, or changes to the existing heater control. If init
fails, retain the hexadecimal error and confirm carrier/pinout and camera ribbon.
No reset/brownout protections are disabled. Physical capture still requires a
hardware test; building alone does not validate the board or its power supply.

## Capture settings and diagnostics

Startup uses QVGA (320×240), JPEG quality20, one frame buffer, and the white
GPIO4 LED off. PSRAM is used when detected.

- `/config?resolution=qvga&quality=20`: set capture resolution and JPEG compression.
- `/config?resolution=qqvga`:160×120; `/config?resolution=vga`:640×480 (requires PSRAM).
- `/status`: current driver frame-size enum, JPEG quality, Wi-Fi RSSI in dBm,
  free heap bytes and free PSRAM bytes.

Quality accepts integers10–40; higher numbers mean more compression. These
settings are volatile and reset on restart. Changing resolution changes crop
coordinates in the backend; recalibrate them from the new original capture.
The serial monitor prints capture time, send time, sent/expected bytes and RSSI
for each request. Timings diagnose firmware stages; they are not equivalent to
client-side network measurements. These local routes have no authentication;
keep the camera on the trusted local demo network.

## Live framing preview

Open `/` and select **Encuadrar**. It opens MJPEG at
`http://<camera-IP>:81/stream`, capped at about5fps, using the current resolution
and quality. Preview does not silently change the capture settings or OCR crop.
Only one streaming viewer is supported. **Detener** disconnects the preview;
**Foto** requests a single image at the current resolution. Settings are shared
by streaming and snapshots. To deliberately change them, use `/config`; restore
the calibrated settings before OCR. Stop preview while measuring to avoid camera
mutex contention and additional Wi-Fi traffic.
Use preview for positioning, not to judge final OCR detail. Port81 must be
reachable locally. Streaming, capture and configuration serialize camera access.

## Snapshot freshness and software checks

The camera driver may already hold a frame captured before an HTTP request.
`/capture` returns that queued frame to the driver, obtains the next frame while
holding the camera mutex, and sends `X-Capture-Fresh: 1` with the JPEG. The header
means that this firmware discarded its prior buffer; it does not certify network
latency or OCR accuracy. Acquisition failures remain HTTP503 without that header.
See [Espressif's camera FAQ](https://documentation.espressif.com/projects/esp-faq/en/latest/application-solution/camera-application.html).

The backend can use one JPEG request when that header is present. With older
camera firmware it must still discard the first HTTP image before using a second,
including OLED mirror polling. Updating the backend therefore does not require
assuming the camera firmware has already been flashed.

Tests use the production helper and the JavaScript extracted from the actual
camera page; they do not access a device:

```sh
g++ -std=c++11 -Wall -Wextra -Werror -I esp32cam/test/fakes -I esp32cam/include \
  esp32cam/test/fresh_frame_test.cpp -o /tmp/camera_fresh_frame_test
/tmp/camera_fresh_frame_test
node --test esp32cam/test/preview.test.mjs
```

They cover buffer discard/ownership and both acquisition failures, plus preview,
stop and capture preserving settings. A firmware build checks the real SDK API;
neither check measures frame age, image quality or Wi-Fi performance on hardware.
