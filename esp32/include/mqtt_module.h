#pragma once
#include "ESP32MQTTClient.h"
#include "heater_module.h"
#include "config.h"
#include <cstdlib>
#include <cmath>
#include <cstdio>

ESP32MQTTClient mqttClient;

// Required global event handler - ESP-IDF version dependent
#if ESP_IDF_VERSION < ESP_IDF_VERSION_VAL(5, 0, 0)
esp_err_t handleMQTT(esp_mqtt_event_handle_t event)
{
    mqttClient.onEventCallback(event);
    return ESP_OK;
}
#else
void handleMQTT(void *handler_args, esp_event_base_t base, int32_t event_id, void *event_data)
{
    (void)base;
    (void)event_id;
    auto *client = static_cast<ESP32MQTTClient *>(handler_args);
    auto *event = static_cast<esp_mqtt_event_handle_t>(event_data);
    client->onEventCallback(event);
}
#endif

class MqttModule
{
public:
    MqttModule() {}
    void setup()
    {
        instance = this;
        if (!heaterModule)
        {
            Serial.println("MQTTModule has no HeaterModule attached");
            return;
        }
        mqttClient.setURI(BROKER_URI);

        mqttClient.setKeepAlive(ESP_KEEPALIVE_SECONDS);
        mqttClient.enableLastWillMessage("heater/status", "offline", true, 1);

        mqttClient.loopStart();
    }
    void attach(HeaterModule &h) { this->heaterModule = &h; }
    void subscribe()
    {
        mqttClient.subscribe("heater/input/power", [this](const std::string &payload)
                             {
                                 if (heaterModule && payload == "true")
                                 {
                                     heaterModule->observePilot(HeaterModule::PilotState::Awake);
                                 }
                             });
        mqttClient.subscribe("heater/input/pilot", [this](const std::string &payload) {
            if (!heaterModule) return;
            auto state = HeaterModule::PilotState::Unknown;
            if (payload == "heating" || payload == "ready") state = HeaterModule::PilotState::Awake;
            else if (payload == "unlit") state = HeaterModule::PilotState::Unlit;
            heaterModule->observePilot(state);
        });
        mqttClient.subscribe("heater/input/temperature", [this](const std::string &payload)
                             { handleTemperature(payload); });
        mqttClient.subscribe("heater/input/temperature_verification", [this](const std::string &payload)
                             {
                                 auto separator = payload.find(',');
                                 if (!heaterModule || separator == std::string::npos) return;
                                 std::string token = payload.substr(0, separator);
                                 if (token.empty() || token.find_first_not_of("0123456789") != std::string::npos) return;
                                 unsigned long long id = strtoull(token.c_str(), nullptr, 10);
                                 if (id > UINT32_MAX) return;
                                 const char *number = payload.c_str() + separator + 1;
                                 char *end = nullptr;
                                 float value = strtof(number, &end);
                                 if (end != number && *end == '\0' && std::isfinite(value))
                                     heaterModule->verifyTemperature(uint32_t(id), value);
                             });
        mqttClient.subscribe("heater/set/temperature", [this](const std::string &payload) { handleTemperatureControl(payload, false); });
        mqttClient.subscribe("heater/set/temperature_base", [this](const std::string &payload) { handleTemperatureControl(payload, true); });
        mqttClient.subscribe("heater/set/power", [this](const std::string &payload)
                             { handlePower(payload); });
        mqttClient.subscribe("heater/set/autoshutdown", [this](const std::string &payload)
                             { handleAutoShutdown(payload); });
        mqttClient.subscribe("heater/command/state_snapshot", [this](const std::string &payload)
                             { handleSnapshot(payload); });
    }
    static void onConnect(esp_mqtt_client_handle_t client)
    {
        if (!instance || !mqttClient.isMyTurn(client))
            return;

        Serial.println("Connected to broker");

        mqttClient.publish("heater/status", "online", 1, true);

        instance->heaterModule->invalidateTemperature();
        instance->subscribe();

        instance->publishState();
        instance->publishPowerState();
        instance->publishAutoShutdown();
    }
    void handleTemperature(const std::string &payload)
    {
        if (!heaterModule) return;
        char *end = nullptr;
        float value = strtof(payload.c_str(), &end);
        if (payload.empty() || end == payload.c_str() || *end != '\0' ||
            !std::isfinite(value) || value < 0 || value > 100)
            heaterModule->invalidateTemperature();
        else
            heaterModule->setTemperature(value);
    }

