# Monitoreo de incendios — Agro Consultas

**Revisión:** 27 de noviembre de 2026. El pronóstico meteorológico consulta el punto seleccionado, pero no representa la ubicación GPS ni una detección de incendio. La corrección que desacopla el clic del mapa del marcador verde está en la rama `fix/persistencia-forestal-gps` y queda pendiente de publicación. Estado y limitaciones: [auditoría de producción](docs/PRODUCTION_AUDIT_2026-11-27.md).\n
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

## Análisis histórico integrado

La vista histórica consulta desde Agro Consultas el archivo NASA FIRMS mediante `POST /api/fires/history`. Antes de descargar focos, consulta `data_availability` para obtener las fechas publicadas por cada producto. Para cada familia (MODIS, VIIRS Suomi-NPP, NOAA-20 y NOAA-21), selecciona Standard Processing (`*_SP`) cuando cubre la fecha y Near Real-Time (`*_NRT`) cuando SP todavía no está disponible. No consulta fechas fuera de los rangos publicados. Luego consulta el bounding box del lote y aplica una intersección exacta con la geometría Polygon/MultiPolygon. Los resultados se muestran dentro del módulo, se agregan por año y mes, y se descargan como CSV desde la misma pantalla.

La API FIRMS admite hasta cinco días por solicitud; Agro Consultas divide automáticamente cada tramo en bloques de hasta cinco días y limita cada consulta a 31 días. Requiere la variable de entorno segura `FIRMS_MAP_KEY` en el servidor. La autenticación y la disponibilidad se comprueban sin devolver ni registrar la clave. HTTP 400/403 no se clasifica automáticamente como clave inválida: NASA puede responder por credencial inválida o por límite temporal de transacciones excedido. NASA establece un máximo de 5.000 transacciones por intervalo de 10 minutos y las consultas de varios días pueden consumir varias transacciones. Cuando informa límite agotado, el backend reconoce la clave como configurada, devuelve HTTP 429 con `Retry-After` de hasta 10 minutos y evita repetir solicitudes durante esa ventana en la misma instancia. Los resultados parciales y errores no se almacenan como consultas completas. La caché de histórico en memoria del backend solo conserva respuestas sin errores; en Vercel puede ser efímera por instancia y no constituye almacenamiento persistente. La importación CSV sigue siendo una herramienta secundaria offline.

Se conservan las detecciones con sensor/producto, satélite, fecha y hora UTC, confianza, potencia radiativa y otros atributos disponibles. Los focos son anomalías térmicas, no incendios confirmados ni perímetros quemados. MODIS y VIIRS permanecen separados; sus coincidencias son agrupamientos exploratorios.

