# Agro-Consultas — auditoría comparativa y hoja de ruta de producto

> **Documento histórico:** investigación con corte al 18-11-2026. La referencia a commit `8a0d14b` se conserva para reproducir el análisis original; no representa el estado de producción actual. Para estado operativo, pull requests, riesgos y cambios recientes consultar [docs/PRODUCTION_AUDIT_2026-11-28.md](PRODUCTION_AUDIT_2026-11-28.md).

**Fecha de corte:** 18 de noviembre de 2026  
**Base de código auditada:** `main`, commit `8a0d14bbd0479a2e43f30a0d822b1223e6de5eba`  
**Tipo de documento:** investigación de producto y arquitectura; no modifica los servicios de análisis ni afirma que las integraciones propuestas estén implementadas.

## 1. Resumen ejecutivo

Agro-Consultas ya dispone de una base funcional: frontend HTML/JavaScript con Leaflet, contexto territorial compartido, proyectos y lotes en almacenamiento local, backend FastAPI, consultas FIRMS/GOES, WFS de CONAE, catálogo STAC, procesamiento ráster NDVI/SAR, servicios de clima/suelo y pruebas automatizadas.

El problema principal no es la ausencia de tecnología. Es la distancia entre capacidades técnicas aisladas y una experiencia que ayude a responder preguntas concretas. La interfaz de incendios expone conteos por sensor, frescura, alertas, pronóstico, histórico manual y análisis de lote en una misma pantalla. El informe permite variantes de aptitud o forestal, pero no reúne aún todos los módulos en una única salida. La gestión de proyectos/lotes se añadió como barra global, pero necesita una ubicación de producto más clara.

**Recomendación:** evolucionar Agro-Consultas como un espacio de trabajo territorial con un núcleo común de proyecto/lote/evidencia y módulos especializados. No reemplazar Leaflet ni reescribir todo. Mejorar primero la jerarquía de información, normalizar resultados y procedencia, y después sumar nuevas fuentes en orden de valor y viabilidad.

### Alcance geográfico obligatorio: Argentina

El producto es nacional. El NEA es un territorio de validación prioritaria por cercanía operativa, pero ninguna regla, catálogo, filtro, endpoint, lista de cultivos ni diseño de interfaz debe asumir que el usuario está en Corrientes o Misiones.

Criterios no negociables:
- Las consultas espaciales aceptan geometrías WGS84 válidas en cualquier provincia argentina y no aplican recortes provinciales/regionales salvo que el usuario los seleccione.
- Los feeds regionales (por ejemplo, CSV FIRMS de Sudamérica) deben describir su recorte como aproximado si se usa un bounding box. No presentar ese rectángulo como frontera administrativa exacta de Argentina.
- Cada fuente declara cobertura real: nacional, global, provincial, ecorregional o sitio específico. Una capa local no se presenta como nacional.
- La ausencia de cobertura se comunica por fuente y territorio; nunca se reemplaza con datos de otra región ni se extrapola silenciosamente.
- Los tests espaciales deben incluir extremos norte/sur/este/oeste, Patagonia, Cuyo, NOA, Centro, NEA y región pampeana, además de puntos fuera del país para detectar falsos positivos.

### Fuentes nacionales adicionales verificadas para integrar

| Fuente / producto | Cobertura documentada | Uso en Agro-Consultas | Límite que debe mostrarse |
|---|---|---|---|
| CONAE MODIS AQM WMS | Argentina; serie mensual publicada como 13 capas `EmergenciasCONAE:MODIS_AQM_1..13` | Contexto de áreas quemadas, separado de focos activos | El índice de capa no se debe convertir en fecha sin leer metadatos del servicio. Producto derivado de MCD64A1.061. |
| CONAE disponibilidad de combustibles Landsat 8/9 | Productos publicados por CONAE, capas `AlertaTemprana:INC_SIARTIVGEOL89_DC_1..3` | Contexto de fracciones de vegetación verde, seca/senescente y suelo descubierto | No es FWI ni una predicción de ignición; validar fecha y disponibilidad de cada capa. |
| CONAE disponibilidad de combustibles SNPP-VIIRS | Productos publicados por CONAE, capas `AlertaTemprana:INC_SIARTIVGEOSNPP_DC_1..6` | Contexto complementario de combustible fino | Resolución/fecha y actualización deben obtenerse de metadatos; no inferirlas del sufijo. |
| CONAE cobertura de bosques | Mapas anuales de coberturas vegetales nativas para la República Argentina; primer mapa publicado 2020 | Capa nacional de referencia en Forestal | No representa plantaciones ni condición forestal actual; el mapa 2020 es histórico. |
| GFW `arg_otbn_forest_loss` | Dataset de pérdida de bosque nativo de Argentina, 2007–2022, 30 m, escala nacional | Capa ráster nacional integrada mediante GFW Tile Cache (`/arg_otbn_forest_loss/v2022/dynamic/{z}/{x}/{y}.png`); API Data para estadísticas por AOI como etapa siguiente | No equivale a alertas en tiempo real. El mosaico de tiles se agregó al mapa; falta QA visual en todo el país. Las consultas de Data API requieren API key y validar campos/versiones. |
| GAEZ v5 FAO/IIASA | Marco global con cobertura de Argentina; resultados de aptitud/producción para más de 70 cultivos. Capas clave de aptitud/producción alcanzan 30 segundos de arco (~1 km); otras capas se publican a 5 minutos (~10 km). | Benchmark de aptitud por cultivo/escenario, priorizando Theme 4 (Suitability and Attainable Yield) y Crop Summary Data por país/cultivo | El portal expone rásteres vía catálogo y Google Cloud Storage; aún falta seleccionar variables/cultivos de interés nacional, descargar los COG/TIFF apropiados y procesarlos por AOI. La tabla resumen por país no es dato parcelario. |

