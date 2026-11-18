#pragma once
#include <cstdint>
#include <string>
#include "config.h"

// Parse wire fields without touching the controller or queues.
namespace MqttTemperatureProtocol {
struct Command {
    uint32_t id;
    int base;
    int target;
};

inline bool parseUnsigned(const std::string &token, uint32_t &value)
{
    if (token.empty()) return false;
    value = 0;
    for (char digit : token)
    {
        if (digit < '0' || digit > '9' || value > (UINT32_MAX - uint32_t(digit - '0')) / 10U) return false;
        value = value * 10U + uint32_t(digit - '0');
    }
    return true;
}

inline bool parseCommand(const std::string &payload, Command &command)
{
    if (payload.size() > 40) return false;
    const auto comma = payload.find(',');
    const auto second = comma == std::string::npos ? comma : payload.find(',', comma + 1);
    if (second == std::string::npos) return false;
    uint32_t id = 0, base = 0, target = 0;
    const auto baseToken = payload.substr(comma + 1, second - comma - 1);
    if (!parseUnsigned(payload.substr(0, comma), id) || id == 0 ||
        !parseUnsigned(payload.substr(second + 1), target) || target < MIN_TEMPERATURE_C || target > MAX_TEMPERATURE_C ||
        (baseToken != "-1" && (!parseUnsigned(baseToken, base) || base < MIN_TEMPERATURE_C || base > MAX_TEMPERATURE_C)))
        return false;
    command = {id, baseToken == "-1" ? -1 : int(base), int(target)};
    return true;
}
}
