/**
 * Adaptador INTA-CIRN para mapas nacionales de pH y suelos afectados por sales.
 * Las consultas WMS se realizan desde el backend para evitar CORS y conservar procedencia.
 */

const CACHE_PREFIX = 'agro_cache_inta_v2_';
const CACHE_EXPIRY = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12000;

function unavailable(message) {
  return {
    tipo: null,
    textura: null,
    drenaje: null,
    limitantes: null,
    aptitud: null,
    ph: null,
    ph_0_30: null,
    ph_30_100: null,
    salinidad: null,
    salinidad_0_30_raw: null,
    salinidad_30_100_raw: null,
    escala: null,
    status: 'UNAVAILABLE',
    confidence: 'none',
    evidenceType: 'UNAVAILABLE',
    fuente: 'Consulta cartográfica INTA-CIRN no disponible',
    fechaActualizacion: null,
    fechaConsulta: null,
    retrievedAt: null,
    cached: false,
    fallback: false,
    error: message
  };
}

/**
 * Consulta las capas nacionales INTA para un punto WGS84.
 * Si el punto corresponde a un lote, el resultado representa solo el centroide.
 */
export async function fetchINTASoilData(lat, lng, _subregionStaticData = null) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return unavailable('Coordenadas WGS84 inválidas.');
  }

  const cacheKey = `${CACHE_PREFIX}${lat.toFixed(3)}_${lng.toFixed(3)}`;
  try {
    if (typeof localStorage !== 'undefined') {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const entry = JSON.parse(cached);
        if (Date.now() - entry.timestamp < CACHE_EXPIRY && entry.origin === 'inta-api-v2') {
          return { ...entry.data, cached: true, fallback: false };
        }
        localStorage.removeItem(cacheKey);
      }
    }
  } catch (err) {
    console.warn('[INTA] No se pudo leer caché local:', err);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
    const response = await fetch(`/api/soil/inta?${params.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    const products = payload.products || {};
    const ph030 = products.ph_0_30 || {};
    const ph30100 = products.ph_30_100 || {};
    const sal030 = products.salinity_0_30 || {};
    const sal30100 = products.salinity_30_100 || {};

    const data = {
      tipo: 'Cartografía modelada de pH del suelo (INTA-CIRN)',
      textura: null,
      drenaje: null,
      limitantes: null,
      aptitud: null,
      ph: ph030.value ?? null,
      ph_0_30: ph030.value ?? null,
      ph_30_100: ph30100.value ?? null,
      ph_0_30_quality: ph030.quality ?? null,
      ph_30_100_quality: ph30100.quality ?? null,
      phProfundidad: '0-30 cm',
      salinidad: null,
      salinidad_0_30_raw: sal030.rawClass ?? sal030.rawValue ?? null,
      salinidad_30_100_raw: sal30100.rawClass ?? sal30100.rawValue ?? null,
      salinityClassInterpretation: 'NOT_INTERPRETED_PENDING_LEGEND',
      escala: ph030.resolution ? `${ph030.resolution} m pixel (pH); resolución de salinidad no informada` : 'Resolución no informada',
      resolution: {
        ph: ph030.resolution ?? null,
        salinity: sal030.resolution ?? null,
        unit: 'm'
      },
      status: payload.status || 'UNAVAILABLE',
      confidence: 'none',
      evidenceType: 'CARTOGRAPHIC',
      fuente: payload.source || 'INTA-CIRN',
      sourceUrl: payload.sourceUrl || null,
      dataset: payload.dataset || null,
      products,
      sampleMethod: payload.sampleMethod || 'Punto de consulta; no representa la totalidad del lote',
      limitations: payload.limitations || [],
      fechaActualizacion: null,
      fechaConsulta: payload.retrievedAt || null,
      retrievedAt: payload.retrievedAt || null,
      cached: false,
      fallback: false,
      error: null
    };

    if (data.status === 'CARTOGRAPHIC' || data.status === 'PARTIAL') {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(cacheKey, JSON.stringify({
            data,
            timestamp: Date.now(),
            origin: 'inta-api-v2'
          }));
        }
      } catch (err) {
        console.warn('[INTA] No se pudo guardar caché local:', err);
      }
    }
    return data;
  } catch (err) {
    return unavailable(err.name === 'AbortError' ? 'Timeout consultando el backend INTA.' : err.message);
  } finally {
    clearTimeout(timeoutId);
  }
}
