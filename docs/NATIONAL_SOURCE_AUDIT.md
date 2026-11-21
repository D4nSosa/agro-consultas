# Auditoría inicial de fuentes y cobertura nacional

**Corte:** 21 de noviembre de 2026  
**Rama:** `fix/firms-auth-diagnostics-crop-soil-values`  
**Alcance:** diagnóstico de código y documentación pública. No equivale a una certificación de disponibilidad operativa de cada endpoint.

## Regla de lectura

Se separan tres estados: presente en el código, documentado por el proveedor y validación operativa pendiente. Una página de catálogo o un GetCapabilities exitoso no demuestra que la capa entregue píxeles o entidades válidas para todas las provincias.

## Hallazgos transversales de código y condiciones de publicación

- **Límite de uso de APIs públicas:** no se encontró un limitador distribuido por IP/cliente en las rutas costosas. En particular, `POST /api/fires/history` utiliza `FIRMS_MAP_KEY` del servidor y puede disparar varias transacciones NASA por solicitud; limita el período a 31 días, pero no limita explícitamente el área ni la frecuencia del solicitante. Antes de abrir tráfico sostenido debe configurarse rate limiting en el borde o un almacén compartido, y un límite de superficie/consultas. Un contador en memoria de una Function serverless no sería una protección suficiente.
- **Otras rutas de consumo:** NDVI, SAR, cambios forestales, análisis territorial y consultas INTA también realizan trabajo o llamadas externas sin una política compartida de cuota por cliente. Deben quedar bajo la misma política de protección.
- **Pruebas de fuentes:** `live_source_smoke.py` es deliberadamente observacional: genera un informe y no falla el workflow por cada proveedor inaccesible. Un job verde significa que el informe se produjo; no significa que CONAE, MapBiomas, IDECorr o INDEC estén disponibles. Las pruebas que exigen datos reales de proveedores dentro de `pytest` también deben aislarse de las pruebas unitarias deterministas para evitar fallos intermitentes.
- **Higiene del repositorio:** se retiró `server.log`, que contenía registros locales de navegación y coordenadas, y se agregaron exclusiones para logs y artefactos generados.
- **Rutas FastAPI:** se detectó y eliminó un registro duplicado de `POST /api/forest/stac`; se agregó una prueba que impide volver a registrarlo dos veces.
- **Comparación ráster:** la comparación píxel a píxel ahora exige CRS y transformada explícitos e idénticos en ambas fechas. Si falta cualquiera de esos metadatos, el resultado conserva la comparación de medias, pero no declara disponibilidad espacial.
- **CONAE WFS:** la consulta directa usada por la interfaz ahora tiene timeout y aborta si el proveedor no responde; se añadió una prueba del timeout y un smoke test contra el endpoint exacto de la interfaz.
- **INTA:** los valores ráster no finitos se descartan antes de construir la respuesta; un NaN/Infinity no puede convertirse en una clase de salinidad válida ni contaminar JSON.

## Cobertura territorial del producto

El catálogo `data/provincias.json` contiene 24 claves administrativas: las 23 provincias y CABA. La prueba `tests/territorial-recommendations.test.mjs` verifica esa lista y que cada perfil tenga información de referencia de suelo y clima.

Esto verifica perfiles administrativos; **no demuestra que un servicio geoespacial cubra las 24 jurisdicciones**, ni que los perfiles sean mediciones de lote, polígonos parcelarios o cartografía oficial. El adaptador IGN/Georef devuelve centroide provincial, no geometría de límite provincial. La cobertura de cada dataset debe registrarse por separado y no heredarse del catálogo de provincias.

## Matriz de las nueve familias

