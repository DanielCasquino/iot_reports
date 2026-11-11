#include <Arduino.h>
#include <WiFi.h>
#include "secrets.h"
#include "camera_module.h"

CameraModule cameraModule;
bool cameraReady = false;
bool wasConnected = false;

void setup()
{
    Serial.begin(115200);
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    cameraReady = cameraModule.setup();
}

void loop()
{
    bool connected = WiFi.status() == WL_CONNECTED;
    if (cameraReady && connected && !wasConnected)
    {
        Serial.print("Camera: http://");
        Serial.println(WiFi.localIP());
    }
    wasConnected = connected;
    if (cameraReady) cameraModule.loop();
    delay(1);
}
