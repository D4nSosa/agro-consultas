# Agro Consultas — Plataforma de Inteligencia Territorial Agropecuaria y Forestal

Agro Consultas es una plataforma web profesional de análisis y apoyo a decisiones territoriales que integra datos geoespaciales, climáticos, edáficos, satelitales y de campo para comprender un territorio, evaluar aptitudes, detectar limitantes, monitorear cambios y sustentar proyectos productivos.

---

## 📋 Matriz de Estado de Funcionalidades

| Funcionalidad | Estado | Descripción / Fuente |
| :--- | :--- | :--- |
| **Búsqueda Geográfica y Geocodificación** | ✅ Funcional | Open-Meteo Geocoding API e IGN Georef API con identificación de nivel espacial. |
| **Posicionamiento GPS en Tiempo Real** | ✅ Funcional | Browser Geolocation API con margen de precisión `coords.accuracy` en metros. |
| **Base Agronómica (29 Cultivos)** | ✅ Funcional | Cultivos extensivos, hortícolas, frutícolas, regionales y forestales con requerimientos INTA/INV. |
| **Motor Multicriterio de Aptitud** | ✅ Funcional | Aptitud Alta, Media, Baja o No Evaluable con explicaciones de motivos y limitantes. |
| **Clima Histórico y Comparación** | ✅ Funcional | API Oficial de NASA POWER Climatology con series mensuales y anomalías reales. |
| **Clima en Vivo** | ✅ Funcional | Open-Meteo Forecast API con caché de resiliencia y datos en directo. |
| **Suelos y Cartografía Edafológica** | ✅ Funcional | WMS INTA Cartografía de Suelos 1:50.000 / Subregional. |
| **Fotografías de Campo y EXIF** | ✅ Funcional | Carga batch múltiple, borrado individual, extracción EXIF real y métricas Canvas API. |
| **Vista Dual (Simple vs. Técnica)** | ✅ Funcional | Alternancia entre semáforo ejecutivo (🟢🟡🔴) y detalle técnico cuantitativo. |
| **Mapa de Decisiones e Interactivo** | ✅ Funcional | Leaflet con capas basemaps y leyenda de aptitud agro-ecológica. |
| **Catálogo Satelital Sentinel-2** | ✅ Funcional | Consulta directa en vivo a Copernicus Data Space Ecosystem STAC. |
| **Generación de Informe PDF** | ✅ Funcional | Impresión y descarga de reporte técnico formateado mediante `@media print` CSS. |
| **Cálculo Ráster de Píxeles B04/B08** | ⚠️ Con Limitaciones | Requiere token S3 de Copernicus CDSE para descarga directa de bandas .jp2. |
| **Diagnóstico Fitopatológico IA** | ❌ Pendiente | Se utiliza análisis visual prudente no diagnóstico (*"síntomas compatibles con..."*). |

---

## 🛡️ Principio Fundamental: Cero Datos Ficticios

Agro Consultas trabaja exclusivamente con fuentes reales identificables, datos abiertos oficiales y cálculos reproducibles.

- **Cero ubicaciones de ejemplo predeterminadas:** Al iniciar, la plataforma comienza limpia solicitando la ubicación o geometría real del usuario (`¿Qué querés analizar?`).
- **Cero números ni porcentajes inventados:** Cuando una fuente no está disponible o no cubre las coordenadas seleccionadas, el sistema indica explícitamente **"DATOS NO DISPONIBLES"** o **"EVIDENCIA INSUFFICIENT"** explicando el parámetro faltante.
- **Trazabilidad completa de metadatos:** Cada métrica utilizada reporta su fuente oficial, dataset, API/endpoint, variable, unidad, resolución espacial/temporal, fecha de observación y limitaciones.

---

## 🛠️ Instalación y Ejecución Local

### 1. Servidor Frontend
Debido a restricciones de seguridad del navegador (CORS) en peticiones `fetch` sobre `file://`, la aplicación debe ejecutarse sobre un servidor web local:

```bash
# Iniciar servidor web local en puerto 8000
python3 -m http.server 8000
```
Abrir en el navegador: `http://localhost:8000`

### 2. Backend Geoespacial FastAPI (Opcional)
Para habilitar endpoints REST geoespaciales de teledetección:

```bash
# Instalar dependencias Python
pip install fastapi uvicorn shapely httpx pydantic pytest

# Ejecutar servidor FastAPI
uvicorn backend.main:app --reload --port 8000
```

---

## 🧪 Pruebas y Verificación Automática

Ejecutar la suite de pruebas unitarias y de integridad:

```bash
# Validar esquemas JSON de cultivos y provincias
python3 self_created_tools/validate_datasets.py

# Ejecutar todos los test suites en pytest
python3 -m pytest tests/
```

---

## 📚 Documentación Técnica Adicional

Para más detalles sobre la arquitectura intermedia, especificaciones de APIs, guías para agregar nuevos cultivos o fuentes, consultar [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 📜 Licencia

Este proyecto se encuentra bajo la Licencia MIT. Consulta el archivo [LICENSE.md](LICENSE.md) para más información.
