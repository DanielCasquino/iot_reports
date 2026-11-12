#pragma once
#include "ESP32MQTTClient.h"
#include "heater_module.h"
#include "config.h"
#include <cstdlib>
#include <cmath>

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
                                     heaterModule->observePowerOn();
                                     publishPowerState();
                                 }
                             });
        mqttClient.subscribe("heater/input/temperature", [this](const std::string &payload)
                             { handleTemperature(payload); });
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
        bool changed = false;
        Serial.println(payload.c_str());
        if (payload == "true")
        {
            if (heaterModule->getPower())
                return;
            changed = heaterModule->setPower(true);
        }
        else if (payload == "false")
        {
            if (!heaterModule->getPower())
                return;
            changed = heaterModule->setPower(false);
        }
        else
        {
            Serial.println("Invalid power payload");
        }

        if (!mqttClient.isConnected() || !changed)
            return;

        publishPowerState();
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
    void publishState()
    {
        if (!heaterModule || !mqttClient.isConnected())
            return;
        mqttClient.publish("heater/state/temperature",
                           heaterModule->isTemperatureAvailable() ? std::to_string(heaterModule->getTemperature()) : "unavailable", 1, true);
        ColorModule &color = heaterModule->getColor();
        if (color.isAvailable() && color.hasReading())
        {
            std::string rgb = std::to_string(color.getRed()) + "," + std::to_string(color.getGreen()) + "," +
                              std::to_string(color.getBlue()) + "," + std::to_string(color.getClear());
            mqttClient.publish("heater/state/color", rgb, 1, true);
        }
        else mqttClient.publish("heater/state/color", "unavailable", 1, true);
        mqttClient.publish("heater/state/volume", std::to_string(heaterModule->getVolume()), 1, true);
        mqttClient.publish("heater/state/flowrate", std::to_string(heaterModule->getFlowrate()), 1, true);
    }

    void publishPowerState()
    {
        if (!heaterModule || !mqttClient.isConnected())
            return;

        mqttClient.publish(
            "heater/state/power",
            heaterModule->isPowerKnown() ? (heaterModule->getPower() ? "true" : "false") : "unknown", 1, true);
    }
    void publishAutoShutdown()
    {
        if (!heaterModule || !mqttClient.isConnected())
            return;
        mqttClient.publish("heater/state/autoshutdown", heaterModule->getIsAutoShutdownEnabled() ? "true" : "false", 1, true);
    }

private:
    static MqttModule *instance;
    HeaterModule *heaterModule = nullptr;
};

MqttModule *MqttModule::instance = nullptr;