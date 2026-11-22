/**
 * Estado compartido de resultados analíticos para el informe unificado.
 * Cada resultado queda asociado a una huella determinista de la geometría GeoJSON.
 * El informe solo lee este estado: no ejecuta consultas ni reprocesa fuentes.
 */
const STORAGE_KEY = 'agro_report_analysis_v1';

function unwrapGeometry(input) {
  if (!input || typeof input !== 'object') return null;
  const geometry = input.type === 'Feature' ? input.geometry : input;
  return geometry && ['Polygon', 'MultiPolygon'].includes(geometry.type) ? geometry : null;
}

export function getGeometryFingerprint(input) {
  const geometry = unwrapGeometry(input);
  if (!geometry) return null;
  const source = JSON.stringify(geometry);
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return 'geo-v1-' + (hash >>> 0).toString(16).padStart(8, '0');
}

function readState() {
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      const raw = globalThis[name]?.getItem(STORAGE_KEY);
      if (!raw) continue;
      const value = JSON.parse(raw);
      if (value?.version === 1 && value.records && typeof value.records === 'object') return value;
    } catch (_) { /* Try the next browser storage. */ }
  }
  return { version: 1, records: {} };
}

function writeState(state) {
  const serialized = JSON.stringify(state);
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      const storage = globalThis[name];
      if (!storage) continue;
      storage.setItem(STORAGE_KEY, serialized);
      if (storage.getItem(STORAGE_KEY) === serialized) return true;
    } catch (_) { /* Try the next browser storage. */ }
  }
  return false;
}

export function saveReportSection(geometryInput, section, payload, metadata = {}) {
  const fingerprint = getGeometryFingerprint(geometryInput);
  if (!fingerprint) throw new Error('El resultado requiere un lote Polygon o MultiPolygon válido.');
  if (!/^[a-z0-9-]{2,48}$/i.test(String(section || ''))) throw new Error('Identificador de sección inválido.');
  const state = readState();
  const record = state.records[fingerprint] || { geometryFingerprint: fingerprint, sections: {} };
  record.sections[section] = {
    module: metadata.module || 'unknown',
    source: metadata.source || null,
    updatedAt: new Date().toISOString(),
    payload
  };
  record.updatedAt = new Date().toISOString();
  state.records[fingerprint] = record;
  if (!writeState(state)) throw new Error('No se pudo guardar el resultado analítico en el navegador.');
  return { fingerprint, updatedAt: record.updatedAt };
}

export function getReportSnapshot(geometryInput) {
  const fingerprint = getGeometryFingerprint(geometryInput);
  if (!fingerprint) return null;
  const record = readState().records[fingerprint];
  if (!record || record.geometryFingerprint !== fingerprint) return null;
  return JSON.parse(JSON.stringify(record));
}

export function clearReportSnapshot(geometryInput) {
  const fingerprint = getGeometryFingerprint(geometryInput);
  if (!fingerprint) return false;
  const state = readState();
  delete state.records[fingerprint];
  return writeState(state);
}

export const REPORT_ANALYSIS_STORAGE_KEY = STORAGE_KEY;
