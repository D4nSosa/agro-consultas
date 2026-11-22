import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const report = await readFile(new URL('../reporte.html', import.meta.url), 'utf8');
const sentinel = await readFile(new URL('../forestal/services/satelliteService.js', import.meta.url), 'utf8');
const backendMain = await readFile(new URL('../backend/main.py', import.meta.url), 'utf8');
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
  assert.match(sentinel, /BACKEND_STAC_ENDPOINT = '\/api\/forest\/stac'/);
  assert.match(sentinel, /body: JSON.stringify\(\{[\s\S]*geometry: geojson/);
  assert.match(backendMain, /"intersects": geom_dict/);
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


test('unified report is read-only for forestry satellite and global forest analyses', () => {
  assert.match(report, /getReportSnapshot/);
  assert.doesNotMatch(report, /runFullForestAnalysis/);
  assert.doesNotMatch(report, /id="gfw-run"|id="hansen-run"|id="jrc-run"/);
  assert.doesNotMatch(report, /\/api\/territorial\/forest\/(gfw-drivers|hansen|jrc)\/analyze/);
  assert.match(report, /este informe no inicia consultas satelitales/i);
  assert.match(report, /No hay un análisis Sentinel-2 guardado para esta geometría/i);
});

test('Forestal lets users select comparison target dates and stores real scene results', async () => {
  const forestPage = await readFile(new URL('../forestal.html', import.meta.url), 'utf8');
  assert.match(forestPage, /id="forest-date-a"/);
  assert.match(forestPage, /id="forest-date-b"/);
  assert.match(forestPage, /saveReportSection\(feature\.geometry, 'forest-sentinel2'/);
  assert.match(forestPage, /forest-gfw-run/);
  assert.match(forestPage, /forest-hansen-run/);
  assert.match(forestPage, /forest-jrc-run/);
});

test('Forestal presents analysis output but leaves PDF and sharing to unified Reports', () => {
  assert.match(forestReport, /Resultados del análisis forestal y teledetección/);
  assert.doesNotMatch(forestReport, /btn-print-report|btn-share-forest-report/);
});

test('report normalizes shared raw GeoJSON geometry before loading saved results', () => {
  assert.match(report, /Los enlaces históricos pueden transportar una geometría GeoJSON directa/);
  assert.match(report, /parsedGeom = \{ type: 'Feature', properties: \{\}, geometry: parsedGeom \}/);
});
