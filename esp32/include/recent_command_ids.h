#pragma once
#include <cstddef>
#include <cstdint>

// Main loop owns this bounded history. It resets when the controller reboots.
// Session and expiry validation must be added before commands use QoS 1.
class RecentCommandIds
{
public:
    bool accept(uint32_t id)
    {
        if (id == 0) return false;
        for (uint32_t previous : ids)
            if (previous == id) return false;
        ids[next] = id;
        next = (next + 1) % capacity;
        return true;
    }

private:
    static constexpr std::size_t capacity = 32;
    uint32_t ids[capacity] = {};
    std::size_t next = 0;
};
