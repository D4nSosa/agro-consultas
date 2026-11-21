import test from 'node:test';
import assert from 'node:assert/strict';
import { searchSentinelImagesByTargetDate } from '../forestal/services/satelliteService.js';

const geometry = {
  type: 'Polygon',
  coordinates: [[[-56.1, -28.1], [-56.0, -28.1], [-56.0, -28.0], [-56.1, -28.0], [-56.1, -28.1]]]
};

function product(date = '2026-11-17', cloudCover = 24) {
  return {
    id: 'S2A_TEST_ITEM',
    date,
    acquiredAt: `${date}T12:00:00Z`,
    cloudCover,
    collection: 'sentinel-2-l2a',
    sensor: 'sentinel-2a',
    product: 'Sentinel-2 L2A Surface Reflectance',
    source: 'Copernicus Sentinel-2 / AWS Earth Search STAC',
    resolution: 10,
    bands: ['B04 (Red)', 'B08 (NIR)'],
    assets: {
      red: 'https://example.test/B04.tif',
      nir: 'https://example.test/B08.tif',
      scl: 'https://example.test/SCL.tif',
      redScale: 0.0001,
      redOffset: -0.1,
      nirScale: 0.0001,
      nirOffset: -0.1
    },
    geometry: { type: 'Polygon', coordinates: geometry.coordinates }
  };
}

function mockResponse(data) {
  return { ok: true, status: 200, json: async () => data };
}

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
});test('informa la ventana histórica efectiva y no consulta escenas futuras', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  const requestBodies = [];
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    requestBodies.push(JSON.parse(options.body));
    return calls === 1
      ? mockResponse({ success: false, products: [] })
      : mockResponse({ success: true, source: 'Earth Search backend', products: [product()] });
  };

  const result = await searchSentinelImagesByTargetDate(geometry, '2026-11-17', 10, 30);
  assert.equal(result.success, true);
  assert.equal(result.windowDays, 60);
  assert.equal(result.cloudCoverThreshold, 30);
  assert.equal(requestBodies[0].endDate, '2026-11-17');
  assert.equal(requestBodies[1].endDate, '2026-11-17');
  assert.equal(requestBodies[1].collection, 'sentinel-2-l2a');
  assert.equal(result.bestProduct.assets.b04, 'https://example.test/B04.tif');
  assert.equal(result.bestProduct.assets.b08, 'https://example.test/B08.tif');
  assert.equal(calls, 2);
});

test('expone el umbral de nubosidad flexibilizado a 50 por ciento', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const body = JSON.parse(options.body);
    if (body.maxCloudCover === 50) {
      return mockResponse({ success: true, source: 'Earth Search backend', products: [product('2026-11-17', 42)] });
    }
    return mockResponse({ success: false, products: [] });
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
});test('informa la ventana histórica efectiva y no consulta escenas futuras', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  const requestBodies = [];
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    requestBodies.push(JSON.parse(options.body));
    return calls === 1
      ? mockResponse({ success: false, products: [] })
      : mockResponse({ success: true, source: 'Earth Search backend', products: [product()] });
  };

  const result = await searchSentinelImagesByTargetDate(geometry, '2026-11-17', 10, 30);
  assert.equal(result.success, true);
  assert.equal(result.windowDays, 60);
  assert.equal(result.cloudCoverThreshold, 30);
  assert.equal(requestBodies[0].endDate, '2026-11-17');
  assert.equal(requestBodies[1].endDate, '2026-11-17');
  assert.equal(requestBodies[1].collection, 'sentinel-2-l2a');
  assert.equal(result.bestProduct.assets.b04, 'https://example.test/B04.tif');
  assert.equal(result.bestProduct.assets.b08, 'https://example.test/B08.tif');
  assert.equal(calls, 2);
});


