/**
 * Contexto territorial compartido entre los módulos de Agro-Consultas.
 * La geometría almacenada es GeoJSON WGS84 [longitud, latitud].
 * No genera ubicaciones ni geometrías por defecto.
 */
const STORAGE_KEY = 'agro_lot_context_v1';
const EVENT_NAME = 'agro:lot-context-changed';

const WORKSPACE_STORAGE_KEY = 'agro_workspace_v1';
const WORKSPACE_EVENT_NAME = 'agro:workspace-changed';

function workspaceId(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function emptyWorkspace() {
  return {
    version: 1,
    activeProjectId: 'default',
    activeLotId: null,
    updatedAt: new Date(0).toISOString(),
    projects: [{ id: 'default', name: 'Mi espacio', createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), lots: [] }]
  };
}

function readWorkspaceState() {
  const candidates = [];
  for (const storageName of ['localStorage', 'sessionStorage']) {
    try {
      const raw = globalThis[storageName]?.getItem(WORKSPACE_STORAGE_KEY);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed?.version !== 1 || !Array.isArray(parsed.projects)) continue;
      const projects = parsed.projects.filter(project =>
        project && typeof project.id === 'string' && typeof project.name === 'string' && Array.isArray(project.lots)
      );
      if (!projects.length) continue;
      const activeProjectId = projects.some(project => project.id === parsed.activeProjectId)
        ? parsed.activeProjectId : projects[0].id;
      candidates.push({ ...parsed, projects, activeProjectId, activeLotId: parsed.activeLotId || null,
        updatedAt: parsed.updatedAt || new Date(0).toISOString() });
    } catch (_) { /* Ignore unavailable or malformed workspace storage. */ }
  }
  candidates.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
  return candidates[0] || emptyWorkspace();
}

function persistWorkspaceState(state) {
  state.updatedAt = new Date().toISOString();
  const serialized = JSON.stringify(state);
  for (const storageName of ['localStorage', 'sessionStorage']) {
    try {
      const storage = globalThis[storageName];
      if (!storage) continue;
      storage.setItem(WORKSPACE_STORAGE_KEY, serialized);
      if (storage.getItem(WORKSPACE_STORAGE_KEY) !== serialized) continue;
      if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
        globalThis.dispatchEvent(new CustomEvent(WORKSPACE_EVENT_NAME, { detail: state }));
      }
      return true;
    } catch (_) { /* Try the next available browser storage. */ }
  }
  return false;
}

export function getWorkspaceState() {
  return JSON.parse(JSON.stringify(readWorkspaceState()));
}

export function createWorkspaceProject(name) {
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new Error('Ingresá un nombre para el proyecto.');
  const state = readWorkspaceState();
  const now = new Date().toISOString();
  const project = { id: workspaceId('project'), name: cleanName, createdAt: now, updatedAt: now, lots: [] };
  state.projects.push(project);
  state.activeProjectId = project.id;
  state.activeLotId = null;
  if (!persistWorkspaceState(state)) throw new Error('No se pudo guardar el proyecto en el almacenamiento del navegador.');
  clearLotContext();
  return project;
}

export function renameWorkspaceProject(projectId, name) {
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new Error('Ingresá un nombre para el proyecto.');
  const state = readWorkspaceState();
  const project = state.projects.find(item => item.id === projectId);
  if (!project) throw new Error('No se encontró el proyecto seleccionado.');
  project.name = cleanName;
  project.updatedAt = new Date().toISOString();
  if (!persistWorkspaceState(state)) throw new Error('No se pudo actualizar el proyecto.');
  return project;
}

export function selectWorkspaceProject(projectId) {
  const state = readWorkspaceState();
  const project = state.projects.find(item => item.id === projectId);
  if (!project) throw new Error('No se encontró el proyecto seleccionado.');
  state.activeProjectId = project.id;
  const selectedLot = project.lots.find(item => item.id === project.activeLotId) ||
    project.lots.find(item => item.id === state.activeLotId) || project.lots[project.lots.length - 1] || null;
  state.activeLotId = selectedLot?.id || null;
  if (!persistWorkspaceState(state)) throw new Error('No se pudo cambiar el proyecto activo.');
  if (selectedLot?.feature) return setLotContext(selectedLot.feature, { source: 'workspace-selection' });
  clearLotContext();
  return null;
}

export function selectWorkspaceLot(lotId) {
  const state = readWorkspaceState();
  const project = state.projects.find(item => item.id === state.activeProjectId);
  const lot = project?.lots.find(item => item.id === lotId);
  if (!project || !lot?.feature) throw new Error('No se encontró el lote guardado.');
  state.activeLotId = lot.id;
  project.activeLotId = lot.id;
  if (!persistWorkspaceState(state)) throw new Error('No se pudo activar el lote seleccionado.');
  return setLotContext(lot.feature, { source: 'workspace-selection' });
}

