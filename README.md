# Agro-Consultas — Plataforma de consulta territorial agropecuaria y forestal

Agro-Consultas es un desarrollo independiente orientado a explorar información territorial y apoyar el análisis preliminar de áreas agropecuarias y forestales. Integra herramientas de georreferenciación, consulta de fuentes climáticas y edáficas, catálogos satelitales, registro GPS y monitoreo exploratorio de anomalías térmicas.

**Demo pública:** https://agro-consultas.vercel.app  
**Repositorio:** https://github.com/D4nSosa/agro-consultas

> Estado de referencia: documentación revisada el 21 de noviembre de 2026. La publicación de una interfaz o la existencia de un endpoint no implica que todas las fuentes externas estén disponibles en todo momento ni que cada flujo haya sido validado en campo.

## Alcance y estado de los módulos

| Módulo | Alcance implementado | Qué debe tenerse en cuenta |
|---|---|---|
| Aptitud territorial | Catálogos agrícolas y forestales, selección provincial, motor multicriterio y consulta de variables climáticas/edáficas. Se incorpora consulta cartográfica nacional INTA-CIRN de pH a 0–30 y 30–100 cm y capas de suelos afectados por sales. | Los perfiles forestales provinciales se muestran por separado de los agrícolas. Los valores pH son modelos cartográficos de 1 km, no análisis de laboratorio; las clases de salinidad se muestran sin interpretación hasta verificar su leyenda. |
| Forestal | Delimitación de lotes, búsqueda STAC centralizada en backend, Sentinel-2 L2A, NDVI con escala/offset y máscara SCL, Landsat 8/9 C2 L2 mediante Planetary Computer con escala/offset y QA_PIXEL, fallback automático entre sensores y comparación temporal con sensor consistente. Sentinel-1 aporta DN VV/VH crudos. | Landsat se procesa a 30 m y Sentinel-2 a la resolución del activo consultado. Sentinel-1 permanece sin calibración sigma0: no se infiere humedad, biomasa, especie ni sanidad. El NDVI no es medición directa de biomasa ni inventario. El inventario manual usa supuestos orientativos; no es inventario dasométrico validado. |
| Incendios | Vista nacional de anomalías térmicas recientes NASA FIRMS MODIS/VIIRS y GOES-19; consulta por lote; consulta histórica automática NASA FIRMS mediante API en backend, con importación local de CSV como herramienta offline secundaria; previsión meteorológica orientativa. | El histórico integrado consulta automáticamente NASA FIRMS desde el backend mediante `POST /api/fires/history`, selecciona productos SP/NRT según disponibilidad publicada y recorta los resultados a la geometría del lote. La importación CSV permanece como alternativa offline. Un foco satelital no confirma un incendio ni representa un perímetro quemado. |
| Tracking GPS | Geolocalización, registro de recorridos y geometrías, medición de superficie/perímetro y exportación. | El GeoJSON conserva muestras y precisión GNSS declarada (mediana y máximo) cuando el dispositivo la informa. La superficie es estimada y no es una mensura. |
| Selección territorial | Dibujo e importación de polígonos GeoJSON y contexto de lote compartido entre módulos compatibles. | La geometría representa el área de interés; no certifica límites parcelarios ni titularidad. |

## Cobertura nacional

La arquitectura y la validación se diseñan para las 23 provincias y CABA, sin limitarse al NEA. Cada dataset declara su cobertura real, resolución/escala, período y limitaciones. La disponibilidad en una provincia se verifica por producto y no se deduce de que el proveedor tenga un portal nacional.

El muestreo automatizado de INTA-CIRN consultó centroides de las 23 provincias: obtuvo pH válido en 23/23 y NoData en CABA. Esto valida consultas puntuales distribuidas nacionalmente, no cobertura uniforme de cada provincia.

Auditoría técnica y matriz de cobertura: [docs/NATIONAL_SOURCE_AUDIT.md](docs/NATIONAL_SOURCE_AUDIT.md).

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
| NASA FIRMS | Integrado: detecciones MODIS/VIIRS recientes e histórico automático SP/NRT mediante API backend; CSV offline secundario. |
| NOAA GOES-19 Open Data | Integrado: ABI L2 FDCF para alertas térmicas rápidas. |
| CONAE | AQM de áreas quemadas: GetMap PNG y metadatos verificados. WFS de focos y disponibilidad de combustibles/SAOCOM/anomalías: servicios en validación; algunos endpoints presentan timeouts. |
| Sentinel-2 / AWS Earth Search STAC | Integrado: catálogo backend, bandas RED/NIR, escala/offset STAC y máscara SCL. |
| Landsat 8/9 / Microsoft Planetary Computer | Integrado en la rama PR #94: C2 L2, escala/offset, QA_PIXEL y token SAS público temporal; prueba NDVI de punto en Mendoza. |
| Sentinel-1 / AWS Earth Search STAC | Integrado con limitaciones: estadísticas VV/VH en DN crudos; sin calibración sigma0 ni inferencias biofísicas. |
| INTA-CIRN | Integrado en la rama PR #94: pH 0–30/30–100 cm y clases crudas de salinidad; pH modelado 1 km, salinidad pendiente de leyenda. |
| MapBiomas Argentina | No integrada todavía: descarga directa probada respondió 403; GeoServers regionales candidatos en validación y licencia de colección pendiente de resolver. |
| IDERA / IGN / INDEC | Catálogo y geoservicios WMS/WFS identificados; selección de capas nacionales y conexión con mapas existentes pendiente. |
| IDECorr | Servicio identificado; disponibilidad WMS/SSL inestable en las pruebas actuales. |
| Open-Meteo | Geocodificación y pronóstico meteorológico. |
| NASA POWER | Variables climatológicas e históricas de escala de grilla. |
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

En Tracking, cada posición aceptada se conserva junto con la precisión que informa el dispositivo; el resumen muestra mediana y máximo. No se eliminan puntos automáticamente por un umbral arbitrario. En Forestal, una escena STAC sin estadísticas ráster no se considera NDVI disponible.

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
