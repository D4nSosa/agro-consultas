import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [script, styles] = await Promise.all([
  readFile(new URL('../script.js', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8')
]);

test('crop candidates remain visible without being mislabeled as recommendations', () => {
  assert.match(script, /Perfiles que requieren más evidencia/);
  assert.match(script, /pendientes\.map\(createSingleRecommendationCardHtml\)/);
  assert.doesNotMatch(script, /Orientación productiva territorial/);
  assert.doesNotMatch(script, /perfiles del catálogo provincial/);
  assert.doesNotMatch(script, /no como recomendaciones de siembra ni como cultivos aptos/);
});

test('GAEZ uses the crop suitability index and historical baseline by default', async () => {
  const results = await readFile(new URL('../resultados.html', import.meta.url), 'utf8');
  assert.match(results, /id="gaez-map-controls"/);
  assert.match(results, /id="gaez-map-run"/);
  assert.match(results, /initSplashScreen/);
  assert.match(results, /splash\.style\.display = 'flex'/);
  assert.doesNotMatch(results, /sessionStorage\.getItem\('splash_shown'\)/);
  assert.match(script, /preferred: "RES05-SUT"/);
  assert.match(script, /value === "RES05-SUT"/);
  assert.match(script, /body.mapset_code !== "RES05-SUT"/);
  assert.match(script, /preferred: "HP0120"/);
  assert.match(script, /preferred: "AgERA5"/);
  assert.match(script, /preferred: "HIST"/);
  assert.match(script, /preferred: "L"/);
  assert.doesNotMatch(results, /Abrir portal FAO\/IIASA GAEZ/);
  assert.match(script, /L\.imageOverlay/);
  assert.match(script, /api\/territorial\/gaez\/analyze/);
});

test('mobile module navigation wraps into a grid without horizontal scrolling', () => {
  assert.match(styles, /\.app-header \.right\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)/);
  assert.match(styles, /overflow-x:\s*visible\s*!important/);
});

test('forest module does not show the obsolete external GFW promotion block', async () => {
  const forest = await readFile(new URL('../forestal.html', import.meta.url), 'utf8');
  assert.doesNotMatch(forest, /Fuentes complementarias de cobertura forestal/);
  assert.doesNotMatch(forest, /Explorar mapa Global Forest Watch/);
  assert.doesNotMatch(forest, /Documentación de su API/);
});

test('production HTML and module imports are cache-busted after UI fixes', async () => {
  const results = await readFile(new URL('../resultados.html', import.meta.url), 'utf8');
  const scriptText = await readFile(new URL('../script.js', import.meta.url), 'utf8');
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.match(results, /script\.js\?v=20261118-crops-fix/);
  assert.match(scriptText, /recommendationEngine\.js\?v=20261118-crops-fix/);
  assert.ok(config.headers.some(item => item.source === '/resultados.html'));
  assert.ok(config.headers.some(item => item.source === '/forestal.html'));
});
