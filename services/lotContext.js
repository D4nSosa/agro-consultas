/**
 * Contexto territorial compartido entre los módulos de Agro-Consultas.
 * La geometría almacenada es GeoJSON WGS84 [longitud, latitud].
 * No genera ubicaciones ni geometrías por defecto.
 */
const STORAGE_KEY = 'agro_lot_context_v1';
const EVENT_NAME = 'agro:lot-context-changed';

function unwrap(input) {
  if (!input || typeof input !== 'object') throw new Error('GeoJSON vacío o inválido.');
  if (input.type === 'Feature') return input;
  if (input.type === 'FeatureCollection') {
    if (!Array.isArray(input.features) || input.features.length !== 1) {
      throw new Error('Importá una FeatureCollection con una única geometría.');
    }
    return input.features[0];
  }
  return { type: 'Feature', properties: {}, geometry: input };
}

function validatePosition(position) {
  return Array.isArray(position) && position.length >= 2 &&
    Number.isFinite(Number(position[0])) && Number.isFinite(Number(position[1])) &&
    Number(position[0]) >= -180 && Number(position[0]) <= 180 &&
    Number(position[1]) >= -90 && Number(position[1]) <= 90;
}

function ringArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(sum / 2);
}

function validateRing(ring) {
  if (!Array.isArray(ring) || ring.length < 4) throw new Error('El anillo necesita al menos 3 vértices y el cierre.');
  if (!ring.every(validatePosition)) throw new Error('Hay coordenadas GeoJSON inválidas; se espera [longitud, latitud].');
  const first = ring[0], last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) throw new Error('El polígono debe cerrarse manualmente.');
  const unique = new Set(ring.slice(0, -1).map(p => p.join(',')));
  if (unique.size < 3) throw new Error('El polígono necesita al menos 3 vértices distintos.');
  if (ringArea(ring) <= 1e-12) throw new Error('El polígono no tiene superficie válida.');
}

export function normalizeLotFeature(input, metadata = {}) {
  const feature = unwrap(input);
  const geometry = feature.geometry;
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) {
    throw new Error('El lote debe ser Polygon o MultiPolygon; un punto no define superficie.');
  }
  if (geometry.type === 'Polygon') {
    if (!Array.isArray(geometry.coordinates) || !geometry.coordinates.length) throw new Error('Polígono sin anillos.');
    geometry.coordinates.forEach(validateRing);
  } else {
    if (!Array.isArray(geometry.coordinates) || !geometry.coordinates.length) throw new Error('MultiPolygon vacío.');
    geometry.coordinates.forEach(poly => {
      if (!Array.isArray(poly) || !poly.length) throw new Error('MultiPolygon con polígono vacío.');
      poly.forEach(validateRing);
    });
  }
  return {
    type: 'Feature',
    geometry: JSON.parse(JSON.stringify(geometry)),
    properties: { ...(feature.properties || {}), ...metadata, contextVersion: 1, updatedAt: new Date().toISOString() }
  };
}

export function getLotContext() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY) || globalThis.sessionStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return normalizeLotFeature(parsed.feature, parsed.metadata || {});
  } catch (error) {
    console.warn('[Agro-Consultas] No se pudo recuperar el lote compartido:', error);
    return null;
  }
}

export function setLotContext(input, metadata = {}) {
  const feature = normalizeLotFeature(input, metadata);
  const payload = { feature, metadata: { source: metadata.source || feature.properties.source || 'user-selected' } };
  const serialized = JSON.stringify(payload);
  try { globalThis.localStorage?.setItem(STORAGE_KEY, serialized); } catch (_) {}
  try { globalThis.sessionStorage?.setItem(STORAGE_KEY, serialized); } catch (_) {}
  globalThis.dispatchEvent?.(new CustomEvent(EVENT_NAME, { detail: feature }));
  return feature;
}

export function clearLotContext() {
  try { globalThis.localStorage?.removeItem(STORAGE_KEY); } catch (_) {}
  try { globalThis.sessionStorage?.removeItem(STORAGE_KEY); } catch (_) {}
  globalThis.dispatchEvent?.(new CustomEvent(EVENT_NAME, { detail: null }));
}

export function onLotContextChange(callback) {
  const handler = event => callback(event.detail || null);
  globalThis.addEventListener?.(EVENT_NAME, handler);
  return () => globalThis.removeEventListener?.(EVENT_NAME, handler);
}

export const LOT_CONTEXT_STORAGE_KEY = STORAGE_KEY;
