# CP2: lectura de LDR y publicación MQTT

`Checkpoint2_LDR/Checkpoint2_LDR.ino` utiliza ESP32, WiFi y PubSubClient.
Lee el código ADC crudo de GPIO35, lo imprime a 115200 baudios y lo publica
como texto en `lab/ldr`. El bucle incluye una espera de 1000 ms; el tiempo
total entre publicaciones también depende de las operaciones de red.

## Configuración y uso

1. En `Checkpoint2_LDR/`, copiar `secrets_local.example.h` a `secrets_local.h`.
2. Configurar `ssid`, `password` y `mqtt_broker`. La dirección del ejemplo
   es ilustrativa y debe sustituirse por la del broker del laboratorio.
3. Abrir `Checkpoint2_LDR.ino` en Arduino IDE con soporte ESP32 y la
   biblioteca PubSubClient; seleccionar la placa y el puerto correspondientes.
4. Configurar el monitor serial a 115200 baudios. El cliente receptor MQTT
   debe ejecutarse en otra computadora, según la guía de CP2.

`secrets_local.h` está excluido de Git. En sistemas Unix se pueden limitar
sus permisos con `chmod 600 secrets_local.h`.