| Familia | Evidencia encontrada en la rama | Estado de integración | Trabajo pendiente |
|---|---|---|---|
| CONAE | Incendios: AQM y WFS de focos existentes. El nuevo catálogo publica productos SAOCOM de humedad de perfil (7 capas), percentiles y SMAP/SMOS; el visor intenta descubrir sus WMS mediante GetCapabilities y solo registra capas devueltas por el proveedor. | Integración funcional de focos/AQM + descubrimiento WMS de humedad; consulta de valores por lote pendiente de validar GetFeatureInfo y fechas de capa. | Verificar combustibles, GOES/GEOAvisos, ISAGRO, sensores, anomalías y rendimientos; validar SAOCOM por fecha, escala, leyenda y cobertura antes de usar valores en cálculos. |
| MapBiomas Argentina | El catálogo compartido expone metadatos de Colección 3 (1985–2025, 30 m, 18 clases), licencia CC BY 4.0 y enlaces oficiales. El visor integra teselas XYZ anuales de la Colección 3 a través de la API pública de la plataforma y capas contextuales del workspace MapBiomas Argentina vía WMS. El backend descubre subtema, años, leyenda y URL de teselas; valida que el host sea `earthengine.googleapis.com`, cachea por año y no acepta URLs arbitrarias. La capa anual es visual y no calcula estadísticas zonales por lote. | Integrada como teselas XYZ anuales de la Colección 3 (1985–2025, 30 m) y capas contextuales WMS de Argentina; visualización disponible, estadísticas zonales de lote pendientes. | Para estadísticas zonales y exportación de assets se requiere el flujo autorizado de MapBiomas/GEE. Confirmar la licencia específica de la colección antes de redistribuir productos derivados. No sustituir C3 por C2 ni producir estadísticas ficticias. |
| IDERA | Nuevo adaptador consulta el registro abierto idera/geoservicios y normaliza organismos relevantes (IGN, INTA, INDEC, CONAE, SENASA, Ambiente y jurisdicciones). Las entradas se marcan como catálogo, no como servicio vivo verificado. Se agregaron endpoints OGC allowlisted para IGN e INTA y el visor descubre capas temáticas disponibles. | Integrada como catálogo dinámico + descubrimiento OGC selectivo; no se descarga el catálogo completo ni se confunde registro con disponibilidad. | Revisar servicios restantes por organismo/capa y sumar solo los que tengan cobertura, licencia y atributos útiles verificados. |
| IDECorr | Se añadió descubrimiento WMS allowlisted contra el endpoint provincial publicado y el visor registra capas temáticas si GetCapabilities responde. La cobertura queda restringida a Corrientes. | Integración de descubrimiento WMS; capas reales y cobertura dependen de la respuesta en vivo. | Validar en CI GetCapabilities, CRS, capas, bounding boxes, leyendas y muestras GetFeatureInfo; no extrapolar fuera de Corrientes. |
| INTA | `services/sources/intaService.js` consulta el backend `/api/soil/inta`; este consulta cuatro capas nacionales pH 0–30/30–100 cm y suelos afectados por sales del nodo `geo-nodo05`. Los centroides de 23 provincias devolvieron pH dentro de rango; CABA devolvió sentinel 100/NoData. | Integrada con limitaciones: cartografía puntual/modelada, pixel pH de 1 km; salinidad aún sin interpretación | Mantener la distinción entre pH cartográfico y análisis de laboratorio; interpretar clases de salinidad solo después de verificar leyenda/metadatos. La consulta del centroide no es estadística zonal del lote. |
| Sentinel-1 | `backend/main.py` consulta STAC `sentinel-1-grd`, procesa VV/VH y recorta COGs a geometría; expone `POST /api/forest/sar`. | Integrada con limitaciones: DN crudos sin calibración sigma0 | No convertir DN en humedad/biomasa/especie/sanidad; validar assets y cobertura por geometría/fecha antes de cada análisis. |
| Sentinel-2 | Backend consulta Sentinel-2 L2A por STAC, preserva escala/offset publicados y calcula NDVI con máscara SCL cuando hay píxeles válidos. | Integrada con limitaciones de escena, nubes y disponibilidad | Seguir validando fechas, bandas, máscara, NoData, resolución y cobertura por geometría; no inferir biomasa ni sanidad a partir de NDVI. |
| Landsat 8/9 | Backend consulta `landsat-c2-l2` mediante Microsoft Planetary Computer, filtra Landsat 8/9, firma assets con SAS público temporal y calcula NDVI con escala/offset y QA_PIXEL. | Integrada en la rama PR #94, con prueba de lectura de asset y procesamiento puntual | Validar polígonos, rangos temporales, assets y QA_PIXEL en más geografías; no exponer ni registrar tokens SAS. Atribuir a USGS y conservar la licencia del producto fuente verificada. |
| NASA FIRMS | Backend reciente MODIS/VIIRS y consulta histórica automática SP/NRT; valida disponibilidad publicada, divide intervalos, filtra detecciones por geometría y diagnostica autenticación/cuota. | Integrada con requisito de `FIRMS_MAP_KEY` para histórico; feeds recientes separados por sensor | Mantener separación entre detección térmica, incendio confirmado y perímetro quemado; proteger la cuota de la clave con límites de uso del endpoint público. |

