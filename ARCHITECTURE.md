# Agro Consultas — Arquitectura del Sistema y Especificación Técnica

## 1. Resumen Ejecutivo y Misión
**Agro Consultas** es una plataforma profesional de inteligencia territorial, recomendación agronómica y teledetección forestal de alta integridad para la República Argentina.
El sistema integra servicios oficializados de cartografía de suelos (INTA WMS), datos topográficos e hidrológicos (IGN / Argenmap), series climáticas y alertas en tiempo real (SMN / Open-Meteo) y catálogo STAC oficial de imágenes multiespectrales Sentinel-2 (Copernicus Data Space Ecosystem).

---

## 2. Modelo Unificado de Datos e Integridad Estricta
Para garantizar absoluta transparencia en la toma de decisiones agrícolas y forestales, la plataforma implementa una regla estricta de integridad de datos:

### Estados de Datos (`DATA_STATUS`):
- `real`: Dato puntual o capa GIS oficial verificada sin interpolación.
- `estimated`: Dato derivado mediante modelos meteorológicos u observaciones indirectas.
- `regional`: Cartografía edáfica o climática de escala subregional (ej. 1:500.000 / 1:1.000.000).
- `simulated`: Parámetros ingresados o ajustados libremente por el usuario en el Simulador de Lote.
- `unavailable`: Ausencia de cobertura puntual oficial en la coordenada dada.

### Niveles de Confiabilidad (`CONFIDENCE_LEVELS`):
- `high`: Fuentes de alta resolución espacial con punto WMS verificado.
- `medium`: Mapeo subregional oficial o serie climática interpolada.
- `low`: Ausencia de punto puntual o simulación manual de usuario.
- `none`: Datos no disponibles.

> **Nota:** Se ha eliminado completamente la generación silenciosa de datos sintéticos o falsos fallbacks ("mocks" opacos). Cada variable expone explícitamente su fuente, escala, fecha de consulta, enlace oficial y nivel de incertidumbre.

---

## 3. Arquitectura del Sistema

```
                         +-----------------------------------+
                         |   Cliente Web / Dashboard UI      |
                         | (index, resultados, forestal.html)|
                         +-----------------+-----------------+
                                           |
                +--------------------------+--------------------------+
                |                                                     |
  +-------------v-------------+                         +-------------v-------------+
  | Recommendation Engine JS  |                         |  Módulo Forestal Frontend |
  |   (scoring.js + datos)    |                         |  (satellite & raster JS)  |
  +-------------+-------------+                         +-------------+-------------+
                |                                                     |
  +-------------v-------------+                         +-------------v-------------+
  | Adapters & Sources (ES6)  |                         | FastAPI Python Backend    |
  | INTA WMS, IGN, OpenMeteo  |                         | (STAC search, raster calc)|
  +---------------------------+                         +---------------------------+
```

---

## 4. Estándares GIS e Interoperabilidad
- **Sistemas de Referencia Espacial (CRS):**
  - Standard de Intercambio / Almacenamiento: **WGS 84 (EPSG:4326)**
  - Coordenadas Oficiales de Argentina: **POSGAR 2007 (EPSG:5343)**
- **Formatos Exportables:**
  - GeoJSON (Estándar OGC)
  - Shapefile (vía backend Python / GeoPandas)
  - GeoTIFF / CoG para coberturas de teledetección
  - CSV / JSON para inventarios daseométricos de campo

---

## 5. Teledetección y Diagnóstico Forestal
- **Fórmula NDVI:** $NDVI = \frac{B08_{NIR} - B04_{Red}}{B08_{NIR} + B04_{Red}}$ (Resolución de 10 metros).
- **Detección de Cambios ($ \Delta NDVI $):** $ \Delta NDVI = NDVI_B - NDVI_A $ con umbral configurable de $ \pm 0.15 $.
- **Lenguaje Prudente y Conclusivo:** El sistema no emite afirmaciones categóricas de deforestación ilegal o tala sin validación de campo. Las anomalías en el NDVI son clasificadas como alteración foliar, raleo o estrés hídrico, recomendando inspección terrestre.

---

## 6. Pruebas Automatizadas y Aseguramiento de Calidad
- **Pruebas de Backend (pytest):** Cobertura completa de endpoints REST `/api/forest/*` (STAC search, NDVI calculation, change detection, full analysis).
- **Pruebas Frontend (Playwright):** Verificación de interactividad de mapas Leaflet, geolocalización GPS en tiempo real y simulación de lotes.
