#pragma once

struct camera_fb_t { int sample; };
camera_fb_t *esp_camera_fb_get();
void esp_camera_fb_return(camera_fb_t *frame);
