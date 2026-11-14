/**
 * Registro y contexto territorial compartido de Agro-Consultas.
 * GeoJSON WGS84: [longitud, latitud]. El registro local es la fuente persistente
 * para todas las páginas del mismo navegador/origen.
 */
const STORAGE_KEY = 'agro_lot_registry_v2';
const LEGACY_STORAGE_KEY = 'agro_lot_context_v1';
const EVENT_NAME = 'agro:lot-context-changed';
const REGISTRY_VERSION = 2;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getStorage() {
  try {
    if (!globalThis.localStorage) throw new Error('El almacenamiento local no está disponible.');
    return globalThis.localStorage;
  } catch (error) {
    throw new Error('No se puede acceder al almacenamiento persistente del navegador: ' + error.message);
  }
}

function dispatchLotChange(feature) {
  if (typeof globalThis.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') return;
  globalThis.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: feature ? clone(feature) : null }));
}

function unwrap(input) {
  if (!input || typeof input !== 'object') throw new Error('GeoJSON vacío o inválido.');
  if (input.type === 'Feature') return input;
  if (input.type === 'FeatureCollection') {
    if (!Array.isArray(input.features) || input.features.length === 0) {
      throw new Error('La FeatureCollection no contiene geometrías.');
    }
    const features = input.features;
    if (features.length === 1) return features[0];
    const polygons = [];
    for (const item of features) {
      const geometry = item?.geometry;
      if (geometry?.type === 'Polygon') polygons.push(geometry.coordinates);
      else if (geometry?.type === 'MultiPolygon') polygons.push(...geometry.coordinates);
      else throw new Error('La FeatureCollection debe contener solo geometrías Polygon o MultiPolygon.');
    }
    return { type: 'Feature', properties: features[0]?.properties || {}, geometry: { type: 'MultiPolygon', coordinates: polygons } };
  }
  return { type: 'Feature', properties: {}, geometry: input };
}

function validatePosition(position) {
  return Array.isArray(position) && position.length >= 2 &&
    typeof position[0] === 'number' && typeof position[1] === 'number' &&
    Number.isFinite(position[0]) && Number.isFinite(position[1]) &&
    position[0] >= -180 && position[0] <= 180 &&
    position[1] >= -90 && position[1] <= 90;
}

function orientation(a, b, c) {
  const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  return Math.abs(value) < 1e-12 ? 0 : (value > 0 ? 1 : 2);
}

function onSegment(a, b, c) {
  return b[0] <= Math.max(a[0], c[0]) + 1e-12 && b[0] >= Math.min(a[0], c[0]) - 1e-12 &&
    b[1] <= Math.max(a[1], c[1]) + 1e-12 && b[1] >= Math.min(a[1], c[1]) - 1e-12;
}

function segmentsIntersect(p1, q1, p2, q2) {
  const o1 = orientation(p1, q1, p2), o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1), o4 = orientation(p2, q2, q1);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && onSegment(p1, p2, q1)) ||
    (o2 === 0 && onSegment(p1, q2, q1)) ||
    (o3 === 0 && onSegment(p2, p1, q2)) ||
    (o4 === 0 && onSegment(p2, q1, q2));
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
  for (let i = 0; i < ring.length - 1; i++) {
    if (ring[i][0] === ring[i + 1][0] && ring[i][1] === ring[i + 1][1]) {
      throw new Error('El polígono contiene vértices consecutivos duplicados.');
    }
    for (let j = i + 1; j < ring.length - 1; j++) {
      if (j === i || j === i + 1 || (i === 0 && j === ring.length - 2)) continue;
      if (segmentsIntersect(ring[i], ring[i + 1], ring[j], ring[j + 1])) {
        throw new Error('El polígono se cruza a sí mismo o tiene segmentos superpuestos.');
      }
    }
  }
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
  const properties = { ...(feature.properties || {}), ...metadata };
  return {
    type: 'Feature',
    geometry: clone(geometry),
    properties: {
      ...properties,
      contextVersion: REGISTRY_VERSION,
      updatedAt: properties.updatedAt || new Date().toISOString()
    }
  };
}

function createLotId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch (_) {}
  return 'lot-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

function emptyRegistry() {
  return { version: REGISTRY_VERSION, activeLotId: null, lots: [], updatedAt: new Date().toISOString() };
}

function readLegacy(storage) {
  const raw = storage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  const legacyFeature = normalizeLotFeature(parsed.feature, parsed.metadata || {});
  legacyFeature.properties.lotId = legacyFeature.properties.lotId || createLotId();
  legacyFeature.properties.createdAt = legacyFeature.properties.createdAt || legacyFeature.properties.updatedAt;
  return { version: REGISTRY_VERSION, activeLotId: legacyFeature.properties.lotId, lots: [legacyFeature], updatedAt: new Date().toISOString() };
}

