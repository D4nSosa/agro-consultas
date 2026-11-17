import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateArea } from '../forestal/utils/geo.js';

const square = [
  [-56.1, -28.1],
  [-56.0, -28.1],
  [-56.0, -28.0],
  [-56.1, -28.0],
  [-56.1, -28.1]
];

test('calcula superficie positiva para un Polygon', () => {
  const result = calculateArea({ type: 'Polygon', coordinates: [square] });
  assert.ok(result.squareMeters > 0);
  assert.equal(result.hectares, Math.round(result.squareMeters / 10000 * 100) / 100);
});

test('suma partes separadas de un MultiPolygon sin conectarlas', () => {
  const second = square.map(([lng, lat]) => [lng + 0.2, lat]);
  const oneArea = calculateArea({ type: 'Polygon', coordinates: [square] }).squareMeters;
  const result = calculateArea({ type: 'MultiPolygon', coordinates: [[square], [second]] });
  assert.ok(Math.abs(result.squareMeters - oneArea * 2) < 0.02);
});

test('descuenta los anillos interiores de un Polygon', () => {
  const hole = [
    [-56.075, -28.075],
    [-56.025, -28.075],
    [-56.025, -28.025],
    [-56.075, -28.025],
    [-56.075, -28.075]
  ];
  const full = calculateArea({ type: 'Polygon', coordinates: [square] }).squareMeters;
  const withHole = calculateArea({ type: 'Polygon', coordinates: [square, hole] }).squareMeters;
  assert.ok(withHole > 0);
  assert.ok(withHole < full);
});

test('acepta Features GeoJSON y conserva el área de su geometría', () => {
  const geometry = { type: 'Polygon', coordinates: [square] };
  const raw = calculateArea(geometry);
  const feature = calculateArea({ type: 'Feature', properties: {}, geometry });
  assert.equal(feature.squareMeters, raw.squareMeters);
});

test('no asigna superficie a un punto', () => {
  const result = calculateArea({ type: 'Point', coordinates: [-56, -28] });
  assert.equal(result.isPoint, true);
  assert.equal(result.squareMeters, 0);
});
