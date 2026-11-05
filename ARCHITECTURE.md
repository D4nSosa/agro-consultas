# Evolución integrada de Agro-Consultas

## Contexto de lote compartido
La evolución adopta `services/lotContext.js` como contrato común para el área de interés (AOI). El objeto se representa como GeoJSON Feature Polygon/MultiPolygon en WGS84, con propiedades y metadatos de procedencia. Se persiste en localStorage y sessionStorage para permitir el paso entre páginas clásicas y emite el evento `agro:lot-context-changed`.

El contexto compartido no reemplaza los motores de Aptitud, Forestal, Clima, Suelos ni Tracking. Cada módulo conserva su responsabilidad y puede dibujar capas temáticas propias, pero debe consumir el mismo AOI cuando corresponda. Un punto GPS es una referencia puntual, no un lote con superficie.

## Geometría
El servicio normaliza Feature, Polygon y MultiPolygon; rechaza puntos, coordenadas fuera de rango, anillos abiertos, menos de tres vértices distintos y polígonos degenerados. La interfaz principal admite agregar vértices hasta que el usuario cierre manualmente con el botón de dibujo. El botón secundario deshace el último vértice durante el dibujo; fuera de dibujo limpia la selección.

## Evolución de interfaz
La futura pantalla de mapa central debe ser una capa de entrada y navegación que cree/seleccione el AOI y entregue el mismo contexto a los módulos. No debe duplicar motores de análisis ni eliminar los mapas temáticos específicos. La interfaz clásica se mantiene como ruta de compatibilidad durante la transición.

## Procedencia y validación
- Clima en vivo, climatología histórica y referencias regionales deben identificarse por separado.
- Los datos WMS de suelos no equivalen a muestreo de laboratorio ni a estadísticas completas del polígono.
- La asignación territorial por coordenada más cercana es una referencia, no una intersección con límites administrativos.
- Los análisis Sentinel dependen de escenas disponibles, fechas, cobertura de nubes y procesamiento correcto; ausencia de escena debe mostrarse como no disponible.
- Los datos agrícolas SAGyP locales deben conservar campaña y fecha de actualización visibles.

## Límites de validación
Este documento describe contratos y comportamiento esperado. La integración externa y los recorridos end-to-end requieren pruebas en navegador y en el despliegue Preview; no deben considerarse aprobados solo por existir código.
