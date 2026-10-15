# LAB3: MQTT y ESP32

Informe del laboratorio de Internet of Things (CS5055), con formato IEEEtran.
Fuente principal: `3/main.tex` desde la raíz del repositorio, o `main.tex`
desde este directorio.

| Archivo | Contenido |
|---|---|
| `introduction.tex` | Marco teórico y antecedente de investigación |
| `methodology.tex` | Configuración de adquisición y comunicación de CP2 |
| `development_discussion.tex` | Instalación, pruebas y desarrollo de las experiencias |
| `conclusion.tex` | Conclusiones y recomendaciones |
| `references.bib` | Referencias bibliográficas |
| `img/chk1/` | Capturas de instalación y pruebas de CP1 |
| `checkpoint2/` | Código y configuración de telemetría LDR |

## Compilación

Requiere una distribución TeX con pdfLaTeX, BibTeX, latexmk, la clase
`IEEEtran` y los paquetes utilizados en `main.tex`, incluido español para
`babel`. Desde la raíz del repositorio:

```sh
latexmk -cd -pdf -interaction=nonstopmode -halt-on-error 3/main.tex
```

Desde `3/`:

```sh
latexmk -pdf -interaction=nonstopmode -halt-on-error main.tex
```

El resultado es `3/main.pdf`. En Overleaf, seleccionar **`3/main.tex`** como
documento principal y **pdfLaTeX** como compilador. La compilación completa
incluye BibTeX y las pasadas adicionales para resolver citas y referencias.
Las imágenes se referencian desde `img/`.

## Guía y fuentes

[Sem10_LAB3_MQTT.pdf](https://utec.instructure.com/courses/24674/files/4935950)
contiene la consigna del laboratorio. Las referencias técnicas del informe
incluyen OASIS MQTT 3.1.1, la API ADC de Espressif, PubSubClient 2.8 y el
antecedente MQTT-S de Hunkeler, Truong y Stanford-Clark.
