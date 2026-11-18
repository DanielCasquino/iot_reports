# Arranque de Terma Erma en la Raspberry

Construir el backend con `npm run build` desde `water-heater/broker`. Mantener
el frontend en `water-heater/front` junto al backend. El mismo Node sirve el
frontend/API en 3000 y el WebSocket en 8080.

Revisar el usuario, directorio y binario absoluto de Node en
`terma-erma.service` antes de instalar. La unidad lee el `.env` local y conserva
`.runtime`. Revisar la unidad con `systemd-analyze verify` en la Pi. Tras detener
la instancia verificada de tmux que ocupa 3000/8080, instalar la unidad en
`/etc/systemd/system/`, ejecutar `systemctl daemon-reload` y
`systemctl enable --now terma-erma.service`. Verificar HTTP y WebSocket en LAN
y por Tailscale. La sesión MQTT puede volver después de que arranque Node.

`journalctl -u terma-erma.service -b` muestra el arranque actual. Revisar
`journalctl --list-boots` y `journalctl --disk-usage`. Si hace falta limitar
persistencia en esta Pi dedicada, revisar la configuración y colocar el
drop-in opcional en `/etc/systemd/journald.conf.d/`. Su presupuesto es global.
La telemetría por mensaje se puede activar temporalmente mediante
`HEATER_DEBUG_TELEMETRY=true`. Las órdenes y los resultados tienen eventos
propios con la depuración desactivada.

Probar la recuperación sin actuadores pendientes. Una consigna guardada
permanece visible, pero un reinicio o desconexión deja fallido el ajuste
incompleto y requiere una orden nueva. Validar que no haya publicaciones de
control al arrancar. Para revertir, deshabilitar y parar la unidad, y arrancar
el proceso anterior en su propio checkout con la misma configuración.

## Prueba del montaje

La versión del backend y del ESP32 principal deben corresponder al mismo
artefacto de entrega. En el `.env` privado, `MQTT_TEMPERATURE_QOS1=true` activa
QoS 1 cuando el ESP anuncia su token. Mosquitto necesita `persistence true`
para recuperar el último valor del OLED tras reiniciar el broker. Los tópicos
de órdenes y las verificaciones ópticas conservan su política sin retain.

| Prueba | Resultado observable |
| --- | --- |
| Encender, apagar y dejar el visor tenue | La web distingue apagado, visor tenue y pérdida de imagen. El OLED y el indicador de encendido siguen el estado confirmado. |
| Subir y bajar la temperatura máx. con el visor despierto | El ajuste puede comenzar durante el parpadeo que abrió el primer toque. La web confirma la nueva máxima con evidencia del visor y mantiene aparte la temperatura del agua. |
| Repetir con el visor tenue o un contacto fallido | El primer toque puede despertar el visor. Un nuevo intento de lectura usa otro ID. Al agotar los intentos, la web indica que se revise el contacto. |
| Activar autoapagado con una máxima admitida y esperar a que el agua alcance el objetivo | Se registra `auto_shutdown_at_target`. La cámara y el controlador confirman que la terma queda apagada. |
| Perder el backend y recuperarlo con la Pi encendida | Los botones locales siguen respondiendo. Las órdenes pendientes no se reanudan al reconectar. El OLED distingue un valor histórico vigente de la falta de lectura. |
| Reiniciar la Pi sin una orden pendiente | Vuelven Mosquitto, la aplicación y Tailscale. HTTP y WebSocket responden con disponibilidad real. El journal conserva el arranque anterior y permite medir el tiempo de cada ajuste. |
| Probar el caudal en el banco separado | Habilitar `FLOW_SENSOR_ENABLED=1` y comprobar el volumen contra la cantidad medida. El montaje sin sensor indica caudal no disponible. |

En la Pi con journal aislado, usar
`journalctl --namespace=terma -u terma-erma.service` para seguir la solicitud,
las pulsaciones y el resultado.
