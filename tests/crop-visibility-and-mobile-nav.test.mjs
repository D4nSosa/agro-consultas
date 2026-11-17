import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [script, styles] = await Promise.all([
  readFile(new URL('../script.js', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8')
]);

test('regional crop candidates remain visible when aptitude is not classifiable', () => {
  assert.match(script, /Candidatos regionales sin clasificación de aptitud/);
  assert.match(script, /pendientes\.map\(createSingleRecommendationCardHtml\)/);
  assert.match(script, /no como recomendaciones de siembra ni como cultivos aptos/);
});

test('mobile module navigation wraps into a grid without horizontal scrolling', () => {
  assert.match(styles, /\.app-header \.right\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styles, /overflow-x:\s*visible\s*!important/);
});