function readRegistry() {
  const storage = getStorage();
  const raw = storage.getItem(STORAGE_KEY);
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed?.version !== REGISTRY_VERSION || !Array.isArray(parsed.lots)) {
      throw new Error('El registro de lotes tiene un formato desconocido; no se sobrescribió para proteger los datos existentes.');
    }
    const lots = parsed.lots.map(feature => {
      const normalized = normalizeLotFeature(feature);
      if (!normalized.properties.lotId) throw new Error('Hay un lote guardado sin identificador; no se sobrescribió el registro.');
      return normalized;
    });
    return { version: REGISTRY_VERSION, activeLotId: parsed.activeLotId || null, lots, updatedAt: parsed.updatedAt || null };
  }
  const migrated = readLegacy(storage);
  return migrated || emptyRegistry();
}

function writeRegistry(registry) {
  const storage = getStorage();
  const payload = { ...registry, version: REGISTRY_VERSION, updatedAt: new Date().toISOString() };
  try {
    const serialized = JSON.stringify(payload);
    storage.setItem(STORAGE_KEY, serialized);
    const check = storage.getItem(STORAGE_KEY);
    if (check !== serialized) throw new Error('La verificación del registro persistido no coincide con los datos enviados.');
  } catch (error) {
    throw new Error('No se pudo guardar el lote de forma persistente: ' + error.message);
  }
  return payload;
}

function findActive(registry) {
  return registry.lots.find(lot => lot.properties.lotId === registry.activeLotId) || null;
}

/** Devuelve el lote activo compartido entre los módulos. */
export function getLotContext() {
  try {
    const storage = getStorage();
    const hasCurrentRegistry = Boolean(storage.getItem(STORAGE_KEY));
    const registry = readRegistry();
    // Migra el contexto v1 antes de devolverlo; el legado queda intacto si falla la escritura.
    if (!hasCurrentRegistry && registry.lots.length) writeRegistry(registry);
    const active = findActive(registry);
    return active ? clone(active) : null;
  } catch (error) {
    console.warn('[Agro-Consultas] No se pudo recuperar el registro de lotes:', error);
    return null;
  }
}

/**
 * Crea/actualiza un lote guardado y lo establece como AOI activo.
 * Se conserva el identificador cuando se actualiza el mismo Feature.
 */
export function setLotContext(input, metadata = {}) {
  const registry = readRegistry();
  const incoming = normalizeLotFeature(input, metadata);
  const existingId = incoming.properties.lotId;
  const existing = existingId ? registry.lots.find(lot => lot.properties.lotId === existingId) : null;
  const lotId = existingId || existing?.properties.lotId || createLotId();
  const now = new Date().toISOString();
  const feature = normalizeLotFeature(incoming, {
    ...metadata,
    lotId,
    name: metadata.name || incoming.properties.name || existing?.properties.name || 'Lote sin nombre',
    createdAt: incoming.properties.createdAt || existing?.properties.createdAt || now,
    updatedAt: now
  });
  const index = registry.lots.findIndex(lot => lot.properties.lotId === lotId);
  if (index >= 0) registry.lots[index] = feature;
  else registry.lots.push(feature);
  registry.activeLotId = lotId;
  const saved = writeRegistry(registry);
  dispatchLotChange(feature);
  return clone(feature);
}

/** Alias explícito para interfaces que presentan una acción Guardar lote. */
export function saveLotContext(input, metadata = {}) {
  return setLotContext(input, metadata);
}

/** Lista los lotes guardados sin cambiar el AOI activo. */
export function listSavedLots() {
  return readRegistry().lots.map(clone);
}

/** Activa un lote ya guardado sin duplicarlo. */
export function selectSavedLot(lotId) {
  if (!lotId) throw new Error('Seleccioná un lote guardado.');
  const registry = readRegistry();
  const feature = registry.lots.find(lot => lot.properties.lotId === lotId);
  if (!feature) throw new Error('El lote seleccionado ya no existe en el registro.');
  registry.activeLotId = lotId;
  writeRegistry(registry);
  dispatchLotChange(feature);
  return clone(feature);
}

/** Elimina un lote del registro. No borra otros lotes guardados. */
export function deleteSavedLot(lotId) {
  const registry = readRegistry();
  const before = registry.lots.length;
  registry.lots = registry.lots.filter(lot => lot.properties.lotId !== lotId);
  if (registry.lots.length === before) return false;
  if (registry.activeLotId === lotId) registry.activeLotId = null;
  writeRegistry(registry);
  dispatchLotChange(findActive(registry));
  return true;
}

/** Desactiva el AOI actual; conserva la biblioteca de lotes guardados. */
export function clearLotContext() {
  const registry = readRegistry();
  registry.activeLotId = null;
  writeRegistry(registry);
  dispatchLotChange(null);
}

export function onLotContextChange(callback) {
  const handler = event => callback(event.detail || null);
  globalThis.addEventListener?.(EVENT_NAME, handler);
  return () => globalThis.removeEventListener?.(EVENT_NAME, handler);
}

export const LOT_CONTEXT_STORAGE_KEY = STORAGE_KEY;
export const LOT_CONTEXT_EVENT_NAME = EVENT_NAME;
