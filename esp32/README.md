# Firmware del controlador de la terma

Modo normal: OCR por MQTT para la temperatura y TCS34725 como observación
complementaria. La consigna seleccionada, la temperatura del agua y el estado
Power son datos distintos. Una lectura de OLED retenida es exclusivamente visual.

## Contrato vigente

- El primer + despierta el panel o abre la selección. La sincronización usa
  +, espera6s, otro + y lectura del objetivo dentro de su ventana de selección.
- Cada pulsación posterior cambia un grado en el rango circular30–75.
  El objetivo se confirma mediante el ID de la captura vigente, durante la
  selección; después se esperan6s para volver a aceptar temperatura del agua.
- El comando web de temperatura es una orden absoluta; los callbacks no mueven
  servos. Todas las mutaciones del controlador y sus snapshots ocurren en loop().
- Power se ejecuta una sola vez. Una pulsación PWM **no confirma** ON/OFF:
  después de pulsarA, el estado queda desconocido hasta una observación nueva.
  Una lectura fresca del agua o piloto rojo/verde válido puede confirmarON.
  Oscuridad, OCR ilegible y piloto apagado no confirmanOFF.
- Si hace falta despertar antes de apagar, se usaB/+, se esperan al menos6s
  y una observación posterior; un fallo cancela la orden, sin togglesPower a ciegas.
- Desconectar/reconectar MQTT invalida observaciones y acciones remotas pendientes.
  Los mensajes retenidos, demasiado grandes, con NUL o con más de5s en la cola
  local se rechazan. Los botones locales siguen atendidos desde el loop.
- El autoapagado opcional usa sólo temperatura vigente yON observado; apaga al alcanzar/superar el último objetivo seleccionado y admitido por el controlador (sin límite fijo de40°C). Si no hay objetivo conocido, espera una selección. El valor retenido del OLED no se usa para decidirlo.
  No sustituye los controles térmicos originales del equipo.

La máquina de temperatura es Idle→Opening→Reading→Applying→Confirming→Settling→Idle,
con salidaError por lectura incorrecta/tardía. Se eliminaron la antigua selección
local diferida y las correcciones contra lecturas de agua, que ya no estaban
conectadas al flujo vigente. No hay un segundo algoritmo oculto de consigna.

## Pruebas sin hardware

```sh
python3 esp32/test/run_host_tests.py
```

Se requiere Python3 y un compiladorC++17 (`CXX` configurable). Compila los headers
reales de include/ con periféricos y reloj simulados de test/fakes/; no copia el
controlador a otro proyecto ni abre puertos. Cubre la matriz completa30–75,
IDs/ventanas/corrección rechazada, retained, payload inválido, callbacks diferidos,
cancelación offline, wake con+, confirmaciónPower y desbordamiento de millis().
Para compilar por primera vez, copia `esp32/include/secrets.example.h` a
`esp32/include/secrets.h` y llena la configuración de la red local. Git ignora
`secrets.h`. Compila con `platformio run -d esp32 -j1`. Las dependencias
están fijadas a las versiones ya usadas; no se cambió la biblioteca MQTT.

## Pines y montaje

A: GPIO32/servo25; B: GPIO33/servo27 (+); C: GPIO18/servo26 (−). Botones aGND con
INPUT_PULLUP y antirrebote40ms. SDA23/SCL22 comparten RGB y OLED. El firmware comprueba y reintenta cada
dispositivo I²C cuando deja de responder. LED azul y OLED indican encendido
observado. Con el visor de la terma apagado o estado desconocido, ambos se
apagan. Con Power ON, el OLED muestra el último número recibido que siga
vigente o `-.-`. El texto se desplaza unos píxeles cada 8 s. La calibración
actual de ángulos está en config.h: conservarla hasta medir el montaje.
Cada tap conserva250ms de pulsación y250ms de retorno; ese bloqueo es medible,
no prueba por sí solo un fallo de alimentación ni de MQTT.

Caudal: GPIO34 usa INPUT porque carece de pull-up interno. El acondicionamiento
externo y450pulsos/L requieren comprobación física. Los servos necesitan su
alimentación dimensionada y masa común según el montaje; este README no valida
una conexión concreta ni autoriza actuar sobre ella.

TEMPORARY_SENSOR_TEST_MODE=1 mantiene la pruebaDS18B20 enGPIO4. Es un modo
explícito de banco: asumeOFF inicial y consigna inicial configurada, sin pretender
que esos supuestos sean observaciones del equipo. El modo normal es0.

## Qué falta comprobar físicamente

Respuesta del panel a cada primer botón; confirmación independiente deOFF;
recorrido/retorno de servos; iluminación/foco/crop en imágenes nuevas; referencias
RGB; factor de caudal y estabilidad de alimentación/red. Primero ensayar una
frontera por vez con versión identificada y logs pasivos, antes de un caso completo.
Ver también ../water-heater/broker/SOFTWARE-VALIDATION.md y ../esp32cam/README.md.
