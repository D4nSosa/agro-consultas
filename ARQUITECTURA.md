# Arquitectura de Agro-Consultas

## Entradas y navegación

- `index.html`: Home institucional y punto de entrada público.
- `workspace.html`: espacio geoespacial central; mapa, selección/dibujo/importación de áreas, análisis coordinados, historial y proyectos portables.
- `inicio.html`: ruta institucional anterior conservada por compatibilidad.
- `resultados.html`: módulo clásico de aptitud y diagnóstico territorial.
- `forestal.html`: módulo forestal y de teledetección.
- `tracking.html`: herramienta de medición y tracking GPS.

El Home enlaza con el Workspace y los módulos clásicos. El Workspace permite volver al Home y abrir cada módulo clásico. Los módulos clásicos enlazan al Home y al Workspace. Las rutas anteriores se conservan; no se reemplazan por páginas vacías ni redirecciones.

## Workspace central

El Workspace mantiene el mapa como superficie de trabajo común. El área activa es el contexto para ejecutar aptitud, clima, suelos, análisis forestal y consultas Sentinel. También conserva selección/importación de geometrías, áreas guardadas, tracking GPS, historial local e importación/exportación de proyectos.

## Análisis y fuentes

- Aptitud: catálogo agrícola provincial, compatibilidad y factores del motor existente. La evaluación actual usa contexto edáfico y climático asociado al centroide; no representa una zonificación por píxel dentro del polígono.
- Clima: consulta actual Open-Meteo y serie histórica NASA POWER cuando la fuente responde.
- Suelos: cartografía de referencia disponible; no sustituye muestreo ni análisis de laboratorio.
- Forestal y satélite: servicios existentes de análisis y catálogos Sentinel-1/2, sujetos a cobertura, fechas y respuesta de los proveedores.
- Tracking: geolocalización del dispositivo y exportación de geometrías compatibles.
- Informes: salida imprimible del Workspace, que puede guardarse como PDF desde el navegador.

## Persistencia y formatos

Las áreas, ejecuciones e historial del Workspace se guardan en el almacenamiento local del navegador. La exportación/importación de proyecto permite trasladar un paquete JSON entre dispositivos; no equivale a sincronización en la nube ni a colaboración multiusuario. Se admiten los formatos que implementan los importadores de cada módulo; no asumir compatibilidad con Shapefile ZIP o GeoTIFF si no se valida expresamente.

## Criterios de integridad

- No sustituir fallos de proveedores por datos sintéticos.
- Mostrar como no disponible la información que no pudo consultarse.
- Diferenciar observación satelital, estimación, cartografía regional y medición de campo.
- No representar como mapa de aptitud por píxel una clasificación calculada sobre el centroide.
- Un build exitoso no demuestra que todas las fuentes externas respondan; la validación funcional requiere un lote real y pruebas por módulo.

## Validación pendiente antes de producción

1. Probar el recorrido Home → Workspace → módulos clásicos → Home.
2. Probar importación GeoJSON/KML/GPX, dibujo, guardado, recarga e intercambio de proyectos.
3. Ejecutar aptitud y verificar filtros, catálogo provincial, clasificación y detalle técnico.
4. Consultar clima actual e historia NASA POWER; verificar estados de error/no disponibilidad.
5. Ejecutar los servicios forestales y Sentinel-1/2 con un polígono real y fechas explícitas.
6. Probar tracking GPS en un dispositivo con permisos concedidos.
7. Generar el informe imprimible y revisar que no incluya valores inexistentes.
