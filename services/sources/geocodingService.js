/**
 * geocodingService.js - Servicio de Geocodificación Real
 * Consulta Open-Meteo Geocoding API e IGN Georef Oficial.
 * No utiliza listas hardcodeadas ni coordenadas inventadas.
 */

import { createDataPoint, createUnavailableDataPoint, DataStatus, ConfidenceLevel } from '../../utils/dataModel.js';

const CACHE_PREFIX = 'agro_cache_geocoding_';
const CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 1 semana

/**
 * Geocodifica un texto ingresado por el usuario (ej: "Gobernador Virasoro", "Río Cuarto", "Balcarce").
 * @param {string} queryTexto - Nombre de la localidad o punto de interés.
 * @returns {Promise<Object>} Resultado con coordenadas, entidad geográfica, provincia, país y nivel espacial.
 */
export async function geocodeLocation(queryTexto) {
  if (!queryTexto || !queryTexto.trim()) {
    return createUnavailableDataPoint('Geocodificación', 'Texto de búsqueda vacío.');
  }

  const cleanQuery = queryTexto.trim();
  const cacheKey = `${CACHE_PREFIX}${cleanQuery.toLowerCase().replace(/\s+/g, '_')}`;

  // 1. Verificar Caché
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_EXPIRY) {
        return { ...data, cached: true };
      }
    }
  } catch (err) {
    console.warn('[Geocoding] Error al leer caché:', err);
  }

  // 2. Intentar Open-Meteo Geocoding API (Global / Argentina)
  try {
    const encoded = encodeURIComponent(cleanQuery);
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encoded}&count=5&language=es&format=json`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (resp.ok) {
      const data = await resp.json();
      const results = data.results || [];

      if (results.length > 0) {
        // Priorizar resultados en Argentina si existen
        const argResult = results.find(r => r.country_code === 'AR') || results[0];

        const spatialLevel = determineSpatialLevel(argResult);

        const geoPoint = {
          nombre: argResult.name,
          localidad: argResult.name,
          departamento: argResult.admin2 || null,
          provincia: argResult.admin1 || 'Argentina',
          pais: argResult.country || 'Argentina',
          lat: argResult.latitude,
          lng: argResult.longitude,
          elevation: argResult.elevation || null,
          geoId: argResult.id ? String(argResult.id) : null,
          spatialLevel: spatialLevel,
          source: 'Open-Meteo Geocoding API (Oficial)'
        };

        const resultPoint = createDataPoint({
          value: geoPoint,
          source: 'Open-Meteo Geocoding API',
          sourceUrl: 'https://open-meteo.com/en/docs/geocoding-api',
          status: DataStatus.REAL,
          confidence: ConfidenceLevel.HIGH,
          resolution: 'Localidad / Punto'
        });

        try {
          localStorage.setItem(cacheKey, JSON.stringify({ data: resultPoint, timestamp: Date.now() }));
        } catch (e) {}

        return resultPoint;
      }
    }
  } catch (err) {
    console.warn('[Geocoding] Falló Open-Meteo Geocoding, intentando IGN Georef:', err.message);
  }

  // 3. Fallback a IGN Georef Localidades API (Argentina)
  try {
    const encoded = encodeURIComponent(cleanQuery);
    const url = `https://apis.datos.gob.ar/georef/api/localidades?nombre=${encoded}&max=5`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (resp.ok) {
      const data = await resp.json();
      const locs = data.localidades || [];

      if (locs.length > 0) {
        const loc = locs[0];
        const geoPoint = {
          nombre: loc.nombre,
          localidad: loc.nombre,
          departamento: loc.departamento ? loc.departamento.nombre : null,
          provincia: loc.provincia ? loc.provincia.nombre : 'Argentina',
          pais: 'Argentina',
          lat: loc.centroide.lat,
          lng: loc.centroide.lon,
          geoId: loc.id,
          spatialLevel: 'LOCALIDAD / PUNTO DE REFERENCIA',
          source: 'IGN Georef Oficial (Gobierno Nacional)'
        };

        const resultPoint = createDataPoint({
          value: geoPoint,
          source: 'IGN Georef Localidades API',
          sourceUrl: 'https://apis.datos.gob.ar/georef/api',
          status: DataStatus.REAL,
          confidence: ConfidenceLevel.HIGH,
          resolution: 'Localidad Censal / Centroide IGN'
        });

        try {
          localStorage.setItem(cacheKey, JSON.stringify({ data: resultPoint, timestamp: Date.now() }));
        } catch (e) {}

        return resultPoint;
      }
    }
  } catch (err) {
    console.warn('[Geocoding] Falló IGN Georef API:', err.message);
  }

  return createUnavailableDataPoint(
    'Geocodificación Real',
    `NO DISPONIBLE: No se encontraron registros geográficos reales para "${queryTexto}".`
  );
}

/**
 * Determina el nivel o alcance espacial según el tipo de entidad geográfica devuelta.
 */
function determineSpatialLevel(item) {
  const code = (item.feature_code || '').toUpperCase();

  if (code.startsWith('ADM1')) return 'PROVINCIA';
  if (code.startsWith('ADM2') || code.startsWith('ADM3')) return 'REGIÓN / DEPARTAMENTO';
  if (code.startsWith('PPL')) return 'LOCALIDAD / PUNTO DE REFERENCIA';

  return 'LOCALIDAD / PUNTO DE REFERENCIA';
}
