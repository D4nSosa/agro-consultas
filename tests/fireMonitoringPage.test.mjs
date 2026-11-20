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
