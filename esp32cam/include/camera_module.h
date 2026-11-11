#pragma once
#include <Arduino.h>
#include <WebServer.h>
#include "esp_camera.h"

// AI-Thinker ESP32-CAM pinout.
class CameraModule
{
public:
    bool setup()
    {
        camera_config_t config = {};
        config.ledc_channel = LEDC_CHANNEL_0;
        config.ledc_timer = LEDC_TIMER_0;
        config.pin_d0 = 5;
        config.pin_d1 = 18;
        config.pin_d2 = 19;
        config.pin_d3 = 21;
        config.pin_d4 = 36;
        config.pin_d5 = 39;
        config.pin_d6 = 34;
        config.pin_d7 = 35;
        config.pin_xclk = 0;
        config.pin_pclk = 22;
        config.pin_vsync = 25;
        config.pin_href = 23;
        config.pin_sccb_sda = 26;
        config.pin_sccb_scl = 27;
        config.pin_pwdn = 32;
        config.pin_reset = -1;
        config.xclk_freq_hz = 20000000;
        config.pixel_format = PIXFORMAT_JPEG;
        config.frame_size = FRAMESIZE_VGA;
        config.jpeg_quality = 12;
        config.fb_count = 1;
        config.fb_location = CAMERA_FB_IN_DRAM;

        esp_err_t result = esp_camera_init(&config);
        if (result != ESP_OK)
        {
            Serial.printf("Camera init failed: 0x%x\n", result);
            return false;
        }
        server.on("/", HTTP_GET, [this]() {
            server.send(200, "text/html", "<!doctype html><meta name='viewport' content='width=device-width'><title>Camera test</title><h1>ESP32-CAM</h1><img id='frame' style='max-width:100%' src='/capture'><p><button onclick=\"document.getElementById('frame').src='/capture?t='+Date.now()\">Capture</button></p>");
        });
        server.on("/capture", HTTP_GET, [this]() { capture(); });
        server.begin();
        Serial.println("Camera module initialized");
        return true;
    }

    void loop() { server.handleClient(); }

private:
    void capture()
    {
        camera_fb_t *frame = esp_camera_fb_get();
        if (!frame)
        {
            server.send(503, "text/plain", "Capture failed");
            return;
        }
        server.sendHeader("Cache-Control", "no-store");
        server.setContentLength(frame->len);
        server.send(200, "image/jpeg", "");
        auto client = server.client();
        size_t sent = 0;
        unsigned long started = millis();
        while (sent < frame->len && client.connected() && millis() - started < 5000)
        {
            size_t chunk = frame->len - sent;
            if (chunk > 1024) chunk = 1024;
            size_t written = client.write(frame->buf + sent, chunk);
            sent += written;
            if (written == 0) delay(1);
        }
        if (sent != frame->len) client.stop();
        esp_camera_fb_return(frame);
    }

    WebServer server{80};
};
