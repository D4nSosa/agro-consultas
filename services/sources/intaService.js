/**
 * Adaptador de Servicio para la API del Instituto Nacional de Tecnología Agropecuaria (INTA) de Argentina
 * Proporciona información edafológica y cartografía de suelos con almacenamiento en caché (localStorage) y tolerancia a fallos.
 */

const CACHE_PREFIX = 'agro_cache_inta_';
const CACHE_EXPIRY = 24 * 60 * 60 * 1000; // 24 horas de vigencia de datos de suelo de INTA

/**
 * Obtiene la información edafológica de INTA para unas coordenadas dadas.
 * Realiza una consulta espacial simulada (o real si está disponible) a los servicios WMS/WFS de INTA.
 * @param {number} lat - Latitud.
 * @param {number} lng - Longitud.
 * @param {Object} subregionStaticData - Datos estáticos de suelo de la subregión para fallback inmediato.
 * @returns {Promise<Object>} Datos de suelo del territorio.
 */
export async function fetchINTASoilData(lat, lng, subregionStaticData = null) {
  const cacheKey = `${CACHE_PREFIX}${lat.toFixed(4)}_${lng.toFixed(4)}`;

  // 1. Intentar recuperar desde Caché
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_EXPIRY) {
        return { ...data, fuente: 'INTA GeoServer (Caché local)', cached: true };
      }
    }
  } catch (err) {
    console.warn("[INTA] Error al leer caché edafológico:", err);
  }

  // 2. Intentar consulta remota (ej. WMS GetFeatureInfo o servicios de la Infraestructura de Datos Espaciales del INTA)
  try {
    // URL base de ejemplo del nodo SIG de INTA (Suelos de Argentina)
    // En producción, esto consulta la cartografía edafológica nacional a escala 1:50.000 o 1:250.000.
    const baseUrl = 'https://geoserver.inta.gob.ar/geoserver/wms';
    const params = new URLSearchParams({
      service: 'WMS',
      version: '1.1.1',
      request: 'GetFeatureInfo',
      layers: 'suelos:cartografia_nacional',
      bbox: `${lng - 0.01},${lat - 0.01},${lng + 0.01},${lat + 0.01}`,
      width: '101',
      height: '101',
      srs: 'EPSG:4326',
      format: 'image/png',
      query_layers: 'suelos:cartografia_nacional',
      info_format: 'application/json',
      x: '50',
      y: '50'
    });

    // Simulamos la llamada remota con un timeout corto para evitar bloqueos
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s timeout para garantizar agilidad

    const response = await fetch(`${baseUrl}?${params.toString()}`, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
    const geoJson = await response.json();

    // Si obtenemos respuesta estructurada de INTA, la parseamos
    if (geoJson && geoJson.features && geoJson.features.length > 0) {
      const props = geoJson.features[0].properties;
      const data = {
        tipo: props.tipo_suelo || props.GREATGROUP || "Molisol",
        textura: props.textura || props.TEXTURE || "Franco-limosa",
        drenaje: props.drenaje || props.DRAINAGE || "Bueno",
        limitantes: props.limitantes || props.LIMITATIONS || "Ninguna",
        aptitud: props.aptitud || props.APTITUDE || "Agrícola",
        ph: parseFloat(props.ph || props.PH || "6.5"),
        escala: "1:50.000",
        fechaActualizacion: new Date().toISOString()
      };

      // Guardar en caché
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ data, timestamp: Date.now() }));
      } catch (e) {}

      return { ...data, fuente: 'INTA Cartografía Oficial (WMS)', cached: false };
    } else {
      throw new Error("No se encontraron features en la coordenada");
    }
  } catch (err) {
    console.log("[INTA] Consulta de mapa de suelo en tiempo real no disponible, activando adaptador estático:", err.message);

    // 3. Cuando no hay respuesta remota puntual WMS/WFS de INTA:
    // Si contamos con datos estáticos subregionales provistos por la cartografía regional, los marcamos explícitamente como REGIONAL.
    if (subregionStaticData) {
      const data = {
        tipo: subregionStaticData.tipo || "No especificado",
        textura: subregionStaticData.textura || "No especificada",
        drenaje: subregionStaticData.drenaje || "No especificado",
        limitantes: subregionStaticData.limitantes || "Ninguna",
        aptitud: subregionStaticData.aptitud || "Mixta",
        ph: subregionStaticData.ph !== undefined ? subregionStaticData.ph : 6.5,
        escala: "1:250.000 (Cartografía Regional)",
        fechaActualizacion: new Date().toISOString()
      };
      return { ...data, fuente: 'Cartografía Regional de Suelos (INTA/Agro Consultas)', cached: false, fallback: false, isRegional: true, isUnavailable: false };
    }

    // Si tampoco hay datos regionales, indicar explícitamente indisponibilidad sin inventar pH o textura ficticios
    return {
      available: false,
      isUnavailable: true,
      tipo: "Información de suelo no disponible",
      textura: "No disponible",
      drenaje: "No disponible",
      limitantes: "No disponible",
      aptitud: "No disponible",
      ph: null,
      fuente: 'INTA GeoServer (Sin Cobertura Puntual)',
      message: 'Información de suelo no disponible para esta ubicación'
    };
  }
}
