#pragma once
#include "ESP32MQTTClient.h"
#include "heater_module.h"

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
        mqttClient.loopStart();
    }
    void attach(HeaterModule &h) { this->heaterModule = &h; }
    void subscribe()
    {
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

        instance->subscribe();
    }
    void handlePower(const std::string &payload)
    {
        if (!heaterModule || !mqttClient.isConnected())
            return;
        bool changed = false;
        Serial.println(payload.c_str());
        if (payload == "true")
        {
            if (heaterModule->getPower())
                return;
            heaterModule->setPower(true);
            changed = true;
        }
        else if (payload == "false")
        {
            if (!heaterModule->getPower())
                return;
            heaterModule->setPower(false);
            changed = true;
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
        mqttClient.publish("heater/state/temperature", std::to_string(heaterModule->getTemperature()), 1, true);
        mqttClient.publish("heater/state/flowrate", std::to_string(heaterModule->getFlowrate()), 1, true);
    }

    void publishPowerState()
    {
        if (!heaterModule || !mqttClient.isConnected())
            return;

        mqttClient.publish(
            "heater/state/power",
            heaterModule->getPower() ? "true" : "false", 1, true);
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