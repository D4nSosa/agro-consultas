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

function stateUpdatedAt(state) {
  const topLevel = Date.parse(state?.updatedAt || '') || 0;
  const records = Object.values(state?.records || {});
  const latestRecord = records.reduce((latest, record) => Math.max(latest, Date.parse(record?.updatedAt || '') || 0), 0);
  return Math.max(topLevel, latestRecord);
}

function readState() {
  const candidates = [];
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      const raw = globalThis[name]?.getItem(STORAGE_KEY);
      if (!raw) continue;
      const value = JSON.parse(raw);
      if (value?.version === 1 && value.records && typeof value.records === 'object' && !Array.isArray(value.records)) {
        candidates.push(value);
      }
    } catch (_) { /* Try the next browser storage. */ }
  }
  candidates.sort((a, b) => stateUpdatedAt(b) - stateUpdatedAt(a));
  return candidates[0] || { version: 1, records: {} };
}

function writeState(state) {
  state.updatedAt = new Date().toISOString();
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

/**
 * Guarda varias secciones de un informe en una única escritura verificada.
 * Se utiliza al importar paquetes para evitar dejar informes parcialmente importados.
 */
export function saveReportSections(geometryInput, sectionsInput) {
  const fingerprint = getGeometryFingerprint(geometryInput);
  if (!fingerprint) throw new Error('El resultado requiere un lote Polygon o MultiPolygon válido.');
  if (!sectionsInput || typeof sectionsInput !== 'object' || Array.isArray(sectionsInput)) {
    throw new Error('La colección de secciones del informe no es válida.');
  }

  const entries = Object.entries(sectionsInput);
  if (!entries.length || entries.length > 100) throw new Error('El informe debe contener entre 1 y 100 secciones.');
  for (const [section, entry] of entries) {
    if (!/^[a-z0-9-]{2,48}$/i.test(section) || !entry || typeof entry !== 'object' ||
        Array.isArray(entry) || !Object.prototype.hasOwnProperty.call(entry, 'payload')) {
      throw new Error('El paquete contiene una sección con estructura inválida.');
    }
  }

  const state = readState();
  const record = state.records[fingerprint] || { geometryFingerprint: fingerprint, sections: {} };
  if (!record.sections || typeof record.sections !== 'object' || Array.isArray(record.sections)) record.sections = {};
  const now = new Date().toISOString();
  for (const [section, entry] of entries) {
    record.sections[section] = {
      module: String(entry.module || 'imported').slice(0, 80),
      source: entry.source == null ? null : String(entry.source).slice(0, 200),
      updatedAt: typeof entry.updatedAt === 'string' && Number.isFinite(Date.parse(entry.updatedAt))
        ? entry.updatedAt : now,
      payload: entry.payload
    };
  }
  record.updatedAt = now;
  state.records[fingerprint] = record;
  if (!writeState(state)) throw new Error('No se pudo guardar el informe importado en el navegador.');
  return { fingerprint, updatedAt: record.updatedAt, sectionCount: entries.length };
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
