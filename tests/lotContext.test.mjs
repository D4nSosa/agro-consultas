import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLotFeature } from '../services/lotContext.js';

const square = { type: 'Feature', properties: { name: 'Lote de prueba' }, geometry: { type: 'Polygon', coordinates: [[[-56.1,-28.1],[-56,-28.1],[-56,-28],[-56.1,-28],[-56.1,-28.1]]] } };

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
  assert.throws(() => normalizeLotFeature({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [-56,-28] } }), /Polygon o MultiPolygon/);
});

test('rechaza coordenadas fuera de rango', () => {
  const invalid = structuredClone(square);
  invalid.geometry.coordinates[0][0] = [250,-28];
  assert.throws(() => normalizeLotFeature(invalid), /coordenadas GeoJSON inválidas/);
});

test('rechaza polígonos auto-intersectados', () => {
  const bowTie = structuredClone(square);
  bowTie.geometry.coordinates[0] = [
    [-56.1,-28.1], [-56,-28], [-56,-28.1], [-56.1,-28], [-56.1,-28.1]
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
    type: 'Feature', properties: {},
    geometry: { type: 'MultiPolygon', coordinates: [
      [[[-56.1,-28.1],[-56,-28.1],[-56,-28],[-56.1,-28],[-56.1,-28.1]]],
      [[[-55.9,-28.1],[-55.8,-28.1],[-55.8,-28],[-55.9,-28],[-55.9,-28.1]]]
    ] }
  };
  assert.equal(normalizeLotFeature(multi).geometry.type, 'MultiPolygon');
});

test('combina Features Polygon de una FeatureCollection en MultiPolygon', () => {
  const collection = {
    type: 'FeatureCollection',
    features: [square, {
      type: 'Feature', properties: {},
      geometry: { type: 'Polygon', coordinates: [[[-55.9,-28.1],[-55.8,-28.1],[-55.8,-28],[-55.9,-28],[-55.9,-28.1]]] }
    }]
  };
  assert.equal(normalizeLotFeature(collection).geometry.type, 'MultiPolygon');
});