Para detalles metodológicos y límites: [NASA FIRMS Area API](https://firms.modaps.eosdis.nasa.gov/api/area/) y [NASA FIRMS API Guide](https://firms.modaps.eosdis.nasa.gov/content/academy/data_api/firms_api_use.html).

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

**Estado de la aplicación:** la consulta de detecciones históricas de focos activos NASA FIRMS está integrada dentro del módulo y se filtra por la geometría del lote. El histórico de focos activos no debe confundirse con las superficies/perímetros quemados de GWIS o CONAE: son productos diferentes y no se suman entre sí.

**Contexto de áreas quemadas:** GWIS/JRC publica series administrativas y productos de áreas quemadas derivados de MODIS MCD64A1. Las series por provincia no permiten atribuir hectáreas quemadas a un lote. La interfaz no debe presentar ese contexto como un resultado parcelario sin una geometría de perímetro o ráster validada.

**Metadatos CONAE:** el módulo consulta GetCapabilities WMS a través de la API propia y presenta título, identificador, resumen y leyenda oficial cuando el servicio los publica. Si no existe resumen o falla el catálogo, se informa la ausencia de metadatos y no se interpreta el ID AQM como una variable conocida.

Fuentes:
- [GWIS — descargas de superficie quemada y perímetros 2002–2025](https://gwis.jrc.ec.europa.eu/apps/country.profile/downloads)
- [GWIS — metodología de áreas quemadas y eventos](https://gwis.jrc.ec.europa.eu/about-gwis/technical-background/burnt-areas)
- [NASA FIRMS — archivo histórico](https://firms.modaps.eosdis.nasa.gov/download/)
- [NASA FIRMS — requisitos de MAP_KEY para API](https://firms.modaps.eosdis.nasa.gov/content/academy/data_api/firms_api_use.html)

## Productos de incendios y combustibles de CONAE: interpretación

La aplicación consume capas WMS del catálogo oficial PROSAT II de CONAE. Los identificadores terminados en _1, _2, etc. se conservan como identificadores de capa; el catálogo consultado no publica una correspondencia explícita entre cada sufijo y un mes o una fracción temática. Por eso la interfaz debe recuperar el título, resumen y leyenda de cada capa desde GetCapabilities y no renombrarlas por inferencia.

- **MODIS AQM (EmergenciasCONAE:MODIS_AQM_1 a MODIS_AQM_13)**: producto mensual de áreas quemadas derivado de NASA MODIS MCD64A1.061, banda Burn_Date. Representa superficie afectada y el día juliano de quemado; no es un foco activo ni un pronóstico de incendio.
- **Disponibilidad de combustibles Landsat 8/9 (AlertaTemprana:INC_SIARTIVGEOL89_DC_1 a _3)**: desmezclado espectral de Landsat 8/9 que estima fracciones relativas de vegetación verde, vegetación seca/senescente y suelo descubierto/superficie no vegetada. Describe composición superficial; no es un índice de peligro ni una predicción de ignición.
- **Disponibilidad de combustibles SNPP-VIIRS (AlertaTemprana:INC_SIARTIVGEOSNPP_DC_1 a _6)**: producto basado en SNPP-VIIRS VNP13A1 con las mismas tres fracciones generales de composición de combustibles.

La simbología de estas capas debe provenir de la leyenda publicada por CONAE para la capa seleccionada. No se debe aplicar una paleta inventada ni interpretar los colores como clases de riesgo sin documentación oficial. Las detecciones MODIS/VIIRS y GOES mantienen colores separados por sensor; son puntos de anomalías térmicas y no polígonos de áreas quemadas.

Fuente primaria: https://catalogos.conae.gov.ar/catalogo/catalogoGeoServiciosProsatII.html y https://catalogos.conae.gov.ar/catalogo/catalogoGeoServiciosOGC.html.

**Estado de verificación WMS:** los metadatos se consultan desde la API de Agro Consultas y la interfaz muestra la leyenda si el servicio la publica. La disponibilidad en vivo de cada WMS debe comprobarse por separado; una respuesta correcta de GetCapabilities no garantiza que GetMap entregue teselas para la extensión y fecha consultadas.

## Persistencia local de preferencias de interfaz

El módulo Incendios guarda únicamente preferencias pequeñas y no sensibles en `localStorage`, mediante `services/userPreferences.js` y la clave versionada `agro_user_preferences_v1`: mapa base, visibilidad de capas, productos CONAE seleccionados y umbral mínimo de confianza. El esquema usa lista permitida y valores predeterminados; datos incompatibles o almacenamiento bloqueado se ignoran sin impedir la carga del módulo. No se guardan claves API, credenciales, geometrías de lotes, respuestas NASA ni históricos en este almacén. El contexto y los proyectos/lotes siguen bajo el contrato existente de `services/lotContext.js`; no se migra ni duplica su persistencia.


Si el WMS de CONAE no responde, el módulo mantiene una explicación general documentada para las capas MODIS MCD64A1.061 Burn_Date y composición de combustibles verde/seco/suelo. La interfaz identifica que la ficha/leyenda de la capa no estuvo disponible y no inventa fecha, valores ni simbología. Los nombres técnicos AQM/DC quedan acompañados por la finalidad del producto.