## Red de geoservicios INTA descubierta mediante el monitor IDERA

El monitor IDERA registra un WMS central y una red de nodos regionales. Los estados de disponibilidad siguientes son los publicados por el monitor, no resultados propios de la plataforma:

| Nodo | Dominio territorial publicado | Endpoint WMS |
|---|---|---|
| Central | INTA nacional | https://geo-backend.inta.gob.ar/geoserver/ows |
| 01 | Salta y Jujuy | https://geo-nodo01.inta.gob.ar/geoserver/wms |
| 02 | Santiago del Estero y Tucumán | https://geo-nodo02.inta.gob.ar/geoserver/wms |
| 03 | Entre Ríos | https://geo-nodo03.inta.gob.ar/geoserver/wms |
| 04 | Río Negro y Neuquén | https://geo-nodo04.inta.gob.ar/geoserver/wms |
| 05 | Centro de Investigación de Recursos Naturales | https://geo-nodo05.inta.gob.ar/geoserver/wms |
| 06 | Santa Cruz, Chubut y Tierra del Fuego | https://geo-nodo06.inta.gob.ar/geoserver/wms |
| 07 | Buenos Aires | https://geo-nodo07.inta.gob.ar/geoserver/wms |
| 08 | Córdoba | https://geo-nodo08.inta.gob.ar/geoserver/wms |
| 09 | Corrientes | https://geo-nodo09.inta.gob.ar/geoserver/wms |
| 10 | Santa Fe | https://geo-nodo10.inta.gob.ar/geoserver/wms |
| 11 | Catamarca y La Rioja | https://geo-nodo11.inta.gob.ar/geoserver/wms |
| 12 | Mendoza y San Juan | https://geo-nodo12.inta.gob.ar/geoserver/wms |

El monitor marcaba los nodos regionales consultados como activos y con 100% de fiabilidad en sus períodos publicados. El nodo central también figura activo, aunque el runner de GitHub Actions tuvo timeout al consultar sus capacidades. La red regional no cubre por sí sola todas las provincias: Chaco, Formosa, Misiones, San Luis, La Pampa y CABA no aparecen en la lista de dominios regionales de esta tabla. Para esas jurisdicciones debe probarse el nodo central u otras capas oficiales; no asignarles un nodo regional por inferencia.

La integración no debe asumir que todos los nodos publican la misma capa ni el mismo esquema de atributos. Cada nodo requiere GetCapabilities, lista de capas, CRS, bounding boxes, escala, GetFeatureInfo de muestra y validación de cobertura. La prueba añadida a GitHub Actions consulta los 12 WMS regionales por separado.

Fuentes del monitor:
- INTA central: https://controlserviciosidera.iado-conicet.gob.ar/resource/466?lang=es_BO
- INTA Corrientes: https://controlserviciosidera.iado-conicet.gob.ar/resource/495?lang=es_BO
- INTA Buenos Aires: https://controlserviciosidera.iado-conicet.gob.ar/resource/487?lang=es_BO
- INTA Salta/Jujuy: https://controlserviciosidera.iado-conicet.gob.ar/resource/501?lang=es_BO
- Listado INTA: https://controlserviciosidera.iado-conicet.gob.ar/resources?lang=es_BO&tag=INTA

