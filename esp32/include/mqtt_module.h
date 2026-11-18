#pragma once
#include "ESP32MQTTClient.h"
#include "heater_module.h"
#include "display_mirror.h"
#include "mqtt_inbox.h"
#include "config.h"
#include <cstdlib>
#include <cmath>
#include <cstdio>

ESP32MQTTClient mqttClient;
std::atomic<uint32_t> mqttConnectionRevision{0};

// Required global event handler - ESP-IDF version dependent
#if ESP_IDF_VERSION < ESP_IDF_VERSION_VAL(5, 0, 0)
esp_err_t handleMQTT(esp_mqtt_event_handle_t event)
{
    if (event->event_id == MQTT_EVENT_DISCONNECTED) ++mqttConnectionRevision;
    if (event->event_id == MQTT_EVENT_DATA && event->retain) return ESP_OK;
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
    if (event->event_id == MQTT_EVENT_DISCONNECTED) ++mqttConnectionRevision;
    if (event->event_id == MQTT_EVENT_DATA && event->retain) return;
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
        if (!inbox.setup())
        {
            Serial.println("MQTT inbox allocation failed; controller remains local");
            return;
        }
        heaterModule->attachTransportRevision(mqttConnectionRevision);
        mqttClient.setURI(BROKER_URI);

        mqttClient.setKeepAlive(ESP_KEEPALIVE_SECONDS);
        mqttClient.enableLastWillMessage("heater/status", "offline", true, 1);

        mqttClient.loopStart();
    }
    void attach(HeaterModule &h) { this->heaterModule = &h; h.attachTapSink(publishTap); }
    static void publishTap(const ServoModule::TapEvent &tap)
    {
        if (!mqttClient.isConnected()) return;
        std::string payload = "{\"pin\":" + std::to_string(tap.pin) +
            ",\"button\":\"" + (tap.pin == SERVO_PIN_A ? "power" : tap.pin == SERVO_PIN_B ? "plus" : "minus") +
            "\",\"reason\":\"" + tap.reason + "\",\"commandId\":" + std::to_string(tap.commandId) +
            ",\"estimatedBefore\":" + std::to_string(tap.estimatedBefore) + ",\"estimatedAfter\":" + std::to_string(tap.estimatedAfter) +
            ",\"target\":" + std::to_string(tap.target) + ",\"press\":" + std::to_string(tap.press) + ",\"rest\":" + std::to_string(tap.rest) +
            ",\"startedAt\":" + std::to_string(tap.startedAt) + ",\"completedAt\":" + std::to_string(tap.completedAt) +
            ",\"mechanicalConfirmed\":false}";
        mqttClient.publish("heater/diagnostic/servo", payload, 0, false);
    }
    void attachDisplay(DisplayMirror &display) { displayMirror = &display; }
    // Called only by the MQTT task. No HeaterModule getters or mutation here.
    void subscribe()
    {
        using Kind = MqttInbox::Kind;
        subscribeTopic("heater/command/wake_display", Kind::WakeDisplay);
        subscribeTopic("heater/input/display", Kind::Display);
        subscribeTopic("heater/input/power", Kind::PowerObservation);
        subscribeTopic("heater/input/pilot", Kind::Pilot);
        subscribeTopic("heater/input/temperature", Kind::Temperature);
        subscribeTopic("heater/input/temperature_verification", Kind::Verification);
        subscribeTopic("heater/input/wake_verification", Kind::WakeVerification);
        subscribeTopic("heater/set/temperature", Kind::Target);
        subscribeTopic("heater/set/temperature_v2", Kind::TargetV2, 1);
        subscribeTopic("heater/set/temperature_base", Kind::Base);
        subscribeTopic("heater/set/power", Kind::Power);
        subscribeTopic("heater/set/autoshutdown", Kind::AutoShutdown);
        subscribeTopic("heater/command/state_snapshot", Kind::Snapshot);
    }
    static void onConnect(esp_mqtt_client_handle_t client)
    {
        if (!instance || !mqttClient.isMyTurn(client)) return;
        ++mqttConnectionRevision;
        instance->inbox.reset(); // Old-session requests must not act after reconnect.
        instance->subscribe();
        instance->inbox.push(MqttInbox::Kind::Connected, nullptr, 0, millis(), mqttConnectionRevision.load());
    }
    void loop()
    {
        bool connected = mqttClient.isConnected();
        if (wasConnected && !connected) heaterModule->invalidateObservations();
        wasConnected = connected;
        MqttInbox::Message message;
        // A fixed bound also lets sensors/buttons run under sustained MQTT input.
        for (unsigned count = 0; count < 16 && inbox.next(message); ++count)
        {
            using Kind = MqttInbox::Kind;
            if (!mqttClient.isConnected() || message.revision != mqttConnectionRevision.load()) continue;
            if (message.kind == Kind::Connected)
            {
                heaterModule->invalidateObservations();
                renewTemperatureToken();
                mqttClient.publish("heater/status", "online", 1, true);
                publishState();
                publishPowerState();
                publishAutoShutdown();
                continue;
            }
            if (uint32_t(millis() - message.receivedAt) > 5000U) continue;
            const std::string payload(message.payload);
            switch (message.kind)
            {
            case Kind::WakeDisplay:
                if (payload == "wake") heaterModule->requestDisplayWake();
                break;
            case Kind::Display:
                if (displayMirror) displayMirror->receive(message.payload, message.receivedAt);
                break;
            case Kind::PowerObservation:
                if (payload == "true" || payload == "false")
                    heaterModule->observePilot(payload == "true" ? HeaterModule::PilotState::ObservedOn :
                        HeaterModule::PilotState::ObservedOff, message.receivedAt);
                break;
            case Kind::Pilot:
                heaterModule->observePilot(payload == "heating" || payload == "ready" ? HeaterModule::PilotState::Awake :
                    payload == "unlit" ? HeaterModule::PilotState::Unlit : HeaterModule::PilotState::Unknown, message.receivedAt);
                break;
            case Kind::Temperature: handleTemperature(payload, message.receivedAt); break;
            case Kind::Verification: handleVerification(payload, message.receivedAt); break;
            case Kind::WakeVerification: handleVerification(payload, message.receivedAt, true); break;
            case Kind::Target: handleTemperatureControl(payload, false); break;
            case Kind::TargetV2: handleTemperatureControlV2(payload); break;
            case Kind::Base: handleTemperatureControl(payload, true); break;
            case Kind::Power: handlePower(payload); break;
            case Kind::AutoShutdown: handleAutoShutdown(payload); break;
            case Kind::Snapshot: handleSnapshot(payload); break;
            default: break;
            }
        }
    }
    void handleVerification(const std::string &payload, uint32_t receivedAt, bool wake = false)
    {
        auto separator = payload.find(',');
        if (!heaterModule || !heaterModule->acceptsObservation(receivedAt) || separator == std::string::npos) return;
        std::string token = payload.substr(0, separator);
        if (token.empty() || token.find_first_not_of("0123456789") != std::string::npos) return;
        unsigned long long id = strtoull(token.c_str(), nullptr, 10);
        if (id > UINT32_MAX) return;
        const char *number = payload.c_str() + separator + 1;
        char *end = nullptr;
        float value = strtof(number, &end);
        if (end != number && *end == '\0' && std::isfinite(value)) {
            if (wake) heaterModule->verifyWake(uint32_t(id), value, receivedAt);
            else heaterModule->verifyTemperature(uint32_t(id), value, receivedAt);
        }
    }
    void handleTemperature(const std::string &payload, uint32_t receivedAt)
    {
        if (!heaterModule || !heaterModule->acceptsObservation(receivedAt)) return;
        char *end = nullptr;
        float value = strtof(payload.c_str(), &end);
        if (payload.empty() || end == payload.c_str() || *end != '\0' ||
            !std::isfinite(value) || value < 0 || value > 100)
            heaterModule->setTemperature(NAN, receivedAt);
        else
            heaterModule->setTemperature(value, receivedAt);
    }

    void renewTemperatureToken()
    {
        uint32_t nextToken = esp_random();
        if (!nextToken || nextToken == temperatureToken)
            nextToken = temperatureToken == UINT32_MAX ? 1 : temperatureToken + 1;
        temperatureToken = nextToken;
        temperatureTokenAt = millis();
    }

    void handleTemperatureControlV2(const std::string &payload)
    {
        const auto separator = payload.rfind(',');
        if (separator == std::string::npos) return;
        uint32_t token = 0;
        if (!parseUnsigned(payload.substr(separator + 1), token) || token != temperatureToken ||
            uint32_t(millis() - temperatureTokenAt) >= 5000UL) return;
        // Consume before queuing; duplicate messages cannot actuate again.
        renewTemperatureToken();
        handleTemperatureControl(payload.substr(0, separator), false);
        publishTemperatureControl();
    }

    void handleTemperatureControl(const std::string &payload, bool calibrate)
    {
        if (!heaterModule || payload.size() > 40) return;
        auto comma = payload.find(',');
        auto second = comma == std::string::npos ? comma : payload.find(',', comma + 1);
        if (second == std::string::npos) return;
        uint32_t id = 0, base = 0, target = 0;
        auto baseToken = payload.substr(comma + 1, second - comma - 1);
        if (!parseUnsigned(payload.substr(0, comma), id) || id == 0 ||
            !parseUnsigned(payload.substr(second + 1), target) || target < MIN_TEMPERATURE_C || target > MAX_TEMPERATURE_C ||
            (baseToken != "-1" && (!parseUnsigned(baseToken, base) || base < MIN_TEMPERATURE_C || base > MAX_TEMPERATURE_C))) return;
        heaterModule->requestTemperatureControl(id, baseToken == "-1" ? -1 : int(base), int(target), calibrate);
    }
    void publishTemperatureControl(int qos = 0)
    {
        if (!heaterModule || !mqttClient.isConnected()) return;
        if (!temperatureToken || uint32_t(millis() - temperatureTokenAt) >= 5000UL)
            renewTemperatureToken();
        std::string payload = "{\"temperatureV2Token\":" + std::to_string(temperatureToken) +
            ",\"base\":" + std::to_string(heaterModule->getSetpoint()) +
            ",\"target\":" + std::to_string(heaterModule->getTargetTemperature()) +
            ",\"status\":\"" + heaterModule->getAdjustmentStatus() + "\",\"locked\":" +
            (heaterModule->isTemperatureLocked() ? "true" : "false") +
            ",\"min\":" + std::to_string(int(MIN_TEMPERATURE_C)) + ",\"max\":" + std::to_string(int(MAX_TEMPERATURE_C)) +
            ",\"commandId\":" + std::to_string(heaterModule->getTemperatureCommandId()) +
            ",\"result\":\"" + heaterModule->getTemperatureCommandResult() +
            "\",\"autoShutdownTarget\":" + std::to_string(heaterModule->getAutoShutdownTarget()) + "}";
        mqttClient.publish("heater/state/temperature_control", payload, qos, false);
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
    void handleSnapshot(const std::string &)
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
    void requestWakeVerification()
    {
        if (!heaterModule || !mqttClient.isConnected() || !heaterModule->needsWakeVerification()) return;
        mqttClient.publish("heater/command/verify_wake", std::to_string(heaterModule->wakeVerificationId()), 0, false);
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
        mqttClient.publish("heater/state/volume",
                           FLOW_SENSOR_ENABLED ? std::to_string(heaterModule->getVolume()) : "unavailable", 0, false);
        mqttClient.publish("heater/state/flowrate",
                           FLOW_SENSOR_ENABLED ? std::to_string(heaterModule->getFlowrate()) : "unavailable", 0, false);
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
    static bool parseUnsigned(const std::string &token, uint32_t &value)
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
    void subscribeTopic(const char *topic, MqttInbox::Kind kind, int qos = 0)
    {
        mqttClient.subscribe(topic, [this, kind](const std::string &payload) {
            if (!inbox.push(kind, payload.data(), payload.size(), millis(), mqttConnectionRevision.load()))
                Serial.println("MQTT message rejected: inbox full or oversized payload");
        }, qos);
    }
    uint32_t temperatureToken = 0;
    uint32_t temperatureTokenAt = 0;
    MqttInbox inbox;
    bool wasConnected = false;
    static MqttModule *instance;
    HeaterModule *heaterModule = nullptr;
    DisplayMirror *displayMirror = nullptr;
};

MqttModule *MqttModule::instance = nullptr;
