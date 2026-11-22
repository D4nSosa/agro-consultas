# Motor geoespacial bajo demanda

## Alcance

El motor central se integra como infraestructura de backend, no como un módulo de interfaz. La primera capacidad es descubrir escenas satelitales reales mediante STAC para AOI GeoJSON Point, Polygon o MultiPolygon en WGS84, sin limitar la consulta a una localidad.

- `GET /api/engine/capabilities`: proveedores y capacidades declaradas.
- `POST /api/engine/scenes`: descubrimiento de escenas.
- `POST /api/engine/process`: procesa un ID de escena concreto mediante el procesador especializado existente.
- `POST /api/engine/analyze`: despacha análisis territoriales GAEZ, GFW, Hansen, drivers GFW/WRI y JRC a sus servicios especializados existentes.
- `GET /api/engine/sources`: expone el catálogo de fuentes oficiales existente.
- `GET /api/engine/ogc/{provider}/{service}`: consulta GetCapabilities mediante la lista permitida de proveedores existente.
- `GET /api/engine/mapbiomas/tiles/{year}`: delega la obtención de teselas de MapBiomas Argentina.

Colecciones permitidas:
- `sentinel-1-grd` — AWS Earth Search.
- `sentinel-2-l2a` — AWS Earth Search.
- `landsat-c2-l2` — Microsoft Planetary Computer.

La API usa endpoints allow-listed; el cliente no puede elegir una URL arbitraria. Envía `intersects` con la geometría exacta, nunca `bbox` junto a `intersects`. Cada proveedor se consulta de forma aislada: un error genera estado parcial y no borra los resultados correctos. Las respuestas parciales no se cachean. Las respuestas completas usan caché en memoria de 10 minutos, limitada a 128 entradas por proceso. Las colecciones se consultan en paralelo y se siguen hasta cinco páginas por colección; los enlaces de paginación deben permanecer en el mismo origen HTTPS autorizado.

## Contrato de salida

Cada escena normaliza identificador, colección, proveedor, fecha, plataforma, modo, polarizaciones, órbita, geometría, bbox, assets y enlaces. Conserva bandas, roles, tamaño, checksum, GSD y referencias de proyección cuando el catálogo los publica. Los assets S3 de Sentinel-1 se preservan solo para el bucket público esperado; no se aceptan esquemas o referencias arbitrarias.

`coverageStatus=INTERSECTS_AOI` significa que la huella reportada por STAC intersecta el AOI. No significa cobertura completa de la parcela ni confirma que un asset sea descargable. La respuesta incluye `hasMore` si el catálogo aún tiene páginas luego del máximo de cinco páginas leídas por colección. Las colecciones se consultan en paralelo y los enlaces de paginación se limitan al mismo origen HTTPS del catálogo.

## Procesamiento y límites

El descubrimiento y el procesamiento son operaciones separadas. `/scenes` no descarga píxeles. `/process` vuelve a localizar el ID exacto en el catálogo y delega la lectura de los assets al procesador existente:
- Sentinel-1 continúa por el procesador SAR del módulo Forestal.
- Sentinel-2 y Landsat continúan por el flujo NDVI existente y sus máscaras de calidad.

Para Sentinel-1, `/process` utiliza el procesador SAR existente y devuelve Sigma0 elipsoidal, sin declarar RTC ni corrección topográfica. Para Sentinel-2 y Landsat, utiliza el procesador NDVI existente y sus máscaras SCL/QA_PIXEL. `assetAccessVerified=true` solo se devuelve cuando el procesador leyó los assets necesarios y produjo píxeles válidos; no implica que todos los assets opcionales de la escena hayan sido descargados.

Los catálogos son globales y la disponibilidad real se determina por AOI y fecha en cada consulta. Se aceptan geometrías WGS84 válidas; no se infiere pertenencia administrativa a Argentina a partir de un rectángulo envolvente. Cada proveedor tiene timeout de 25 segundos y hasta 100 resultados por colección. El procesamiento se limita a una escena por solicitud y queda sujeto a los límites de tiempo y memoria del despliegue. `/analyze` centraliza el despacho de GAEZ, GFW, Hansen, GFW Drivers y JRC sin duplicar sus cálculos, autenticación ni reglas de procedencia. Los adaptadores OGC y MapBiomas conservan sus propias validaciones y cachés. La caché de escenas es efímera y local al proceso, no compartida entre instancias. Los errores upstream se informan explícitamente, nunca como cero escenas.
