# Monitoreo de incendios — Agro-Consultas

## Fuentes y cobertura

La vista de monitoreo reciente consume los geoservicios WFS públicos de CONAE:

- `GeoServiciosCONAE:FocosDeCalor`: focos MODIS de Aqua/Terra.
- `GeoServiciosCONAE:FocosDeCalorVIIRS`: focos VIIRS de SNPP/NOAA-20.

Las capas WFS publicadas en el catálogo OGC corresponden a las últimas 24 horas. El módulo las presenta como monitoreo reciente, no como un archivo histórico.

## Análisis histórico

La vista histórica acepta archivos CSV detallados de focos de calor de CONAE y NASA FIRMS. El análisis se ejecuta localmente en el navegador: filtra los puntos por la geometría del lote, aplica el filtro de confianza cuando el dato es numérico y calcula totales anuales y mensuales separados por MODIS y VIIRS.

### Cómo obtener el CSV de CONAE

1. Abrir [Consultas Interactivas: Incendios](https://catalogos5.conae.gov.ar/catalogofocos/default.aspx).
2. Seleccionar Focos de Calor, los satélites y el período histórico deseado.
3. Elegir el área de interés (coordenadas del lote o provincia/departamento), seleccionar salida **Detalle** y formato CSV.
4. Ejecutar la consulta e iniciar sesión con una cuenta registrada de CONAE para habilitar la descarga.
5. Si se seleccionaron ambos instrumentos, importar los CSV MODIS y VIIRS juntos en Agro-Consultas.

La consulta web de CONAE es de acceso abierto; la identificación de usuario se exige para descargar archivos. El manual documenta registros detallados con satélite, instrumento, latitud, longitud, fecha/hora, confianza y potencia radiativa. No usar las salidas **Totalizar** para el mapa de puntos.

### NASA FIRMS

También se aceptan CSV de descarga histórica de FIRMS. El archivo de descarga ofrece productos históricos MODIS y VIIRS con distintas coberturas temporales. La API automatizada requiere un MAP_KEY; por eso no se incluye ninguna clave en el frontend ni en el repositorio. En esta versión, la importación de CSV evita credenciales y mantiene la procedencia del archivo.

## Método e interpretación

- La serie mensual y anual cuenta detecciones originales por instrumento. Los conteos MODIS y VIIRS no se suman como si fueran observaciones equivalentes.
- El agrupamiento exploratorio de eventos coincidentes usa mismo día y distancia máxima de 1.000 metros. Se muestra separado de los registros originales y no equivale a una metodología validada por CONAE.
- La confianza numérica se filtra por porcentaje; las categorías FIRMS `low`, `nominal` y `high` se conservan como etiquetas, sin convertirlas artificialmente en porcentajes.
- Los CSV se procesan en memoria del navegador y no se suben a un servidor.
- Los resultados representan focos de calor detectados, no perímetros ni superficie quemada.
- Los datos de área quemada mensual de CONAE son otro producto, agregado por provincia/departamento; no se mezclan con la serie de focos puntuales.
- Para mantener fluida la navegación, el mapa dibuja hasta 10.000 eventos; las estadísticas incluyen todos los registros filtrados.

## Pruebas

```bash
python tests/check_frontend_syntax.py
node --experimental-default-type=module --test tests/lotContext.test.mjs tests/fireMonitoring.test.mjs
```

## Referencias

- [Geoservicios OGC de CONAE](https://catalogos.conae.gov.ar/catalogo/catalogoGeoServiciosOGC.html)
- [Catálogo de focos de calor y áreas quemadas](https://catalogos5.conae.gov.ar/catalogofocos/default.aspx)
- [Manual de usuario CONAE: Consultas Interactivas de Incendios](https://catalogos5.conae.gov.ar/catalogofocos/Docs/035_CONAE_AQUA_TERRA_NOAA20_MODIS_VIIRS_FC_VISOR_ManualUsuarios_e02.pdf)
- [NASA FIRMS — Archive Download](https://firms.modaps.eosdis.nasa.gov/download/)
- [NASA FIRMS — API Map Key](https://firms.modaps.eosdis.nasa.gov/api/map_key)
