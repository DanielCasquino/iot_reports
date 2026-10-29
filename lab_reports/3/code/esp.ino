#include <WiFi.h>
#include <PubSubClient.h>

const char* ssid = "quaso";
const char* password = "sapo";

const char* mqtt_server = "10.221.239.228";

#define RXD2 16
#define TXD2 17

WiFiClient espClient;
PubSubClient mqtt(espClient);

void setup() {
  Serial.begin(115200);
  Serial2.begin(9600, SERIAL_8N1, RXD2, TXD2);

  WiFi.begin(ssid, password);
  Serial.println(WiFi.localIP());
  mqtt.setServer(mqtt_server, 1883);

  while (!mqtt.connected()) {
    Serial.print("Connecting to MQTT...");

    if (mqtt.connect("esp32cito")) {
      Serial.println("connected!");
    } else {
      Serial.print("failed, state=");
      Serial.println(mqtt.state());
      delay(2000);
    }
  }
}

void loop() {
  if(!mqtt.connected()){
    while(!mqtt.connected()){
      if(mqtt.connect("esp32cito")){
        Serial.println("MQTT rc");
      }
      else{
        delay(1000);
      }
    }
  }
  mqtt.loop();
  if (!Serial2.available())
    return;
  
  String msg = Serial2.readStringUntil('\n');
  msg.trim();
  if (msg.length() <= 0)
    return;

  if(mqtt.publish("hey/guys", msg.c_str())){
    Serial.println("Published :)");
  }
  else{
    Serial.println("Not published :(");
  }
}