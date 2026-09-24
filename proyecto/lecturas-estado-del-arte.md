# Reparto y resúmenes para el estado del arte — terma Rheem EW1-50RP

Fecha de revisión: 23 de septiembre de 2026. Son los ocho artículos citados en el informe del proyecto, dos por integrante. El reparto sirve para estudiar y exponer; cada quien debe revisar al menos la página enlazada antes de afirmar que leyó el artículo completo. Los resúmenes se elaboraron con el abstract y las secciones accesibles indicadas; Scite no respondió en esta revisión (transporte cerrado), por lo que no se afirma cobertura en Scite.

| Integrante | Fuentes asignadas | Eje para la exposición |
| --- | --- | --- |
| José | Bhati et al. (2017); Booysen et al. (2019) | Necesidad del usuario y control de termas |
| Daniel | Singer et al. (2017); Pirow et al. (2018) | Medición de uso de agua alrededor de la terma |
| Nicolás | Lee y Yim (2021); Tongbai (2024) | Datos de caudal y lectura óptica del visor |
| Sofía | Shen et al. (2021); Marikyan et al. (2019) | Alcance de la automatización e interfaz |

## Textos listos para copiar a WhatsApp

### Para José

**1. Bhati, Hansen y Chan (2017), “Energy conservation through smart homes in a smart city: A lesson for Singapore households”.** [Artículo y PDF académico](https://researchonline.jcu.edu.au/47248/) · DOI: https://doi.org/10.1016/j.enpol.2017.01.032

**Qué estudiaron.** Investigaron cómo perciben los hogares de Singapur las tecnologías domésticas inteligentes y el ahorro de energía. Combinaron revisión de casos con una encuesta; seleccionaron 200 hogares y obtuvieron 131 respuestas válidas. Analizaron conocimiento, actitudes, uso de tecnología y motivos para ahorrar. El artículo observa interés por información detallada sobre los aparatos, pero también una brecha entre la preocupación declarada y las acciones cotidianas. Comodidad, costo y privacidad intervienen en la aceptación.

**Qué nos sirve.** Justifica diseñar una interfaz que ofrezca información comprensible y control útil para la persona, sin asumir que mostrar datos por sí solo cambia hábitos. Nuestro caso ofrece lectura remota del visor, piloto y agua utilizada. **Qué no prueba:** no ensayaron nuestra terma, un pulsador externo ni una reducción de consumo causada por este prototipo. Tampoco debemos citar su interés por datos eléctricos como si nosotros midiéramos kWh.

**Frase para exponer:** “Bhati estudia la perspectiva del usuario: la comodidad y la información importan, pero no podemos prometer ahorro energético solo por poner una app”.

**Base consultada:** versión publicada de 10 páginas alojada por James Cook University, con método y resultados de la encuesta.

**2. Booysen et al. (2019), “How much energy can optimal control of domestic water heating save?”** [Artículo editorial](https://www.sciencedirect.com/science/article/abs/pii/S0973082618306562) · [preprint de los autores](https://engrxiv.org/preprint/download/511/1164) · DOI: https://doi.org/10.1016/j.esd.2019.05.004

**Qué estudiaron.** Formularon el calentamiento doméstico como un problema de control óptimo: elegir cuándo calentar para satisfacer los eventos de uso de agua con menos energía. Utilizaron perfiles de consumo medidos cada minuto en 30 termas durante 20 días en hogares de Sudáfrica (Western Cape, Gauteng y Mpumalanga); con esos datos simularon distintas estrategias frente al termostato habitual. Separaron comparaciones que conservan la temperatura del agua entregada de otras que conservan la energía térmica entregada, porque bajar la temperatura puede aparentar un ahorro distinto. También consideraron pérdidas térmicas y una restricción sanitaria relativa a *Legionella*.

**Qué nos sirve.** Es evidencia de que conocer la demanda y decidir el encendido puede tener valor energético, y explica por qué el caudal es una variable relevante. **Qué no prueba:** sus resultados son de simulación con otros equipos y perfiles; nuestro primer prototipo no implementa control óptimo, no cambia la temperatura objetivo de la Rheem y no mide energía eléctrica. Por tanto, no trasladamos porcentajes de ahorro a nuestra propuesta.

**Frase para exponer:** “Booysen demuestra que el control según uso merece estudiarse, pero nosotros primero resolvemos observación y encendido remoto; medir ahorro sería otra evaluación”.

**Base consultada:** resumen y secciones de método/resultados accesibles en la página editorial y preprint.

### Para Daniel

**3. Singer, Jansen, Wang y Lee (2017), “Non-Invasive Water Flow Sensing for Smart Water Heater Controller”.** [Registro y abstract disponibles](https://www.researchgate.net/publication/322391808_Non-Invasive_Water_Flow_Sensing_for_Smart_Water_Heater_Controller) · DOI: https://doi.org/10.1115/IMECE2017-72021

**Qué estudiaron.** Proponen medir el uso y caudal de agua de una terma sin colocar un medidor en línea. Según el abstract accesible, usan tres sensores de temperatura sobre las superficies de las tuberías de entrada y salida. Relacionan los cambios transitorios de temperatura con el flujo mediante balances de energía y comparan el cálculo con una medición real en un montaje experimental. La motivación es que conocer el uso de agua puede alimentar un controlador de calentamiento ajustado a los hábitos.

**Qué nos sirve.** Muestra que el caudal es una señal pertinente para estudiar una terma y que hay precedentes de sensado desde conexiones externas. **Qué no prueba:** no valida nuestro YF-S201, que mide pulsos Hall y requiere instalarse en una unión hidráulica. El abstract accesible no da una cifra de error verificable; no presentemos una precisión numérica para este trabajo.

**Frase para exponer:** “Singer muestra una alternativa completamente no invasiva para estimar caudal; nosotros elegimos un Hall en unión externa por simplicidad de lectura, aceptando intervenir esa unión”.

**Base consultada:** abstract y metadatos accesibles; texto completo no verificado.

**4. Pirow, Louw y Booysen (2018), “Non-invasive estimation of domestic hot water usage with temperature and vibration sensors”.** [Artículo editorial](https://www.sciencedirect.com/science/article/pii/S0955598618301018) · DOI: https://doi.org/10.1016/j.flowmeasinst.2018.07.003

**Qué estudiaron.** Probaron un sistema que detecta eventos de uso de agua caliente combinando vibración y temperatura medidas por fuera de tuberías de cobre. Su algoritmo separa detección del inicio/fin del evento y estimación de caudal/volumen. En su montaje experimental reportan 95,6 % de acierto para los límites temporales de los eventos, estimación cuantitativa de caudal para flujos mayores de 5 L/min con 89 % de exactitud, y más de 93 % de exactitud del volumen bajo sus condiciones. La propia publicación advierte límites: los eventos muy seguidos necesitan enfriamiento entre usos, y los caudales bajos complican la estimación.

**Qué nos sirve.** Refuerza que medir uso de agua alrededor de una terma es técnicamente relevante y que la ubicación del sensor cambia lo que puede inferirse. **Qué no prueba:** sus cifras no son la precisión del YF-S201 ni del montaje en la casa de Daniel. El nuestro no es “sin tocar tubería”: el caudalímetro va en una unión externa removible.

**Frase para exponer:** “Pirow logra estimar uso sin abrir la tubería, pero con límites por caudal y separación entre eventos; por eso debemos calibrar y declarar exactamente qué mide nuestro sensor”.

**Base consultada:** abstract, resultados y limitaciones visibles en la página editorial.

### Para Nicolás

**5. Lee y Yim (2021), “Energy and flow demand analysis of domestic hot water in an apartment complex using a smart meter”.** [Artículo editorial de acceso abierto](https://www.sciencedirect.com/science/article/pii/S0360544221009270) · DOI: https://doi.org/10.1016/j.energy.2021.120678

**Qué estudiaron.** Instrumentaron el suministro de agua caliente de un complejo con 918 hogares. Sus medidores registraron cada 30 segundos caudal, energía, agua descartada y temperatura en los puntos finales. Analizaron cómo varía la demanda por estación, cómo cambian los picos cuando los datos se agregan en intervalos más largos y si la temperatura exterior previa ayuda a predecir uso estacional. Una conclusión útil es que caudal y energía no son magnitudes intercambiables: la temperatura del agua en el punto de uso también influye.

**Qué nos sirve.** Sustenta registrar caudal y volumen como información sobre uso, y obliga a etiquetar bien la métrica. **Qué no prueba:** un medidor de caudal por sí solo no calcula kWh, ni los patrones de 918 departamentos describen a una sola familia. Nuestra app mostrará agua que pasa por la unión elegida, no consumo eléctrico de la Rheem.

**Frase para exponer:** “Lee y Yim separan caudal, temperatura y energía; nosotros medimos solo el primero y leemos la temperatura que ya muestra el visor”.

**Base consultada:** abstract y resultados destacados en la publicación de acceso abierto.

**6. Tongbai (2024), “Automated calibration system for a digital thermo-hygrometer using image processing approaches and wireless communication”.** [Página de la revista](https://ph03.tci-thaijo.org/index.php/BAS/article/view/624) · DOI: https://doi.org/10.60136/bas.v13.2024.624

**Qué estudió.** Automatizó la lectura de un instrumento digital sin interfaz de comunicación. Una ESP32-CAM captura la imagen; el procesamiento de los dígitos de siete segmentos (SSOCR) ocurre en un servidor web y el resultado aparece en un dashboard. En ese instrumento y montaje, el reconocimiento logró 96,48 % de exactitud media. El aporte es el patrón de arquitectura: cámara barata para capturar un indicador existente, comunicación inalámbrica y reconocimiento fuera de la cámara.

**Qué nos sirve.** Es el precedente más directo para leer el visor de la Rheem sin abrir la terma. **Qué no prueba:** no estudió esa terma, sus reflejos, brillo ni posibles códigos de error. No debemos decir que OCR se ejecuta dentro de la ESP32-CAM ni atribuirle 96,48 % de precisión a nuestro diseño. Habrá que comparar lecturas automáticas con el visor real.

**Frase para exponer:** “Tongbai ya leyó por cámara un display sin interfaz; replicamos la idea de captura y OCR, y validaremos su exactitud en nuestro panel”.

**Base consultada:** abstract y ficha oficial de la revista; PDF disponible allí, sin revisión exhaustiva de todas sus páginas.

### Para Sofía

**7. Shen, Lee, Amadeh y Zhang (2021), “A data-driven electric water heater scheduling and control system”.** [Artículo editorial](https://www.sciencedirect.com/science/article/abs/pii/S0378778821002085) · [manuscrito en repositorio público](https://par.nsf.gov/servlets/purl/10304052) · DOI: https://doi.org/10.1016/j.enbuild.2021.110924

**Qué estudiaron.** Diseñaron un sistema de predicción de demanda de agua caliente y control predictivo robusto (MPC) para una terma central de un edificio multifamiliar. Usaron datos reales de demanda, un modelo térmico de dos estados y simulaciones que consideran incertidumbre. En los días estudiados, el intervalo de predicción cubrió hasta 97 % de la demanda observada y el control simulado redujo el costo eléctrico hasta 33,2 % bajo sus condiciones, manteniendo la temperatura requerida. Su objetivo incluye gestión de demanda y tarifas, no solo encender a distancia.

**Qué nos sirve.** Explica por qué caudal histórico y control podrían habilitar funciones futuras. **Qué no prueba:** esos porcentajes son de un sistema central simulado, no de nuestra terma doméstica ni del servo. La primera versión no tiene predicción, control MPC, cambio remoto de consigna ni estimación de ahorro; solo obtiene datos actuales y pulsa on/off.

**Frase para exponer:** “Shen representa el siguiente nivel de control basado en datos; nuestro alcance se queda deliberadamente en medición y accionamiento verificable”.

**Base consultada:** abstract, introducción y manuscrito público; resultados cuantitativos reportados por los autores.

**8. Marikyan, Papagiannidis y Alamanos (2019), “A systematic review of the smart home literature: A user perspective”.** [Artículo editorial](https://www.sciencedirect.com/science/article/pii/S0040162517315676) · [PDF académico accesible](https://eli.johogo.com/Class/tfsc-2019.pdf) · DOI: https://doi.org/10.1016/j.techfore.2018.08.015

**Qué estudiaron.** Revisaron sistemáticamente publicaciones sobre hogares inteligentes desde la perspectiva del usuario: tipos de servicios, beneficios esperados y barreras de adopción. Entre los beneficios aparecen comodidad, apoyo y control; entre las barreras, usabilidad, complejidad, confiabilidad, privacidad, seguridad y costo. Es una síntesis de trabajos previos, no un experimento sobre una aplicación concreta.

**Qué nos sirve.** Apoya que la app presente estados claros, indique cuando una lectura es incierta y mantenga una interacción simple. El asistente de voz debe limitarse a órdenes explícitas y consultas sobre datos disponibles. **Qué no prueba:** que nuestra voz ahorre energía, que a todos los usuarios les resulte más cómoda o que el prototipo ya sea seguro/confiable. Esas propiedades requieren pruebas propias.

**Frase para exponer:** “Marikyan recuerda que una solución IoT se evalúa también por facilidad de uso y confianza, por eso evitamos que la app invente un estado cuando no puede leer el panel”.

**Base consultada:** texto editorial accesible y PDF de la versión publicada, con secciones sobre beneficios y barreras.

## Acuerdos para la PPT

- Cada integrante explica sus dos artículos con la secuencia: **qué estudió → qué tomamos → qué no demuestra**.
- Las ocho fuentes académicas anteriores cubren el mínimo de dos por integrante; el manual Rheem y las fichas de componentes son soporte técnico adicional, no sustituyen artículos.
- No presentar porcentajes de otros trabajos como resultados de nuestra terma. El prototipo aún debe validar lectura del visor, color del piloto, pulsos por litro y accionamiento del botón.
- La propuesta actual tiene tres sensores (cámara, RGB y caudal) y un actuador (servo). El YF-S201 requiere una unión hidráulica externa; no se abre la terma ni se conmuta su alimentación eléctrica.
