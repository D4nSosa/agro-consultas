import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../incendios.html', import.meta.url), 'utf8');

test('fire detections and local forecast are promoted immediately below the map', () => {
  assert.match(page, /fire-priority-panels/);
  assert.match(page, /priorityPanels\.append\(detectionCard\)/);
  assert.match(page, /priorityPanels\.append\(forecastCard\)/);
  assert.match(page, /@media\(max-width:620px\)\{\.fire-priority-panels\{grid-template-columns:minmax\(0,1fr\)\}/);
});

test('selecting a fire detection brings the map into view automatically', () => {
  assert.match(page, /scrollIntoView\(\{behavior:'smooth',block:'center'\}\)/);
});

test('historical error copy does not send users to the technical status panel', () => {
  assert.doesNotMatch(page, /Revisá el estado de la fuente NASA FIRMS/i);
  assert.doesNotMatch(page, /Revisá el estado de NASA FIRMS/i);
  assert.match(page, /no significa que no haya incendios/i);
});
test('fire map preferences are stored through the allowlisted local preference service', () => {
  assert.match(page, /getFireMapPreferences/);
  assert.match(page, /saveFireMapPreferences/);
  assert.match(page, /services\/userPreferences\.js/);
});

test('CONAE layers remain understandable when WMS metadata times out', () => {
  assert.match(page, /conaeProductFallback/);
  assert.match(page, /MODIS MCD64A1\.061/);
  assert.match(page, /día juliano asociado al área quemada/);
  assert.match(page, /vegetación senescente o seca y suelo descubierto/);
  assert.doesNotMatch(page, /ficha pendiente/i);
  assert.doesNotMatch(page, /revisá el título y la descripción/i);
});

test('mobile fire cards stack and occupy the available width', () => {
  assert.match(page, /@media\(max-width:900px\)/);
  assert.match(page, /\.fire-side\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(page, /\.fire-priority-panels\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(page, /\.fire-day\{grid-template-columns:minmax\(0,1fr\)\}/);
});

test('restores and saves the minimum confidence preference', () => {
  assert.match(page, /firePreferences\.minConfidence/);
  assert.match(page, /saveFireMapPreferences\(\{minConfidence:Number\(\$\('confidence'\)\.value\)\}\)/);
});
