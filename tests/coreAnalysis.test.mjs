import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeEvidenceQuality } from '../services/coreAnalysis.js';
import { DataStatus, ConfidenceLevel } from '../utils/dataModel.js';

test('la calidad queda no disponible cuando suelo y climatología no tienen evidencia', () => {
  const quality = summarizeEvidenceQuality(
    { status: DataStatus.UNAVAILABLE },
    { status: DataStatus.UNAVAILABLE, climatologyStatus: DataStatus.UNAVAILABLE }
  );
  assert.equal(quality.status, DataStatus.UNAVAILABLE);
  assert.equal(quality.confidence, ConfidenceLevel.NONE);
  assert.equal(quality.recommendationEligibility, false);
});

test('el clima actual no sustituye una climatología histórica', () => {
  const quality = summarizeEvidenceQuality(
    { status: DataStatus.UNAVAILABLE },
    { status: DataStatus.REAL, climatologyStatus: DataStatus.UNAVAILABLE, liveWeatherPoint: { available: true } }
  );
  assert.equal(quality.status, DataStatus.ESTIMATED);
  assert.equal(quality.confidence, ConfidenceLevel.LOW);
  assert.equal(quality.components.currentWeather.available, true);
  assert.equal(quality.recommendationEligibility, false);
});

test('la cartografía INTA no se eleva a evidencia parcelaria real', () => {
  const quality = summarizeEvidenceQuality(
    { status: 'CARTOGRAPHIC', evidenceType: 'CARTOGRAPHIC', textura: 'franca', fuente: 'INTA WMS' },
    { status: DataStatus.REAL, climatologyStatus: DataStatus.REAL, temperaturaMediaVal: 20, precipitacionesAnualesVal: 1000 }
  );
  assert.equal(quality.status, DataStatus.ESTIMATED);
  assert.equal(quality.confidence, ConfidenceLevel.MEDIUM);
  assert.equal(quality.recommendationEligibility, false);
});

test('solo suelo puntual y climatología histórica real habilitan calidad completa', () => {
  const quality = summarizeEvidenceQuality(
    { status: DataStatus.REAL, evidenceType: 'FIELD_MEASUREMENT', ph: 6.5, fuente: 'Muestreo de campo' },
    { status: DataStatus.REAL, climatologyStatus: DataStatus.REAL, temperaturaMediaVal: 20, precipitacionesAnualesVal: 1000 }
  );
  assert.equal(quality.status, DataStatus.REAL);
  assert.equal(quality.confidence, ConfidenceLevel.HIGH);
  assert.equal(quality.recommendationEligibility, true);
});

test('los perfiles regionales permanecen regionales y nunca obtienen confianza alta', () => {
  const quality = summarizeEvidenceQuality(
    { status: DataStatus.REGIONAL, evidenceType: 'REGIONAL_PROFILE', tipo: 'Molisol' },
    { status: DataStatus.REGIONAL, climatologyStatus: DataStatus.REGIONAL, temperaturaMediaVal: 20, precipitacionesAnualesVal: 1000 }
  );
  assert.equal(quality.status, DataStatus.REGIONAL);
  assert.notEqual(quality.confidence, ConfidenceLevel.HIGH);
  assert.equal(quality.recommendationEligibility, false);
});
