#include <cassert>
#include <cstdint>
#include <cstring>
#include "display_mirror.h"

int main()
{
    DisplayMirror mirror;
    assert(std::strcmp(mirror.text(0), "--") == 0);
    mirror.setup();
    assert(std::strcmp(mirror.text(0), "--") == 0);

    mirror.receive("0", 0);
    assert(std::strcmp(mirror.text(0), "0") == 0);
    assert(std::strcmp(mirror.text(2000), "0") == 0);
    assert(std::strcmp(mirror.text(2001), "0") == 0);

    const char *valid[] = {"1", "9", "10", "30", "75", "99", "00", "09"};
    const char *expected[] = {"1", "9", "10", "30", "75", "99", "0", "9"};
    for (unsigned i = 0; i < sizeof(valid) / sizeof(valid[0]); ++i) {
        mirror.receive(valid[i], 3000);
        assert(std::strcmp(mirror.text(3000), expected[i]) == 0);
    }

    mirror.receive("blank", 4000);
    assert(std::strcmp(mirror.text(4000), "") == 0);
    assert(std::strcmp(mirror.text(6000), "") == 0);
    assert(std::strcmp(mirror.text(34001), "--") == 0);

    const char *invalid[] = {nullptr, "", "unknown", "-1", "-2", "+1", "100", "000",
                             "1.0", " 1", "1 ", "1\n", "1x", "Blank", "NaN"};
    for (const char *payload : invalid) {
        mirror.receive("42", 7000);
        assert(std::strcmp(mirror.text(7000), "42") == 0);
        mirror.receive(payload, 7001);
        assert(std::strcmp(mirror.text(7001), "42") == 0);
    }

    mirror.receive("10", 8000);
    mirror.receive("blank", 8001);
    mirror.receive("99", 8002);
    assert(std::strcmp(mirror.text(8002), "99") == 0);
    assert(std::strcmp(mirror.text(10002), "99") == 0);
    assert(std::strcmp(mirror.text(38003), "--") == 0);
    mirror.receive("55", 11000);
    mirror.receive("unknown", 11001);
    assert(std::strcmp(mirror.text(11001), "55") == 0);

    mirror.receive("47", 12000);
    mirror.receive("unknown", 12001);
    assert(std::strcmp(mirror.text(12002), "47") == 0);
    assert(std::strcmp(mirror.text(42000), "47") == 0);
    assert(std::strcmp(mirror.text(42001), "--") == 0);

    mirror.receive("0", UINT32_MAX - 999U);
    assert(std::strcmp(mirror.text(0), "0") == 0);
    assert(std::strcmp(mirror.text(1000), "0") == 0);
    assert(std::strcmp(mirror.text(29001), "--") == 0);
    mirror.receive("blank", UINT32_MAX);
    assert(std::strcmp(mirror.text(0), "") == 0);
    mirror.receive("7", 0);
    assert(std::strcmp(mirror.text(0), "7") == 0);
}
