import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularIndicePeligroIncendio } from '../services/climateService.js';

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
