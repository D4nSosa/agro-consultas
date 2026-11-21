# Auditoría inicial de fuentes y cobertura nacional

**Corte:** 21 de noviembre de 2026  
**Rama:** `fix/firms-auth-diagnostics-crop-soil-values`  
**Alcance:** diagnóstico de código y documentación pública. No equivale a una certificación de disponibilidad operativa de cada endpoint.

## Regla de lectura

Se separan tres estados: presente en el código, documentado por el proveedor y validación operativa pendiente. Una página de catálogo o un GetCapabilities exitoso no demuestra que la capa entregue píxeles o entidades válidas para todas las provincias.

## Cobertura territorial del producto

El catálogo `data/provincias.json` contiene 24 claves administrativas: las 23 provincias y CABA. La prueba `tests/territorial-recommendations.test.mjs` verifica esa lista y que cada perfil tenga información de referencia de suelo y clima.

Esto verifica perfiles administrativos; **no demuestra que un servicio geoespacial cubra las 24 jurisdicciones**, ni que los perfiles sean mediciones de lote, polígonos parcelarios o cartografía oficial. El adaptador IGN/Georef devuelve centroide provincial, no geometría de límite provincial. La cobertura de cada dataset debe registrarse por separado y no heredarse del catálogo de provincias.

## Matriz de las nueve familias

| Familia | Evidencia encontrada en la rama | Estado de integración | Trabajo pendiente |
|---|---|---|---|
| CONAE | Backend de incendios consulta capas WFS MODIS/VIIRS; documentación menciona capas WFS y productos de incendios. | Parcial | Auditar AQM, combustibles, GOES, GEOAvisos, ISAGRO, SAOCOM, sensores y demás productos uno por uno. |
| MapBiomas Argentina | No se identificó adaptador ni consumidor en el árbol auditado. El portal oficial publica Colección 3 (1985–2025) y assets para GEE; informa que la descarga GeoTIFF directa está temporalmente suspendida y que el acceso por assets requiere cuenta GEE. Los datos se publican bajo CC BY 4.0 con citación. | No integrada | Resolver un acceso programático permitido sin depender de descarga completa nacional ni de credenciales personales; validar leyenda, clases, transiciones, versión y recorte por geometría. |
| IDERA | No se identificó adaptador directo al catálogo IDERA. | No integrada como catálogo | Implementar descubrimiento selectivo; no descargar ni incorporar automáticamente todo el catálogo. |
| IDECorr | No se identificó adaptador en el árbol auditado. | No integrada | Inventariar capas, WMS/WFS, CRS, metadatos, estabilidad y cobertura jurisdiccional. |
| INTA | `services/sources/intaService.js` consulta una capa WMS de suelos mediante GetFeatureInfo. | Parcial y por validar | Confirmar endpoint/capa/formato/atributos, escala, cobertura efectiva y naturaleza cartográfica. Evitar presentar una unidad cartográfica como medición puntual. |
| Sentinel-1 | `backend/main.py` consulta STAC `sentinel-1-grd`, procesa VV/VH y recorta COGs a geometría; expone `POST /api/forest/sar`. | Parcial | Verificar colecciones, assets, calibración/unidades, órbitas, máscaras, escenas y resultados en geometrías nacionales variadas. |
| Sentinel-2 | Servicio forestal y backend consultan Sentinel-2 L2A por STAC y calculan estadísticas ráster cuando existen píxeles válidos. | Parcial | Verificar bandas, escala, nubes/NoData, fechas, colecciones y cobertura nacional con pruebas espaciales. |
| Landsat 8/9 | No se identificó adaptador de consulta directa ni consumidor Landsat específico. | No integrada | Evaluar Landsat Collection 2 y STAC; evitar duplicar Sentinel-2 cuando no aporte archivo histórico o continuidad útil. |
| NASA FIRMS | Backend reciente e histórico MODIS/VIIRS; consulta disponibilidad SP/NRT, divide intervalos y filtra geometría. | Parcial | Mantener sensores/productos separados; probar fechas, cuota, cobertura nacional y duplicaciones con CONAE/GOES. |

## Inventario ampliado de productos CONAE

Este inventario no declara productos integrados.

