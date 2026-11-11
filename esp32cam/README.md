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
