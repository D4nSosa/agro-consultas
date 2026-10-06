# Documentación de Arquitectura Técnica — Agro Consultas

## 1. Visión General y Capas de la Arquitectura

Agro Consultas implementa una arquitectura modular intermedia desacoplada organizada de la siguiente forma:

```
+-----------------------------------------------------------------------+
|                            DATA SOURCES                               |
| (Open-Meteo, NASA POWER, INTA WMS, IGN Georef, Copernicus STAC, SMN)  |
+-----------------------------------------------------------------------+
                                   │
                                   ▼
+-----------------------------------------------------------------------+
|                            DATA PROVIDERS                             |
| (geocodingService, climateService, soilService, nasaPowerService)     |
+-----------------------------------------------------------------------+
                                   │
                                   ▼
+-----------------------------------------------------------------------+
|                            NORMALIZATION                              |
| (dataModel.js - createDataPoint / createMetadata / DataStatus)        |
+-----------------------------------------------------------------------+
                                   │
                                   ▼
+-----------------------------------------------------------------------+
|                           ANALYSIS ENGINE                             |
| (scoring.js - calcularCompatibilidad / recommendationEngine.js)       |
+-----------------------------------------------------------------------+
                                   │
                                   ▼
+-----------------------------------------------------------------------+
|                            RESULT MODEL                               |
| ({ compatibilidad, motivos, riesgos, datosFaltantes, confianza })     |
+-----------------------------------------------------------------------+
                                   │
                                   ▼
+-----------------------------------------------------------------------+
|                                UI / REPORT                            |
| (script.js, resultados.html, forestal.html, @media print PDF Report)   |
+-----------------------------------------------------------------------+
```

---

## 2. Flujo de Datos y Trazabilidad

1. **Adquisición:** Cada proveedor de datos en `services/sources/` consulta APIs oficiales abiertas con mecanismos de caché (`localStorage`) y timeout tolerante.
2. **Normalización:** Los datos crudos se envuelven en estructuras `DataPoint` con metadatos de trazabilidad completa (`createDataPoint` en `utils/dataModel.js`).
3. **Análisis:** El motor de scoring en `utils/scoring.js` evalúa los requerimientos agronómicos del cultivo frente a las propiedades del suelo y clima.
4. **Respuesta Transparente:** Se devuelven listas de motivos favorables, limitantes de terreno e información faltante, evitando la generación de números o porcentajes artificiales.

---

## 3. Fuentes Abiertas e Integradas

| Fuente | Tipo de Servicio | Variable Aportada | Cobertura / Alcance |
| :--- | :--- | :--- | :--- |
| **Open-Meteo** | REST Forecast API | Clima en vivo (Temp, Viento, Condición) | Global / Punto exacto |
| **NASA POWER** | Climatology & Temporal API | Series de precipitación, temperatura, humedad y radiación | Global / Malla 0.5° |
| **INTA Cartografía** | WMS / Datasets | Tipo de suelo, textura, drenaje, pH, limitantes | Argentina / Subregional |
| **IGN Georef** | Geocoding API | Nombres oficiales de localidades, provincias y coordenadas | Argentina |
| **Copernicus CDSE** | STAC API v1 | Catálogo satelital Sentinel-2 L2A (10m) | Global / Polígono Lote |

---

## 4. Guía para Agregar Nuevos Cultivos o Especies

Para incorporar un nuevo cultivo o especie forestal:

1. Abrir `data/cultivos.json` (o `data/forestales.json` para leñosas).
2. Agregar la clave normalizada (minúsculas, sin acentos ni espacios):

```json
"mi_nuevo_cultivo": {
  "nombre": "Mi Nuevo Cultivo",
  "categoria": "Extensivo",
  "descripcion": "Descripción agronómica técnica.",
  "siembra": "Ventana de siembra",
  "cosecha": "Ventana de cosecha",
  "reqSuelo": "Requerimientos de suelo cualitativos.",
  "reqClima": "Requerimientos de clima cualitativos.",
  "variedades": ["Variedad A", "Variedad B"],
  "fuenteVariedades": "INTA / SENASA",
  "rendimientoEstimado": "ESTIMADO: X - Y tn/ha",
  "pino_eucalyptus": false,
  "requerimientos": {
    "suelo": {
      "phMin": 6.0,
      "phMax": 7.5,
      "drenaje": ["bueno", "moderado"],
      "texturas": ["franca", "franco-limosa"]
    },
    "clima": {
      "precipitacionMin": 500,
      "temperaturaMin": 10,
      "temperaturaMax": 30
    }
  }
}
```

3. Incluir el cultivo en las listas regionales correspondientes dentro de `data/provincias.json`.
4. Ejecutar la validación automática: `python3 self_created_tools/validate_datasets.py`.

---

## 5. Pruebas Unitarias y Cobertura

La suite de pruebas en `tests/` verifica:
- `tests/test_integrity.py`: Ausencia de claves erróneas o ficticias.
- `tests/test_scoring.py`: Estructura del dataset de cultivos y provincias.
- `tests/test_image_analysis.py`: Módulo de análisis de imágenes y EXIF.
- `tests/test_forest.py`: Endpoints REST del backend FastAPI en `backend/main.py`.

Comando de ejecución:
```bash
python3 -m pytest tests/
```
