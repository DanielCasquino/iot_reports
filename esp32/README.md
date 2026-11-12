# Modo temporal de pruebas (activo)

`TEMPORARY_SENSOR_TEST_MODE = 1` en `include/config.h` activa el modo temporal.
El broker también lo activa por defecto; su variable de entorno
`TEMPORARY_SENSOR_TEST_MODE=false` lo desactiva. Para restaurar el flujo original,
cambiar ambas opciones (ESP32 a `0`, broker a `false`), recompilar el firmware y
reiniciar el broker. Los bloques originales se conservan con comentarios y `#if`.

- La temperatura proviene del **DS18B20 en GPIO 4**, con las dependencias OneWire y
  DallasTemperature existentes. La conversión es asíncrona; no detiene los botones.
- **Arrancar con la terma físicamente apagada.** El estado inicial se asume apagado
  y conocido. Los comandos y el botón de encendido actualizan el estado estimado,
  sin esperar RGB. Un reinicio del ESP32 no detecta el estado físico por sí solo.
- Cámara y sensor de color siguen inicializados, con captura/OCR y telemetría RGB
  disponibles. No cambian el encendido, no sobrescriben la sonda y sus fallos no
  bloquean los controles. La web utiliza la temperatura de la sonda.
- Subir/bajar conservan la selección de 5 segundos y el bloqueo durante los
  movimientos. **La confirmación por cámara está suspendida**: al finalizar los
  servos se libera el bloqueo sin afirmar que el display quedó confirmado.
- Para probar subir/bajar, establecer manualmente el display en
  `TEMPORARY_INITIAL_SETPOINT_C` (**20 °C** por defecto) antes de arrancar el ESP32,
  o ajustar esa constante al valor real. Se cuentan las pulsaciones desde ese
  valor; no se confunde la temperatura del agua con la consigna del display.
  El objetivo estimado mantiene el rango 20–75 °C. Si se opera directamente la
  terma o un servo pierde una pulsación, este modo no puede detectar el desfase.
- El autoapagado opcional usa la sonda y conserva el umbral de 40 °C.

Prueba de la sonda con conversión simulada (y de la restauración del modo OCR):

```sh
g++ -std=c++11 -Wall -Wextra -Werror -I esp32/test/probe_fakes -I esp32/include \
  esp32/test/temperature_probe_test.cpp -o /tmp/temperature_probe_test
/tmp/temperature_probe_test
g++ -std=c++11 -Wall -Wextra -Werror -DTEMPORARY_SENSOR_TEST_MODE=0 \
  -I esp32/test/probe_fakes -I esp32/include \
  esp32/test/temperature_probe_test.cpp -o /tmp/temperature_ocr_test
/tmp/temperature_ocr_test
```

La sección siguiente describe el modo original, recuperable al desactivar la
bandera temporal.

# Botones de la terma

Los botones se conectan entre GPIO y GND (`INPUT_PULLUP`): A/32 enciende o
apaga, B/33 sube y C/18 baja. B y C requieren encendido confirmado y una lectura
OCR reciente, entera y dentro de 20–75 °C para comenzar una selección.

Cada pulsación modifica el objetivo pendiente en 1 °C, sin mover servos. Los
límites son 20 y 75 °C. Cada pulsación individual, incluso en un límite,
reinicia los 5 segundos de selección. Pulsaciones simultáneas se ignoran.
Si el objetivo vuelve al valor inicial, no se acciona ningún servo.

Tras 5 segundos sin pulsaciones, B y C quedan bloqueados: sus pulsaciones se
descartan hasta finalizar. Se ejecuta una pulsación física por grado de diferencia,
con al menos 1 segundo entre pulsaciones. El bucle sigue atendiendo sensores y
MQTT entre movimientos (cada movimiento conserva los 150 ms del servo existente).
`TEMPERATURE_STEP_C` presupone que una pulsación física cambia **1 °C**; verificar
esto con la terma real antes de usar el ajuste.

Después de la última pulsación se esperan 6 segundos de estabilización y se
solicita una captura nueva al broker mediante `heater/command/verify_temperature`.
El broker responde en `heater/input/temperature_verification` con `id,valor`.
Solo una respuesta del identificador vigente puede confirmar el objetivo y
liberar el bloqueo; las lecturas periódicas de `heater/input/temperature` no
lo liberan. Se necesita actualizar tanto el firmware como el broker. No se
requieren cambios en el firmware de la ESP32-CAM.

Una lectura distinta permite hasta 3 rondas de corrección desde el valor observado,
seguidas de otra captura nueva. Las capturas se solicitan cada 5 segundos si el
broker está ocupado o la imagen no es legible. Tras 60 segundos sin confirmar
una ronda, o si se agotan las correcciones, el estado pasa a `error`: no hay más
movimientos de temperatura y B/C permanecen bloqueados. Apagar cancela el ajuste;
al encender de nuevo se requiere una lectura válida para seleccionar otro objetivo.
El botón de encendido y el autoapagado siguen disponibles durante el ajuste.
Los comandos remotos de encendido se ejecutan en el bucle principal para evitar
que dos servos se accionen desde tareas distintas.

Se publican cada 2 segundos los temas `heater/state/temperature_adjustment`
(`idle`, `selecting`, `applying`, `verifying`, `error`),
`heater/state/temperature_locked` y `heater/state/temperature_target` (o
`unavailable` en reposo). La temperatura observada sigue publicándose aparte;
el objetivo pendiente no se presenta como una lectura física confirmada.

El límite global es `MAX_TEMPERATURE_C = 75`. El umbral opcional de autoapagado
existente se conserva en `AUTO_SHUTDOWN_TEMPERATURE_C = 40`; si está activado,
puede apagar la terma antes de alcanzar un objetivo superior.

Prueba de la lógica de ajuste sin hardware:

```sh
g++ -std=c++11 -Wall -Wextra -Werror -I esp32/include \
  esp32/test/temperature_adjustment_test.cpp -o /tmp/temperature_adjustment_test
/tmp/temperature_adjustment_test
```

La validación física pendiente incluye recorrido y tiempo de retorno de los
servos, incremento real por pulsación, cableado, y que la cámara lea la temperatura
configurada del display (no una medida distinta de la temperatura del agua).
