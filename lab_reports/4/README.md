# LAB4: LoRa P2P

Fuentes LaTeX y procesamiento de mediciones de recepción LoRa.

## Archivos

- `main.tex`: documento principal.
- `main.pdf`: PDF compilado.
- `introduction.tex`, `methodology.tex`, `development_discussion.tex` y `conclusion.tex`: secciones del informe.
- `img/receiver-processing.drawio`: flujo editable del procesamiento del registro receptor.
- `img/receiver-processing.png`: exportación utilizada en el documento.
- `img/lab4-system.drawio` y `.png`: roles funcionales del enlace P2P y del transmisor con MEGA; no son un esquema eléctrico del cableado.
- `img/mega-counter-flow.drawio` y `.png`: flujo del contador y de la función `sendRAK`, trazado a partir del sketch.
- `img/chk1/` y `img/chk2/`: capturas de respuestas AT y eventos de transmisión.
- `img/chk3/`: fotografías del montaje MEGA--RAK y su salida serial.
- `data/lora-numeric.csv`: tiempo relativo, RSSI en dBm y SNR en dB de las 108 observaciones.
- `code/plot_lora.py`: procesamiento y gráficas con Python y matplotlib.
- `references.bib`: referencias bibliográficas.

## Compilación

Con IEEEtran y las dependencias LaTeX instaladas, desde la raíz del repositorio:

```sh
latexmk -cd -pdf -interaction=nonstopmode -halt-on-error 4/main.tex
```

Desde `4/`:

```sh
latexmk -pdf -interaction=nonstopmode -halt-on-error main.tex
```

El resultado es `4/main.pdf`. En Overleaf, seleccionar **`4/main.tex`** como documento principal y **pdfLaTeX** como compilador.

## Gráfica temporal

Con Python y matplotlib, elegir una carpeta de salida nueva:

```sh
python code/plot_lora.py data/lora-numeric.csv --out-dir resultados
```

El script conserva todas las observaciones, expresa el tiempo desde la primera recepción y genera CSV numérico, estadísticas, tabla LaTeX y figuras PNG/SVG/PDF. No interpola los intervalos sin datos ni abre un puerto serial.

## Código del checkpoint 3 y material compartido

- Sketch Arduino MEGA: `code/cp3_lora/cp3_lora.ino`; conserva el contenido de [lora.txt](https://drive.google.com/file/d/1SrnPct0enrU3doz0R0MApW0z8LCoYyoH/view).
- [Carpeta LAB4 en Drive](https://drive.google.com/drive/folders/1rxPscm24PQ41dW3EaSxCHFeebt27BfVf).
- El sketch compartido usa SF12; el código visible en el video usa SF10. Ambos representan un contador, sin sensor.
- `bare_jrnl.tex` conserva el acceso al mismo documento desde el nombre anterior.
