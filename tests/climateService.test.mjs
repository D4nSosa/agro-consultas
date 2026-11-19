import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularIndicePeligroIncendio, resolveClimateEvidenceStatus } from '../services/climateService.js';
import { DataStatus, ConfidenceLevel } from '../utils/dataModel.js';

test('el indicador de propagación declara que no es FWI y no predice ignición', () => {
  const result = calcularIndicePeligroIncendio(39, 40, 0);
  assert.equal(result.tipoIndice, 'HEURISTICA_METEOROLOGICA_INTERNA');
  assert.match(result.limitacion, /No es el Fire Weather Index/);
  assert.match(result.descripcion, /alertas oficiales/);
});

test('sin temperatura o viento el indicador queda no disponible', () => {
  const result = calcularIndicePeligroIncendio(null, 20, 0);
  assert.equal(result.nivel, 'NO DISPONIBLE');
  assert.equal(result.tipoIndice, 'HEURISTICA_METEOROLOGICA_INTERNA');
});

test('Open-Meteo se conserva como estimación de modelo, no observación de estación', () => {
  const evidence = resolveClimateEvidenceStatus({
    available: true,
    status: DataStatus.ESTIMATED,
    confidence: ConfidenceLevel.MEDIUM
  });
  assert.equal(evidence.status, DataStatus.ESTIMATED);
  assert.equal(evidence.confidence, ConfidenceLevel.MEDIUM);
});

test('un perfil subregional se identifica como regional y no como medición del lote', () => {
  const evidence = resolveClimateEvidenceStatus({ available: false }, { temperatura: 21 });
  assert.equal(evidence.status, DataStatus.REGIONAL);
  assert.equal(evidence.confidence, ConfidenceLevel.LOW);
});

test('sin modelo disponible ni perfil regional el clima queda no disponible', () => {
  const evidence = resolveClimateEvidenceStatus({ available: false }, null);
  assert.equal(evidence.status, DataStatus.UNAVAILABLE);
  assert.equal(evidence.confidence, ConfidenceLevel.NONE);
});
