# Arquitectura y organización del proyecto

Este documento describe la estructura que existe en el repositorio. No implica que todos los proveedores externos estén siempre disponibles ni que todos los recorridos hayan sido validados en producción.

## Componentes principales

| Área | Ubicación | Responsabilidad |
|---|---|---|
| Interfaz | Archivos HTML, `script.js` y `styles.css` | Pantallas, interacción y presentación de resultados. |
| Servicios del frontend | `services/` | Consultas de clima, suelos, geocodificación, contexto de lote, análisis y fuentes externas. |
| Datos de referencia | `data/` | Catálogos de cultivos, especies forestales, regiones y provincias. |
| Modelo y reglas | `utils/` | Normalización, estructura de datos y evaluación de compatibilidad. |
| API geoespacial | `backend/main.py` | Endpoints FastAPI para consultas STAC y procesamiento geoespacial/ráster del módulo forestal. |
| API de incendios | `backend/fire_monitoring.py` | Endpoints para detecciones térmicas y pronóstico meteorológico orientativo. |
| Pruebas | `tests/` y `self_created_tools/` | Pruebas automatizadas y validaciones auxiliares. |

## Flujo general

1. La interfaz recoge una ubicación, un punto o una geometría GeoJSON según el módulo.
2. Los servicios consultan las fuentes configuradas y procesan las respuestas disponibles.
3. Los datos se presentan con sus metadatos cuando el proveedor los entrega. Las respuestas ausentes o incompletas deben mantenerse identificadas como tales.
4. Los motores locales aplican reglas o cálculos específicos del módulo.
5. La interfaz muestra resultados, advertencias y limitaciones para facilitar una evaluación preliminar.

No existe un único motor que convierta todas las fuentes en un diagnóstico integral. Cada módulo tiene su propio flujo y sus propios límites.

## Fuentes identificadas

| Fuente | Uso documentado |
|---|---|
| Open-Meteo | Pronóstico meteorológico y variables climáticas consultadas por los servicios del proyecto. |
| NASA POWER | Variables climáticas e históricas de escala de grilla. |
| INTA | Capas cartográficas de suelos mediante servicios WMS disponibles. |
| IGN Georef | Referencias geográficas y administrativas. |
| AWS Earth Search STAC | Búsqueda de escenas Sentinel-2 L2A. |
| NASA FIRMS | Detecciones térmicas MODIS/VIIRS y datos históricos compatibles. |
| NOAA GOES-19 Open Data | Producto ABI L2 FDCF para detecciones térmicas. |
| Geoservicios CONAE | Capas WFS de focos térmicos cuando el servicio responde. |

La integración técnica no implica convenio, certificación ni respaldo de las instituciones proveedoras. La cobertura, resolución, fecha, disponibilidad y condiciones de uso dependen de cada fuente.

## Contexto de lote

`services/lotContext.js` permite compartir un área de interés (AOI) entre módulos compatibles. La geometría se maneja como GeoJSON en WGS84 y se conserva en el almacenamiento del navegador para facilitar la navegación entre páginas.

Un punto GPS no equivale a un polígono ni define una superficie. La geometría dibujada o importada por el usuario tampoco certifica límites catastrales, titularidad ni mensura.

## Reglas de interpretación

- Una consulta puntual no debe presentarse como estadística de todo el polígono.
- Una capa cartográfica de suelos no reemplaza un muestreo ni un análisis de laboratorio.
- Encontrar una escena satelital no significa que se haya calculado un índice.
- Un índice espectral no equivale a un inventario forestal de campo.
- Una detección térmica no confirma por sí sola un incendio.
- Los valores calculados por reglas propias deben identificarse como indicadores exploratorios, no como índices oficiales.
- La ausencia de datos debe mostrarse como ausencia o resultado no evaluable, no como condición favorable.

## Pruebas y validación

El repositorio incluye pruebas automatizadas para integridad de datos, reglas de análisis, contexto de lote, endpoints forestales y de incendios, y partes de la interfaz.

Para ejecutar las pruebas principales:

```bash
python -m pytest tests/ -q
node --experimental-default-type=module --test tests/lotContext.test.mjs tests/fireMonitoring.test.mjs
```

Una ejecución correcta de pruebas automatizadas no demuestra por sí sola que los proveedores externos estén disponibles, que la interfaz funcione en todos los dispositivos ni que los resultados sean adecuados para una decisión productiva. Esas condiciones requieren pruebas funcionales y contraste con datos o mediciones de referencia.
