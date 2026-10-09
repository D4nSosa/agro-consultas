/**
 * Adaptador de Servicio para la API del Instituto Nacional de Tecnología Agropecuaria (INTA) de Argentina
 * Proporciona información edafológica y cartografía de suelos con almacenamiento en caché (localStorage) y tolerancia a fallos.
 */

const CACHE_PREFIX = 'agro_cache_inta_';
const CACHE_EXPIRY = 24 * 60 * 60 * 1000; // 24 horas de vigencia de datos de suelo de INTA

/**
 * Obtiene la información edafológica de INTA para unas coordenadas dadas.
 * Realiza una consulta espacial a los servicios WMS/WFS de INTA o recurre a la cartografía regional si el nodo no responde.
 * @param {number} lat - Latitud.
 * @param {number} lng - Longitud.
 * @param {Object} subregionStaticData - Datos estáticos de suelo de la subregión para fallback inmediato.
 * @returns {Promise<Object>} Datos de suelo del territorio.
 */
/**
 * Realiza una consulta WMS GetFeatureInfo directa a la Infraestructura de Datos Espaciales de INTA
 * @param {number} lat - Latitud
 * @param {number} lng - Longitud
 * @returns {Promise<Object|null>} Propiedades edafológicas crudas de INTA GeoServer
 */
export async function queryINTAGetFeatureInfo(lat, lng) {
  try {
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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    const response = await fetch(`${baseUrl}?${params.toString()}`, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) return null;
    const geoJson = await response.json();

    if (geoJson && geoJson.features && geoJson.features.length > 0) {
      return geoJson.features[0].properties;
    }
    return null;
  } catch (err) {
    console.warn("[INTA WMS] Consulta GetFeatureInfo no respondió:", err.message);
    return null;
  }
}

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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(`${baseUrl}?${params.toString()}`, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
    const geoJson = await response.json();

    if (geoJson && geoJson.features && geoJson.features.length > 0) {
      const props = geoJson.features[0].properties;
      const rawPh = props.ph || props.PH;
      const data = {
        tipo: props.tipo_suelo || props.GREATGROUP || "Suelo clasificado WMS",
        textura: props.textura || props.TEXTURE || "No especificada en capa WMS",
        drenaje: props.drenaje || props.DRAINAGE || "No especificado en capa WMS",
        limitantes: props.limitantes || props.LIMITATIONS || "No especificadas en capa WMS",
        aptitud: props.aptitud || props.APTITUDE || "No especificada en capa WMS",
        ph: rawPh !== undefined && rawPh !== null && !isNaN(parseFloat(rawPh)) ? parseFloat(rawPh) : null,
        escala: "1:50.000 (WMS INTA)",
        status: "REAL",
        confidence: "high",
        fechaActualizacion: new Date().toISOString()
      };

      try {
        localStorage.setItem(cacheKey, JSON.stringify({ data, timestamp: Date.now() }));
      } catch (e) {}

      return { ...data, fuente: 'INTA Cartografía Oficial (WMS)', cached: false };
    } else {
      throw new Error("No se encontraron features en la coordenada");
    }
  } catch (err) {
    console.log("[INTA] Consulta de mapa de suelo en tiempo real no disponible, activando adaptador estático:", err.message);

    if (subregionStaticData) {
      const data = {
        tipo: subregionStaticData.tipo || "Información Regional de Suelos",
        textura: subregionStaticData.textura || "No disponible en cartografía regional",
        drenaje: subregionStaticData.drenaje || "No disponible en cartografía regional",
        limitantes: subregionStaticData.limitantes || "Sin información regional",
        aptitud: subregionStaticData.aptitud || "No disponible en cartografía regional",
        ph: subregionStaticData.ph !== undefined && subregionStaticData.ph !== null ? subregionStaticData.ph : null,
        escala: "1:250.000 (Cartografía Regional INTA)",
        status: "REGIONAL",
        confidence: "medium",
        fechaActualizacion: new Date().toISOString()
      };

      try {
        localStorage.setItem(cacheKey, JSON.stringify({ data, timestamp: Date.now() }));
      } catch (e) {}

      return { ...data, fuente: 'INTA / Cartografía Regional Subregional', cached: false, fallback: true };
    }

    return {
      tipo: "Información de suelo no disponible para esta ubicación",
      textura: "No disponible",
      drenaje: "No disponible",
      limitantes: "No disponible",
      aptitud: "No disponible para esta coordenada",
      ph: null,
      escala: "Sin cobertura puntual",
      status: "UNAVAILABLE",
      confidence: "none",
      fuente: 'INTA Cartografía (Sin Cobertura Puntual / Servicio No Disponible)',
      cached: false,
      fallback: false
    };
  }
}
