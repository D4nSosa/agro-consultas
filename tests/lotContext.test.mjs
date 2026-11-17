import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeLotFeature,
  setLotContext,
  getLotContext,
  clearLotContext,
  LOT_CONTEXT_STORAGE_KEY
} from '../services/lotContext.js';

const square = {
  type: 'Feature',
  properties: { name: 'Lote de prueba' },
  geometry: {
    type: 'Polygon',
    coordinates: [[[-56.1, -28.1], [-56, -28.1], [-56, -28], [-56.1, -28], [-56.1, -28.1]]]
  }
};

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

function withStorage(t, local, session = memoryStorage()) {
  const previous = {
    local: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'),
    session: Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: session });
  t.after(() => {
    if (previous.local) Object.defineProperty(globalThis, 'localStorage', previous.local);
    else delete globalThis.localStorage;
    if (previous.session) Object.defineProperty(globalThis, 'sessionStorage', previous.session);
    else delete globalThis.sessionStorage;
  });
}

test('normaliza un Polygon cerrado', () => {
  const feature = normalizeLotFeature(square);
  assert.equal(feature.geometry.type, 'Polygon');
  assert.equal(feature.properties.name, 'Lote de prueba');
});

test('rechaza anillos abiertos', () => {
  const open = structuredClone(square);
  open.geometry.coordinates[0].pop();
  assert.throws(() => normalizeLotFeature(open), /cerrarse manualmente/);
});

test('rechaza puntos como lotes', () => {
  assert.throws(
    () => normalizeLotFeature({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [-56, -28] } }),
    /Polygon o MultiPolygon/
  );
});

test('rechaza coordenadas fuera de rango', () => {
  const invalid = structuredClone(square);
  invalid.geometry.coordinates[0][0] = [250, -28.1];
  assert.throws(() => normalizeLotFeature(invalid), /coordenadas GeoJSON inválidas/);
});

test('rechaza polígonos auto-intersectados', () => {
  const bowTie = structuredClone(square);
  bowTie.geometry.coordinates[0] = [
    [-56.1, -28.1], [-56, -28], [-56, -28.1], [-56.1, -28], [-56.1, -28.1]
  ];
  assert.throws(() => normalizeLotFeature(bowTie), /se cruza a sí mismo/);
});

test('rechaza coordenadas GeoJSON representadas como texto', () => {
  const invalid = structuredClone(square);
  invalid.geometry.coordinates[0][0] = ['-56.1', -28.1];
  assert.throws(() => normalizeLotFeature(invalid), /coordenadas GeoJSON inválidas/);
});

test('acepta una MultiPolygon válida', () => {
  const multi = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'MultiPolygon',
      coordinates: [
        [[[-56.1, -28.1], [-56, -28.1], [-56, -28], [-56.1, -28], [-56.1, -28.1]]],
        [[[-55.9, -28.1], [-55.8, -28.1], [-55.8, -28], [-55.9, -28], [-55.9, -28.1]]]
      ]
    }
  };
  assert.equal(normalizeLotFeature(multi).geometry.type, 'MultiPolygon');
});

test('combina Features Polygon de una FeatureCollection en MultiPolygon', () => {
  const collection = {
    type: 'FeatureCollection',
    features: [square, {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [[[-55.9, -28.1], [-55.8, -28.1], [-55.8, -28], [-55.9, -28], [-55.9, -28.1]]] }
    }]
  };
  assert.equal(normalizeLotFeature(collection).geometry.type, 'MultiPolygon');
});

test('confirma el guardado solo después de verificar la persistencia', t => {
  const local = memoryStorage();
  withStorage(t, local);
  const saved = setLotContext(square, { source: 'test' });
  assert.equal(saved.properties.name, 'Lote de prueba');
  assert.equal(getLotContext().geometry.type, 'Polygon');
  assert.ok(local.getItem(LOT_CONTEXT_STORAGE_KEY));
});

test('usa sessionStorage cuando localStorage no está disponible', t => {
  const blockedLocal = { getItem() { return null; }, setItem() { throw new Error('quota'); } };
  const session = memoryStorage();
  withStorage(t, blockedLocal, session);
  setLotContext(square);
  assert.equal(getLotContext().properties.name, 'Lote de prueba');
  assert.ok(session.getItem(LOT_CONTEXT_STORAGE_KEY));
});

test('no informa éxito si ningún almacenamiento puede persistir el lote', t => {
  const blocked = { getItem() { return null; }, setItem() { throw new Error('quota exceeded'); } };
  withStorage(t, blocked, blocked);
  assert.throws(() => setLotContext(square), /No se pudo guardar el lote compartido/);
});

test('limpia el lote compartido de ambos almacenamientos', t => {
  const local = memoryStorage();
  const session = memoryStorage();
  withStorage(t, local, session);
  setLotContext(square);
  clearLotContext();
  assert.equal(local.getItem(LOT_CONTEXT_STORAGE_KEY), null);
  assert.equal(session.getItem(LOT_CONTEXT_STORAGE_KEY), null);
});
