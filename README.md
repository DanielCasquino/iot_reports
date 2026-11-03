# How to run dis

## How to run esp32

js open the esp32 folder as a platformio project in vscode, then upload and monitor
dont forget to put ur stuff in include/secrets.h (ssid, password)

## how to run broker

go to broker folder, npm i, npm run dev, profit. node app runs both broker and frontend.

## firewall

don't forget to open ports lol, smth like this:

```
sudo ufw allow from 192.168.1.0/24 to any port 8080 proto tcp
sudo ufw allow from 192.168.1.0/24 to any port 3000 proto tcp
sudo ufw allow from 192.168.1.0/24 to any port 1883 proto tcp
```

8080 for broker,
3000 for front,
1883 for mqtt

## Arquitectura general
```mermaid
flowchart LR
    UI["water-heater/front<br/>HTML + CSS + JavaScript"]
    WS["water-heater/broker/src/websocket/server.ts<br/>WebSocket :8080"]
    APP["water-heater/broker/src/index.ts<br/>Express :3000<br/>Estado en memoria"]
    MQTT["water-heater/broker/src/mqtt/client.ts<br/>Cliente MQTT"]
    BROKER["Mosquitto<br/>MQTT :1883"]
    ESP["esp32/src/main.cpp<br/>ESP32 + sensor/modelo térmico"]
    LED["LED integrado"]
    UI -->|"set_heater_power<br/>set_auto_shutdown"| WS
    WS --> APP
    APP -->|"heater/set/power<br/>heater/set/autoshutdown"| MQTT
    MQTT <-->|"MQTT"| BROKER
    BROKER <-->|"heater/set/*<br/>heater/state/*"| ESP
    ESP --> LED
    MQTT -->|"heater/state/*"| APP
    APP -->|"mqtt_message<br/>state_snapshot"| WS
    WS --> UI
```
## Inicio de los componentes
```mermaid
flowchart TD
    START([Inicio])
    ESPSETUP["ESP32: iniciar Serial, WiFi y cliente MQTT<br/>configurar LED y temporizador"]
    BROKERSTART["Broker: conectar a MQTT<br/>crear WebSocket :8080<br/>servir front por Express :3000"]
    FRONTSTART["Front: cargar ajustes locales<br/>inicializar UI y abrir WebSocket"]
    CONNECT{"¿Conexión disponible?"}
    SNAPSHOT["Broker envía state_snapshot<br/>con power, autoShutdown y temperature"]
    RETRY["Reintentar conexión cada 2 s"]
    START --> ESPSETUP
    START --> BROKERSTART
    START --> FRONTSTART
    FRONTSTART --> CONNECT
    CONNECT -->|Sí| SNAPSHOT
    CONNECT -->|No| RETRY --> CONNECT
```
## Flujo de control del calentador
```mermaid
flowchart TD
    USER["Usuario pulsa encendido<br/>o cambia Low Cortisol Mode"]
    COMMAND["Front crea mensaje WebSocket<br/>con el evento y enabled"]
    ROUTE{"Evento recibido por el broker"}
    POWER["Publicar heater/set/power"]
    AUTO["Publicar heater/set/autoshutdown"]
    SUBSCRIBE["ESP32 recibe el tópico MQTT"]
    VALIDATE{"¿Payload es true o false?"}
    UPDATE["Actualizar estado del ESP32<br/>y LED si cambia power"]
    INVALID["Registrar payload inválido"]
    PUBLISH["Publicar el estado actualizado<br/>en heater/state/*"]
    BROKERSTATE["Broker actualiza heaterState<br/>y retransmite mqtt_message"]
    UIUPDATE["Front actualiza botón,<br/>interruptor y temperatura"]
    USER --> COMMAND --> ROUTE
    ROUTE -->|set_heater_power| POWER
    ROUTE -->|set_auto_shutdown| AUTO
    POWER --> SUBSCRIBE
    AUTO --> SUBSCRIBE
    SUBSCRIBE --> VALIDATE
    VALIDATE -->|No| INVALID
    VALIDATE -->|Sí| UPDATE --> PUBLISH --> BROKERSTATE --> UIUPDATE
```
## Ciclo térmico del ESP32
El ESP32 usa `tick()` cada 2 segundos. La temperatura simulada aumenta
cuando el calentador está encendido y disminuye cuando está apagado (20 °C - 40 °C).
```mermaid
flowchart TD
    TICK([Cada 2 segundos])
    POWERSTATE{"¿Calentador encendido?"}
    HEAT["Aumentar 0.1 °C"]
    COOL["Disminuir 0.1 °C"]
    LIMIT["Limitar temperatura entre<br/>20 °C y 40 °C"]
    AUTO{"¿Autoapagado activo,<br/>temperatura = 40 °C<br/>y power = true?"}
    OFF["Apagar calentador<br/>y publicar power = false"]
    MQTT{"¿MQTT conectado?"}
    TEMP["Publicar heater/state/temperature"]
    WAIT["Esperar al siguiente ciclo"]
    TICK --> POWERSTATE
    POWERSTATE -->|Sí| HEAT
    POWERSTATE -->|No| COOL
    HEAT --> LIMIT
    COOL --> LIMIT
    LIMIT --> AUTO
    AUTO -->|Sí| OFF --> MQTT
    AUTO -->|No| MQTT
    MQTT -->|Sí| TEMP --> WAIT
    MQTT -->|No| WAIT
    WAIT --> TICK
```
