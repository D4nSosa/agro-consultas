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
