# Agro Consultas — Plataforma de Inteligencia Agrícola y Teledetección Forestal

**Agro Consultas** es una plataforma integral de recomendación de cultivos, análisis territorial de suelos y seguimiento forestal por satélite para la República Argentina.

## 🚀 Características Principales

- **Recomendación de Cultivos con Evidencia y Confiabilidad:** Evalúa la compatibilidad agroambiental de cultivos y especies forestales utilizando datos oficiales de suelo (INTA), clima (SMN / Open-Meteo) y geografía (IGN). Expresa explícitamente el nivel de confiabilidad (Alta, Media, Baja) y la fuente de cada dato.
- **Geolocalización GPS y Ajuste de Alcance:** Botón de ubicación en tiempo real en ambos módulos con radio de análisis configurable (5 km, 15 km, 35 km, 75 km).
- **Módulo Forestal y Teledetección:** Integración directa con el catálogo STAC de Copernicus (Sentinel-2 L2A), cálculo de NDVI (10m), detección de cambios temporales y generación de informes técnicos imprimibles/exportables.
- **Simulador de Lote Agrícola:** Permite modificar interactivamente parámetros de suelo (pH, textura, drenaje, limitantes) para predecir la idoneidad de cultivos en tiempo real.
- **Estándares GIS Profesionales:** Compatibilidad total con EPSG:4326 (WGS 84), EPSG:5343 (POSGAR 2007) y exportación de GeoJSON / datos daseométricos de campo.

## 📖 Arquitectura y Documentación Técnica

Para consultar los detalles sobre el Modelo Unificado de Datos, la API REST en Python y los estándares de trazabilidad, revise el archivo [ARCHITECTURE.md](ARCHITECTURE.md).

## 🛠️ Ejecución Local

1. Servidor HTTP Frontend:
   ```bash
   python3 -m http.server 8000
   ```
2. Servidor Backend REST (Opcional para procesamiento satelital de servidor):
   ```bash
   uvicorn backend.main:app --reload --port 8000
   ```
3. Pruebas Automatizadas:
   ```bash
   python3 -m pytest
   ```

## 📜 Licencia

Este proyecto está bajo la Licencia MIT. Consulta el archivo [LICENSE.md](LICENSE.md) para más detalles.