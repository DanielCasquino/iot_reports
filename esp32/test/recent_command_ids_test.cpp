#include <cassert>
#include "recent_command_ids.h"

int main()
{
    RecentCommandIds recent;
    assert(!recent.accept(0));
    assert(recent.accept(17));
    assert(recent.accept(18));
    assert(!recent.accept(17)); // A, B, duplicated A.
    for (unsigned id = 19; id < 49; ++id) assert(recent.accept(id));
    assert(!recent.accept(17)); // Exactly 32 recent IDs are retained.
    assert(recent.accept(49));
    assert(recent.accept(17)); // Eviction is explicit; QoS 1 needs a session fence.
}
