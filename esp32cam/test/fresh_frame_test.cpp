#include <cassert>
#include <vector>
#include "fresh_frame.h"

static std::vector<camera_fb_t *> queued, returned;
static unsigned gets;

camera_fb_t *esp_camera_fb_get()
{
    assert(gets < queued.size());
    // A second acquisition may only happen after the first frame was returned.
    if (gets == 1) assert(returned.size() == 1 && returned[0] == queued[0]);
    return queued[gets++];
}

void esp_camera_fb_return(camera_fb_t *frame)
{
    assert(frame);
    returned.push_back(frame);
}

static void reset(std::vector<camera_fb_t *> frames)
{
    queued = frames;
    returned.clear();
    gets = 0;
}

int main()
{
    camera_fb_t previous{1}, fresh{2};
    reset({&previous, &fresh});
    camera_fb_t *result = captureFreshFrame();
    assert(result == &fresh && gets == 2);
    assert(returned.size() == 1 && returned[0] == &previous);
    esp_camera_fb_return(result); // HTTP caller returns only its own fresh frame.
    assert(returned.size() == 2 && returned[1] == &fresh);

    reset({nullptr});
    assert(captureFreshFrame() == nullptr);
    assert(gets == 1 && returned.empty());

    reset({&previous, nullptr});
    assert(captureFreshFrame() == nullptr);
    assert(gets == 2 && returned.size() == 1 && returned[0] == &previous);
}
