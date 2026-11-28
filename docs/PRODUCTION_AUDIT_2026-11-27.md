# Auditoría de producción, repositorio y documentación

**Fecha de corte:** 27 de noviembre de 2026  
**Producción:** https://agro-consultas.vercel.app  
**Repositorio:** https://github.com/D4nSosa/agro-consultas  
**Commit de producción auditado:** `e1203bb2b6dc413493774e37065052dc60ab96b0`  
**Último PR integrado:** [#102](https://github.com/D4nSosa/agro-consultas/pull/102)  
**Rama de mantenimiento:** `fix/persistencia-forestal-gps`

## 1. Estado de publicación y pull requests

- La última publicación de producción consultada en Vercel figura como **READY** y corresponde al commit `e1203bb`.
- El dominio de producción asociado al proyecto es `agro-consultas.vercel.app`. En el listado de dominios del proyecto no figura todavía un dominio personalizado.
- El PR #103 concentra esta consolidación de mantenimiento; su estado de revisión e integración se consulta directamente en GitHub.
- La rama `fix/persistencia-forestal-gps` se utiliza para agrupar las correcciones de esta auditoría. Los cambios de esa rama no forman parte de producción hasta que se integren en `main` y se publique una nueva versión.
- Se deshabilita la creación de preview deployments de Vercel para esta rama de mantenimiento, evitando despliegues de vista previa mientras se trabaja en ella.

## 2. Hallazgos confirmados y correcciones incluidas en esta rama

### Agro: restauración de análisis

El almacenamiento de informes ya guardaba secciones de Agro asociadas a la geometría del lote, pero el módulo no las recuperaba al volver a abrir el mismo lote. Además, cuando existía contexto de lote compartido y la URL también contenía coordenadas, el inicio podía disparar el procesamiento dos veces.

Corrección incluida:
- Recuperar el snapshot guardado para la geometría activa.
- Restaurar recomendaciones, informes de suelo y clima, panel territorial y serie histórica disponible.
- Evitar volver a procesar el lote si ya se restauró el análisis.
- Mantener el reprocesamiento como alternativa cuando no existe un snapshot compatible.

La restauración depende del almacenamiento local del navegador. No constituye sincronización entre dispositivos ni una copia remota.

### Forestal: guardar y abrir informe

Los resultados forestales ya se persistían automáticamente en el almacenamiento de informes, pero la interfaz no ofrecía acciones visibles para el usuario.

Corrección incluida:
- Acción explícita para guardar los resultados actuales asociados al lote.
- Acciones explícitas para guardar los resultados forestales y abrir el informe unificado.
- El informe ofrece impresión/guardar como PDF y exportación del paquete de resultados en JSON.
- El paquete JSON incluye geometría y secciones guardadas; se puede compartir como archivo o descargar e importar desde otro dispositivo.
- La importación valida formato, versión, tamaño y estructura básica, y escapa texto importado antes de representarlo.

**Límite vigente:** los datos permanecen en almacenamiento local. La transferencia entre dispositivos requiere enviar el archivo JSON e importarlo; no hay sincronización remota automática.

### Incendios: marcador de pronóstico

El punto verde era `forecastMarker`, creado dentro de `loadForecast()`. El evento de clic del mapa llamaba a esa función y movía el punto en cada consulta.

Corrección incluida:
- Se elimina el marcador verde asociado al pronóstico.
- Se conserva la consulta meteorológica del punto seleccionado.
- Se conserva separado el marcador azul de ubicación GPS y las capas de detecciones.

### Dominio canónico, sitemap y robots

Las páginas HTML y los archivos SEO apuntaban a `agroconsultas.com.ar`, aunque ese dominio no aparece asociado al proyecto Vercel auditado. El sitemap también tenía fechas de modificación antiguas.

Corrección incluida:
- Canonical y metadatos de URL alineados al dominio de producción actualmente asociado.
- Canonical incorporado en la página de incendios.
- Sitemap actualizado con las páginas públicas principales y fecha de corte 2026-11-27.
- `robots.txt` actualizado para señalar el sitemap del dominio activo.

Cuando se conecte el dominio personalizado, habrá que cambiar canónicos, sitemap, robots y metadatos en una única modificación coordinada.

## 3. Riesgos operativos que siguen abiertos

1. **Límites de consumo del backend.** Se configuró una regla de Vercel Firewall activa para solicitudes `POST` a los endpoints costosos de procesamiento geoespacial y al histórico FIRMS: 12 solicitudes por IP cada 60 segundos, ventana fija, con denegación al exceder. Es un límite perimetral compartido por el firewall, no una cuota por usuario autenticado ni un presupuesto mensual. Deben revisarse sus métricas y ajustarse los topes de geometría, fechas y concurrencia según el uso real.
2. **Disponibilidad de proveedores externos.** Open-Meteo, NASA FIRMS, servicios WMS/WFS, STAC y demás proveedores públicos pueden cambiar, limitar o interrumpir respuestas. La presencia de una fuente en el catálogo no prueba que entregue datos válidos para cualquier AOI o fecha.
3. **Compartición de informes.** Los snapshots y proyectos siguen siendo locales. La transferencia portátil se realiza mediante exportación/importación JSON; no hay sincronización automática ni URL pública autocontenida.
4. **Validación territorial.** No hay que interpretar índices satelitales como rendimiento, volumen comercial ni productividad observada. Para esos resultados hacen falta inventarios, cosechas o registros de campo.
5. **Validación operativa.** El estado READY confirma que Vercel completó la publicación; no certifica por sí solo la exactitud agronómica, la disponibilidad de cada proveedor ni el funcionamiento de cada flujo con todos los lotes.
6. **Seguridad y abuso.** Mantener las credenciales de proveedores exclusivamente en backend y revisar límites de tamaño, geometría, tiempo de consulta y concurrencia en cada endpoint público.

## 4. Documentación y trazabilidad

- Este documento es la referencia operativa para el corte del 27-11-2026.
- `README.md` resume el estado del producto y enlaza esta auditoría.
- `ARCHITECTURE.md` describe las capas y responsabilidades técnicas.
- `PILOT_READINESS.md` define el alcance y las limitaciones para evaluaciones piloto.
- `PRODUCT_WORKSPACE.md` documenta el flujo de proyectos, lotes y navegación.
- `FIRE_MONITORING.md` describe las fuentes y el comportamiento del módulo de incendios.
- `GEOSPATIAL_ENGINE.md` describe el motor geoespacial y sus endpoints.
- `NATIONAL_SOURCE_AUDIT.md` mantiene el inventario de fuentes y su estado de evidencia.
- `PLATFORM_RESEARCH_AND_ROADMAP.md` se conserva como investigación histórica del 18-11-2026; sus referencias de commit y estado no deben tomarse como el estado de producción actual.

## 5. Verificación y publicación

- No se ejecutaron pruebas manuales ni pruebas de integración durante esta auditoría.
- No se solicitó ni se ejecutó un nuevo despliegue de producción.
- La rama de mantenimiento tiene deshabilitados los preview deployments de Vercel.
- Al abrir un PR, GitHub Actions puede ejecutar automáticamente las validaciones configuradas para eventos de pull request. Eso es distinto de una prueba manual o de un despliegue de producción.
- Las correcciones de esta rama deben considerarse **pendientes de integración y publicación** hasta que el PR sea fusionado y la nueva publicación alcance estado READY.

## 6. Orden recomendado para la siguiente consolidación

1. Integrar y publicar las correcciones de persistencia, informes, marcador y metadatos.
2. Observar el firewall perimetral y calibrar el límite de 12 solicitudes por IP/minuto según telemetría real.
3. Revisar cada fuente de datos con el recorrido completo: consulta, descarga, validación, procesamiento, resultado y trazabilidad.
4. Verificar geometrías, unidades, fechas, píxeles inválidos, nubes y cobertura antes de mostrar resultados.
5. Mantener los informes claros sobre fuentes, períodos, metodología y límites de interpretación.

**Criterio de cierre:** una capacidad se considera operativa cuando el flujo completo entrega un resultado reproducible y trazable; no solamente porque exista un endpoint, un componente visual o una entrada en el catálogo.
