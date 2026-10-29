#include <WiFi.h>
#include <WebServer.h>
#include <LittleFS.h>

const int LED_PIN = 2;

const float MIN_TEMP = 29.0;
const float MAX_TEMP = 41.0;
const uint32_t HEAT_TICK_MS = 8000;
const uint32_t COOL_TICK_MS = 10000;
const float HEAT_INCREASE = 0.2;
const float HEAT_DECREASE = 0.1;

float temperature = MIN_TEMP;
uint32_t lastTick = 0;

bool automatedShutdownEnabled = false;

const char* ssid = "";
const char* password = "";

WebServer server(80);

void turnTermaOn(){
    digitalWrite(LED_PIN, HIGH);
}

void turnTermaOff(){
    digitalWrite(LED_PIN, LOW);
}

bool isTermaOn(){
  return digitalRead(LED_PIN) == HIGH;
}

void getTemp()
{
  server.send(200, "text/plain", String(temperature, 1));
}

void toggleTerma()
{
  if (isTermaOn())
    turnTermaOff();
  else
    turnTermaOn();
  server.send(200, "text/plain", String(isTermaOn()));
}

void getTerma(){
  server.send(200, "text/plain", String(isTermaOn()));
}

void getLowcort(){
  server.send(200, "text/plain", String(automatedShutdownEnabled));
}

void toggleLowcort(){
  automatedShutdownEnabled = !automatedShutdownEnabled;
  server.send(200, "text/plain", String(automatedShutdownEnabled));
}


void mockTemperature()
{
  uint32_t now = millis();
  if (isTermaOn())
  {
    if (now - lastTick < HEAT_TICK_MS) return;
    lastTick = now;
    if (temperature >= MAX_TEMP) return;
    temperature += HEAT_INCREASE;
  }
  else
  {
    if (now - lastTick < COOL_TICK_MS) return;
    lastTick = now;
    if (temperature <= MIN_TEMP) return;
    temperature -= HEAT_DECREASE;
  }
}

void setup()
{
  Serial.begin(115200);

  pinMode(LED_PIN, OUTPUT);

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED)
  {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nConnected!");
  Serial.println(WiFi.localIP());

  LittleFS.begin(true);

  server.serveStatic("/", LittleFS, "/index.html");
  server.serveStatic("/styles.css", LittleFS, "/styles.css");
  server.serveStatic("/script.js", LittleFS, "/script.js");

  server.on("/get_temp", getTemp);
  server.on("/toggle_terma", toggleTerma);
  server.on("/get_terma", getTerma);
  server.on("/get_lowcort", getLowcort);
  server.on("/toggle_lowcort", toggleLowcort);

  server.begin();
}

void loop()
{
  server.handleClient();
  mockTemperature();
  if (automatedShutdownEnabled && temperature >= MAX_TEMP){
    turnTermaOff();
  }
}
