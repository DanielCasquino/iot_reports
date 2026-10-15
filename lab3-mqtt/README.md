# LAB3 MQTT y ESP32 — borrador colaborativo

Entrada: `main.tex`. Estado: **parcial, para completar en equipo**, no entrega
final ni constancia de aprobación. Usa IEEEtran y el orden de secciones de
`../2/main.tex`, adaptados a la guía actual; no copia resultados del LAB2.
Se reutiliza la organización de evidencias del borrador local del 08Oct
(`informe-lab07oct-borrador.tex`), que permanece intacto. Este directorio
es la versión colaborativa del LAB3. Los directorios históricos `3/`, `4/`
y `5/` contienen otros informes y no se sustituyen por este trabajo.

La guía vigente es [Sem10_LAB3_MQTT.pdf](https://utec.instructure.com/courses/24674/files/4935950),
revisada el 14Oct. El esquema incluye todas sus experiencias; la redacción
experimental queda abierta. CP3 presentado y grabado es **declaración de
José**; falta incorporar su evidencia. CP4 sigue a cargo de su sesión
original. Terma, PCB y tarea opcional tienen otros documentos.

| Archivo | Aporte preparado | Pendiente del equipo |
|---|---|---|
| `introduction.tex` | Introducción, teoría y antecedente breve | Revisar pertinencia y ajustar al desarrollo real |
| `methodology.tex` | Descripción estática de CP2; huecos B1/F1 | Materiales confirmados, diagramas y procedimiento real |
| `development_discussion.tex` | Mapa de evidencias y captions | Capturas, datos, experiencia y discusión |
| `conclusion.tex` | Campo reservado | Conclusiones y recomendaciones sustentadas |
| `references.bib` | Cinco referencias verificadas | Añadir sólo fuentes leídas que el texto use |
| `checkpoint2/` | Sketch CP2 sin configuración privada; ejemplo y uso | Configurar en privado sólo si se va a usar |

## Evidencias y figuras propuestas

Los identificadores son huecos editoriales, **no archivos existentes**.

| ID | Título/caption propuesto | Datos necesarios |
|---|---|---|
| E1 | Entorno y carga de prueba de CP1 | Capturas reales, placa y versiones |
| E2 | Montaje empleado para adquirir la señal del LDR | Foto, orientación del divisor, resistor y alimentación |
| B1 | Arquitectura de adquisición y distribución MQTT de CP2 | Diagrama validado y receptor en otra computadora |
| F1 | Flujo del programa de telemetría de CP2 | Código final confirmado, incluida reconexión fallida |
| E3 | Adquisición y recepción remota de CP2 | Serial y cliente del segundo equipo, condición de luz y tópico |
| G1 | Variación de la lectura ADC durante las condiciones documentadas | Serie real; tiempo registrado o índice explícito; sin lux inferidos |
| E4 | Sistema integrado de CP3 | Selección del vídeo declarado, enlace y diagramas del equipo |
| CP4 | Por definir con su sesión responsable | Estado real y evidencia autorizada; sin reconstrucción |

Próximo paso: seleccionar E2/E3 y aportar las lecturas reales de CP2;
confirmar integrantes y asignar al equipo los apartados experimentales.
No se inventan cifras, curvas, capturas, experiencias ni conclusiones.
Antes de incorporar imágenes, recortar/redactar contraseñas, SSID y datos
privados. Los raw y las configuraciones locales permanecen fuera de Git.

## Fuentes y validación editorial

Se verificaron guía institucional, norma OASIS, documentación de Espressif,
código oficial PubSubClient v2.8 y metadatos/resumen del artículo MQTT-S
en IBM Research (DOI en la bibliografía). El antecedente no constituye una
comparación experimental ni una revisión exhaustiva de literatura.

Sólo se revisa estructura LaTeX, entradas, citas, secretos y diff. No se ha
compilado ni producido PDF en esta sesión. Para una revisión posterior,
usar la instalación LaTeX existente desde este directorio, con IEEEtran,
BibTeX y sus paquetes; no hay imágenes externas obligatorias porque los
huecos se dibujan como recuadros. Revisar paginación al incorporar evidencia.

Rollback: retirar únicamente este directorio en un commit nuevo si hiciera
falta; no restaurar credenciales al código ni reescribir historia.
