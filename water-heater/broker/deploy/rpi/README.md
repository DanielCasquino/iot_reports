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
