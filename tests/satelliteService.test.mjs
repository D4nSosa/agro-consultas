import test from 'node:test';
import assert from 'node:assert/strict';
import { searchSentinelImagesByTargetDate } from '../forestal/services/satelliteService.js';

const geometry = {
  type: 'Polygon',
  coordinates: [[[-56.1, -28.1], [-56.0, -28.1], [-56.0, -28.0], [-56.1, -28.0], [-56.1, -28.1]]]
};

function item(date = '2026-11-17T12:00:00Z', cloudCover = 24) {
  return {
    type: 'Feature',
    id: 'S2A_TEST_ITEM',
    bbox: [-56.1, -28.1, -56.0, -28.0],
    properties: { datetime: date, 'eo:cloud_cover': cloudCover },
    assets: { B04_10m: { href: 'https://example.test/B04.tif' }, B08_10m: { href: 'https://example.test/B08.tif' } },
    links: []
  };
}

function mockResponse(features) {
  return { ok: true, status: 200, json: async () => ({ features }) };
}

test('informa la ventana temporal efectiva cuando amplía la búsqueda STAC', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return mockResponse(calls === 1 ? [] : [item()]);
  };

  const result = await searchSentinelImagesByTargetDate(geometry, '2026-11-17', 10, 30);
  assert.equal(result.success, true);
  assert.equal(result.windowDays, 60);
  assert.equal(result.cloudCoverThreshold, 30);
  assert.equal(calls, 2);
});

test('expone el umbral de nubosidad flexibilizado a 50 por ciento', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const body = JSON.parse(options.body);
    const threshold = body.query['eo:cloud_cover'].lte;
    if (threshold === 50) return mockResponse([item('2026-11-17T12:00:00Z', 42)]);
    return mockResponse([]);
  };

  const result = await searchSentinelImagesByTargetDate(geometry, '2026-11-17', 10, 30);
  assert.equal(result.success, true);
  assert.equal(result.windowDays, 90);
  assert.equal(result.cloudCoverThreshold, 50);
  assert.equal(result.bestProduct.cloudCover, 42);
  assert.equal(calls, 4);
});

test('una escena STAC sin estadísticas no se presenta como NDVI disponible', async () => {
  const { analyzeVegetation } = await import('../forestal/services/vegetationService.js');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  try {
    const result = await analyzeVegetation(geometry, {
      id: 'S2_TEST', date: '2026-11-17', cloudCover: 10,
      assets: { b04: 'https://example.test/B04.tif', b08: 'https://example.test/B08.tif' }
    });
    assert.equal(result.available, false);
    assert.equal(result.state, 'SCENE_IDENTIFIED');
    assert.equal(result.stats, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('la consulta nacional INTA devuelve pH modelado y salinidad sin interpretar como cartografía', async t => {
  const { fetchINTASoilData } = await import('../services/sources/intaService.js');
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  const store = new Map();
  globalThis.localStorage = {
    getItem: key => store.get(key) || null,
    setItem: (key, value) => store.set(key, value),
    removeItem: key => store.delete(key)
  };
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      status: 'CARTOGRAPHIC',
      source: 'INTA-CIRN',
      sourceUrl: 'https://geo-nodo05.inta.gob.ar/geoserver/wms',
      retrievedAt: '2026-11-21T12:00:00Z',
      sampleMethod: 'Punto de consulta; representa el centroide',
      limitations: ['Pixel 1 km; no es análisis de laboratorio'],
      products: {
        ph_0_30: { value: 6.4, resolution: 1000, quality: { rmse: 0.84, r2: 0.456 } },
        ph_30_100: { value: 7.1, resolution: 1000, quality: { rmse: 0.80, r2: 0.523 } },
        salinity_0_30: { value: null, rawClass: 1 },
        salinity_30_100: { value: null, rawClass: 0 }
      }
    })
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
  });
  const result = await fetchINTASoilData(-27, -56, null);
  assert.equal(result.status, 'CARTOGRAPHIC');
  assert.equal(result.evidenceType, 'CARTOGRAPHIC');
  assert.equal(result.ph_0_30, 6.4);
  assert.equal(result.ph_30_100, 7.1);
  assert.equal(result.salinidad_0_30_raw, 1);
  assert.equal(result.salinidad, null);
  assert.equal(result.fechaActualizacion, null);
  assert.notEqual(result.status, 'REAL');
});
