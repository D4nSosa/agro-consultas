# Auditoría de producción y mantenimiento

**Fecha de corte:** 28 de noviembre de 2026  
**Producción:** https://agro-consultas.vercel.app  
**Repositorio:** https://github.com/D4nSosa/agro-consultas  
**Commit de producción auditado:** `cc5aaa4f422a326caf130f94ebc32c0a04c18621`  
**Último PR integrado:** [#103](https://github.com/D4nSosa/agro-consultas/pull/103)  
**Rama de mantenimiento en revisión:** `fix/auditoria-integral-informes-2026-11-28`

## 1. Estado de publicación

- El PR #103 fue integrado mediante squash.
- Vercel informó estado **READY** para la publicación de producción asociada al commit `cc5aaa4`.
- El dominio de producción continúa siendo `agro-consultas.vercel.app`; el dominio personalizado todavía no está conectado.
- Los cambios de la rama de mantenimiento indicada en este documento no forman parte de producción. La rama tiene deshabilitados los preview deployments para evitar publicaciones innecesarias.
- No se ejecutó un nuevo despliegue como parte de esta revisión.

## 2. Qué quedó publicado en PR #103

El PR #103 incorporó la consolidación de metadatos SEO, la eliminación del marcador móvil asociado al pronóstico en Incendios, acciones de informe forestal, soporte de exportación/importación JSON y una regla perimetral de limitación para rutas costosas.

La regla de firewall publicada limita a 12 solicitudes POST por IP cada 60 segundos para las rutas geoespaciales costosas incluidas en su expresión. No equivale a una cuota por usuario autenticado ni a una protección completa frente a abuso distribuido. Sus métricas y el comportamiento de los endpoints deben seguir revisándose.

La exportación y la importación JSON utilizan el mismo contrato de secciones: cada sección contiene metadatos y un campo `payload`. La revisión confirmó que el contrato básico de exportación e importación es compatible. El problema posterior no era una ausencia general del campo `payload`; el trabajo de mantenimiento mejora validación, sanitización y escritura atómica para hacer la transferencia más robusta.

## 3. Hallazgos de la revisión posterior

### Agro: restauración de resultados guardados

El módulo guarda el contexto territorial bajo la sección `agro-territory`, pero la función de restauración buscaba `agro-environment`. Por eso no recuperaba el snapshot esperado aunque estuviera guardado para la misma geometría.

Corrección preparada en la rama de mantenimiento:
- Leer `agro-territory` y `agro-recommendations` desde el formato real del almacenamiento.
- Mantener el acceso al `payload` que define el contrato del store.
- No inventar ni reconstruir una serie histórica climática: el módulo no persiste esa serie en el snapshot actual. Al restaurar sin ella, la interfaz debe informar que no hay histórico guardado y no disparar una consulta nueva en modo de restauración.

### Forestal: acciones duplicadas y asociación del análisis al lote

La revisión encontró dos juegos de listeners para guardar y abrir el informe forestal: uno dentro de la inicialización del DOM y otro registrado fuera de ella. Esto podía ejecutar dos veces las acciones.

También se detectó que el resultado asíncrono de un análisis podía terminar después de que el usuario cambiara de lote, dejando el resultado anterior visible como si correspondiera al lote activo.

Corrección preparada en la rama:
- Eliminar el segundo juego de listeners y conservar un único flujo.
- Vincular los resultados en memoria a la huella de la geometría analizada.
- Invalidar el resultado en memoria al cambiar o limpiar el lote.
- Si el lote cambia mientras la consulta está en curso, guardar el resultado solamente bajo la geometría original y no mostrarlo como resultado del lote nuevo.

### Almacenamiento e importación de informes

El almacenamiento intentaba leer primero `localStorage` y solo después `sessionStorage`, sin comparar cuál contenía la versión más reciente. Si una escritura fallaba en el primer almacenamiento y se guardaba en el segundo, una lectura posterior podía recuperar un estado anterior.

Corrección preparada:
- Comparar marcas de actualización y leer el estado más reciente disponible.
- Registrar una marca de actualización global.
- Agregar una operación de escritura por lote para importar todas las secciones en una sola escritura verificada.
- Validar la geometría GeoJSON y la estructura de las secciones antes de guardar.
- Eliminar caracteres de control y claves peligrosas sin pre-escapar el texto; el escape HTML se realiza en la representación.

La transferencia sigue siendo por archivo JSON entre dispositivos. No existe sincronización remota.

## 4. Límites del producto que siguen vigentes

1. **Fuentes externas:** la disponibilidad de Open-Meteo, NASA POWER, NASA FIRMS, WMS/WFS y catálogos STAC depende del proveedor, del área y del período consultado.
2. **Cartografía de suelo:** los valores de pH de INTA-CIRN son modelos cartográficos de 1 km; no son análisis de laboratorio ni mediciones directas de cada lote. Las clases de salinidad permanecen sin interpretación mientras no se valide la leyenda.
3. **Teledetección forestal:** NDVI no es biomasa, inventario, sanidad ni rendimiento. Sentinel-1 permanece en DN VV/VH sin calibración sigma0 y no permite inferir humedad, biomasa o especie.
4. **Productividad:** no se infiere rendimiento agrícola o forestal a partir de índices remotos. Las comparaciones de rendimiento requieren cosechas, inventarios o registros de campo.
5. **Geometrías:** un polígono es un área de interés y no certifica límites parcelarios, mensura ni titularidad.
6. **PDF:** el informe utiliza la función de impresión del navegador para guardar como PDF; no es un generador PDF independiente.
7. **Almacenamiento:** los proyectos, lotes y resultados continúan guardándose localmente en el navegador. No hay cuentas ni sincronización remota.
8. **Protección de consumo:** el rate limit perimetral no reemplaza límites de tamaño de AOI, fechas, concurrencia y costo computacional en backend.

## 5. Verificación y publicación

- Esta revisión fue estática: lectura de código y seguimiento de contratos entre módulos. No se ejecutaron pruebas manuales, pruebas de integración ni nuevos builds/despliegues, respetando la restricción operativa de evitar ejecuciones y publicaciones innecesarias.
- GitHub Actions puede ejecutar automáticamente los controles configurados al abrir el PR. Un workflow verde no sustituye la validación funcional de fuentes externas, lotes reales y dispositivos móviles.
- Las correcciones de la rama deben considerarse pendientes hasta que el PR se revise, se integre y una publicación de producción alcance estado READY.

## 6. Criterio de cierre

Agro-Consultas debe seguir evolucionando sobre el motor existente, sin sumar módulos durante esta etapa. La prioridad es que cada flujo sea reproducible y trazable desde la fuente hasta el resultado, que el estado guardado se recupere sin contradicciones y que la interfaz no presente datos de otro lote ni convierta ausencias en valores.

La presencia de una fuente, endpoint o componente visual no demuestra por sí sola que una capacidad esté operativa. Para declarar una capacidad validada hace falta comprobar su recorrido completo con datos externos actuales y geometrías representativas.
