import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [script, styles, nasaService, openMeteoService, smnService] = await Promise.all([
  readFile(new URL('../script.js', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../services/sources/nasaPowerService.js', import.meta.url), 'utf8'),
  readFile(new URL('../services/sources/openMeteoService.js', import.meta.url), 'utf8'),
  readFile(new URL('../services/sources/smnService.js', import.meta.url), 'utf8')
]);

test('crop candidates remain visible without being mislabeled as recommendations', () => {
  assert.match(script, /Perfiles que requieren más evidencia/);
  assert.match(script, /pendientes\.map\(createSingleRecommendationCardHtml\)/);
  assert.match(script, /Datos que faltan para clasificar/);
  assert.match(script, /const displayedMotives = c/);
  assert.doesNotMatch(script, /Orientación productiva territorial/);
  assert.doesNotMatch(script, /perfiles del catálogo provincial/);
  assert.doesNotMatch(script, /La especie figura en el catálogo provincial/);
  assert.doesNotMatch(script, /no como recomendaciones de siembra ni como cultivos aptos/);
});

test('the inactive GAEZ workflow is removed while historical climate periods remain explicit', async () => {
  const results = await readFile(new URL('../resultados.html', import.meta.url), 'utf8');
  const report = await readFile(new URL('../reporte.html', import.meta.url), 'utf8');
  assert.match(results, /12 meses consolidados/);
  assert.doesNotMatch(results, /Últimos 12 meses/);
  assert.doesNotMatch(results, /gaez-map-controls|gaez-map-run|GAEZ v5/);
  assert.equal(results.includes('/api/territorial/gaez/'), false);
  assert.doesNotMatch(script, /GAEZ|gaez-map/);
  assert.doesNotMatch(report, /GAEZ|gaez-map/);
  assert.equal(report.includes('/api/territorial/gaez/'), false);
  assert.match(results, /id="crop-map-analysis-status"/);
  assert.match(results, /initSplashScreen/);
  assert.match(results, /splash\.style\.display = 'flex'/);
  assert.doesNotMatch(results, /sessionStorage\.getItem\('splash_shown'\)/);
  assert.match(script, /periodLabel/);
  assert.match(script, /climateHistory\.traceability\?\.periodoMensual/);
  assert.match(nasaService, /periodoMensual/);
  assert.match(nasaService, /status: "ESTIMATED"/);
  assert.doesNotMatch(nasaService, /status: "REAL"/);
  assert.match(nasaService, /reanálisis\/modelado espacial/);
  assert.match(script, /reanálisis\/modelado espacial/);
  assert.match(report, /Período mensual reciente \(reanálisis\)/);
  assert.match(script, /climateHistory\?\.status === 'ESTIMATED'/);
  assert.match(script, /climatologyStatus: 'ESTIMATED'/);
  assert.match(report, /reportSections\['agro-environment'\]/);
  assert.match(report, /climateHistory\?\.data\?\.historicalAverages/);
  assert.doesNotMatch(report, /climatologyStatus/);
  assert.match(results, /class="map-legend" style="display:none;"/);
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

test('Agro never runs the heavy Sentinel-1 raster processing during the main location workflow', () => {
  const start = script.indexOf('export async function renderSarRadarUI');
  const end = script.indexOf('Renderiza la capa visual de aptitud', start);
  const radarFunction = script.slice(start, end);
  assert.ok(radarFunction.includes('if (!manual)'));
  assert.ok(radarFunction.includes('btn-run-agro-sar'));
  assert.ok(radarFunction.includes('renderSarRadarUI(lat, lng, geom, true)'));
  assert.ok(script.includes("await ejecutarEtapaConTimeout("));
  assert.ok(script.includes('ocultarIndicadorCarga();'));
});

test('map and GPS selection call the SAR renderer in lazy mode and close the global overlay', () => {
  assert.ok(script.includes("await ejecutarEtapaConTimeout(\\n      'Radar satelital'"));
  assert.ok(script.includes('renderSarRadarUI(currentLat, currentLng, sarGeometry)'));
  assert.ok(script.includes('ocultarIndicadorCarga();'));
  const start = script.indexOf('export async function renderSarRadarUI');
  const end = script.indexOf('Renderiza la capa visual de aptitud', start);
  const radarFunction = script.slice(start, end);
  assert.ok(radarFunction.includes('if (!manual)'));
  assert.ok(radarFunction.includes('btn-run-agro-sar'));
});

test('Open-Meteo and SMN keep AbortController active until JSON body parsing finishes', () => {
  assert.match(openMeteoService, /await response\.json\(\)[\s\S]*?finally\s*\{\s*clearTimeout\(timeoutId\)/);
  assert.match(smnService, /await response\.json\(\)[\s\S]*?finally\s*\{\s*clearTimeout\(timeoutId\)/);
  assert.match(openMeteoService, /controller\.abort\(\), 12000/);
  assert.match(smnService, /controller\.abort\(\), 2500/);
});

test('NASA POWER monthly and climatology requests have independent bounded fetch and JSON parsing', () => {
  assert.match(nasaService, /NASA_POWER_REQUEST_TIMEOUT_MS = 10000/);
  assert.match(nasaService, /fetch\(url, \{ signal: controller\.signal \}\)/);
  assert.match(nasaService, /await response\.json\(\)/);
  assert.match(nasaService, /fetchJsonWithTimeout\(url\)/);
});

test('Agro stores forest candidates from the already generated recommendation set without recalculating them', () => {
  assert.match(script, /const recomendacionesForestales = selectedCropKey === 'todos'[\s\S]*?recomendaciones\.filter/);
  assert.doesNotMatch(script, /generateRecommendations\(forestNames/);
});

test('fire-weather heuristic is not presented as official FWI in user-facing modules', async () => {
  const [report, tracking, openMeteo] = await Promise.all([
    readFile(new URL('../reporte.html', import.meta.url), 'utf8'),
    readFile(new URL('../tracking.html', import.meta.url), 'utf8'),
    readFile(new URL('../services/sources/openMeteoService.js', import.meta.url), 'utf8')
  ]);
  assert.match(script, /Indicador meteorológico interno \(no FWI\)/);
  assert.match(report, /Indicador meteorológico interno \(no FWI\)/);
  assert.match(tracking, /Indicador meteorológico interno \(no FWI\)/);
  assert.match(openMeteo, /status: DataStatus\.ESTIMATED/);
  assert.match(openMeteo, /modelo meteorológico, no observación directa/);
});
