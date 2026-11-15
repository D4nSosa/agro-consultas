# Alcance para evaluación técnica piloto

**Desarrollo independiente:** Dante Iván Sosa  
**Ubicación:** Gobernador Virasoro, Corrientes, Argentina  
**Demo:** https://agro-consultas.vercel.app

## Propósito

Agro-Consultas es una plataforma independiente para explorar información territorial agropecuaria y forestal. Este documento resume qué se puede revisar en los módulos forestal y de incendios y qué aspectos todavía requieren evaluación.

No es un sistema oficial, no constituye una alerta pública y no cuenta con validación institucional atribuible a CONAE, NASA, NOAA, INTA u otro organismo.

## Módulo forestal

El código contempla:

- Delimitación o carga de áreas de interés mediante geometrías GeoJSON.
- Búsqueda de escenas Sentinel-2 L2A en el catálogo AWS Earth Search STAC.
- Consulta de metadatos de adquisición, nubosidad y recursos disponibles.
- Procesamiento ráster para calcular NDVI cuando se dispone de bandas y estadísticas válidas.
- Funciones de análisis de cambios y consulta SAR en el backend.
- Registro de información de campo y evidencia fotográfica, con lectura de metadatos EXIF cuando existen.

**Aspectos que requieren validación:** disponibilidad y calidad de las escenas, cobertura de nubes, alineación de bandas, tratamiento de píxeles sin datos, comportamiento con geometrías reales y contraste de resultados con observaciones de campo. La presencia de una escena en el catálogo no significa que el análisis ráster se haya completado.

Los resultados SAR representan información de retrodispersión. No deben interpretarse como una medición directa y universal de humedad del suelo o biomasa. Las estimaciones de inventario dependen de los datos ingresados y de los supuestos del modelo; no reemplazan un inventario dasométrico realizado y validado en campo.

## Módulo de incendios

El código contempla:

- Detecciones MODIS/VIIRS de NASA FIRMS.
- Una capa independiente basada en el producto NOAA GOES-19 ABI L2 FDCF.
- Consulta de capas WFS de focos térmicos de CONAE, con alternativa FIRMS cuando las consultas configuradas no responden.
- Importación y análisis local de archivos CSV históricos compatibles.
- Consulta de pronóstico meteorológico de Open-Meteo y cálculo de un indicador exploratorio.

**Límites de interpretación:**

- Una detección satelital es una anomalía térmica; no confirma un incendio ni delimita un área quemada.
- MODIS, VIIRS y GOES tienen características y tiempos de observación diferentes. Las capas se presentan por separado.
- Los agrupamientos entre detecciones MODIS/VIIRS son exploratorios; no representan equivalencia física de píxeles ni una metodología oficial.
- El indicador meteorológico utiliza umbrales configurados sobre variables del pronóstico. No es el Fire Weather Index (FWI), no incorpora humedad del combustible ni topografía y no predice ignición o propagación.

## Qué sería útil evaluar

1. Comprobar la disponibilidad, procedencia, fecha y unidades de los datos mostrados.
2. Probar el comportamiento con respuestas vacías, parciales y errores de los proveedores.
3. Contrastar resultados sobre áreas conocidas con datos de referencia y observaciones de campo.
4. Revisar criterios de calidad para escenas Sentinel-2, índices espectrales y productos SAR.
5. Evaluar si las advertencias y limitaciones se entienden correctamente para el uso previsto.

## Propuesta

Se buscan observaciones técnicas y orientación para definir una evaluación acotada con casos o datos de referencia. Cualquier uso operativo requeriría validación específica, revisión por profesionales competentes y acuerdos sobre los datos utilizados.

La documentación técnica del módulo de incendios está en [FIRE_MONITORING.md](FIRE_MONITORING.md). La arquitectura y las pruebas disponibles se describen en [ARCHITECTURE.md](ARCHITECTURE.md) y [README.md](README.md).
