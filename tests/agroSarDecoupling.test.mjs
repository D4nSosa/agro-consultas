import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const script = await readFile(new URL('../script.js', import.meta.url), 'utf8');

test('Sentinel-1 is not awaited by the main location analysis', () => {
  assert.match(script, /SAR queda disponible como acción independiente/);
  assert.doesNotMatch(script, /ejecutarEtapaConTimeout\(['"]Radar satelital/);
});

test('manual Sentinel-1 requests do not fail after an arbitrary 15-second timer', () => {
  const start = script.indexOf('export async function renderSarRadarUI');
  const end = script.indexOf('/**\n * Renderiza la capa visual', start);
  const sar = script.slice(start, end);
  assert.match(sar, /await getSentinel1SarAnalysis\(targetGeom\)/);
  assert.doesNotMatch(sar, /setTimeout/);
  assert.doesNotMatch(sar, /15 segundos/);
  assert.match(sar, /btn-retry-agro-sar/);
});
