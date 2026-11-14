# Agro-Consultas — Plataforma de consulta territorial agropecuaria y forestal

Agro-Consultas es un desarrollo independiente orientado a explorar información territorial y apoyar el análisis preliminar de áreas agropecuarias y forestales. Integra herramientas de georreferenciación, consulta de fuentes climáticas y edáficas, catálogos satelitales, registro GPS y monitoreo exploratorio de anomalías térmicas.

**Demo pública:** https://agro-consultas.vercel.app  
**Repositorio:** https://github.com/D4nSosa/agro-consultas

> Estado de referencia: documentación revisada el 14 de noviembre de 2026. La publicación de una interfaz o la existencia de un endpoint no implica que todas las fuentes externas estén disponibles en todo momento ni que cada flujo haya sido validado en campo.

## Alcance y estado de los módulos

| Módulo | Alcance implementado | Qué debe tenerse en cuenta |
|---|---|---|
| Aptitud de cultivos | Catálogo de perfiles, selección territorial, motor multicriterio y consulta de variables climáticas/edáficas. | Algunas consultas de clima y suelos son puntuales y usan una coordenada representativa del área. No son estadísticas zonales ni sustituyen análisis de laboratorio o asesoramiento agronómico. |
| Forestal | Delimitación de lotes, búsqueda de escenas Sentinel-2 L2A mediante AWS Earth Search STAC, metadatos, análisis NDVI cuando existen estadísticas ráster válidas, evidencia fotográfica y registro de variables de campo. | La identificación de una escena no significa que el NDVI haya sido calculado. El inventario manual usa supuestos orientativos; no es inventario dasométrico validado. |
| Incendios | Vista nacional de anomalías térmicas recientes NASA FIRMS MODIS/VIIRS y GOES-19; consulta por lote; importación local de CSV históricos; previsión meteorológica orientativa. | Un foco satelital no confirma un incendio ni representa un perímetro quemado. El indicador meteorológico no es FWI y no predice igniciones o propagación. |
| Tracking GPS | Geolocalización, registro de recorridos y geometrías, medición de superficie/perímetro y exportación. | La precisión depende del dispositivo, la recepción GNSS y las condiciones de campo. |
| Selección territorial | Dibujo e importación de polígonos GeoJSON y contexto de lote compartido entre módulos compatibles. | La geometría representa el área de interés; no certifica límites parcelarios ni titularidad. |

## Monitoreo de incendios

La vista de incendios presenta capas independientes:

- **NASA FIRMS MODIS/VIIRS:** detecciones de los archivos públicos NRT de las últimas 24 horas para Sudamérica, recortadas a Argentina y su entorno.
- **NOAA GOES-19 ABI L2 FDCF:** última escena disponible, con atributos que pueden incluir categoría, hora, potencia radiativa, temperatura y área de píxel.
- **Consulta por lote:** intenta utilizar los servicios WFS de CONAE para MODIS y VIIRS. Si ambas consultas fallan, utiliza FIRMS como alternativa y filtra por la geometría del lote. GOES se consulta por separado.
- **Histórico:** permite importar CSV detallados de CONAE o NASA FIRMS. El procesamiento del archivo se realiza en el navegador; el CSV no se carga al servidor.
- **Meteorología:** consulta el pronóstico de Open-Meteo para tres días y calcula un indicador orientativo basado en cuatro umbrales transparentes: temperatura máxima, humedad relativa mínima, viento máximo y precipitación.

Los sensores se mantienen separados porque sus resoluciones, tiempos de observación y atributos no son equivalentes. Los agrupamientos MODIS/VIIRS son exploratorios: mismo día y distancia máxima de 1 km, sin representar equivalencia física de píxeles ni una metodología oficial.

El indicador meteorológico suma hasta 25 puntos por cada condición disponible que supere el umbral configurado. Si faltan todas las variables, devuelve “No evaluable”. No es el Fire Weather Index (FWI), no incorpora humedad del combustible ni topografía y no estima probabilidad de ignición, velocidad o dirección de propagación.

Documentación detallada: [FIRE_MONITORING.md](FIRE_MONITORING.md).

## Fuentes y servicios identificados en el código

| Fuente | Uso |
|---|---|
| NASA FIRMS | Detecciones de anomalías térmicas MODIS/VIIRS y archivos históricos importados por el usuario. |
| NOAA GOES-19 Open Data | Producto ABI L2 FDCF para alertas térmicas rápidas. |
| Geoservicios OGC de CONAE | Capas WFS de focos MODIS y VIIRS cuando responden correctamente. |
| AWS Earth Search STAC | Catálogo público de escenas Sentinel-2 L2A. |
| Open-Meteo | Geocodificación y pronóstico meteorológico. |
| NASA POWER | Variables climatológicas e históricas de escala de grilla. |
| INTA | Servicios cartográficos de suelos consultados mediante WMS, con alcance según la capa disponible. |
| IGN Georef | Referencias geográficas y geocodificación administrativa. |

La disponibilidad, latencia, cobertura, licencias y condiciones de uso de cada proveedor deben comprobarse para cada caso de aplicación. La presencia de una fuente en el código no constituye aval institucional ni convenio con el organismo proveedor.

## Principios de interpretación

1. No convertir datos faltantes en valores favorables ni completar observaciones ausentes con valores ficticios.
2. Distinguir observaciones, estimaciones derivadas y datos ingresados por el usuario.
3. Mostrar fuente, fecha, unidad y limitaciones cuando esos metadatos estén disponibles.
4. No presentar detecciones satelitales como incendios confirmados.
5. No presentar índices espectrales como inventarios de campo ni estimaciones como mediciones directas.
6. Identificar expresamente cuando una consulta puntual representa un área mediante un centroide o coordenada de referencia.

## Validación y estado operativo

El repositorio incluye pruebas automatizadas de integridad de datos, contexto GeoJSON, servicios de incendios, endpoints forestales y sintaxis de módulos del frontend. La ejecución de CI no reemplaza una prueba funcional de punta a punta con datos externos actuales, dispositivos móviles y geometrías reales.

Para una evaluación piloto se recomienda validar:
- disponibilidad y tiempos de respuesta de cada fuente;
- consistencia de fechas, coordenadas, unidades y metadatos;
- comportamiento ante respuestas vacías, parciales y errores HTTP;
- resultados sobre lotes conocidos y comparaciones con observaciones de campo;
- usabilidad en teléfonos y conectividad limitada.

## Instalación local

Frontend estático:

```bash
python3 -m http.server 8000
```

Backend FastAPI (cuando se necesiten los endpoints geoespaciales):

```bash
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000
```

Pruebas:

```bash
python self_created_tools/validate_datasets.py
python -m pytest tests/ -q
node --experimental-default-type=module --test tests/lotContext.test.mjs tests/fireMonitoring.test.mjs
```

## Licencia

El repositorio incluye licencia MIT. Revisar las condiciones de cada fuente de datos y servicio externo por separado.
