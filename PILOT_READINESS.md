# Nota de alcance para evaluación piloto — Agro-Consultas

**Revisión:** 27 de noviembre de 2026 · **Producción:** commit `e1203bb` (READY).  
**Auditoría operativa vigente:** [docs/PRODUCTION_AUDIT_2026-11-27.md](docs/PRODUCTION_AUDIT_2026-11-27.md).  
La publicación READY no equivale a validación agronómica, prueba de campo ni certificación institucional.\n
**Desarrollo independiente:** Dante Iván Sosa · Gobernador Virasoro, Corrientes, Argentina  
**Demo:** https://agro-consultas.vercel.app  
**Repositorio:** https://github.com/D4nSosa/agro-consultas

## Propósito

Agro-Consultas es una plataforma independiente de consulta territorial agropecuaria y forestal. Este documento describe el alcance técnico del módulo de incendios y del módulo forestal para facilitar una devolución técnica. No se presenta como producto oficial, sistema de alerta pública ni herramienta validada por CONAE, NASA, NOAA u otro organismo.

## Módulo de incendios

- NASA FIRMS: detecciones MODIS y VIIRS recientes.
- NOAA GOES-19 ABI L2 FDCF: capa separada de detección rápida basada en la última escena disponible.
- Geoservicios WFS de CONAE: consulta por lote para capas MODIS y VIIRS, con respaldo FIRMS cuando los servicios no responden.
- CSV históricos: importación y análisis local en el navegador, sin subir el archivo al servidor.
- Open-Meteo: pronóstico diario a tres días y un indicador meteorológico exploratorio.

**Límites:** las detecciones son anomalías térmicas y no confirmaciones de incendio. No se calculan perímetros ni superficie quemada. El indicador meteorológico no es FWI, no incorpora humedad del combustible ni topografía y no predice igniciones ni propagación. Los emparejamientos MODIS/VIIRS son agrupamientos exploratorios, no equivalencias de píxeles ni una metodología oficial.

## Módulo forestal

- Delimitación de lotes mediante geometrías GeoJSON.
- Consulta del catálogo público AWS Earth Search STAC para escenas Sentinel-2 L2A.
- Recuperación de metadatos de adquisición, nubosidad y enlaces a bandas disponibles.
- Cálculo de NDVI solo cuando el backend devuelve estadísticas ráster válidas.
- Carga de evidencia fotográfica y extracción de metadatos EXIF cuando están presentes.
- Formulario de inventario de campo con datos ingresados por el usuario y estimaciones derivadas.

**Límites:** una escena identificada en STAC no significa que el índice se haya calculado. Sentinel-1 SAR aporta retrodispersión, no una medición directa y universal de humedad del suelo o biomasa. El modelo de volumen de campo utiliza un factor de forma fijo de 0,45 en esta versión y requiere calibración por especie, sitio y manejo; no reemplaza un inventario dasométrico.

## Preguntas para una revisión técnica

1. ¿Qué mejoras metodológicas recomendarían para interpretar detecciones MODIS, VIIRS y GOES sin confundir sus características?
2. ¿Qué metadatos y criterios de calidad consideran indispensables para una herramienta de exploración de focos térmicos?
3. ¿Qué protocolos de validación con datos de referencia o trabajo de campo recomendarían?
4. ¿Qué buenas prácticas sugieren para documentar escenas Sentinel-2, índices espectrales y observaciones SAR en aplicaciones forestales?

## Propuesta de colaboración

Se busca recibir observaciones técnicas, orientación sobre fuentes y metodologías, y explorar una posible validación acotada con datos o casos de referencia. Cualquier uso operativo requeriría evaluación adicional, acuerdos de datos y validación por los equipos competentes.

## Trazabilidad

La documentación técnica ampliada del radar se encuentra en [FIRE_MONITORING.md](FIRE_MONITORING.md). Las pruebas automatizadas del repositorio pueden ejecutarse con los comandos indicados en el README. La disponibilidad en vivo de fuentes externas debe comprobarse al momento de cada demostración.


## Ajustes de calidad incorporados — 17 de noviembre de 2026

- Aptitud: la respuesta WMS de INTA se etiqueta como evidencia cartográfica (CARTOGRAPHIC), no como medición puntual (REAL). La clasificación de aptitud continúa exigiendo evidencia comparable; una capa cartográfica no la habilita por sí sola.
- Forestal: una escena Sentinel-2 encontrada en STAC sin estadísticas ráster se presenta como escena identificada, no como NDVI disponible. La reproyección del ROI conserva las partes de MultiPolygon y sus anillos interiores.
- Incendios: la interfaz distingue archivos FIRMS atrasados, fallidos y con antigüedad desconocida; las detecciones de fuentes atrasadas quedan fuera de la capa en vivo. GOES-19 se mantiene como fuente separada.
- Tracking: el GeoJSON incorpora cantidad de muestras y precisión GNSS declarada (mediana y máximo) cuando el dispositivo la informa. La precisión reportada por el teléfono no es exactitud topográfica certificada.

Estos cambios mejoran trazabilidad y comunicación de incertidumbre; no constituyen validación operativa con lotes de campo.