## Hallazgo INTA nacional: pH y suelos afectados por sales

El nodo WMS del Centro de Investigación de Recursos Naturales de INTA (`https://geo-nodo05.inta.gob.ar/geoserver/wms`) publica cuatro capas nacionales queryable:

| Capa | Profundidad | Cobertura publicada | Resolución / calidad |
|---|---|---|---|
| `geonode:ph_0_30_nuevo_recorte_m_4d4cbbd459875375ae3e856e2870841f` | 0–30 cm | Argentina; bounding box WMS aprox. lon -74.83 a -48.56, lat -55.11 a -21.57 | Pixel 1 km; RMSE 0,84; R² 0,456 |
| `geonode:ph_30_100_nuevo_recorte_m_cbccd7b512bb4f943ad9672e961bee3d` | 30–100 cm | Argentina; bounding box WMS aprox. lon -74.52 a -47.17, lat -56.12 a -21.35 | Pixel 1 km; RMSE 0,80; R² 0,523 |
| `geonode:suelos_salinos_0_30_recorte_9622e0e127b7ae1d157c7f49d41605f3` | 0–30 cm | Argentina; bounding box WMS equivalente al producto nacional publicado | Resolución y métricas no informadas en Abstract WMS |
| `geonode:suelos_salinos_30_100_recorte_437dcf998c66ee96455f4cb196eda5b1` | 30–100 cm | Argentina; bounding box WMS equivalente al producto nacional publicado | Resolución y métricas no informadas en Abstract WMS |

Las cuatro capas anuncian `queryable=1` y CRS `EPSG:4326` / `CRS:84`. El pH se describe como mapa modelado con pixel de 1 km y métricas de ajuste; no es análisis de laboratorio ni medición del lote. Los productos de salinidad tampoco deben interpretarse como diagnóstico de campo. Se integrarán como cartografía/modelos de referencia, mostrando profundidad, resolución y calidad cuando estén publicadas.

La ejecución de GitHub Actions del 21/11/2026 consultó GetFeatureInfo para las cuatro capas en los centroides de las 24 jurisdicciones y obtuvo cuatro features por punto. Los valores pH fueron válidos en las 23 provincias; CABA devolvió 100, tratado como sentinel/NoData. Las clases crudas de salinidad (incluidos 0/1/2) se conservan sin interpretación agronómica hasta validar la leyenda. Esto confirma consultas puntuales, no cobertura uniforme ni estadísticas de lote.

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
- IDECorr, geoservicios: https://ide.corrientes.gob.ar/articulo/geoservicios (portal; respuesta HTTP 403 desde GitHub Actions en la primera prueba)
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

## Corrección radiométrica Sentinel-2 L2A

La consulta STAC real de Earth Search para `sentinel-2-l2a` devuelve assets COG con esta calibración:
- RED (`red` / B04): resolución 10 m, escala 0.0001, offset -0.1.
- NIR (`nir` / B08): resolución 10 m, escala 0.0001, offset -0.1.
- SCL: clasificación de calidad a 20 m.

El cálculo anterior aplicaba NDVI directamente a DN enteros. Como el offset es distinto de cero, esa operación altera el cociente y produce valores incorrectos. La rama PR #94 ahora conserva la escala/offset publicados por STAC y calcula NDVI sobre reflectancia calibrada antes de combinar bandas. También exige SCL, aplica remuestreo nearest-neighbour para la máscara y excluye NoData, píxeles saturados/defectuosos, sombras, nubes y nieve.

La búsqueda STAC usa `intersects` con la geometría exacta del lote, en vez de seleccionar escenas solo por bbox. El rango de fallback histórico termina en la fecha solicitada y no selecciona escenas futuras.

La corrección se prueba con valores de referencia sintéticos y con metadatos STAC simulados; la consulta real de las 24 jurisdicciones se verifica aparte en GitHub Actions.