    void handleTemperatureControl(const std::string &payload, bool calibrate)
    {
        if (!heaterModule || payload.size() > 40) return;
        unsigned long id = 0;
        int base = 0, target = 0, consumed = 0;
        if (sscanf(payload.c_str(), "%lu,%d,%d%n", &id, &base, &target, &consumed) != 3 ||
            consumed != int(payload.size()) || id == 0 || target < MIN_TEMPERATURE_C || target > MAX_TEMPERATURE_C) return;
        heaterModule->requestTemperatureControl(uint32_t(id), base, target, calibrate);
    }
    void publishTemperatureControl()
    {
        if (!heaterModule || !mqttClient.isConnected()) return;
        std::string payload = "{\"base\":" + std::to_string(heaterModule->getSetpoint()) +
            ",\"target\":" + std::to_string(heaterModule->getTargetTemperature()) +
            ",\"status\":\"" + heaterModule->getAdjustmentStatus() + "\",\"locked\":" +
            (heaterModule->isTemperatureLocked() ? "true" : "false") +
            ",\"min\":" + std::to_string(int(MIN_TEMPERATURE_C)) + ",\"max\":" + std::to_string(int(MAX_TEMPERATURE_C)) +
            ",\"commandId\":" + std::to_string(heaterModule->getTemperatureCommandId()) +
            ",\"result\":\"" + heaterModule->getTemperatureCommandResult() + "\"}";
        mqttClient.publish("heater/state/temperature_control", payload, 0, false);
    }
    void handlePower(const std::string &payload)
    {
        if (!heaterModule || !mqttClient.isConnected())
            return;
        if (!heaterModule->isPowerKnown())
        {
            Serial.println("Power state unknown; waiting for an observation");
            publishPowerState();
            return;
        }
        Serial.println(payload.c_str());
        if (payload == "true")
        {
            heaterModule->requestPower(true);
        }
        else if (payload == "false")
        {
            heaterModule->requestPower(false);
        }
        else
        {
            Serial.println("Invalid power payload");
        }

        // Main loop executes the servo command and publishes the resulting power state.
    }

    void handleAutoShutdown(const std::string &payload)
    {
        if (!heaterModule || !mqttClient.isConnected())
            return;
        bool changed = false;
        Serial.println(payload.c_str());
        if (payload == "true")
        {
            if (heaterModule->getIsAutoShutdownEnabled())
                return;
            heaterModule->setIsAutoShutdownEnabled(true);
            changed = true;
        }
        else if (payload == "false")
        {
            if (!heaterModule->getIsAutoShutdownEnabled())
                return;
            heaterModule->setIsAutoShutdownEnabled(false);
            changed = true;
        }
        else
        {
            Serial.println("Invalid autoshutdown payload");
        }

        if (!mqttClient.isConnected() || !changed)
            return;

        publishAutoShutdown();
    }
    void handleSnapshot(const std::string &payload)
    {
        if (!heaterModule || !mqttClient.isConnected())
            return;
        publishState();
        publishPowerState();
        publishAutoShutdown();
    }
    void requestTemperatureVerification()
    {
        if (!heaterModule || !mqttClient.isConnected() || !heaterModule->needsTemperatureVerification()) return;
        mqttClient.publish("heater/command/verify_temperature",
                           std::to_string(heaterModule->temperatureVerificationId()), 0, false);
    }
    void publishState()
    {
        if (!heaterModule || !mqttClient.isConnected())
            return;
        mqttClient.publish("heater/state/temperature",
                           heaterModule->isTemperatureAvailable() ? std::to_string(heaterModule->getTemperature()) : "unavailable", 0, false);
        mqttClient.publish("heater/state/temperature_adjustment", heaterModule->getAdjustmentStatus(), 0, false);
        mqttClient.publish("heater/state/temperature_locked", heaterModule->isTemperatureLocked() ? "true" : "false", 0, false);
        mqttClient.publish("heater/state/temperature_target",
                           std::string(heaterModule->getAdjustmentStatus()) == "idle" ? "unavailable" :
                           std::to_string(heaterModule->getTargetTemperature()), 0, false);
        publishTemperatureControl();
        ColorModule &color = heaterModule->getColor();
        if (color.isAvailable() && color.hasReading())
        {
            std::string rgb = std::to_string(color.getRed()) + "," + std::to_string(color.getGreen()) + "," +
                              std::to_string(color.getBlue()) + "," + std::to_string(color.getClear());
            mqttClient.publish("heater/state/color", rgb, 0, false);
        }
        else mqttClient.publish("heater/state/color", "unavailable", 0, false);
        mqttClient.publish("heater/state/volume", std::to_string(heaterModule->getVolume()), 0, false);
        mqttClient.publish("heater/state/flowrate", std::to_string(heaterModule->getFlowrate()), 0, false);
    }

    void publishPowerState()
    {
        if (!heaterModule || !mqttClient.isConnected())
            return;

        mqttClient.publish(
            "heater/state/power",
            heaterModule->isPowerKnown() ? (heaterModule->getPower() ? "true" : "false") : "unknown", 0, false);
    }
    void publishAutoShutdown()
    {
        if (!heaterModule || !mqttClient.isConnected())
            return;
        mqttClient.publish("heater/state/autoshutdown", heaterModule->getIsAutoShutdownEnabled() ? "true" : "false", 0, false);
    }

private:
    static MqttModule *instance;
    HeaterModule *heaterModule = nullptr;
};

MqttModule *MqttModule::instance = nullptr;