| Producto / servicio | Evidencia oficial disponible | Decisión preliminar | Verificación pendiente |
|---|---|---|---|
| ISAGRO | CONAE describe productos de humedad, incendios, sequía, heladas y áreas forestadas; indica acceso libre y actualización periódica. | Investigar acceso programático; no asumir API. | Cobertura exacta por producto, resolución, descarga, series y términos actuales. |
| SAOCOM humedad superficial | CONAE publica productos SAOCOM; los mapas integrados describen perfil hasta 50 cm para Región Pampeana. Información pública refiere mapas diarios para cinco provincias pampeanas. | Integrar con limitaciones si existe consulta automatizada permitida. | Producto vigente, provincias efectivas, profundidad, unidades, resolución, frecuencia, API/WMS/descarga y licencia. No extender cobertura pampeana a todo el país. |
| Series de humedad de perfil | Informe de gestión CONAE 2024 describe series hasta 50 cm con frecuencia diaria, semanal y quincenal. | Prioridad alta para Agro. | Confirmar acceso actual, área, fechas, método y metadatos. |
| SAOCOM humedad WMS | El catálogo OGC lista WMS en `geoservicios3.conae.gov.ar`: `HumedadDeSuelos:DSS_MSM_1..7` y krigeado `DSS_MSMKR_1..7`, además de percentiles `DSS_PSM_1..7` y `DSS_PSMKR_1..7`. Describe contenido volumétrico promedio hasta 50 cm por zonas homogéneas; kriging es una variante interpolada. | Prioridad alta, con limitación espacial explícita. | Confirmar cobertura vigente por capa, fecha de cada índice, unidades y documentación. No tratar el producto krigeado como observación puntual ni extrapolar la región pampeana al país entero. |
| SMAP / SMOS | El catálogo OGC lista WMS en `geoservicios2.conae.gov.ar`, con capas ascendentes y descendentes para humedad superficial. | Complemento de escala regional para Agro/Incendios. | Resolución, latencia, cobertura real, unidades, licencia y posibilidad de consulta numérica por geometría. |
| Variación/anomalía de rendimiento | El catálogo OGC lista productos para girasol, trigo, maíz y soja de primera. Variación interanual compara mediana de predicciones con campaña previa; anomalía compara con referencia 1990–2019. Las capas se publican como ventanas numeradas de ocho períodos. El WMS de Cultivos requiere aceptar términos de uso de productos SAOCOM Nivel 2 o superior. | Prioridad alta de investigación para Agro; no es rendimiento medido del lote. | Cobertura de zonas homogéneas, fechas/campañas, términos SAOCOM Nivel 2+, unidad y acceso a valores numéricos. |
| Estatus hídrico / API / CN dinámico | El catálogo OGC lista percentil semanal de API, API diario en mm y Número de Curva Dinámico, con ventanas recientes de siete días. API usa precipitación GPM estimada y descuento por evapotranspiración; CN combina suelo, cobertura y humedad antecedente. | Complemento para Agro e Incendios, con método documentado. | Resolución, cobertura por cuenca, fecha, unidades y coherencia con otras fuentes de precipitación/suelo. Evitar duplicar datos si el módulo ya usa variables equivalentes. |
| Mosaicos provinciales SAOCOM | El catálogo lista WMS/WFS para mosaicos SAOCOM 1A/1B y capas de adquisiciones asociadas, con identificadores provinciales y año. | Candidato de contexto radar y validación visual; no sustituye series de humedad. | Inventario completo de provincias/años, resolución, polarización, licencias y acceso a features/valores. |
| Disponibilidad de combustibles | El catálogo OGC identifica WMS en `geoservicios.conae.gov.ar`: L89 (Landsat 8/9; capas `AlertaTemprana:INC_SIARTIVGEOL89_DC_1..3`) y SNPP-VIIRS (capas `AlertaTemprana:INC_SIARTIVGEOSNPP_DC_1..6`). Son fracciones relativas de vegetación verde, vegetación seca/senescente y suelo descubierto, calculadas por desmezclado espectral. | Prioridad alta para Incendios y Forestal. | Cobertura geográfica, resolución, fecha de cada capa, unidades exactas, licencias y GetFeatureInfo/consulta ráster. El catálogo indica que la documentación del producto está en preparación. |
| GOES / GEOAvisos | Catálogo CONAE lista focos GOES de últimos 10 minutos y 24 horas; el visor GEOAvisos ofrece alertas por área de interés. | Complementar Incendios, sin duplicar FIRMS. | Acceso WFS/WMS/API, atributos, latencia, política de alertas y deduplicación. |
| Red de sensores de humedad | Catálogo CONAE anuncia datos de red telemétrica de humedad y temperatura del suelo. | Integrar como observaciones de estación si existe acceso reutilizable. | Estaciones, coordenadas, variables, unidades, frecuencia, históricos, cobertura, calidad y API. |
| Firmas espectrales | Catálogo CONAE publica biblioteca de firmas; vegetación, suelos y agua requieren registro. | Referencia metodológica/calibración; no es automáticamente una capa de lote. | Acceso permitido, formatos, metadatos, campañas, clases y licencia. |
| Anomalías y variaciones de rendimiento | Producto mencionado en el inventario ampliado. | Pendiente de evidencia técnica suficiente. | Confirmar producto vigente, cultivos, período, cobertura, resolución, método y mecanismo de acceso. |
| Meteogramas WRF | Producto mencionado en el inventario ampliado. | Contexto meteorológico si existe salida automatizable. | Modelo, dominios, resolución, horizonte, variables, frecuencia y acceso. |
| Índice FFDI | Producto mencionado en el inventario ampliado. | Contexto de peligro meteorológico; no equivale a probabilidad de incendio de un lote. | Fuente, formulación, entradas, escala, dominio espacial, frecuencia y licencia. |
| Áreas quemadas AQM | El frontend actual usa WMS `https://geoservicios2.conae.gov.ar/geoserver/EmergenciasCONAE/wms` y capas `EmergenciasCONAE:MODIS_AQM_1..7`; el backend consulta GetCapabilities para poblar metadatos. | Capa de contexto ya visible en Incendios; integración analítica por lote pendiente. | Verificar si GetCapabilities publica efectivamente AQM, qué representa cada ventana mensual, período, resolución, leyenda, CRS y si GetFeatureInfo/descarga permite cuantificar superficie quemada. No asumir que visualizar WMS equivale a calcular área quemada del lote. |

