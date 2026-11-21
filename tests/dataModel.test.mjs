import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDataPoint,
  createMetadata,
  createUnavailableDataPoint,
  DataStatus,
  ConfidenceLevel
} from '../utils/dataModel.js';

test('los metadatos ausentes permanecen ausentes y no se convierten en cobertura/resolución/fechas ficticias', () => {
  const metadata = createMetadata();
  assert.equal(metadata.geographicCoverage, null);
  assert.equal(metadata.spatialResolution, null);
  assert.equal(metadata.temporalResolution, null);
  assert.equal(metadata.acquisitionDate, null);
  assert.equal(metadata.updateDate, null);
  assert.equal(metadata.sensor, null);
  assert.equal(metadata.product, null);
  assert.equal(metadata.geometry, null);
  assert.equal(metadata.coverage, null);
  assert.equal(metadata.acquiredAt, null);
  assert.equal(metadata.publishedAt, null);
  assert.equal(metadata.retrievedAt, null);
  assert.equal(metadata.crs, null);
  assert.equal(metadata.license, null);
  assert.equal(metadata.methodology, null);
  assert.equal(metadata.limitations, null);
});

test('DataPoint conserva valor cero y solo declara metadatos entregados explícitamente', () => {
  const point = createDataPoint({
    value: 0,
    source: 'Fuente de prueba',
    status: DataStatus.REAL,
    confidence: ConfidenceLevel.HIGH,
    geographicCoverage: 'polígono consultado',
    spatialResolution: '30 m',
    temporalResolution: 'adquisición puntual',
    acquisitionDate: '2026-11-20',
    crs: 'EPSG:4326',
    license: 'CC BY 4.0',
    sensor: 'Sentinel-2',
    product: 'L2A',
    geometry: { type: 'Point', coordinates: [-58, -27] },
    coverage: 'AOI consultada',
    quality: { cloudCover: 12 },
    publishedAt: '2026-11-19'
  });
  assert.equal(point.available, true);
  assert.equal(point.value, 0);
  assert.equal(point.metadata.geographicCoverage, 'AOI consultada');
  assert.equal(point.metadata.spatialResolution, '30 m');
  assert.equal(point.metadata.acquisitionDate, '2026-11-20');
  assert.equal(point.metadata.crs, 'EPSG:4326');
  assert.equal(point.metadata.license, 'CC BY 4.0');
  assert.equal(point.metadata.sensor, 'Sentinel-2');
  assert.equal(point.metadata.product, 'L2A');
  assert.deepEqual(point.metadata.geometry, { type: 'Point', coordinates: [-58, -27] });
  assert.equal(point.metadata.coverage, 'AOI consultada');
  assert.deepEqual(point.metadata.quality, { cloudCover: 12 });
  assert.equal(point.metadata.publishedAt, '2026-11-19');
  assert.equal(point.metadata.temporalResolution, 'adquisición puntual');
});

test('un DataPoint sin estado explícito no se declara REAL', () => {
  const point = createDataPoint({ value: 12, source: 'Fuente sin clasificar' });
  assert.equal(point.available, false);
  assert.equal(point.status, DataStatus.UNAVAILABLE);
  assert.equal(point.confidence, ConfidenceLevel.NONE);
});

test('unavailable no inventa fecha, cobertura ni resolución y registra el momento de consulta', () => {
  const point = createUnavailableDataPoint('INTA', 'Servicio no disponible');
  assert.equal(point.available, false);
  assert.equal(point.date, null);
  assert.equal(point.metadata.acquisitionDate, null);
  assert.equal(point.metadata.geographicCoverage, null);
  assert.equal(point.metadata.spatialResolution, null);
  assert.ok(Number.isFinite(Date.parse(point.retrievedAt)));
});
