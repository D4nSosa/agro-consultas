# Monitoreo de incendios — Agro-Consultas

## Fuentes y cobertura

La primera versión consume los geoservicios WFS públicos de CONAE:

- `GeoServiciosCONAE:FocosDeCalor`: focos MODIS de Aqua/Terra.
- `GeoServiciosCONAE:FocosDeCalorVIIRS`: focos VIIRS de SNPP/NOAA-20.

La ficha pública de CONAE describe estas capas como datos de las últimas 24 horas. La interfaz, por lo tanto, las presenta como monitoreo reciente. No construye una serie histórica ni calcula anomalías multianuales.

## Flujo

1. Lee el lote Polygon/MultiPolygon compartido por `services/lotContext.js`.
2. Consulta las dos capas WFS usando el bounding box del lote.
3. Filtra los puntos contra la geometría exacta y la confianza mínima elegida.
4. Agrupa detecciones de sensores distintos si corresponden al mismo día y están separadas hasta 1.000 metros.
5. Muestra eventos coincidentes y detecciones de un solo sensor en el mapa.

## Interpretación

- Un foco de calor es una detección satelital, no una confirmación de incendio.
- El umbral de 1 km es un criterio exploratorio de coincidencia; no equivale a una equivalencia física de píxeles ni a una metodología validada por CONAE.
- Confianza y potencia radiativa se mantienen separadas por sensor. No se suman ni promedian entre instrumentos.
- La consulta pagina hasta 5.000 registros por sensor. Si llega al límite, se advierte que el resultado puede estar incompleto.

## Etapa histórica pendiente

Para cumplir el desafío de armonización histórica MODIS/VIIRS hay que incorporar productos archivados y normalizar fechas, atributos, resolución y procedencia. Las vías a evaluar son el Catálogo de Focos de Calor y Áreas Quemadas de CONAE y NASA FIRMS. La API de FIRMS requiere un MAP_KEY gratuito: nunca debe subirse al repositorio ni incrustarse en el código público.

## Pruebas

```bash
python tests/check_frontend_syntax.py
node --experimental-default-type=module --test tests/lotContext.test.mjs tests/fireMonitoring.test.mjs
```

## Referencias

- [Geoservicios OGC de CONAE](https://catalogos.conae.gov.ar/catalogo/catalogoGeoServiciosOGC.html)
- [Catálogo de focos de calor y áreas quemadas](https://catalogos5.conae.gov.ar/catalogofocos/default.aspx)
- [NASA FIRMS — API Map Key](https://firms.modaps.eosdis.nasa.gov/api/map_key)

## Análisis histórico en Agro-Consultas

La vista histórica acepta archivos CSV detallados de focos de calor de CONAE y NASA FIRMS. El análisis se ejecuta localmente en el navegador: filtra los puntos por la geometría del lote, aplica el filtro de confianza cuando el dato es numérico y calcula totales mensuales separados por MODIS y VIIRS.

### Cómo obtener el CSV de CONAE

1. Abrir [Consultas Interactivas: Incendios](https://catalogos5.conae.gov.ar/catalogofocos/default.aspx).
2. Seleccionar Focos de Calor, los satélites y el período histórico deseado.
3. Elegir el área de interés (coordenadas del lote o provincia/departamento), seleccionar salida Detalle y formato CSV.
4. Ejecutar la consulta e iniciar sesión con una cuenta registrada de CONAE para habilitar la descarga.
5. Si se seleccionaron ambos instrumentos, importar los CSV MODIS y VIIRS juntos en Agro-Consultas.

La consulta web de CONAE es de acceso abierto; la identificación de usuario se exige para descargar archivos. El manual documenta registros detallados con satélite, instrumento, latitud, longitud, fecha/hora, confianza y potencia radiativa. No usar las salidas Totalizar para el mapa de puntos.

### NASA FIRMS

También se aceptan CSV de descarga histórica de FIRMS. El servicio ofrece archivos de focos antiguos y distintas coberturas temporales para MODIS/VIIRS. La API automatizada requiere un MAP_KEY; por eso no se incluye ninguna clave en el frontend ni en el repositorio. Para esta versión, la importación de CSV evita credenciales y mantiene la procedencia del archivo.

### Alcance metodológico

- La serie mensual cuenta detecciones originales por instrumento. Los conteos MODIS y VIIRS no se suman como si fueran observaciones equivalentes.
- El agrupamiento de eventos coincidentes (mismo día, distancia máxima 1 km) es exploratorio y se muestra aparte de los registros originales.
- Los CSV se procesan en memoria del navegador y no se suben a un servidor.
- Los resultados representan focos de calor detectados, no perímetros ni superficie quemada.
- Los datos de área quemada mensual de CONAE son otro producto, agregado por provincia/departamento; no se mezclan con la serie de focos puntuales.
