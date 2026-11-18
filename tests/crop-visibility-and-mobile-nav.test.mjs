import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [script, styles] = await Promise.all([
  readFile(new URL('../script.js', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8')
]);

test('generic provincial orientation sections are removed from crop results', () => {
  assert.match(script, /No hay una evaluación concluyente para esta selección/);
  assert.doesNotMatch(script, /Orientación productiva territorial/);
  assert.doesNotMatch(script, /perfiles del catálogo provincial/);
  assert.doesNotMatch(script, /no como recomendaciones de siembra ni como cultivos aptos/);
});

test('GAEZ controls are integrated into the existing crop map', async () => {
  const results = await readFile(new URL('../resultados.html', import.meta.url), 'utf8');
  assert.match(results, /id="gaez-map-controls"/);
  assert.match(results, /id="gaez-map-run"/);
  assert.doesNotMatch(results, /Abrir portal FAO\\/IIASA GAEZ/);
  assert.match(script, /L\\.imageOverlay/);
  assert.match(script, /api\\/territorial\\/gaez\\/analyze/);
});

test('mobile module navigation wraps into a grid without horizontal scrolling', () => {
  assert.match(styles, /\.app-header \.right\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styles, /overflow-x:\s*visible\s*!important/);
});