### Resultado de muestreo nacional INTA-CIRN (24 jurisdicciones)

En la ejecución de GitHub Actions del 21/11/2026, GetFeatureInfo devolvió valores pH válidos en los centroides de las 23 provincias y NoData en CABA. El muestreo no prueba cobertura completa de cada provincia, pero sí confirma consulta puntual en todas las provincias:

- pH 0–30 cm: 23/23 provincias; mínimo 4,93, máximo 8,58, mediana 7,59.
- pH 30–100 cm: 23/23 provincias; mínimo 5,10, máximo 8,54, mediana 7,99.
- CABA: el WMS devuelve 100, tratado como sentinel/NoData y no como valor pH.
- Suelos afectados por sales 0–30 cm: valores crudos 0 (18 puntos), 1 (1 punto), 2 (4 puntos).
- Suelos afectados por sales 30–100 cm: valores crudos 0 (16 puntos), 1 (2 puntos), 2 (5 puntos).

Los valores de salinidad permanecen sin interpretación hasta leer la leyenda oficial. Los valores pH se presentan como estimaciones/modelos cartográficos con pixel de 1 km, RMSE 0,84 / 0,80 y R² 0,456 / 0,523; no son análisis de laboratorio ni deben usarse como mediciones puntuales del lote.

## MapBiomas: capas contextuales y restricciones de cobertura anual

La página oficial de descarga indica que la descarga GeoTIFF directa está temporalmente suspendida y que los assets de Google Earth Engine requieren cuenta. La Collection 2 2024 tiene una URL pública documentada, pero el probe HTTP Range desde GitHub Actions respondió 403. Esto no prueba que la colección sea inexistente: sí demuestra que el acceso automatizado probado no está disponible desde el runner.

Se investigan los siguientes GeoServers públicos candidatos:
- https://maps.alerta.mapbiomas.org/geoserver/ows
- https://geoserver.layers.mapbiomas.org/geoserver/ows
- https://shared-geoserver.mapbiomas.org/geoserver/ows

La validación del 21/11/2026 confirmó que la API pública de MapBiomas Argentina expone el subtema anual de cobertura de Colección 3, con 41 años (1985–2025), leyenda de 25 clases y teselas `image/png` HTTP 200 desde `earthengine.googleapis.com`. El backend incorpora `/api/sources/mapbiomas/tiles/{year}` y el visor añade la capa anual 2025 apagada por defecto. Las teselas son visuales: no son estadísticas zonales ni valores medidos del lote.

Además, el WMS `https://shared-geoserver.mapbiomas.org/geoserver/ows` responde HTTP 200 y publica capas del workspace `mapbiomas-argentina`, entre ellas `vegetation_unit`, `ecorregion`, `regiones_forestales`, `national_protected_areas` y `subnational_protected_areas`. Se integran como capas contextuales apagadas por defecto, con atribución y alcance explícitos.

Los workspaces `mapbiomas-arida`, `mapbiomas-pampa` y `mapbiomas-chaco` incluyen capas regionales de años/productos diferentes. No se publican como si fueran una serie nacional homogénea. La integración anual nacional de la Colección 3 sigue pendiente de acceso autenticado o endpoint estable documentado.

Hay una discrepancia de licencia entre las páginas oficiales consultadas: la página de descargas indica CC BY 4.0; la FAQ de datos públicos indica CC BY-SA. Debe confirmarse la licencia específica de cada colección/producto antes de redistribuir mapas o productos derivados. Hasta entonces se conserva atribución y no se redistribuye el ráster.

## Contrato técnico de Landsat Collection 2 Level-2

La colección STAC `landsat-c2-l2` es global y contiene productos Level-2 de Landsat 4–9. Para la integración solicitada se filtrarán Landsat 8 y 9, no se mezclarán automáticamente sensores históricos distintos.

Metadatos publicados por Earth Search:
- Bandas de reflectancia superficial: `red` y `nir08`.
- Resolución espacial de esas bandas: 30 m.
- Escala de reflectancia: 0.0000275.
- Offset de reflectancia: -0.2.
- Control de calidad: `qa_pixel` (bitmask) y `qa_radsat`.
- Producto: Collection 2 Level-2 Surface Reflectance / Surface Temperature.

