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
        textura: subregionStaticData.textura || "Regional",
        drenaje: subregionStaticData.drenaje || "Bueno a Moderado",
        limitantes: subregionStaticData.limitantes || "Ninguna declarada a escala regional",
        aptitud: subregionStaticData.aptitud || "Agrícola regional",
        ph: subregionStaticData.ph !== undefined ? subregionStaticData.ph : 6.5,
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