Servicios CONAE publicados en su catálogo oficial:
- Áreas quemadas: `https://geoservicios2.conae.gov.ar/geoserver/EmergenciasCONAE/wms`
- Disponibilidad de combustibles: `https://geoservicios.conae.gov.ar/geoserver/AlertaTemprana/wms`
- Cobertura de bosques: `https://geoservicios2.conae.gov.ar/geoserver/Bosques/wms`

Fuentes oficiales consultadas: catálogo de [Geoservicios CONAE](https://catalogos.conae.gov.ar/catalogo/catalogoGeoServiciosProsatII.html), [GFW Data API](https://data-api.globalforestwatch.org/docs) y [FAO/IIASA GAEZ](https://gaez.fao.org/).

### Decisiones recomendadas

1. Mantener Leaflet y GeoJSON como base de la experiencia web durante la siguiente etapa.
2. Diseñar un modelo común de evidencia que distinga observación, cálculo derivado, estimación, referencia regional y dato ingresado por el usuario.
3. Rediseñar Incendios para priorizar cercanía, lote, hora de observación y estado de fuente; no presentar el total de observaciones como cantidad de incendios.
4. Incorporar ubicación del dispositivo sólo mediante acción explícita y permiso del navegador.
5. Sustituir el indicador meteorológico propio por una fuente/índice documentado (por ejemplo, productos FWI de GWIS) cuando se confirme cobertura, resolución y adecuación para Argentina.
6. Ampliar el informe a un dossier multi-módulo construido desde resultados trazables, sin ejecutar silenciosamente análisis caros ni presentar ausencia de datos como resultado.
7. Mantener QField como opción de campo avanzada/interoperable; no intentar replicar de inmediato toda su capacidad GNSS/offline en el navegador.

---

## 2. Auditoría del estado actual del repositorio

La auditoría se basa en el código y la documentación existentes en el commit indicado. No sustituye pruebas de uso real ni verifica en esta revisión la disponibilidad en vivo de cada proveedor.

| Área | Implementado y localizado en el código | Límite confirmado / brecha |
|---|---|---|
| Espacio territorial | `services/lotContext.js`, `workspace.js`, `workspace.css`; proyectos/lotes y geometría compartida entre páginas. | Persistencia local del navegador; no es colaboración multiusuario ni sincronización entre dispositivos. La barra global compite visualmente con la cabecera y navegación. |
| Mapa | Leaflet, selección/dibujo/importación GeoJSON en `mapa.html`; contexto de lote WGS84. | Aún no existe catálogo común de capas y análisis con metadatos homogéneos para todos los módulos. |
| Agro | `recommendationEngine.js`, `soilService.js`, perfiles JSON provinciales/subregionales, INTA WMS, NASA POWER y Open-Meteo. | Los perfiles internos no tienen fuente primaria documentada por registro; un perfil provincial o subregional no es medición del lote. WMS es cartografía, no muestra de suelo. |
| Forestal | `satelliteService.js` usa AWS Earth Search STAC para Sentinel-2 L2A; `backend/main.py` procesa COG para NDVI y Sentinel-1 SAR; comparación multitemporal. | Encontrar una escena no significa que exista estadística ráster procesada. La interpretación NDVI no identifica especie, edad, volumen o sanidad. SAR requiere interpretación/calibración; no equivale directamente a humedad o biomasa. |
| Incendios | `backend/fire_monitoring.py`: CSV NRT FIRMS MODIS/VIIRS, frescura de archivos, GOES-19 ABI FDCF y Open-Meteo. `services/fireMonitoringService.mjs`: WFS CONAE, filtro espacial, armonización exploratoria, CSV histórico local. | El histórico remoto automático no está integrado: se importan CSV. El indicador meteorológico es una puntuación interna de cuatro umbrales, no FWI. La vista no ofrece botón de geolocalización; el pronóstico se dispara al tocar el mapa o sincronizar lote. |
| Campo / GPS | `tracking.html` registra posiciones y geometrías y permite exportar. | No es equivalente a una app GIS offline en segundo plano con formularios, reanudación robusta, GNSS externo y sincronización colaborativa. Deben revisarse persistencia y recuperación de sesiones en dispositivos reales. |
| Informes | `reporte.html` calcula geometría/ubicación, suelo, clima, NASA POWER y matriz de recomendaciones. Añade análisis forestal cuando `type=forestal`. | El selector `type` no constituye un dossier multi-módulo completo. No se incorporan en una sección propia el resultado de incendios, el histórico de focos ni recorridos/observaciones de campo. El informe depende de consultas al generarse, no de una instantánea de resultados ya revisados. |
| Validación | Tests Python y Node para geometría, recomendaciones, incendios, forestal, satélite, contexto y sintaxis. | CI no valida por sí solo usabilidad móvil, latencia real, límites externos, permisos GPS, PDF final ni precisión temática frente a parcelas de referencia. |

### Evidencia concreta del módulo Incendios

En el código actual:

- FIRMS NRT se consume desde archivos CSV públicos de Sudamérica de las últimas 24 horas; se recorta por extensión geográfica de Argentina y entorno.
- Las colecciones MODIS y VIIRS se mantienen separadas; las plataformas VIIRS incluyen Suomi-NPP, NOAA-20 y NOAA-21.
- GOES-19 se procesa desde ABI L2 FDCF como capa independiente, con atributos distintos.
- Para consulta por lote, se intenta WFS de CONAE y se usa FIRMS como respaldo si falla.
- El histórico de la interfaz se alimenta por CSV detallados que importa el usuario; se procesa en el navegador.
- El pronóstico actual consulta Open-Meteo y calcula 0–100 con cuatro umbrales fijos: temperatura máxima, humedad mínima, viento máximo y precipitación. La documentación del propio proyecto aclara que no es FWI.

**Lectura de la captura del usuario:** 820 es el total de elementos/detecciones devueltos, no 820 incendios confirmados ni necesariamente 820 eventos independientes. Los 739 VIIRS proceden de dos plataformas actuales en esa consulta; MODIS aporta 81. Una misma zona puede aparecer en más de un sensor y una anomalía térmica no confirma fuego. La pantalla debería decirlo antes de mostrar el total, y priorizar cuántas observaciones recientes están dentro/cerca del área elegida.

La respuesta meteorológica HTTP 429 es un fallo de cuota/limitación del proveedor que debe tratarse con caché, backoff, deduplicación de solicitudes y mensaje contextual; no se debe pedir al usuario que toque puntos aleatorios como estrategia de recuperación.

### Brechas de experiencia observadas

- Doble identidad/cabecera y doble navegación en móvil.
- Selector de proyecto/lote y botón de crear proyecto incrustados en la zona superior de todas las páginas.
- Términos técnicos sin jerarquía progresiva: la explicación metodológica ocupa el mismo nivel visual que la respuesta principal.
- Estados de fuente, conteos y avisos mezclados con los resultados que el usuario busca.
- El informe usa un modo por tipo y no un modelo común de resultados de todos los módulos.

---

## 3. Plataformas comparables y qué aprender de ellas

No todas son competidores directos. Algunas son sistemas científicos, otras aplicaciones de campo, catálogos o plataformas de datos.

| Módulo | Referente | Patrón útil | Qué tomar para Agro-Consultas | Qué no copiar |
|---|---|---|---|---|
| Incendios | GWIS / JRC | Vista de situación actual, FWI, rayos, detecciones activas, perímetros quemados y emisiones; estadísticas comparadas con promedios históricos. | Separar peligro, detección y área quemada; añadir contexto histórico y comparación con años previos. | No presentar el producto global como validación local ni llamar FWI a una puntuación propia. |
| Incendios | EFFIS | Peligro, focos activos, áreas quemadas, severidad, combustible y descargas cartográficas. | Capas operativas con leyenda clara, escalas temporales y metadatos. | Sus capas/licencia/cobertura están orientadas principalmente a Europa, Medio Oriente y Norte de África; revisar aptitud para Argentina. |
| Incendios | NASA FIRMS | Detecciones NRT/archivo, atributos de sensor, WMS/WFS y descarga GIS. | Fuente primaria para anomalías activas; filtrar por área/tiempo y conservar atributos de sensor. | No fusionar sensores ni convertir puntos de píxel en perímetros confirmados. |
| Incendios | CONAE | Consulta por foco o área quemada, provincia/departamento, satélite, fecha, confianza, CSV/SHP y detalle/totalización. | Fuente nacional y referencia de nomenclatura/consulta; integrar el producto de área quemada por separado. | La descarga detallada requiere registro; no asumir que todos los endpoints públicos son anónimos o estables. |
| Incendios GIS | POLO QGIS | Reportes y mapas automáticos FIRMS/INPE, períodos recientes, priorización territorial y GeoPDF offline. | Plantilla de informe operativo, resumen municipal y salida offline. | El plugin se orienta al estado de Amazonas; revisar código, licencia y alcance antes de reutilizarlo. |
| GIS forestal | Observatorio Forestal UTN | Plugin QGIS que reúne FIRMS, Sentinel-2/Landsat, DEM, WorldClim, SoilGrids, Open-Meteo/ERA5 y COG. | Referencia de integración de fuentes, herramientas y flujos de análisis en un mismo entorno. | Es un plugin QGIS institucional enfocado en Ecuador, no un backend listo para enchufar a Agro-Consultas. Su metadato declara GPL-3.0. |
| Agro | FAO/IIASA GAEZ v5 | Evaluación agroecológica de hasta 280 cultivos/usos, niveles de manejo y climas históricos/actuales/futuros. | Contrastar perfiles de cultivos y ofrecer contexto agroecológico trazable. | No tratar agregaciones globales/regionales como recomendación agronómica de parcela. Revisar resolución, licencias y forma de descarga antes de integración. |
| Agro | xarvio FIELD MANAGER | Monitoreo de biomasa, zonas de manejo, observaciones satelitales y soporte de decisiones por lote. | Explicar variabilidad intra-lote y comparación temporal, si hay ráster válido. | No imitar prescripciones propietarias ni prometer rendimiento sin calibración/ensayos. |
| Forestal | Global Forest Watch | Alertas y pérdida de cobertura, análisis por AOI, API y datos históricos. | Añadir alertas de cambio de cobertura y contexto de paisaje. | La pérdida de cobertura no equivale automáticamente a incendio, tala ilegal ni cambio de uso verificado. |
| Forestal | Collect Earth Online | Interpretación de imágenes, muestreo y validación humana. | Flujo de validación de detecciones con observaciones de campo y muestras. | Requiere diseño de muestreo y personal capacitado; no automatiza la verdad de terreno. |
| Campo | QField | Formularios, geometrías, rastreo GNSS, trabajo offline y sincronización con QGIS/QFieldCloud. | Modelo de captura de puntos/líneas/polígonos, intervalos de tiempo/distancia, adjuntos y operación sin señal. | No intentar reproducir de inmediato el ciclo de vida de una app nativa desde una web móvil. |
| Campo | Mergin Maps | Formularios, adjuntos, edición offline y sincronización de cambios GeoPackage. | Referencia de captura colaborativa y resolución/sincronización de cambios. | No depender de su nube si el objetivo es mantener Agro-Consultas autónomo. |
| Mapa/GIS | MapStore / GeoNode | Catálogo de capas, metadatos, servicios OGC, mapas compartidos y gestión de datos. | Patrones de catálogo, trazabilidad y servicios interoperables. | No migrar a una plataforma completa sin una necesidad demostrada. |

### Evaluación específica de plugins QGIS

**POLO** (QGIS Plugin ID 2384): su ficha oficial indica FIRMS e INPE, reportes/mapas, datos actuales y últimos siete días, prioridad por municipio/mesorregión y GeoPDF offline. El alcance descrito es Amazonas. La ficha consultada no fue suficiente para confirmar una licencia de código reutilizable; antes de portar código hay que revisar el repositorio y sus archivos de licencia.

**Observatorio Forestal UTN** (Plugin ID 6063): ficha oficial declara GPL-3.0 y lista FIRMS, STAC Planetary Computer, Sentinel-2, Landsat, Copernicus DEM, WorldClim 2.1, ESA WorldCover, SoilGrids 250m, Open-Meteo/ERA5 y COG. La ficha también indica que el plugin está institucionalmente enfocado en Ecuador. Por compatibilidad/licencia, no copiaría módulos de código a este repositorio MIT sin una decisión explícita sobre relicenciamiento y obligaciones de distribución. Sí podemos estudiar interfaces, fuentes, métodos y reimplementar flujos de forma independiente respetando atribuciones y términos de datos.

**Conclusión:** POLO inspira el producto de informe y priorización de incendios; Observatorio Forestal UTN inspira el mapa de herramientas integradas. Ninguno reemplaza el diseño propio ni la validación para Corrientes/Argentina.

---

## 4. Arquitectura recomendada

### 4.1 Núcleo territorial

Mantener `services/lotContext.js` como transición inmediata, pero evolucionar hacia un modelo explícito:

- Proyecto: identidad, nombre, metadatos y lotes.
- Lote/AOI: geometría GeoJSON, CRS, superficie calculada, origen y fecha de edición.
- Observación: fecha, geometría, tipo, fuente, autor/dispositivo y atributos.
- Evidencia: dato bruto o derivado con fuente, fecha de observación, fecha de consulta, unidad, resolución, método, estado y limitaciones.
- Análisis: parámetros, AOI, rango temporal, versiones de algoritmo y referencias a evidencias.
- Informe: instantánea inmutable de resultados y metadatos usados al generarse.

Los módulos reciben el mismo `projectId`, `lotId` y geometría. No deben duplicar el estado ni recalcular el centro del lote de manera diferente.

### 4.2 Contrato de evidencia

Cada resultado debería exponer campos equivalentes:

```json
{
  "kind": "observation | derived | estimate | regional_reference | user_input",
  "status": "available | partial | delayed | unavailable | not_queried",
  "value": null,
  "unit": null,
  "source": "provider or dataset",
  "observedAt": null,
  "retrievedAt": null,
  "spatialResolution": null,
  "method": null,
  "limitations": []
}
```

Es un contrato ilustrativo, no un formato ya implementado. Evitar un único booleano `success` para representar todos los estados. La interfaz traduce el estado en frases contextuales y no muestra jerga interna ni etiquetas genéricas repetidas.

### 4.3 Servicios y formatos

| Tecnología | Decisión | Uso propuesto |
|---|---|---|
| Leaflet | Mantener | Mapas web actuales; incorporar controles de capa, leyenda, selección y clusters con consistencia. |
| GeoJSON / WGS84 | Mantener como intercambio | AOI, lotes, observaciones y exportación. Guardar CRS/origen cuando se importen datos externos. |
| OGC WMS/WFS/WMTS | Integrar selectivamente | Capas cartográficas y datos vectoriales de organismos, con control de disponibilidad. |
| STAC | Estandarizar detrás de adaptadores | Búsqueda de escenas y activos satelitales; proveedor intercambiable. |
| COG + Range Requests | Mantener/mejorar | Lectura parcial de ráster; controlar tamaño, timeout, reproyección y caché. |
| Rasterio / Shapely / PyProj | Mantener backend | Procesamiento ráster y geometrías, con tests de alineación y máscara. |
| PostGIS | Fase posterior | Persistencia multiusuario, consultas espaciales compartidas e historial de proyectos. No es necesario antes de validar el flujo local. |
| QField / GeoPackage | Integración de interoperabilidad, no dependencia | Exportar proyecto/datos de campo para operación offline y volver a importar observaciones. |
| PDF | Mejorar la capa de informes | Documento basado en instantánea de análisis, con mapas, tablas, fuentes y limitaciones. |

### 4.4 Catálogo de fuentes

Crear un registro común de fuentes con: nombre, proveedor, producto/capa, endpoint, tipo de servicio, cobertura, resolución temporal/espacial, latencia esperada, autenticación, cuota, licencia/atribución, estado de salud y último control. Ningún módulo debería codificar mensajes de disponibilidad aislados sin conservar estos metadatos.

---

## 5. Diseño funcional propuesto por módulo

### 5.1 Incendios — primero

**Pantalla inicial simplificada**

- Selector de alcance: Mi ubicación / Lote activo / Argentina.
- Mapa protagonista con tres capas independientes: Detecciones activas, áreas quemadas/perímetros y peligro meteorológico.
- Resumen en lenguaje común: “X observaciones satelitales recientes dentro del área” y “Y observaciones en un radio configurable”. Siempre aclarar que son observaciones, no incendios confirmados.
- Lista priorizada por proximidad y antigüedad, no por orden arbitrario.
- Filtros secundarios: período, sensor, confianza cuando sea numérica, fuente.
- Ficha al tocar un punto: sensor/plataforma, fecha/hora UTC y local, antigüedad, confianza original, FRP/unidad cuando exista, coordenadas y fuente.
- Detalle técnico desplegable con estado de fuentes, resolución, método y advertencias.

**Ubicación en tiempo real**

- Botón explícito “Usar mi ubicación”.
- Solicitar permiso del navegador sólo después del toque.
- Mostrar precisión reportada, hora de fijación y radio de incertidumbre.
- No transmitir ni persistir coordenadas de dispositivo por defecto.
- Si el permiso falla, conservar selección de mapa y lote activo.
- No ejecutar pronóstico cada vez que el GPS se mueve unos metros: usar umbral espacial, debounce, caché por celda/intervalo y botón de actualización.

**Fuentes y mejoras**

1. Mantener FIRMS MODIS/VIIRS y GOES separados.
2. Mantener CONAE como fuente nacional y revisar los servicios oficiales WFS; su portal permite consultar focos y áreas quemadas con filtros por provincia, fechas, satélite y confianza.
3. Añadir GWIS como capa/servicio de contexto: FWI, detecciones, perímetros y estadísticas, sujeto a disponibilidad y licencia para Sudamérica.
4. Evaluar WMS/WMS-Time de FIRMS si conviene representar la capa del proveedor sin descargar todos los puntos; requiere MAP_KEY y tiene límites de transacción.
5. Añadir histórico de área quemada distinto del histórico de anomalías térmicas. GWIS advierte que productos basados en MCD64A1 pueden tener retraso de disponibilidad; no etiquetarlos como tiempo real.
6. Añadir comparaciones por temporada/provincia cuando la serie esté disponible; no atribuir estadísticas administrativas a un lote.

**Peligro meteorológico**

- No llamar FWI al score de cuatro umbrales existente.
- Primera opción: consumir productos FWI publicados por GWIS, revisar cobertura, modelos, fecha y resolución para Argentina.
- Alternativa: calcular FWI sólo si se implementa el método completo con variables de entrada y estado de combustibles requerido, procedencia, modelo y validación. No inferirlo a partir de temperatura, humedad, viento y lluvia solamente.
- Tratar HTTP 429 con caché, Retry-After, backoff exponencial, límite de concurrencia y estados de proveedor. Evitar solicitudes duplicadas por punto.

### 5.2 Agro / aptitud

- Separar “aptitud agroecológica de referencia” de “recomendación de manejo”.
- Mostrar cultivo, clase, factores favorables/limitantes y nivel/escala de evidencia.
- Confrontar perfiles internos con GAEZ v5, datos de suelo, clima y estadísticas nacionales; documentar discrepancias.
- Usar GAEZ como benchmark regional y escenarios, no como recomendación parcelaria directa.
- Permitir comparar cultivos y escenarios de manejo.
- Agregar análisis intra-lote sólo cuando existan rásteres y resolución adecuados.
- Mantener fichas provinciales como catálogo de requerimientos, no como evidencia de aptitud local sin variables locales.

### 5.3 Forestal / ambiente

- Mantener Sentinel-2 L2A y Sentinel-1 SAR como observaciones complementarias.
- Añadir series temporales por lote y comparaciones con fechas equivalentes de estación cuando sea posible.
- Añadir GFW para alertas/cambio de cobertura, diferenciando pérdida de cobertura de incendio, cosecha forestal, tala o conversión de uso.
- Evaluar ESA WorldCover/SoilGrids/WorldClim como contexto de cobertura, suelo y climatología, respetando resolución y fecha.
- Diseñar validación de cambios con puntos/fotos de campo y muestreo estilo Collect Earth Online.
- No llamar inventario forestal a un NDVI; no derivar volumen/biomasa sin modelo calibrado y validación local.

### 5.4 Campo / GPS

- Mantener el módulo web para recorridos sencillos y captura conectada.
- Agregar observaciones con formularios configurables, fotos, tipo de observación y relación con lote/proyecto.
- Persistir borradores y sesiones de forma robusta; permitir recuperar sesiones interrumpidas.
- Diseñar modo offline sólo después de definir sincronización, conflictos, adjuntos y almacenamiento. Un service worker/IndexedDB aislado no resuelve por sí solo sincronización multiusuario.
- Exportar/importar GeoJSON y GeoPackage; documentar compatibilidad con QField.
- Permitir GNSS externo en el futuro; la precisión del GPS interno no debe presentarse como mensura.

### 5.5 Mapa / espacio GIS

- Móvil: mapa primero; barra inferior como navegación principal; retirar navegación duplicada de cabecera.
- Cabecera: conservar marca original; mantener sólo tema y acciones globales realmente necesarias.
- Mover proyecto/lote a “Espacio de trabajo” o panel contextual que se abre desde un control compacto, no a una barra fija duplicada.
- Escritorio: navegación lateral, mapa central y panel de análisis.
- Catálogo de capas con fuente, fecha, cobertura, leyenda y estado.
- Mantener una única selección activa de lote, sincronizada con todos los módulos.

### 5.6 Informes

Un informe territorial integral debe construirse desde resultados persistidos/instantáneas, no sólo relanzando un módulo según query param.

Secciones:
1. Resumen ejecutivo y alcance.
2. Proyecto, lote, geometría, superficie, CRS, origen y precisión.
3. Aptitud agropecuaria.
4. Forestal y cobertura.
5. Incendios: observaciones, período, fuentes, área quemada cuando haya producto válido.
6. Meteorología/clima.
7. Campo: recorridos, observaciones y fotografías seleccionadas.
8. Fuentes, fechas, métodos, resolución y limitaciones.
9. Anexo técnico con parámetros y referencias.

Cada sección debe tener estados propios: disponible, parcial, no consultada o fuente no disponible. El PDF no debe convertir una sección no consultada en “sin eventos” ni volver a consultar proveedores sin que el usuario lo solicite.

---

## 6. Priorización por valor, viabilidad y riesgo

| Prioridad | Entregable | Valor | Complejidad | Dependencia |
|---|---|---:|---:|---|
| P0 | Rediseño de navegación móvil/cabecera y reubicación de proyecto/lote | Alto | Baja-media | Auditoría UX en todos los módulos |
| P0 | Contrato común de evidencia/fuentes y caché de consultas | Muy alto | Media | Modelo de datos |
| P0 | Incendios: resumen comprensible, geolocalización opcional, cercanía y manejo 429 | Muy alto | Media | Backend FIRMS/CONAE/Open-Meteo |
| P0 | Informe multi-módulo basado en instantánea | Muy alto | Alta | Contrato común de evidencia |
| P1 | FWI GWIS como capa/serie documentada | Alto | Media | Verificar acceso, cobertura y licencia |
| P1 | Histórico de áreas quemadas y estadísticas por provincia | Alto | Media | GWIS/CONAE y fechas de actualización |
| P1 | Agro: benchmark GAEZ y explicación de factores | Alto | Media-alta | Datos GAEZ y escalas |
| P1 | Forestal: GFW y series temporales de cobertura | Alto | Media-alta | API/datasets/licencia y AOI |
| P1 | Campo: observaciones/fotos y recuperación de sesión | Alto | Media | Modelo de observaciones |
| P2 | Exportación GeoPackage/QField y flujo offline | Alto | Alta | Persistencia/sincronización |
| P2 | PostGIS, usuarios, colaboración y permisos | Variable | Muy alta | Validación comercial y operación |

### Fuera de alcance por ahora

- Entrenar un modelo propio de riesgo de incendio sin datos de combustible, topografía y validación.
- Clasificar especie/edad/volumen forestal a partir de NDVI aislado.
- Hacer mensura catastral con GPS de teléfono.
- Copiar plugins QGIS enteros al repositorio.
- Añadir una IA conversacional antes de normalizar los datos y la trazabilidad.
- Incorporar cuentas, PostGIS y colaboración multiusuario antes de validar la demanda.

---

## 7. Plan de implementación por fases coordinadas

Las fases pueden desarrollarse en PRs sucesivas, pero todas deben respetar el contrato compartido y no duplicar estado.

### Fase A — Experiencia y modelo común
- Resolver cabecera/navegación duplicadas en móvil.
- Crear acceso claro a proyectos/lotes.
- Definir contratos de evidencia y catálogo de fuentes.
- Añadir caché, frescura, errores tipados y límites de consultas.
- Tests de regresión de proyecto/lote en todas las páginas.

### Fase B — Incendios operativos
- Reorganizar pantalla alrededor de ubicación/lote.
- Añadir botón GPS con permiso explícito y precisión.
- Presentar observaciones por cercanía/antigüedad y separar conteo de sensores.
- Manejar 429 y fallos parciales sin bloquear mapa.
- Integrar fuente de peligro FWI documentada si la cobertura lo permite.
- Integrar contexto histórico de áreas quemadas separado de focos activos.
- Tests con fixture conocido y prueba de proveedor real con caché controlada.

### Fase C — Agro y forestal explicables
- Integrar benchmark GAEZ a escala correcta.
- Mejorar fichas de evidencia de suelo/clima.
- Agregar GFW/cambio de cobertura con advertencias semánticas.
- Consolidar series temporales Sentinel y metadatos de ráster.
- Tests de geometría, fechas, resolución y ausencia de píxeles válidos.

### Fase D — Campo
- Observaciones georreferenciadas y formularios.
- Fotos y atributos vinculados a lote/proyecto.
- Recuperación de sesión y exportación.
- Interoperabilidad GeoJSON/GeoPackage/QField.
- Pruebas offline y de permisos en Android real.

### Fase E — Informe integral
- Modelo de instantánea de análisis.
- Secciones multi-módulo y estado por sección.
- Mapa, tablas, gráficos, metodología y fuentes.
- PDF revisado en móvil/escritorio.
- Test de que una sección no consultada no se presenta como resultado negativo.

### Fase F — Validación de piloto
- Lotes reales de Corrientes/Misiones y regiones contrastantes.
- Comparación con observaciones de campo y productos oficiales.
- Rendimiento en móvil y conectividad limitada.
- Validación de atribución, licencia y cuotas de proveedores.
- Revisión de accesibilidad y lenguaje.
- Publicación sólo después de pruebas automatizadas y visuales.

---

## 8. Diseño de navegación propuesto

### Móvil
- Cabecera original con logo y nombre una sola vez.
- Acceso a proyecto/lote como botón compacto que abre un selector/gestor contextual.
- Control de tema en cabecera.
- Navegación inferior única: Inicio, Mapa, Agro, Forestal, Incendios, Campo e Informes.
- Mapa o resultado como contenido protagonista; filtros en paneles plegables.

### Escritorio
- Marca en barra lateral o cabecera, no repetida.
- Navegación lateral persistente.
- Proyecto/lote en contexto del espacio de trabajo.
- Mapa o análisis central.
- Panel contextual con capas, filtros y metadatos.

---

## 9. Criterios de aceptación del rediseño de Incendios

1. El usuario puede distinguir detección satelital, incendio reportado/perímetro y peligro meteorológico sin leer documentación técnica.
2. El total se etiqueta como observaciones/detecciones, no incendios.
3. Una detección tiene sensor, plataforma, hora UTC, antigüedad y fuente.
4. El usuario puede consultar “mi ubicación” sólo tras conceder permiso, y ver precisión.
5. El usuario puede elegir lote activo y ver detecciones dentro/cerca con distancia calculada.
6. El mapa sigue utilizable aunque falle Open-Meteo, FIRMS, GOES o CONAE.
7. HTTP 429 no dispara reintentos ilimitados ni muestra el texto bruto del proveedor.
8. Las fuentes atrasadas, ausentes o parcialmente disponibles se identifican sin convertirlo en “sin incendios”.
9. Los conteos originales por sensor no se suman como si fueran eventos únicos.
10. La salida del informe conserva la distinción entre observaciones y perímetros/áreas quemadas.

## 10. Preguntas que requieren validación antes de implementar

- ¿Qué servicios GWIS/WMS tienen cobertura útil sobre Corrientes y Argentina y cuáles son sus condiciones de uso?
- ¿Qué capas actuales de CONAE están disponibles de forma estable y con qué requisitos de autenticación?
- ¿Qué conjuntos GFW tienen resolución temporal/espacial adecuada para lotes forestales del NEA?
- ¿Qué cobertura real de GAEZ v5 existe para los cultivos y usos relevantes de Argentina?
- ¿Qué atributos del GPS de los teléfonos Android objetivo están disponibles y con qué precisión reportada?
- ¿El informe debe representar sólo análisis ejecutados por el usuario o ofrecer una acción explícita “Completar informe” que lance consultas adicionales?

No se debe inventar respuesta a estas preguntas; cada integración necesita un spike técnico y una prueba de cobertura antes de comprometerla.

---

## 11. Fuentes consultadas

### Código Agro-Consultas
- [README y alcance actual](../README.md)
- [FIRE_MONITORING.md](../FIRE_MONITORING.md)
- [services/lotContext.js](../services/lotContext.js)
- [services/fireMonitoringService.mjs](../services/fireMonitoringService.mjs)
- [backend/fire_monitoring.py](../backend/fire_monitoring.py)
- [forestal/services/satelliteService.js](../forestal/services/satelliteService.js)
- [backend/main.py](../backend/main.py)
- [reporte.html](../reporte.html)
- [workspace.js](../workspace.js)

### Incendios
- [GWIS — Applications](https://gwis.jrc.ec.europa.eu/applications)
- [GWIS — Fire Danger Forecast](https://gwis.jrc.ec.europa.eu/about-gwis/technical-background/fire-danger-forecast)
- [GWIS — Burnt Areas](https://gwis.jrc.ec.europa.eu/about-gwis/technical-background/burnt-areas)
- [EFFIS — Data and services](https://forest-fire.emergency.copernicus.eu/applications/data-and-services)
- [NASA FIRMS — Active Fire Data](https://firms.modaps.eosdis.nasa.gov/active_fire/)
- [NASA FIRMS — WMS](https://firms.modaps.eosdis.nasa.gov/mapserver/wms-info/)
- [NASA FIRMS — WFS](https://firms.modaps.eosdis.nasa.gov/mapserver/wfs-info/)
- [CONAE — Consultas interactivas de incendios](https://catalogos5.conae.gov.ar/catalogofocos/)
- [CONAE — Geoservicios OGC](https://catalogos.conae.gov.ar/catalogo/catalogoGeoServiciosOGC.html)
- [POLO QGIS Plugin](https://plugins.qgis.org/plugins/polo/)
- [POLO source repository](https://github.com/Newton787/POLO-plugin)
- [Observatorio Forestal UTN — QGIS Plugin](https://plugins.qgis.org/plugins/Observatorio_Forestal_UTN/)
- [Observatorio Forestal UTN — source repository](https://github.com/observatorioforestalutn-beep/Observatorio-Forestal-UTN)

### Agro / forestal / campo / interoperabilidad
- [FAO/IIASA GAEZ](https://www.fao.org/land-water/resources/tools/databases/gaez/en)
- [Global Forest Watch Data API](https://data-api.globalforestwatch.org/docs)
- [Collect Earth Online](https://www.collect.earth/)
- [QField — Tracking](https://docs.qfield.org/es/how-to/navigation-and-positioning/tracking/)
- [QField — GNSS](https://docs.qfield.org/es/how-to/navigation-and-positioning/gnss/)
- [QField — Offline and ecosystem](https://docs.qfield.org/)
- [Mergin Maps — Offline use](https://merginmaps.com/docs/field/offline-use/)
- [Mergin Maps — Synchronisation](https://merginmaps.com/docs/manage/synchronisation/)
- [Copernicus Data Space — STAC API](https://documentation.dataspace.copernicus.eu/APIs/STAC.html)
- [Copernicus Data Space — APIs](https://dataspace.copernicus.eu/analyse/apis)
- [MapStore](https://mapstore.io/)
- [GeoNode](https://geonode.org/)

---

## 12. Cierre

El siguiente paso no es añadir veinte capas a la interfaz. Es convertir la información existente en respuestas claras, trazables y comparables; luego sumar fuentes que mejoren decisiones reales.

La primera entrega de producto debería ser el rediseño de Incendios y del marco común móvil, seguida por el informe integral. GAEZ, GFW, GWIS y QField aportan capacidades valiosas, pero cada integración debe pasar por pruebas de cobertura, escala, licencia, cuotas y validez temática para Argentina.

**Estado de este documento:** investigación y propuesta. No implica que los cambios de interfaz, fuentes o funcionalidades descritos estén ya implementados.


## 13. Integración de fuentes forestales abiertas por lote

Esta entrega incorpora tres fuentes públicas complementarias al análisis por polígono, además del análisis FAO/IIASA GAEZ v5 ya existente:

| Fuente | Producto | Resolución / período | Uso implementado |
|---|---|---|---|
| Hansen / UMD / GLAD | Global Forest Change v1.13 | 1 arc-second (~30 m); pérdida 2001–2025; copa base 2000 | Media/mediana/percentil 90 de cobertura de copa 2000 y superficie estimada de pérdida bruta por año |
| WRI / Google DeepMind (GFW Open Data) | Dominant Drivers of Tree Cover Loss v1.3 | 0.01° (~1 km); período 2001–2025 | Área y proporción del driver dominante por clase dentro del lote |
| European Commission JRC | Global Forest Cover 2020 v4 | ~10 m; año 2020 | Superficie de bosque/no bosque y proporción forestal de referencia |
| FAO / IIASA | GAEZ v5 RES05 | Variable según producto; global | Estadísticas zonales de productos de aptitud y productividad seleccionados |

### Acceso público y autenticación

- GAEZ v5 continúa leyendo el catálogo RES05 oficial y sus GeoTIFF públicos; no requiere API key.
- Hansen lee teselas GeoTIFF públicas de Google Cloud Storage mediante solicitudes parciales.
- El producto WRI/Google DeepMind se lee desde un COG público de Source Cooperative, espejo de acceso abierto con licencia CC BY 4.0. No se llama a la API autenticada de GFW.
- JRC GFC2020 v4 se lee desde un COG público de Source Cooperative, espejo byte a byte del producto JRC. El COG es muy grande, pero GDAL/rasterio solicita únicamente ventanas del lote mediante HTTP range requests. No se descarga el mosaico global completo.

### Endpoints

- `POST /api/territorial/gaez/analyze`
- `POST /api/territorial/forest/hansen/analyze`
- `POST /api/territorial/forest/gfw-drivers/analyze`
- `POST /api/territorial/forest/jrc/analyze`

Todos requieren geometría Polygon/MultiPolygon WGS84. Los servicios forestales abiertos no necesitan credenciales.

### Advertencias de interpretación

- Hansen tree cover 2000 representa porcentaje de copa de vegetación de más de 5 m, no cobertura forestal actual.
- Hansen loss es una perturbación bruta de cobertura arbórea: puede incluir cosecha de plantaciones, incendios y perturbaciones naturales. No es sinónimo automático de deforestación.
- Los cambios metodológicos de Hansen desde 2011 implican cautela al comparar toda la serie temporal.
- El producto WRI/Google DeepMind asigna un único driver dominante por celda (~1 km) al período completo; no identifica secuencias ni múltiples causas y no distingue automáticamente bosque natural de plantaciones.
- JRC GFC2020 es una referencia de presencia/ausencia de bosque para 2020 conforme a su definición armonizada; no es un mapa legal ni identifica por sí solo bosque nativo.
- GAEZ es un modelo agroecológico a escala de píxel; sus resultados dependen de variable, escenario y resolución del producto. No constituyen mediciones de suelo ni rendimientos reales del lote.
- Las áreas se estiman con área geodésica por fila de píxeles en WGS84. Se deben conservar como estimaciones zonales, no como mensura catastral.

### Fuentes y atribución

- Hansen/UMD/Google/USGS/NASA, Global Forest Change 2025 v1.13: https://storage.googleapis.com/earthenginepartners-hansen/GFC-2025-v1.13/download.html — CC BY 4.0.
- WRI/Google DeepMind, Global Drivers of Forest Loss v1.3: https://datasets.wri.org/datasets/dominant-drivers-of-tree-cover-loss-at-1km — CC BY 4.0; espejo COG: https://data.source.coop/epoch/global-forest-loss-drivers/v1_3/drivers_forest_loss_1km_2001_2025_v1_3.tif.
- European Commission JRC, Global Forest Cover 2020 v4: https://forobs.jrc.ec.europa.eu/GFC/v4 — atribución solicitada; espejo COG: https://data.source.coop/epoch/jrc-global-forest-cover-2020/v4/JRC_GFC2020_V4_COG.tif.
- FAO/IIASA GAEZ v5: https://www.fao.org/land-water/resources/tools/databases/gaez/en.

**Estado:** endpoints y controles de consulta por lote agregados en la rama de implementación. La lectura real de los COG/teselas remotos, la cobertura de lotes grandes y el rendimiento en Vercel requieren validación de integración con geometrías reales antes de publicar.
