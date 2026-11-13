# Calibración individual de servos

Proyecto independiente para el ESP32 principal, no la cámara. No usa Wi-Fi,
MQTT ni acciona los tres servos al arrancar. Mantiene GPIO A25, B26 y C27.
Abrir esta carpeta en PlatformIO y seleccionar `servo-calibration`.

Primero probar un servo libre, sin presionar la terma. No forzar su eje a mano.
Mantener alimentación adecuada de servos y GND común con el controlador.
Con monitor serie115200 y final de línea LF:

1. `A 90` selecciona y centra A. `B 90` y `C 90` seleccionan los otros.
2. `+1`, `-1`, `+5`, `-5` cambian el ángulo por pasos.
3. `OFF` libera el servo y cancela la selección.

Cada movimiento libera PWM tras500ms para no mantener presión accidental.
Seleccionar siempre centra: no cambiar de selección con el brazo apoyado en
un botón. No existe una posición central universalmente segura: iniciar libre.
Los comandos se ejecutan sólo localmente por serie.

Fijar el cuerpo antes de medir; buscar un reposo sin contacto y el recorrido
mínimo que registre una pulsación. Si zumba o se traba, cortar alimentación:
aumentar recorrido no equivale a calibrar fuerza. Anotar reposo y pulsación de
cada servo; trasladar a `esp32/include/config.h`, `SERVO_REST_A/B/C` y
`SERVO_PRESS_A/B/C`. Los valores0/90 son los originales, no calibración real.
Después flashear el proyecto normal `esp32/`. Al arrancar irá a su reposo
configurado: montar los brazos respetando esa posición. El retorno también
requiere comprobación física. No hay credenciales ni comandos remotos aquí.

Los servos y brazos del equipo son iguales: calibrar primero uno y usar sus
valores como referencia. Sólo ajustar los demás si cambia la orientación,
separación al botón o registro del brazo. Verificar reposo libre, pulsación y
retorno en los tres; no hace falta repetir todo el procedimiento si coinciden.
