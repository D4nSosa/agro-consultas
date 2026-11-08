# Monitoreo de incendios — Agro Consultas

## Vista nacional y fuentes recientes

La página `incendios.html` muestra detecciones recientes sobre Argentina y su entorno. Los datos se sirven desde dos endpoints independientes para evitar restricciones CORS del navegador:

- `GET /api/fires/national`: NASA FIRMS, archivos públicos CSV de las últimas 24 horas para Sudamérica. Incluye MODIS C6.1 y VIIRS de Suomi-NPP, NOAA-20 y NOAA-21. Se recorta a la extensión geográfica de Argentina y su entorno; los archivos fuente cubren Sudamérica.
- `GET /api/fires/goes`: última escena disponible del producto NOAA GOES-19 ABI L2 FDCF (Full Disk Fire/Hot Spot Characterization). Se transforma la máscara de fuego a puntos geográficos y se conservan categoría, hora, potencia radiativa (MW), temperatura (K) y área del píxel (m²) cuando están disponibles. La cadencia nominal es aproximadamente 10 minutos.

NASA FIRMS se actualiza con los archivos públicos de 24 horas; GOES-19 se consulta de nuevo cada diez minutos desde la interfaz. Las respuestas se cachean brevemente en el backend. Las capas permanecen separadas: GOES es una alerta rápida y no se fusiona con MODIS/VIIRS como si fueran detecciones equivalentes.

## Consulta por lote y respaldo ante HTTP 400

El análisis por lote intenta primero los WFS de CONAE:

- `GeoServiciosCONAE:FocosDeCalor` (MODIS).
- `GeoServiciosCONAE:FocosDeCalorVIIRS` (VIIRS).

Si ambas capas fallan (incluido HTTP 400), la página consulta NASA FIRMS y filtra las detecciones por la geometría del lote. El error del WFS deja de bloquear el módulo. GOES-19 se filtra por separado para mostrar alertas rápidas dentro del lote. El servidor alternativo `geoservicios2` no se usa como sustituto porque su catálogo WFS no publica las capas de focos requeridas.

## Análisis histórico

La vista histórica acepta archivos CSV detallados de CONAE y NASA FIRMS. El procesamiento ocurre localmente en el navegador: filtra puntos por la geometría del lote, aplica el filtro de confianza cuando el valor es numérico y calcula totales anuales y mensuales separados por MODIS y VIIRS. Los CSV no se suben al servidor.

Para obtener CSV de CONAE, abrir [Consultas Interactivas: Incendios](https://catalogos5.conae.gov.ar/catalogofocos/default.aspx), elegir satélites, período y área, seleccionar salida **Detalle** y formato CSV. La descarga requiere una cuenta CONAE. No usar las salidas **Totalizar** para el mapa de puntos.

## Interpretación y límites

- Un foco de calor es una anomalía térmica satelital, no una confirmación de incendio ni un perímetro de área quemada.
- Los conteos MODIS y VIIRS se conservan separados. El agrupamiento exploratorio de eventos coincidentes usa mismo día y distancia máxima de 1.000 metros; no es una metodología oficial ni una equivalencia física de píxeles.
- Las categorías FIRMS `low`, `nominal` y `high` se conservan como etiquetas; no se convierten artificialmente en porcentajes.
- GOES-19 no entrega el mismo campo de confianza que MODIS/VIIRS. Se muestra su clase de máscara y los atributos disponibles, sin inventar confianza.
- El recorte nacional usa una extensión geográfica rectangular que incluye zonas limítrofes; el mapa se titula Argentina y entorno para no presentarlo como un límite político exacto.
- La escena GOES corresponde al último archivo FDCF disponible; puede no ser una escena de exactamente diez minutos antes si el producto o la distribución sufren demoras.

## Referencias

- [Geoservicios OGC de CONAE](https://catalogos.conae.gov.ar/catalogo/catalogoGeoServiciosOGC.html)
- [Consultas Interactivas de Incendios — CONAE](https://catalogos5.conae.gov.ar/catalogofocos/default.aspx)
- [NASA FIRMS — Active Fire Data](https://firms.modaps.eosdis.nasa.gov/active_fire/)
- [NASA FIRMS — Archive Download](https://firms.modaps.eosdis.nasa.gov/download/)
- [NOAA GOES Open Data — GOES-19](https://noaa-goes19.s3.amazonaws.com/)


## Previsión meteorológica integrada

La interfaz permite seleccionar una coordenada directamente en el mapa o utilizar el centro aproximado del lote compartido. El endpoint GET /api/fires/forecast?lat={lat}&lon={lon} consulta el pronóstico diario de Open-Meteo para tres días y devuelve temperatura máxima, humedad relativa mínima, precipitación acumulada, viento máximo y ráfagas.

Se calcula un indicador operativo orientativo de 0 a 100 con cuatro condiciones transparentes (25 puntos cada una): temperatura máxima >= 30 °C, humedad mínima <= 30 %, viento máximo >= 20 km/h y precipitación <= 1 mm. Los rangos son Bajo (0), Moderado (25), Alto (50) y Muy alto (75–100).

Este indicador NO es el Fire Weather Index (FWI) oficial, no integra humedad del combustible ni topografía, no predice igniciones y no sustituye a los organismos de emergencia. Describe solamente condiciones meteorológicas favorables al fuego para apoyar la exploración territorial. Si falta una variable, esa condición no suma puntos y se conserva como dato no informado en la respuesta.
