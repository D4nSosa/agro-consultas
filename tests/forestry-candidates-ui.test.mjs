import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('aptitude page keeps forestry selectable without generic orientation sections', async () => {
  const script = await readFile(new URL('../script.js', import.meta.url), 'utf8');
  assert.match(script, /getForestToEvaluate/);
  assert.match(script, /Todos los perfiles/);
  assert.match(script, /optgroup label="Forestales"/);
  assert.doesNotMatch(script, /Orientación forestal/);
  assert.doesNotMatch(script, /perfiles del catálogo provincial/);
});

test('forest candidate list is merged only for the all-profiles view', async () => {
  const script = await readFile(new URL('../script.js', import.meta.url), 'utf8');
  assert.match(script, /getCropsToEvaluate\(key, subregion\)/);
  assert.match(script, /getForestToEvaluate\(key\)/);
  assert.match(script, /candidatosAgricolas, \.\.\.candidatosForestales/);
});

test('technical report includes provincial forestry candidates without equating catalog membership with lot suitability', async () => {
  const report = await readFile(new URL('../reporte.html', import.meta.url), 'utf8');
  assert.match(report, /getForestToEvaluate/);
  assert.match(report, /Especies forestales del catálogo provincial/);
  assert.match(report, /Su inclusión no implica aptitud del lote/);
  assert.match(report, /recomendacionesForestales/);
});