La fórmula NDVI debe aplicarse a reflectancias escaladas:
`RED = DN × 0.0000275 − 0.2`
`NIR = DN × 0.0000275 − 0.2`
`NDVI = (NIR − RED) / (NIR + RED)`

No calcular NDVI directamente sobre DN enteros porque el offset no se cancela en el cociente. La máscara QA_PIXEL debe excluir relleno, nubes dilatadas, cirrus, nube, sombra de nube y nieve según la definición oficial de bits. La resolución reportada será 30 m, no 10 m.

El catálogo STAC muestra `license=proprietary`, en conflicto con la política oficial de USGS que declara los productos Landsat como dominio público, de uso sin restricciones, y solicita atribución al USGS. La integración debe conservar la procedencia del proveedor y registrar la discrepancia del agregador, no copiar su valor de licencia sin contrastarlo.

Referencias:
- Earth Search Collection: https://earth-search.aws.element84.com/v1/collections/landsat-c2-l2
- USGS Landsat Collection 2 Level-2: https://www.usgs.gov/landsat-missions/landsat-collection-2-level-2-science-products
- USGS Surface Reflectance (resolución global 30 m y sensores): https://www.usgs.gov/landsat-missions/landsat-collection-2-surface-reflectance
- USGS licencia/dominio público en la nube: https://www.usgs.gov/faqs/are-landsat-data-cloud-still-considered-be-within-public-domain

### Sentinel-1: corrección del nivel de dato

El STAC item de ejemplo de Earth Search para `sentinel-1-grd` publica assets VV/VH como COG `uint16`, NoData 0 y sin `scale` ni `offset` radiométrico en `raster:bands`. Los assets apuntan a mediciones GRD de Sentinel-1 L1C. Referencia del esquema STAC: https://github.com/stac-extensions/sentinel-1/blob/main/examples/earthsearch-s1-grd.json

La implementación anterior convertía DN a dB con una constante fija de -83 dB y asignaba valores artificiales cuando DN era cero. No existía evidencia en los metadatos consultados que justificara esa calibración constante. Se eliminó esa conversión y los valores por defecto.

La rama ahora conserva estadísticas VV/VH en DN crudos, identifica `RAW_DN_UNCALIBRATED` y no calcula diferencias VH−VV en dB ni infiere humedad, biomasa, especie, sanidad o estructura forestal. No aplica calibración sigma0 ni corrección de terreno. Por tanto, los DN no deben compararse como magnitudes físicas entre escenas/órbitas. La fuente se mantiene como observación real con limitaciones, no como producto biofísico calibrado.

Para ofrecer sigma0 comparable será necesario un producto con calibración documentada o implementar el flujo de calibración con LUT de Sentinel-1 y validación radiométrica/geométrica; no se reintroducirá un factor fijo.

### Centralización de consultas STAC del módulo Forestal

El cliente frontend `forestal/services/satelliteService.js` dejó de consultar Earth Search directamente. Ahora consume `POST /api/forest/stac`, que aplica geometría exacta `intersects`, filtro temporal y nubosidad, y devuelve metadatos radiométricos y activos. Esto evita mantener dos implementaciones STAC con filtros y resoluciones diferentes.

El buscador histórico de escenas termina siempre en la fecha objetivo; no incorpora escenas futuras para completar una ventana.

### Integración Landsat 8/9 en la rama PR #94

La rama ya incorpora el adaptador STAC para `landsat-c2-l2` mediante Microsoft Planetary Computer, filtrando `platform=landsat-8` y `platform=landsat-9`, con activos RED, NIR (`nir08`) y QA_PIXEL. La búsqueda utiliza `intersects` con la geometría exacta. Earth Search devolvió assets en un bucket AWS Requester Pays y la lectura anónima falló; por eso el adaptador usa Planetary Computer, cuyo STAC es público y ofrece tokens SAS anónimos de corta duración para leer los COGs. El backend firma los tres assets necesarios y cachea el token; no se exponen credenciales permanentes.

