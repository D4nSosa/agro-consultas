/**
 * geocodingService.js - Servicio de Geocodificación Real para Búsqueda de Localidades
 * Utiliza Open-Meteo Geocoding API (v1) / Nominatim OpenStreetMap sin apikeys con almacenamiento en caché local.
 */

const OPEN_METEO_GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const GEO_CACHE_KEY = 'agro_geocoding_cache_v1';

/**
 * Busca localidades por texto y devuelve lugares geocodificados reales.
 * Soporta búsquedas como: "Gobernador Virasoro", "Posadas", "Oberá", "Ituzaingó", "Corrientes", "Eldorado", "Santo Tomé", "Puerto Iguazú".
 *
 * @param {string} query - Término de búsqueda introducido por el usuario.
 * @param {number} count - Número máximo de resultados (por defecto 5).
 * @returns {Promise<Array<Object>>} Lista de resultados geográficos estructurados.
 */
export async function searchLocalities(query, count = 5) {
  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    return [];
  }

  const cleanQuery = query.trim();
  const cacheKey = cleanQuery.toLowerCase();

  // 1. Revisar caché en localStorage
  const cachedResults = getFromCache(cacheKey);
  if (cachedResults) {
    return cachedResults;
  }

  // 2. Probar Open-Meteo Geocoding API (rápida, gratuita, optimizada para lugares poblados)
  try {
    const url = `${OPEN_METEO_GEOCODING_URL}?name=${encodeURIComponent(cleanQuery)}&count=${count}&language=es&format=json`;
    const response = await fetch(url);

    if (response.ok) {
      const data = await response.json();
      if (data.results && Array.isArray(data.results) && data.results.length > 0) {
        const formatted = data.results.map(item => parseOpenMeteoResult(item));
        saveToCache(cacheKey, formatted);
        return formatted;
      }
    }
  } catch (err) {
    console.warn('[geocodingService] Error al consultar Open-Meteo Geocoding API:', err);
  }

  // 3. Fallback a Nominatim OpenStreetMap si Open-Meteo no devuelve resultados
  try {
    const url = `${NOMINATIM_SEARCH_URL}?q=${encodeURIComponent(cleanQuery)}&format=json&addressdetails=1&limit=${count}&countrycodes=ar`;
    const response = await fetch(url, {
      headers: {
        'Accept-Language': 'es',
        'User-Agent': 'AgroConsultas/1.0 (agro-consultas@local)'
      }
    });

    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        const formatted = data.map(item => parseNominatimResult(item));
        saveToCache(cacheKey, formatted);
        return formatted;
      }
    }
  } catch (err) {
    console.warn('[geocodingService] Error al consultar Nominatim OSM:', err);
  }

  return [];
}

/**
 * Mapea el formato de respuesta de Open-Meteo Geocoding
 */
function parseOpenMeteoResult(item) {
  const admin1 = item.admin1 || item.admin2 || '';
  const country = item.country || 'Argentina';

  return {
    id: `om_${item.id || item.latitude + '_' + item.longitude}`,
    name: item.name,
    displayName: `${item.name}, ${admin1 ? admin1 + ', ' : ''}${country}`,
    lat: parseFloat(item.latitude),
    lng: parseFloat(item.longitude),
    province: admin1,
    country: country,
    placeType: item.feature_code ? mapFeatureCode(item.feature_code) : 'LOCALIDAD',
    spatialScope: 'LOCALIDAD / PUNTO DE REFERENCIA',
    provenance: {
      source: 'Open-Meteo Geocoding API',
      status: 'REAL',
      accuracy: item.elevation ? `Elevación: ${item.elevation}m` : 'Coordenadas WGS84'
    }
  };
}

/**
 * Mapea el formato de respuesta de Nominatim OpenStreetMap
 */
function parseNominatimResult(item) {
  const addr = item.address || {};
  const localityName = addr.city || addr.town || addr.village || item.display_name.split(',')[0];
  const province = addr.state || addr.county || '';
  const country = addr.country || 'Argentina';

  return {
    id: `osm_${item.place_id}`,
    name: localityName,
    displayName: item.display_name,
    lat: parseFloat(item.lat),
    lng: parseFloat(item.lon),
    province: province,
    country: country,
    placeType: item.type ? item.type.toUpperCase() : 'LOCALIDAD',
    spatialScope: 'LOCALIDAD / PUNTO DE REFERENCIA',
    provenance: {
      source: 'OpenStreetMap / Nominatim',
      status: 'REAL',
      osmId: item.osm_id
    }
  };
}

function mapFeatureCode(code) {
  if (code.startsWith('PPL')) return 'LOCALIDAD / CIUDAD';
  if (code === 'ADM1') return 'PROVINCIA';
  if (code === 'ADM2') return 'DEPARTAMENTO / MUNICIPIO';
  return 'LUGAR GEOGRÁFICO';
}

function getFromCache(key) {
  try {
    const raw = localStorage.getItem(GEO_CACHE_KEY);
    if (raw) {
      const cache = JSON.parse(raw);
      return cache[key] || null;
    }
  } catch (e) {
    // Ignorar errores de almacenamiento local
  }
  return null;
}

function saveToCache(key, data) {
  try {
    const raw = localStorage.getItem(GEO_CACHE_KEY);
    const cache = raw ? JSON.parse(raw) : {};
    cache[key] = data;
    // Mantener la caché con un número razonables de consultas recientes (max 50)
    const keys = Object.keys(cache);
    if (keys.length > 50) {
      delete cache[keys[0]];
    }
    localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    // Ignorar errores de almacenamiento
  }
}
