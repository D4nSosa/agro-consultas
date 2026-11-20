import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateRecommendations } from '../services/recommendationEngine.js';

test('las fichas conservan rangos edáficos del cultivo y separan pH observado', async () => {
  const crops = await readFile(new URL('../data/cultivos.json', import.meta.url), 'utf8');
  const forests = await readFile(new URL('../data/forestales.json', import.meta.url), 'utf8');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => ({
    ok: true,
    json: async () => String(url).includes('forestales.json') ? JSON.parse(forests) : JSON.parse(crops)
  });
  try {
    const [blueberry] = await generateRecommendations(
      ['Arándano'],
      { status: 'UNAVAILABLE', ph: null, textura: null, drenaje: null, fuente: 'Consulta INTA no disponible' },
      { climatologyStatus: 'UNAVAILABLE' }
    );
    assert.equal(blueberry.requerimientos.suelo.phMin, 4.5);
    assert.equal(blueberry.requerimientos.suelo.phMax, 5.2);
    assert.equal(blueberry.sueloObservado.ph, null);
    assert.equal(blueberry.sueloObservado.status, 'UNAVAILABLE');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('la interfaz distingue pH requerido del pH observado y no inventa mediciones', async () => {
  const script = await readFile(new URL('../script.js', import.meta.url), 'utf8');
  assert.match(script, /pH requerido:/);
  assert.match(script, /pH observado en el punto:/);
  assert.match(script, /No disponible en la consulta de INTA/);
  assert.match(script, /No se reemplaza un dato ausente por un valor estimado/);
});