El procesador NDVI:
- Aplica escala 0.0000275 y offset -0.2 a RED y NIR antes de calcular NDVI.
- Enmascara QA_PIXEL bits 0–5 (fill, nube dilatada, cirrus, nube, sombra y nieve).
- Informa resolución 30 m, sensor, colección, producto, fecha, porcentaje de nubes, máscara aplicada y limitaciones.
- Permite fallback automático desde Sentinel-2 a Landsat cuando no hay píxeles válidos.
- En comparaciones temporales, fuerza la misma colección/sensor para ambas fechas; no compara Sentinel-2 contra Landsat.

El fallback no usa escenas posteriores a la fecha solicitada. Se prueban hasta cinco escenas ordenadas por nubosidad para encontrar píxeles válidos. Los datos Landsat C2 L2 son de dominio público USGS; se conserva atribución al proveedor.

## Primera validación en vivo desde GitHub Actions

**Ejecución:** https://github.com/D4nSosa/agro-consultas/actions/runs/44901226369  
**Fecha de consulta:** 21 de noviembre de 2026.  
**Artefacto:** `national-source-smoke-report`.

Resultados de esa ejecución:

- Earth Search `/collections`: HTTP 200; el catálogo devolvió `sentinel-1-grd`, `sentinel-2-l2a` y `landsat-c2-l2`.
- Búsquedas STAC separadas por colección, con fecha 2025 y punto en el centroide de cada jurisdicción: las tres colecciones devolvieron al menos un ítem en las 24 jurisdicciones. Esto demuestra disponibilidad de escenas en esos puntos y período; no certifica cobertura completa de cada provincia ni disponibilidad en cualquier fecha/lote.
- CONAE AQM MODIS: GetCapabilities HTTP 200 y 31 nombres de capas; se identificaron `MODIS_AQM_1` a `MODIS_AQM_13`. En ese documento los nombres aparecen sin el prefijo de workspace. GetMap respondió HTTP 200 con PNG válido tanto para `MODIS_AQM_1` como para `EmergenciasCONAE:MODIS_AQM_1`; el frontend actual usa el nombre calificado y no requiere cambio por este motivo.
- CONAE Focos MODIS/VIIRS, disponibilidad de combustibles, humedad SAOCOM y capas de cultivos: los GetCapabilities agotaron el timeout de 12 segundos desde el runner de GitHub Actions. Se registra como timeout en esa ejecución, no como inexistencia del producto.
- INTA: `https://geo-backend.inta.gob.ar/geoserver/ows` agotó el timeout de lectura; el endpoint antiguo `geoserver.inta.gob.ar` no resolvió DNS. El monitor IDERA publicó una prueba exitosa del servicio central INTA el 20/11/2026; ambas observaciones deben reconciliarse antes de cambiar el adaptador.
- IDERA: portal HTTP 200. IDECorr: portal HTTP 403 desde el runner. El monitor de geoservicios consultado listaba IDECorr con 0% de disponibilidad en su vista del 21/11/2026.
- MapBiomas: portal de descargas HTTP 200. Esto no demuestra que el ráster pueda leerse por HTTP Range ni que la colección más reciente esté disponible sin GEE.
- NASA FIRMS: no se probó en CI porque la API key permanece como secreto del backend.

La consulta STAC se corrigió para consultar cada colección de forma independiente. La primera versión combinaba tres colecciones y limitaba a tres resultados, lo que sesgaba la detección de colecciones por punto; no se utilizan esos resultados para conclusiones de cobertura por sensor.

## Segunda validación en vivo: valores de píxel y servicios WMS

**Ejecución:** https://github.com/D4nSosa/agro-consultas/actions/runs/44901860577  
**Fecha:** 21 de noviembre de 2026.  
**Artefacto:** `national-source-smoke-report`.

Resultados:

