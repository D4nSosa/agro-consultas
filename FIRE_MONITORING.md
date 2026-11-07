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
