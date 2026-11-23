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


test('clicking a detection opens its popup without triggering map forecast selection', () => {
  assert.match(page, /function bindDetectionPopup\(marker, content\)/);
  assert.match(page, /interactive:true,bubblingMouseEvents:false/);
  assert.match(page, /interactive:false,bubblingMouseEvents:false/);
  assert.match(page, /marker\.on\('click',event=>L\.DomEvent\.stopPropagation\(event\.originalEvent\)\)/);
  assert.match(page, /bindDetectionPopup\(L\.circleMarker/);
  assert.match(page, /map\.on\('click',e=>\{/);
  assert.match(page, /e\.originalEvent\?\.defaultPrevented \|\| e\.originalEvent\?\._stopped/);
});

test('national fire clusters expose sample detection metadata instead of only a count', () => {
  assert.match(page, /group\.features\.slice\(0,5\)/);
  assert.match(page, /Fecha:/);
  assert.match(page, /Satélite:/);
  assert.match(page, /Confianza:/);
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

test('recent fire detections respect the same active sensor filters as the map', () => {
  assert.match(page, /const sensor=f\.properties\?\.sensor/);
  assert.match(page, /if\(sensor==='MODIS'\)return \$\('show-modis'\)\.checked/);
  assert.match(page, /if\(sensor==='VIIRS'\)return \$\('show-viirs'\)\.checked/);
  assert.match(page, /if\(sensor==='GOES'\)return \$\('show-goes'\)\.checked/);
  assert.match(page, /drawDetections\(\);\s*renderRecentDetections\(\);/);
});