- CONAE AQM: GetMap respondió HTTP 200 y PNG válido con el nombre de capa `MODIS_AQM_1` y también con `EmergenciasCONAE:MODIS_AQM_1`. Ambos formatos de nombre son aceptados por el servidor.
- CONAE AQM GetFeatureInfo: 24/24 centroides jurisdiccionales respondieron HTTP 200 y devolvieron un valor `AQM=0` en la capa `MODIS_AQM_1`. Esto describe únicamente el píxel consultado en el producto mensual más reciente disponible (2026-09); no demuestra ausencia de áreas quemadas en toda la provincia ni en el lote.
- INTA-CIRN GetFeatureInfo: 24/24 centroides respondieron HTTP 200 y devolvieron cuatro features, correspondientes a pH 0–30 cm, pH 30–100 cm y las dos capas de suelos afectados por sales.
- Los valores pH de los puntos válidos se devolvieron en `GRAY_INDEX`; el punto de CABA devolvió 100 en ambas capas pH, fuera del rango físico de pH, por lo que debe tratarse como NoData y no como pH 100.
- Las capas de suelos afectados por sales devolvieron valores `GRAY_INDEX` 0, 1, 2 y -9999. Hasta verificar leyenda y valor NoData, deben conservarse como valores/clases crudas, sin asignarles significado agronómico ni unidad.
- Los resultados confirman que las capas nacionales INTA son consultables en puntos de las 24 jurisdicciones. No convierten el dato cartográfico en una medición del lote; la consulta actual es un muestreo puntual del centroide.

## Condiciones para declarar una fuente integrada

Para cada producto se conservará evidencia del endpoint y método de consulta, respuesta HTTP y fecha de prueba, colección/versión, geometría consultada, resultado espacial, cobertura real, resolución/escala, fechas de adquisición/publicación/actualización, CRS, unidades, NoData, calidad, licencia y módulo consumidor.

Un producto visible únicamente en un portal no se considerará integración automatizada. Si no hay acceso permitido o técnicamente viable, se documentará como referencia metodológica o no integrable actualmente.

## Integración compartida de catálogo y capas OGC (PR #94)

Se incorporó backend/source_catalog.py y se montó en FastAPI bajo /api/sources:

- GET /api/sources/catalog: catálogo de referencia MapBiomas, productos CONAE, IDECOR/IDECorr y registro IDERA descargado desde el repositorio público idera/geoservicios. El registro se cachea seis horas y sus entradas se etiquetan CATALOG_ENTRY_NOT_LIVE_VERIFIED.
- GET /api/sources/ogc/{provider}/{service}: GetCapabilities WMS/WFS únicamente para proveedores allowlisted (IDECOR, IDECorr, IGN, INTA, CONAE SAOCOM y SMAP). No es un proxy abierto; el cliente no puede indicar un host arbitrario. Respuestas OGC se cachean seis horas.
- services/mapViewer.js: al inicializar el visor intenta descubrir capas temáticas WMS de IDECOR (solo Córdoba), IDECorr (solo Corrientes), IGN, INTA-CIRN, CONAE SAOCOM y SMAP. Las capas se agregan al control existente, permanecen apagadas por defecto y conservan atribución/proveedor. Un proveedor que no responde no bloquea el mapa.
- Las capas WMS se usan como contexto visual. No se convierten automáticamente en observaciones ráster ni en variables cuantitativas de lote.
- MapBiomas queda documentado con período, resolución, clases, licencia y enlaces oficiales, pero no se incorpora como estadística por lote porque la descarga directa está suspendida y la exportación GEE requiere sesión. La plataforma no inventa resultados cuando no hay acceso automatizado.

Pruebas agregadas: parser WMS/WFS, allowlist anti-SSRF, normalización del registro IDERA y reglas de selección temática del visor. El smoke test público consulta WMS IDECOR, MapBiomas Argentina y CONAE SAOCOM/SMAP; verifica la API de teselas MapBiomas C3 1985–2025 y render PNG de las capas contextuales, y deja el resultado como artefacto de CI.
