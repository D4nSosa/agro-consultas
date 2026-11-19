import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../incendios.html', import.meta.url), 'utf8');

test('incendios keeps source provenance inside the application without a separate methodology section', () => {
  assert.doesNotMatch(page, /Fuentes, cobertura y metodología/i);
  assert.match(page, /id="source-provenance"/);
  assert.match(page, /NASA FIRMS/);
  assert.match(page, /NOAA GOES-19/);
  assert.match(page, /WFS de CONAE/);
  assert.match(page, /Open-Meteo/);
});

test('incendios does not send users to external provider portals', () => {
  const anchors = [...page.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)];
  const external = anchors.map(([, href]) => href).filter(href => /^https?:\/\//i.test(href));
  assert.deepEqual(external, []);
});

test('incendios keeps the warning that weather forecast is not official FWI', () => {
  assert.match(page, /no incorpora el índice FWI/i);
  assert.match(page, /no debe interpretarse como peligro oficial de incendio/i);
});
