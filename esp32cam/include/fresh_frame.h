#pragma once
#include "esp_camera.h"

// With one framebuffer, the driver can have queued an image before the HTTP
// request. Return that image first; the next acquisition waits for a new frame.
// The caller owns the returned frame and must call esp_camera_fb_return().
inline camera_fb_t *captureFreshFrame()
{
    camera_fb_t *previous = esp_camera_fb_get();
    if (!previous)
        return nullptr;
    esp_camera_fb_return(previous);
    return esp_camera_fb_get();
}
