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

La vista histórica acepta archivos CSV detallados de CONAE y NASA FIRMS. El procesamiento ocurre localmente en el navegador: permite consultar el conjunto importado completo aunque no haya un lote seleccionado, o filtrar por la geometría del lote; aplica el filtro de confianza cuando el valor es numérico y calcula totales anuales y mensuales separados por MODIS y VIIRS. Los CSV no se suben al servidor. Se informan las filas descartadas y se conservan detecciones con sensor no identificado como `UNKNOWN`, sin asignarlas artificialmente a MODIS o VIIRS. Las coincidencias MODIS/VIIRS se muestran como agrupamientos exploratorios y no sustituyen los conteos originales.

Para obtener CSV de CONAE, abrir [Consultas Interactivas: Incendios](https://catalogos5.conae.gov.ar/catalogofocos/default.aspx), elegir satélites, período y área, seleccionar salida **Detalle** y formato CSV. La descarga requiere una cuenta CONAE. No usar las salidas **Totalizar** para el mapa de puntos.

## Interpretación y límites

- La respuesta meteorológica solo calcula el indicador cuando existe al menos una variable; con todas las variables ausentes devuelve “No evaluable”, nunca “Bajo”. Si hay datos parciales, el resultado informa cuántas de las cuatro condiciones están disponibles.
- La capa GOES-19 limita la salida a 2.500 candidatos por escena. Si supera ese límite, muestrea de forma distribuida a lo largo de la secuencia completa y expone `totalCandidates` y `truncated`; no representa el total de detecciones.

- Un foco de calor es una anomalía térmica satelital, no una confirmación de incendio ni un perímetro de área quemada.
- Los conteos MODIS y VIIRS se conservan separados. Para proponer coincidencias, se generan candidatos del mismo día dentro de 1.000 m y se asignan primero los pares espacialmente más cercanos, sin reutilizar una detección. Es un agrupamiento exploratorio, no una metodología oficial ni una equivalencia física de píxeles.
- Cada grupo conserva plataforma, hora UTC, confianza y potencia radiativa por sensor cuando la fuente los informa.
- Las categorías FIRMS `low`, `nominal` y `high` se conservan como etiquetas textuales; no se convierten a porcentajes. El filtro numérico de confianza solo puede evaluar fuentes que entregan un valor numérico.
- FIRMS NRT (near real-time) y los productos estándar de archivo tienen tiempos de disponibilidad y finalidades distintas: este módulo consume los CSV públicos NRT de 24 horas; el histórico importado debe documentar el producto y la fecha de descarga.
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


## Frescura de las fuentes en vivo

La respuesta nacional informa el estado de cada archivo FIRMS cuando el proveedor expone su cabecera de actualización. Las fuentes cuya antigüedad supera el umbral de vigencia configurado se marcan como atrasadas y sus detecciones no se incorporan a la capa en vivo; la interfaz identifica cuáles fueron excluidas. Si el proveedor no informa una fecha de actualización, la frescura se muestra como desconocida y no se interpreta como confirmación de actualidad. GOES-19 se informa por separado porque su última escena disponible tiene otro ciclo y otra metodología. Una fuente atrasada o ausente no equivale a ausencia de focos.


## Alcance histórico disponible y evolución prevista

**Estado actual de la aplicación:** el apartado Histórico procesa CSV detallados que el usuario importa desde CONAE o NASA FIRMS. No consulta automáticamente un archivo histórico remoto; por eso el panel aparece vacío hasta que se cargan datos. Los archivos se procesan localmente.

**Fuente abierta adecuada para contexto provincial:** el servicio Global Wildfire Information System (GWIS) / Joint Research Centre publica series mensuales de superficie quemada derivadas de MODIS MCD64A1 para países y unidades administrativas subnacionales (GADM nivel 1), con cobertura 2002–2025 en su descarga global. También publica un conjunto de perímetros individuales de incendios 2002–2025 derivado de MCD64A1. La serie administrativa permite construir gráficos por provincia y año/mes; no permite atribuir hectáreas quemadas a un lote particular. Los perímetros requieren una consulta espacial separada y conservan las limitaciones de resolución y detección del producto.

**Para detecciones históricas de focos activos:** NASA FIRMS ofrece Archive Download para datos de más de siete días; el acceso a los servicios de API requiere una MAP_KEY gratuita y las descargas del archivo requieren registro Earthdata. No se debe asumir que el feed NRT de 24 horas equivale a un archivo histórico.

Implementación recomendada:
1. Incorporar primero la serie GWIS de superficie quemada por provincia (contexto administrativo), con fuente, producto, rango temporal y fecha de actualización visibles.
2. Mantener separadas las detecciones MODIS/VIIRS y las superficies/perímetros quemados; son productos distintos y no deben sumarse como si fueran la misma variable.
3. Añadir consulta por lote únicamente cuando se disponga de geometrías de perímetros o ráster de superficie quemada con cobertura y resolución verificadas. No convertir estadísticas provinciales en resultados del lote.
4. Ofrecer importación FIRMS/CONAE como vía de detalle para focos históricos, indicando fuente, sensor, período y filas descartadas.

Fuentes:
- [GWIS — descargas de superficie quemada y perímetros 2002–2025](https://gwis.jrc.ec.europa.eu/apps/country.profile/downloads)
- [GWIS — metodología de áreas quemadas y eventos](https://gwis.jrc.ec.europa.eu/about-gwis/technical-background/burnt-areas)
- [NASA FIRMS — archivo histórico](https://firms.modaps.eosdis.nasa.gov/download/)
- [NASA FIRMS — requisitos de MAP_KEY para API](https://firms.modaps.eosdis.nasa.gov/content/academy/data_api/firms_api_use.html)
