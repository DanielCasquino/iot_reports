#pragma once
#include <Arduino.h>
#include <WebServer.h>
#include "esp_camera.h"
#include "esp_http_server.h"

// AI-Thinker ESP32-CAM pinout.
class CameraModule
{
public:
    bool setup()
    {
        digitalWrite(4, LOW);
        pinMode(4, OUTPUT);
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
        config.frame_size = psramFound() ? FRAMESIZE_VGA : FRAMESIZE_QVGA;
        config.jpeg_quality = 20;
        config.fb_count = 1;
        config.fb_location = psramFound() ? CAMERA_FB_IN_PSRAM : CAMERA_FB_IN_DRAM;

        esp_err_t result = esp_camera_init(&config);
        if (result != ESP_OK)
        {
            Serial.printf("Camera init failed: 0x%x\n", result);
            return false;
        }
        esp_camera_sensor_get()->set_framesize(esp_camera_sensor_get(), FRAMESIZE_QVGA);
        cameraMutex = xSemaphoreCreateMutex();
        if (!cameraMutex) return false;
        pinMode(4, OUTPUT);
        digitalWrite(4, LOW);
        server.on("/config", HTTP_GET, [this]() { configure(); });
        server.on("/status", HTTP_GET, [this]() { status(); });
        server.on("/", HTTP_GET, [this]() {
            server.send(200, "text/html", R"HTML(<!doctype html><meta name="viewport" content="width=device-width"><title>Camera test</title><style>body{font-family:system-ui;background:#151515;color:white;margin:16px}img{display:block;max-width:100%;image-rendering:auto}button{padding:10px;margin:8px 8px 8px 0}</style><h1>ESP32-CAM</h1><img id="frame"><button onclick="preview()">Encuadrar</button><button onclick="stop()">Detener</button><button onclick="capture()">Foto</button><script>const frame=document.getElementById('frame');function stop(){frame.removeAttribute('src')}async function preview(){stop();const response=await fetch('/config?resolution=qqvga&quality=25');if(response.ok)frame.src='http://'+location.hostname+':81/stream'}function capture(){stop();frame.src='/capture?t='+Date.now()}</script>)HTML");
        });
        server.on("/capture", HTTP_GET, [this]() { capture(); });
        server.begin();
        httpd_config_t streamConfig = HTTPD_DEFAULT_CONFIG();
        streamConfig.server_port = 81;
        streamConfig.ctrl_port = 32769;
        streamConfig.max_open_sockets = 1;
        streamConfig.send_wait_timeout = 3;
        if (httpd_start(&streamServer, &streamConfig) == ESP_OK)
        {
            httpd_uri_t streamRoute = {};
            streamRoute.uri = "/stream";
            streamRoute.method = HTTP_GET;
            streamRoute.handler = stream;
            streamRoute.user_ctx = this;
            httpd_register_uri_handler(streamServer, &streamRoute);
        }
        else Serial.println("Preview server failed to start");
        Serial.println("Camera module initialized");
        return true;
    }

    void loop() { server.handleClient(); }

private:
    static esp_err_t stream(httpd_req_t *request)
    {
        httpd_resp_set_type(request, "multipart/x-mixed-replace;boundary=frame");
        httpd_resp_set_hdr(request, "Cache-Control", "no-store");
        auto *camera = static_cast<CameraModule *>(request->user_ctx);
        while (true)
        {
            if (xSemaphoreTake(camera->cameraMutex, pdMS_TO_TICKS(1000)) != pdTRUE) return ESP_FAIL;
            digitalWrite(4, LOW);
            unsigned long started = millis();
            camera_fb_t *frame = esp_camera_fb_get();
            if (!frame) { xSemaphoreGive(camera->cameraMutex); return ESP_FAIL; }
            char header[96];
            int length = snprintf(header, sizeof(header),
                "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n", unsigned(frame->len));
            esp_err_t result = httpd_resp_send_chunk(request, header, length);
            if (result == ESP_OK)
                result = httpd_resp_send_chunk(request, reinterpret_cast<const char *>(frame->buf), frame->len);
            if (result == ESP_OK) result = httpd_resp_send_chunk(request, "\r\n", 2);
            esp_camera_fb_return(frame);
            xSemaphoreGive(camera->cameraMutex);
            if (result != ESP_OK) return result;
            unsigned long elapsed = millis() - started;
            delay(elapsed < 200 ? 200 - elapsed : 1);
        }
    }

    void status()
    {
        sensor_t *sensor = esp_camera_sensor_get();
        String body = "{\"framesize\":" + String(sensor->status.framesize)
            + ",\"quality\":" + String(sensor->status.quality)
            + ",\"rssi\":" + String(WiFi.RSSI())
            + ",\"freeHeap\":" + String(ESP.getFreeHeap())
            + ",\"freePsram\":" + String(ESP.getFreePsram()) + "}";
        server.sendHeader("Cache-Control", "no-store");
        server.send(200, "application/json", body);
    }

    void configure()
    {
        sensor_t *sensor = esp_camera_sensor_get();
        framesize_t resolution = sensor->status.framesize;
        int quality = sensor->status.quality;
        if (server.hasArg("resolution"))
        {
            String value = server.arg("resolution");
            if (value == "qqvga") resolution = FRAMESIZE_QQVGA;
            else if (value == "qvga") resolution = FRAMESIZE_QVGA;
            else if (value == "vga" && psramFound()) resolution = FRAMESIZE_VGA;
            else { server.send(400, "text/plain", "Use qqvga, qvga, or vga with PSRAM"); return; }
        }
        if (server.hasArg("quality"))
        {
            String value = server.arg("quality");
            if (value.length() == 0 || value.length() > 2)
            { server.send(400, "text/plain", "Quality must be 10-40"); return; }
            for (unsigned int i = 0; i < value.length(); i++)
                if (!isDigit(value[i]))
                { server.send(400, "text/plain", "Quality must be 10-40"); return; }
            quality = value.toInt();
            if (quality < 10 || quality > 40)
            { server.send(400, "text/plain", "Quality must be 10-40"); return; }
        }
        if (xSemaphoreTake(cameraMutex, pdMS_TO_TICKS(1000)) != pdTRUE)
        { server.send(503, "text/plain", "Camera busy"); return; }
        bool configured = sensor->set_framesize(sensor, resolution) == 0
            && sensor->set_quality(sensor, quality) == 0;
        xSemaphoreGive(cameraMutex);
        if (!configured) { server.send(500, "text/plain", "Camera configuration failed"); return; }
        status();
    }

    void capture()
    {
        if (xSemaphoreTake(cameraMutex, pdMS_TO_TICKS(1000)) != pdTRUE)
        { server.send(503, "text/plain", "Camera busy"); return; }
        digitalWrite(4, LOW);
        unsigned long captureStarted = millis();
        camera_fb_t *frame = esp_camera_fb_get();
        unsigned long captureMs = millis() - captureStarted;
        if (!frame)
        {
            xSemaphoreGive(cameraMutex);
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
        Serial.printf("Capture: %lu ms, send: %lu ms, bytes: %u/%u, RSSI: %d dBm\n",
            captureMs, millis() - started, unsigned(sent), unsigned(frame->len), WiFi.RSSI());
        esp_camera_fb_return(frame);
        xSemaphoreGive(cameraMutex);
    }

    SemaphoreHandle_t cameraMutex = nullptr;
    httpd_handle_t streamServer = nullptr;
    WebServer server{80};
};
