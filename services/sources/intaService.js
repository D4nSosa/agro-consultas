/**
 * Adaptador de Servicio para la API del Instituto Nacional de Tecnología Agropecuaria (INTA) de Argentina
 * Proporciona información edafológica y cartografía de suelos con almacenamiento en caché (localStorage) y tolerancia a fallos.
 */

const CACHE_PREFIX = 'agro_cache_inta_v2_';
const CACHE_EXPIRY = 24 * 60 * 60 * 1000; // 24 horas de vigencia de datos de suelo de INTA

/**
 * Obtiene la información edafológica de INTA para unas coordenadas dadas.
 * Realiza una consulta espacial a los servicios WMS/WFS de INTA o recurre a la cartografía regional si el nodo no responde.
 * @param {number} lat - Latitud.
 * @param {number} lng - Longitud.
 * @param {Object} subregionStaticData - Datos estáticos de suelo de la subregión para fallback inmediato.
 * @returns {Promise<Object>} Datos de suelo del territorio.
 */
const cleanSoilValue = value => {
  const text = String(value ?? '').trim();
  if (!text || /no disponible|no especificad[ao]|sin cobertura|sin información|información regional de suelos/i.test(text)) return null;
  return value;
};

export async function fetchINTASoilData(lat, lng, subregionStaticData = null) {
  const cacheKey = `${CACHE_PREFIX}${lat.toFixed(4)}_${lng.toFixed(4)}`;

  // 1. Intentar recuperar desde Caché
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const entry = JSON.parse(cached);
      const { data, timestamp, origin } = entry;
      // Las entradas antiguas no registran procedencia: se descartan para no presentar
      // un fallback regional como si fuera una consulta puntual al GeoServer.
      if (Date.now() - timestamp < CACHE_EXPIRY && (origin === 'wms' || origin === 'regional')) {
        return {
          ...data,
          escala: origin === 'wms' ? 'No informada por la respuesta WMS' : 'Regional (escala no informada)',
          fuente: origin === 'wms'
            ? 'INTA Cartografía (WMS · caché local)'
            : 'INTA / Cartografía Regional Subregional (caché local)',
          cached: true,
          fallback: origin === 'regional'
        };
      }
      if (origin !== 'wms' && origin !== 'regional') localStorage.removeItem(cacheKey);
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
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    let response;
    try {
      response = await fetch(`${baseUrl}?${params.toString()}`, { signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
    const geoJson = await response.json();

    if (geoJson && geoJson.features && geoJson.features.length > 0) {
      const props = geoJson.features[0].properties || {};
      const rawPh = props.ph ?? props.PH;
      const data = {
        tipo: cleanSoilValue(props.tipo_suelo ?? props.GREATGROUP),
        textura: cleanSoilValue(props.textura ?? props.TEXTURE),
        drenaje: cleanSoilValue(props.drenaje ?? props.DRAINAGE),
        limitantes: cleanSoilValue(props.limitantes ?? props.LIMITATIONS),
        aptitud: cleanSoilValue(props.aptitud ?? props.APTITUDE),
        ph: rawPh !== undefined && rawPh !== null && rawPh !== '' && Number.isFinite(Number(rawPh)) ? Number(rawPh) : null,
        escala: "No informada por la respuesta WMS",
        status: "REAL",
        confidence: "medium",
        fechaActualizacion: new Date().toISOString()
      };
      if (![data.tipo, data.textura, data.drenaje, data.limitantes, data.aptitud, data.ph].some(value => value !== null && value !== undefined)) {
        throw new Error("La capa respondió sin atributos edáficos interpretables");
      }
      for (const key of ['tipo', 'textura', 'drenaje', 'limitantes', 'aptitud']) {
        if (!data[key]) data[key] = 'NO DISPONIBLE';
      }

      try {
        localStorage.setItem(cacheKey, JSON.stringify({ data, timestamp: Date.now(), origin: 'wms' }));
      } catch (e) {}

      return { ...data, fuente: 'INTA Cartografía Oficial (WMS)', cached: false };
    } else {
      throw new Error("No se encontraron features en la coordenada");
    }
  } catch (err) {
    console.log("[INTA] Consulta de mapa de suelo en tiempo real no disponible, activando adaptador estático:", err.message);

    if (subregionStaticData) {
      const data = {
        tipo: cleanSoilValue(subregionStaticData.tipo) || 'NO DISPONIBLE',
        textura: cleanSoilValue(subregionStaticData.textura) || 'NO DISPONIBLE',
        drenaje: cleanSoilValue(subregionStaticData.drenaje) || 'NO DISPONIBLE',
        limitantes: cleanSoilValue(subregionStaticData.limitantes) || 'NO DISPONIBLE',
        aptitud: cleanSoilValue(subregionStaticData.aptitud) || 'NO DISPONIBLE',
        ph: subregionStaticData.ph !== undefined && subregionStaticData.ph !== null && subregionStaticData.ph !== '' && Number.isFinite(Number(subregionStaticData.ph)) ? Number(subregionStaticData.ph) : null,
        escala: subregionStaticData.escala || 'Regional (escala no informada)',
        status: [subregionStaticData.tipo, subregionStaticData.textura, subregionStaticData.drenaje, subregionStaticData.ph, subregionStaticData.limitantes].some(value => cleanSoilValue(value) !== null) ? 'REGIONAL' : 'UNAVAILABLE',
        confidence: [subregionStaticData.tipo, subregionStaticData.textura, subregionStaticData.drenaje, subregionStaticData.ph, subregionStaticData.limitantes].some(value => cleanSoilValue(value) !== null) ? 'medium' : 'none',
        fechaActualizacion: new Date().toISOString()
      };

      try {
        localStorage.setItem(cacheKey, JSON.stringify({ data, timestamp: Date.now(), origin: 'regional' }));
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
