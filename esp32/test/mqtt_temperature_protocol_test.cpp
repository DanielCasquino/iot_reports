#include <cassert>
#include <cstdint>
#include <initializer_list>
#include "mqtt_temperature_protocol.h"

int main()
{
    MqttTemperatureProtocol::Command command{};
    assert(MqttTemperatureProtocol::parseCommand("123,-1,45", command));
    assert(command.id == 123 && command.base == -1 && command.target == 45);
    assert(MqttTemperatureProtocol::parseCommand("4294967295,30,75", command));
    assert(command.id == UINT32_MAX && command.base == 30 && command.target == 75);
    for (const char *payload : {"0,-1,45", "4294967296,-1,45", "1,-1,76",
                                "1,29,45", "1,45,30,1", "1,,45", "1,-1,-1",
                                "1,-1,45x", "1,-1,", "1,-1, 45"}) {
        assert(!MqttTemperatureProtocol::parseCommand(payload, command));
    }
}
