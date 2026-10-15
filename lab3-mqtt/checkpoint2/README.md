# CP2: LDR por MQTT

El sketch se conserva desde la copia reutilizable de CP2. Se separan SSID,
contraseña y dirección local del broker en `secrets_local.h`, excluido por
la regla `.gitignore` del directorio del sketch. No se incluyen credenciales
ni un archivo de configuración real en este repositorio.

Uso manual:

1. En `Checkpoint2_LDR/`, copiar `secrets_local.example.h` a `secrets_local.h`.
2. Completar localmente `ssid`, `password` y `mqtt_broker`; limitar el archivo
   a su propietario (`chmod 600 secrets_local.h`). La dirección del ejemplo
   es ilustrativa: no es un broker operativo.
3. Abrir `Checkpoint2_LDR/Checkpoint2_LDR.ino` en el entorno existente con
   WiFi y PubSubClient. Confirmar placa y puerto antes de una carga manual.
4. Monitor a 115200; lectura cruda en GPIO35 y tópico `lab/ldr`. Para CP2,
   registrar la recepción en otra computadora según la guía.

La lógica, pines, tópico y esperas se preservan. No se ha cargado ni probado
hardware en esta sesión. No reutilizar ni editar headers de CP3/CP4.
La configuración privada ya existente de CP2 en la laptop se mantuvo local;
esta copia publicada es independiente y requiere su propia configuración.
No publicar capturas de la pestaña privada ni añadir el header con `-f`.