export const WORKSPACE_STORAGE_KEY = WORKSPACE_STORAGE_KEY;

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
  return {
    type: 'Feature',
    geometry: JSON.parse(JSON.stringify(geometry)),
    properties: { ...(feature.properties || {}), ...metadata, contextVersion: 1, updatedAt: metadata.updatedAt || feature.properties?.updatedAt || new Date().toISOString() }
  };
}

export function getLotContext() {
  const candidates = [];

  for (const storageName of ['localStorage', 'sessionStorage']) {
    try {
      const storage = globalThis[storageName];
      const raw = storage?.getItem(STORAGE_KEY);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const feature = normalizeLotFeature(parsed.feature, parsed.metadata || {});
      const timestamp = Date.parse(feature.properties?.updatedAt || '') || 0;
      candidates.push({ feature, timestamp });
    } catch (error) {
      console.warn('[Agro-Consultas] No se pudo recuperar el lote compartido desde un almacenamiento:', error);
    }
  }

  candidates.sort((a, b) => b.timestamp - a.timestamp);
  return candidates[0]?.feature || null;
}

export function setLotContext(input, metadata = {}) {
  const state = readWorkspaceState();
  let project = state.projects.find(item => item.id === state.activeProjectId);
  if (!project) {
    project = state.projects[0] || { id: 'default', name: 'Mi espacio', createdAt: new Date().toISOString(), lots: [] };
    if (!state.projects.includes(project)) state.projects.push(project);
    state.activeProjectId = project.id;
  }
  const lotId = input?.properties?.workspaceLotId || workspaceId('lot');
  const feature = normalizeLotFeature(input, {
    ...metadata,
    workspaceProjectId: project.id,
    workspaceLotId: lotId,
    updatedAt: new Date().toISOString()
  });
  const lotName = feature.properties?.name || feature.properties?.nombre || 'Lote sin nombre';
  const lotRecord = { id: lotId, name: lotName, feature, updatedAt: feature.properties.updatedAt };
  const existingIndex = project.lots.findIndex(item => item.id === lotId);
  if (existingIndex >= 0) project.lots[existingIndex] = lotRecord;
  else project.lots.push(lotRecord);
  project.activeLotId = lotId;
  project.updatedAt = new Date().toISOString();
  state.activeLotId = lotId;
  if (!persistWorkspaceState(state)) throw new Error('No se pudo guardar el lote en el proyecto activo.');

  const payload = { feature, metadata: { source: metadata.source || feature.properties.source || 'user-selected' } };
  const serialized = JSON.stringify(payload);
  let persisted = false;
  const storageErrors = [];

  for (const storageName of ['localStorage', 'sessionStorage']) {
    try {
      const storage = globalThis[storageName];
      if (!storage) continue;
      storage.setItem(STORAGE_KEY, serialized);
      if (storage.getItem(STORAGE_KEY) !== serialized) {
        throw new Error('La verificación de lectura no coincide con el lote guardado.');
      }
      persisted = true;
      break;
    } catch (error) {
      storageErrors.push(error);
    }
  }

  if (!persisted) {
    const reason = storageErrors[0]?.message || 'El navegador no ofrece almacenamiento disponible.';
    throw new Error(`No se pudo guardar el lote compartido. ${reason}`);
  }

  if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
    globalThis.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: feature }));
  }
  return feature;
}

export function clearLotContext() {
  const state = readWorkspaceState();
  state.activeLotId = null;
  const project = state.projects.find(item => item.id === state.activeProjectId);
  if (project) project.activeLotId = null;
  persistWorkspaceState(state);
  try { globalThis.localStorage?.removeItem(STORAGE_KEY); } catch (_) {}
  try { globalThis.sessionStorage?.removeItem(STORAGE_KEY); } catch (_) {}
  if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
    globalThis.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: null }));
  }
}

export function onLotContextChange(callback) {
  const customHandler = event => callback(event.detail || null);
  const storageHandler = event => {
    if (event.key !== STORAGE_KEY) return;
    if (!event.newValue) {
      callback(null);
      return;
    }
    try {
      const payload = JSON.parse(event.newValue);
      callback(normalizeLotFeature(payload.feature, payload.metadata || {}));
    } catch (error) {
      console.warn('[Agro-Consultas] No se pudo sincronizar el lote desde otra pestaña:', error);
    }
  };

  globalThis.addEventListener?.(EVENT_NAME, customHandler);
  globalThis.addEventListener?.('storage', storageHandler);
  return () => {
    globalThis.removeEventListener?.(EVENT_NAME, customHandler);
    globalThis.removeEventListener?.('storage', storageHandler);
  };
}

export const LOT_CONTEXT_STORAGE_KEY = STORAGE_KEY;
