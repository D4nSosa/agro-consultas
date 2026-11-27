import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPolygonFromGpsPoints } from '../services/imageAnalysisService.js';

test('photo GPS footprint uses a convex hull independent of upload order', () => {
  const hull = buildPolygonFromGpsPoints([
    { lng: 1, lat: 1 },
    { lng: 0, lat: 0 },
    { lng: 0.5, lat: 0.5 },
    { lng: 1, lat: 0 },
    { lng: 0, lat: 1 },
    { lng: 1, lat: 1 },
  ]);
  assert.equal(hull.length, 4);
  assert.deepEqual(hull, [[0, 0], [1, 0], [1, 1], [0, 1]]);
});

test('photo GPS footprint rejects collinear or insufficient points', () => {
  assert.deepEqual(buildPolygonFromGpsPoints([
    { lng: 0, lat: 0 },
    { lng: 1, lat: 1 },
    { lng: 2, lat: 2 },
  ]), []);
});
