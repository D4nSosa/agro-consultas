import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const report = await readFile(new URL('../reporte.html', import.meta.url), 'utf8');
const sentinel = await readFile(new URL('../forestal/services/satelliteService.js', import.meta.url), 'utf8');
const orchestrator = await readFile(new URL('../forestal/services/forestAnalysisService.js', import.meta.url), 'utf8');
const forestReport = await readFile(new URL('../forestal/components/ChangeReport.js', import.meta.url), 'utf8');
const forestTimeline = await readFile(new URL('../forestal/components/ForestTimeline.js', import.meta.url), 'utf8');

test('technical report is responsive on mobile and print layouts', () => {
  assert.match(report, /report-responsive-layout/);
  assert.match(report, /overflow-x:clip;overflow-y:visible/);
  assert.match(report, /@media\(max-width:640px\)/);
  assert.match(report, /@media print/);
  assert.match(report, /\.report-fire-row,\.report-forecast-row\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(report, /\.compatibility-badge\{white-space:normal/);
});

test('technical report consolidates fire detections and local forecast', () => {
  assert.match(report, /\/api\/fires\/national/);
  assert.match(report, /\/api\/fires\/goes/);
  assert.match(report, /\/api\/fires\/forecast/);
  assert.match(report, /Detecciones recientes en el alcance consultado/);
  assert.match(report, /Pronóstico meteorológico local/);
});

test('technical report does not redirect to external platforms', () => {
  const anchors = [...report.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)];
  assert.deepEqual(anchors.map(([, href]) => href).filter(href => /^https?:\/\//i.test(href)), []);
});

test('Sentinel search intersects the actual lot geometry and reports timeouts', () => {
  assert.match(sentinel, /intersects: geojson/);
  assert.match(sentinel, /AbortController/);
  assert.match(sentinel, /20 segundos/);
  assert.doesNotMatch(orchestrator, /Promise\.race/);
  assert.match(orchestrator, /search: \{ dateA: searchResA, dateB: searchResB \}/);
});

test('forest module exposes Sentinel preview assets in report and timeline', () => {
  assert.match(forestReport, /previewA/);
  assert.match(forestReport, /previewB/);
  assert.match(forestReport, /Vista previa Sentinel-2 Fecha A/);
  assert.match(forestTimeline, /item\.thumbnail/);
  assert.match(orchestrator, /thumbnail: prod\.assets/);
});
