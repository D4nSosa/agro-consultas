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
  assert.match(report, /reportSections\['agro-recommendations'\]/);
  assert.match(report, /Especies forestales del análisis Agro/);
  assert.doesNotMatch(report, /getForestToEvaluate/);
  assert.match(report, /Su inclusión no implica aptitud del lote/);
  assert.match(report, /recomendacionesForestales/);
});

test('forest map exposes the national OTBN 2016 layer only as historical context', async () => {
  const map = await readFile(new URL('../forestal/components/ForestMap.js', import.meta.url), 'utf8');
  assert.match(map, /OTBN nacional · referencia histórica 2016/);
  assert.match(map, /OTBN_MAyDS2016\/MapServer\/tile/);
  assert.match(map, /julio 2016/);
  assert.match(map, /no permite identificar la categoría legal vigente de un lote/);
});
