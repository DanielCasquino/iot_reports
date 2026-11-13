# Integración real — 13 de noviembre

Esta rama integra `casita`, `deepfix` y cámara/preview de la rama de revisión.
El modo temporal de sonda queda desactivado por defecto: temperatura por OCR
vía MQTT y piloto por TCS34725. Para repetir explícitamente la prueba de sonda,
usar TEMPORARY_SENSOR_TEST_MODE=1 y el mismo valor true en el backend.

## Antes de fijar brazos

Calibrar con el proyecto separado `servo_calibration/`, monitor serie115200.
No mueve servos al arrancar. Seleccionar uno libre con `A 90`, `B 90` o `C 90` según su
README y avanzar por pasos. Registrar posiciones de reposo y pulsación en
`SERVO_REST_A/B/C` y `SERVO_PRESS_A/B/C` de config.h. Los valores0/90 conservados
son ejemplos del código original, no una calibración física verificada.
La pulsación y retorno esperan250ms cada uno, también pendientes de comprobar.

El modo normal mueve a reposo al arrancar; no montar un brazo presionando.
No usar el regulador3V3 del controlador para alimentar servos. Verificar fuente,
masa común y recorridos antes del montaje definitivo.

## Temperatura medida y consigna

La temperaturaOCR se usa como medición del display y caduca. No se considera
la consigna guardada automáticamente: una terma puede mostrar temperatura del
agua al salir del modo de selección. Al iniciar, consigna=-1 significa desconocida.
Sincronizar la consigna real mediante el control existente de Daniel antes de
ordenar cambios. Esta sincronización no mueve servos. Después se mantiene una
estimación contando pulsaciones de ungrado; comprobar que cada pulsación real
hace exactamente eso. Las pulsaciones locales seleccionan el objetivo durante
5s y luego se aplica por pasos con espera entre ellos.

Al terminar el ajuste se espera6s y se libera el control. No se verifica la
consigna contra la temperatura del agua ni se ejecutan correcciones automáticas.
Por tanto terminar una secuencia no demuestra que todos los botones fueron
presionados correctamente: la comprobación mecánica sigue siendo necesaria.
Durante aplicación/espera se ignoran muestrasOCR para no usar la cifra parpadeante
como medición de agua. Después se requiere una nueva lectura válida.

## Piloto y reinicio

TCS: SDA23, SCL22, ajustes154ms/4x medidos con sensor pegado y cubierta opaca.
Las referencias de .env pertenecen a esa posición y configuración.
Al reiniciar no se supone apagado. Una referencia roja o verde válida puede
recuperar ON; piloto oscuro por sí solo queda sin interpretar como OFF hasta
verificar todos los estados del equipo. Un fallo de sensor no es una ordenPower.

## Comprobación en sitio

1. Arranque sin pulsación accidental; estado desconocido hasta observar.
2. Validar lectura de cámara con el display y piloto con referencia real.
3. Un comando mueve una vez y retorna, sin presión residual ni cuerpo suelto.
4. Sincronizar consigna y probar subir/bajar mirando el panel real.
5. Probar fallos/reconexión sin reutilizar datos antiguos.
6. Autoapagado sólo con temperatura fresca y ON conocido; mantenerlo desactivado
   durante calibración. No sustituye los controles térmicos de la terma.

## Historial de funcionamiento de casita

Las notas siguientes describen la rama anterior, incluidos su modo temporal y
su estrategia original de verificación. El comportamiento vigente es el de arriba.

# Control desde la web

La web mantiene un borrador local de la temperatura deseada. Los botones +/− no
mandan pulsaciones ni esperan un temporizador: **Save temperature** envía un único
objetivo al ESP32. El firmware calcula la diferencia desde la consigna estimada,
activa el servo correspondiente una vez por grado (al menos 1 s entre pulsaciones)
y bloquea nuevos ajustes y calibraciones durante los movimientos y los 6 s finales
de guardado del panel. En el modo temporal no se requiere OCR para liberar el bloqueo.
Los botones físicos B/C conservan su selección de 5 s porque no tienen botón Save.

`TEMPORARY_INITIAL_SETPOINT_C` es **43 °C** por defecto, configurable en
`include/config.h`. Debe coincidir con la consigna física al arrancar el ESP32.
El menú de calibración (icono tune) permite sincronizar otro valor sin mover servos.
El valor se mantiene en RAM; después de reiniciar se vuelve a la constante inicial.
La sonda mide el agua; no se usa como consigna del display. El rango de consigna
es **35–75 °C**, correspondiente al mínimo del manual del equipo.

Comandos MQTT no retenidos: `heater/set/temperature` y
`heater/set/temperature_base`, con payload `requestId,base,target`. El firmware
rechaza nuevas órdenes mientras está ocupado, objetivos fuera del rango, ajustes
con la terma apagada y bases que ya no coinciden. La calibración solo cambia el
valor estimado, sin tocar servos. Estos comandos web están habilitados únicamente
en el modo temporal; restaurar OCR requiere revisar el protocolo de consigna.
`heater/state/temperature_control` publica base, objetivo, estado, bloqueo, límites
y resultado de la última orden en una única observación JSON. La web espera el
acuse del ESP32 y no calcula el fin del bloqueo con un temporizador local.

En escritorio se muestra el control a la izquierda y preferencias/RGB/cámara a la
derecha. En celular se conserva la columna y los diagnósticos quedan en su menú;
la calibración tiene un menú separado en la barra superior.

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
  servos se esperan 6 segundos para que el panel guarde el valor y se libera el
  bloqueo sin afirmar que el display quedó confirmado.
- Para probar subir/bajar, establecer manualmente el display en
  `TEMPORARY_INITIAL_SETPOINT_C` (**43 °C** por defecto) antes de arrancar el ESP32,
  o ajustar esa constante al valor real. Se cuentan las pulsaciones desde ese
  valor; no se confunde la temperatura del agua con la consigna del display.
  El objetivo estimado mantiene el rango 35–75 °C. Si se opera directamente la
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
OCR reciente, entera y dentro de 35–75 °C para comenzar una selección.

Cada pulsación modifica el objetivo pendiente en 1 °C, sin mover servos. Los
límites son 35 y 75 °C. Cada pulsación individual, incluso en un límite,
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

## Caudal de demostración

El SEA ZJ-S201 se prueba separado de las tuberías de la terma. GPIO34 no tiene
pull-up interno, aunque el código anterior use INPUT_PULLUP. Comprobar la
polarización y adaptación reales de su salida antes de trasladarlas aPCB;
no conectar señal5V directamente alGPIO. Una prueba aislada no valida presión,
temperatura ni aptitud del sensor para una instalación permanente.
