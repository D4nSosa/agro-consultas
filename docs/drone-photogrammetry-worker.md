# Fotogrametría y ortomosaicos: arquitectura de procesamiento

## Estado

La fotogrametría de drones no está activa en la instancia Vercel actual. No se presenta como una función disponible hasta tener un worker de larga duración y almacenamiento persistente.

## Motor elegido

NodeODM/OpenDroneMap es el motor propuesto. Procesa fotografías aéreas y puede producir ortofotos georreferenciadas, modelos digitales de superficie/terreno, nubes de puntos y modelos 3D texturizados. NodeODM expone una API REST y recomienda ejecución mediante Docker.

Referencias técnicas:
- NodeODM REST API: https://platform.opendronemap.org/nodeodm/
- ODM: https://github.com/OpenDroneMap/ODM

## Flujo requerido

1. El navegador carga las fotografías originales directamente a almacenamiento persistente mediante URLs de subida firmadas y por partes.
2. El backend crea un trabajo en NodeODM y registra el identificador de tarea asociado al lote.
3. NodeODM procesa en un worker con CPU, memoria, disco persistente y cola de trabajos.
4. Agro-Consultas consulta el estado/progreso y recoge los productos terminados.
5. Un servicio de ráster/tiles publica la ortofoto y los modelos como capas dentro del mapa existente.
6. El usuario inspecciona ortomosaico, DSM/DTM, pendiente y productos 3D dentro de Agro-Consultas. No se requiere QGIS.

## API de NodeODM

El flujo de carga grande usa:
- `POST /task/new/init`
- `POST /task/new/upload/{uuid}` (repetible por partes/archivos)
- `POST /task/new/commit/{uuid}`
- `GET /task/{uuid}/info`
- `GET /task/{uuid}/output`
- `GET /task/{uuid}/download/all.zip`

Los estados documentados incluyen queued (10), running (20), failed (30), completed (40) y canceled (50).

## Infraestructura necesaria

- Un host externo a Vercel Functions que pueda ejecutar NodeODM/ODM en Docker.
- Volumen persistente para los datos de cada tarea; NodeODM documenta el montaje de `/var/www/data`.
- Almacenamiento de objetos para subida directa de fotos y conservación de resultados/ortofotos.
- Un servicio de teselas compatible con GeoTIFF/COG para visualizar ortofotos y modelos en el mapa.
- Autenticación entre backend y worker. El token de NodeODM no debe quedar expuesto en el navegador.
- Límites por lote: cantidad de fotos, tamaño total, resolución, área cubierta y cuota de almacenamiento.

## Por qué no se procesa en una función Vercel

Un vuelo puede incluir decenas o cientos de fotografías y requiere reconstrucción SfM/MVS, escritura de archivos grandes y minutos u horas de CPU. Una función serverless de frontend/backend no ofrece un disco persistente ni una ventana de ejecución apropiada para ese trabajo. Recibir todas las fotos a través de la API Vercel también introduce límites de tamaño de petición.

## Variables previstas

- `ODM_NODE_URL`: URL privada del servicio NodeODM.
- `ODM_NODE_TOKEN`: credencial de servicio, solo en backend.
- `DRONE_STORAGE_BUCKET` y credenciales del proveedor: almacenamiento de originales y resultados.
- `DRONE_TILE_SERVICE_URL`: servicio interno para publicar GeoTIFF/COG como teselas.

La capacidad `dronePhotogrammetry` de `GET /api/engine/capabilities` informa `NOT_CONFIGURED` mientras falte la URL/token del worker. Eso no significa que la fotogrametría esté operativa: el almacenamiento persistente y el servicio de teselas también deben estar provisionados y probados.

## Licencia

NodeODM y ODM se distribuyen bajo AGPL-3.0. Antes de modificar, redistribuir o integrar componentes derivados, hay que revisar y cumplir sus obligaciones de licencia.
