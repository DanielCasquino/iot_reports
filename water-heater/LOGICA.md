# Lógica integrada de la terma

Esta rama reúne controles de `casita`, calibración de `deepfix` y cámara con
preview/OCR de la rama de revisión. No modifica el informe académico.

## Recorrido de datos

```text
ESP32-CAM -- JPEG por HTTP/Wi-Fi --> backend -- OCR --> MQTT heater/input/temperature
TCS34725 -- I2C --> ESP32 -- MQTT heater/state/color --> backend -- clasificación del piloto
App -- WebSocket --> backend -- MQTT --> ESP32 -- servos --> botones originales
ESP32 -- MQTT estado/temperatura/caudal --> backend -- WebSocket --> app
```

La cámara responde a solicitudes; no mueve servos ni reconoce números por sí
misma. El streaming se utiliza para encuadrar y se detiene para medir. Giro90 y
recorte opcional se hacen en el backend. Un resultado ilegible se publica como
`unavailable`, nunca como cero. Lecturas antiguas dejan de estar disponibles.

## Encendido y piloto

Al arrancar el controlador, el estado de encendido es desconocido. No se envía
una pulsación para descubrirlo. Una lectura nueva que coincida con una referencia
roja o verde calibrada permite recuperar ON. Un piloto oscuro se clasifica como
`unlit`; por sí solo no establece OFF, porque antes hay que comprobar que no
ocurre también en otro estado de funcionamiento.

El comandoPower es idempotente respecto al estado conocido y tiene un intervalo
mínimo entre pulsaciones. Aún se debe comprobar físicamente que el servo registra
el botón: el estado esperado tras una orden no sustituye una confirmación óptica
independiente. El pulsador local permite una pulsación explícita cuando el estado
es desconocido, sin inventar una confirmación por ello.

## Temperatura medida y temperatura configurada

La medición del agua viene del OCR por MQTT; la sonda de prueba está desactivada
por defecto. La consigna configurada es una variable distinta. Al arrancar no se
supone una consigna guardada: se sincroniza manualmente con el control existente.
Sincronizar no acciona ningún servo.

Las órdenes de ajuste llevan identificador, base y objetivo. Se validan rango,
estado y coincidencia de base; una orden duplicada no se aplica de nuevo.
El controlador estima la consigna contando pulsaciones y respeta el intervalo
entre ellas. No considera la lectura del agua una confirmación de consigna, ni
aplica correcciones repetidas por esa diferencia.

Los botones locales B/C seleccionan el objetivo durante5s; después se aplica por
pasos. Tras el último movimiento se espera6s antes de liberar el ajuste. Durante
aplicación/espera se descarta la temperatura recibida para no confundir el número
parpadeante con agua medida. La eficacia real de cada pulsación se verifica en
el montaje, no con una simulación de software.

## Actuadores y seguridad de operación

A25 pulsaPower, B26 sube y C27 baja. Cada servo tiene ángulo de reposo y de
pulsación configurables. La calibración comienza con uno y se reutiliza si los
otros montajes permiten el mismo recorrido; siempre se comprueba retorno libre.
El proyecto separado `servo_calibration/` mueve un servo por serie en pasos de
1°/5°, sin red, y liberaPWM tras500ms. El firmware normal arranca en reposo:
los brazos deben montarse de acuerdo con la posición calibrada.

Autoapagado sólo actúa con ON conocido y temperatura fresca que alcance el
umbral del código; se deja desactivado durante calibración. No sustituye las
protecciones originales de la terma. Las credenciales y direcciones de cada red
se configuran localmente, fuera deGit.

## Alcance de la comprobación

Pruebas de backend/C++ y compilación verifican comportamiento de software, no
fuerza, alimentación, cableado, estanqueidad ni montaje. Quedan por comprobar en
conjunto: arranque/reconexión, clasificación en todos los estados, pulsación y
retorno, lecturas repetidas y control de temperatura mirando el panel real.
El caudalímetro se demuestra separado; no se interviene la tubería de la terma.
