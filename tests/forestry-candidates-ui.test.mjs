import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('aptitude page loads and renders forestry candidates separately', async () => {
  const script = await readFile(new URL('../script.js', import.meta.url), 'utf8');
  assert.match(script, /getForestToEvaluate/);
  assert.match(script, /Orientación forestal/);
  assert.match(script, /Perfiles forestales provinciales|Estas especies están incluidas en el catálogo provincial/);
  assert.match(script, /Todos los perfiles/);
  assert.match(script, /optgroup label="Forestales"/);
});

test('forest candidate list is merged only for the all-profiles view', async () => {
  const script = await readFile(new URL('../script.js', import.meta.url), 'utf8');
  assert.match(script, /getCropsToEvaluate\(key, subregion\)/);
  assert.match(script, /getForestToEvaluate\(key\)/);
  assert.match(script, /candidatosAgricolas, \.\.\.candidatosForestales/);
});
