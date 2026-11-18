#pragma once
#include <string>
#include <map>
#include <functional>
#include <vector>
#define ESP_IDF_VERSION_VAL(a,b,c) ((a)*10000+(b)*100+(c))
#define ESP_IDF_VERSION ESP_IDF_VERSION_VAL(5,5,5)
#define MQTT_EVENT_DATA 1
#define MQTT_EVENT_DISCONNECTED 2
using esp_mqtt_client_handle_t = void*;
using esp_event_base_t = const char*;
struct esp_mqtt_event_t {int event_id=MQTT_EVENT_DATA; bool retain=false; std::string topic,payload;};
using esp_mqtt_event_handle_t=esp_mqtt_event_t*;
class ESP32MQTTClient {public:
 bool connected=true;
 std::map<std::string,std::function<void(const std::string&)>> callbacks;
 std::vector<std::pair<std::string,std::string>> published;
 void setURI(const char*){} void setKeepAlive(int){} void enableLastWillMessage(const char*,const char*,bool,int){} void loopStart(){}
 bool isConnected(){return connected;} bool isMyTurn(void*){return true;}
 void subscribe(const char*t,std::function<void(const std::string&)> callback, int qos=0){(void)qos;callbacks[t]=callback;}
 void publish(const char*t,const std::string&p,int,bool){published.push_back({t,p});}
 void onEventCallback(esp_mqtt_event_handle_t e){auto c=callbacks.find(e->topic);if(c!=callbacks.end())c->second(e->payload);}
};