## Referencias oficiales consultadas

- IDERA, geoservicios WMS/WFS/WCS/CSW: https://www.idera.gob.ar/index.php/servicios/geoservicios
- MapBiomas Argentina, descargas y Colección 3 (GeoTIFF directo suspendido temporalmente; GEE requiere cuenta): https://argentina.mapbiomas.org/descargas/mapas-de-la-coleccion/
- MapBiomas Argentina, series históricas: https://argentina.mapbiomas.org/mapas-de-la-coleccion/
- IDECorr, geoservicios: https://ide.corrientes.gob.ar/articulo/geoservicios
- IDECOR, servicios web y APIs: https://www.idecor.gob.ar/web-service-y-apis/
- CONAE, catálogo general: https://catalogos.conae.gov.ar/catalogo/catalogoGeo.html
- CONAE, catálogo WMS/WFS (capas, productos, identificadores y descripciones): https://catalogos.conae.gov.ar/catalogo/catalogoGeoServiciosOGC.html
- CONAE, actualizaciones de productos: https://catalogos.conae.gov.ar/Catalogo/actualizaciones.html
- CONAE, ISAGRO: https://www.argentina.gob.ar/node/87244
- CONAE, SAOCOM: https://www.argentina.gob.ar/ciencia/conae/misiones-espaciales/saocom
- CONAE, humedad integrada: https://www.argentina.gob.ar/ciencia/conae/productos-saocom/mapas-de-humedad-de-suelo-integrado
- CONAE, firmas espectrales: https://catalogos.conae.gov.ar/catalogo/catalogoFir.html
- Copernicus Data Space, STAC: https://documentation.dataspace.copernicus.eu/APIs/STAC.html
- USGS, Landsat STAC: https://www.usgs.gov/landsat-missions/spatiotemporal-asset-catalog-stac
- NASA FIRMS Area API: https://firms.modaps.eosdis.nasa.gov/api/area

## Condiciones para declarar una fuente integrada

Para cada producto se conservará evidencia del endpoint y método de consulta, respuesta HTTP y fecha de prueba, colección/versión, geometría consultada, resultado espacial, cobertura real, resolución/escala, fechas de adquisición/publicación/actualización, CRS, unidades, NoData, calidad, licencia y módulo consumidor.

Un producto visible únicamente en un portal no se considerará integración automatizada. Si no hay acceso permitido o técnicamente viable, se documentará como referencia metodológica o no integrable actualmente.
