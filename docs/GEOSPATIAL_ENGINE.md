# Motor geoespacial bajo demanda

## Alcance

El motor central se integra como infraestructura de backend, no como un módulo de interfaz. La primera capacidad es descubrir escenas satelitales reales mediante STAC para AOI GeoJSON Point, Polygon o MultiPolygon en WGS84, sin limitar la consulta a una localidad.

- `GET /api/engine/capabilities`: proveedores y capacidades declaradas.
- `POST /api/engine/scenes`: descubrimiento de escenas.

Colecciones permitidas:
- `sentinel-1-grd` — AWS Earth Search.
- `sentinel-2-l2a` — AWS Earth Search.
- `landsat-c2-l2` — Microsoft Planetary Computer.

La API usa endpoints allow-listed; el cliente no puede elegir una URL arbitraria. Envía `intersects` con la geometría exacta, nunca `bbox` junto a `intersects`. Cada proveedor se consulta de forma aislada: un error genera estado parcial y no borra los resultados correctos. Las respuestas parciales no se cachean. Las respuestas completas usan caché en memoria de 10 minutos, limitada a 128 entradas por proceso.

## Contrato de salida

Cada escena normaliza identificador, colección, proveedor, fecha, plataforma, modo, polarizaciones, órbita, geometría, bbox, assets y enlaces. Los metadatos de bandas, roles y tamaño se conservan solo cuando el catálogo los publica.

`coverageStatus=INTERSECTS_AOI` significa que la huella reportada por STAC intersecta el AOI. No significa cobertura completa de la parcela ni confirma que un asset sea descargable. La respuesta incluye `hasMore` cuando el catálogo publica paginación siguiente; esta versión informa ese estado, pero no recorre páginas adicionales.

## Procesamiento y límites

Este endpoint descubre y normaliza escenas; no descarga píxeles ni reemplaza procesadores existentes:
- Sentinel-1 continúa por el procesador SAR del módulo Forestal.
- Sentinel-2 y Landsat continúan por el flujo NDVI existente y sus máscaras de calidad.

No declara calibración, RTC, corrección topográfica ni estadísticas raster. La verificación de archivos y el procesamiento se ejecutan en servicios especializados.

Los catálogos son globales y la disponibilidad real se determina por AOI y fecha en cada consulta. Se aceptan geometrías WGS84 válidas; no se infiere pertenencia administrativa a Argentina a partir de un rectángulo envolvente. Cada proveedor tiene timeout de 25 segundos y hasta 100 resultados por colección. La caché es efímera y local al proceso, no compartida entre instancias. Los errores upstream se informan explícitamente, nunca como cero escenas.
