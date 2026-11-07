# Monitoreo de incendios — Agro-Consultas

## Alcance de esta primera integración

El módulo consume las capas WFS públicas de CONAE:

- `GeoServiciosCONAE:FocosDeCalor` — detecciones MODIS de Aqua/Terra.
- `GeoServiciosCONAE:FocosDeCalorVIIRS` — detecciones VIIRS de SNPP/NOAA-20.

La documentación pública de CONAE describe estas capas como productos de las últimas 24 horas. Por eso la interfaz las presenta como monitoreo reciente y no las usa para construir una climatología histórica ni anomalías multianuales.

## Flujo

1. El usuario define un polígono o multipolígono en el mapa compartido.
2. El cliente calcula su bounding box y consulta ambas capas WFS.
3. Las detecciones se filtran contra la geometría exacta, la confianza mínima seleccionada y los atributos disponibles.
4. Las detecciones se armonizan mediante una regla exploratoria: misma fecha y distancia entre centroides menor o igual a 1.000 m.
5. Los eventos coincidentes se muestran diferenciados de las detecciones observadas por un único sensor.

## Interpretación y límites

- Un foco de calor es una detección satelital; no confirma por sí solo un incendio.
- MODIS y VIIRS tienen resoluciones espaciales y características distintas. El umbral de 1 km es una regla inicial de agrupamiento, no una equivalencia física entre píxeles ni una metodología validada por CONAE.
- La potencia radiativa y la confianza se conservan por sensor; no se suman ni promedian como si fueran magnitudes equivalentes.
- La consulta pagina hasta 5.000 registros por sensor. Si alcanza ese límite, la interfaz advierte que la respuesta es parcial.
- La comparación histórica solicitada por el desafío NASA Space Apps todavía requiere incorporar descargas de archivo y normalizar campañas/fechas de ambos sensores.

## Próxima etapa: histórico MODIS/VIIRS

Evaluar la descarga histórica desde el Catálogo de Focos de Calor y Áreas Quemadas de CONAE y/o NASA FIRMS. Los servicios API de FIRMS requieren un MAP_KEY gratuito; la clave no debe incluirse en el repositorio ni exponerse en código público. Una integración de archivo deberá almacenar datasets versionados, metadatos de procedencia y fechas de actualización antes de habilitar calendarios históricos o anomalías.

## Fuentes

- [Geoservicios OGC de CONAE](https://catalogos.conae.gov.ar/catalogo/catalogoGeoServiciosOGC.html)
- [Consultas interactivas de focos de calor y áreas quemadas](https://catalogos5.conae.gov.ar/catalogofocos/default.aspx)
- [NASA FIRMS — API Map Key](https://firms.modaps.eosdis.nasa.gov/api/map_key)
