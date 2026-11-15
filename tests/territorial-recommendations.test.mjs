import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calcularCompatibilidad, AptitudCategoria } from '../utils/scoring.js';
import { getCropsToEvaluate } from '../services/recommendationEngine.js';

test('el contexto regional no se etiqueta como limitación moderada', () => {
  const crop = {
    nombre: 'Naranja',
    requerimientos: {
      suelo: { texturas: ['franca'], drenaje: ['bueno'] },
      clima: { temperaturaMin: 15, temperaturaMax: 28, precipitacionMin: 900 }
    }
  };
  const soil = { status: 'REGIONAL', textura: 'arenosa', drenaje: 'bueno', tipo: 'Alfisol' };
  const climate = {
    status: 'REAL',
    climatologyStatus: 'REGIONAL',
    temperaturaMediaVal: 21,
    precipitacionesAnualesVal: 1400,
    heladas: 'Riesgo muy bajo'
  };
  const result = calcularCompatibilidad(crop, soil, climate);
  assert.equal(result.categoria, AptitudCategoria.REGIONAL);
});

test('la evaluación local puede distinguir limitaciones medidas', () => {
  const crop = {
    nombre: 'Trigo',
    requerimientos: {
      suelo: { phMin: 6, phMax: 7.5, texturas: ['franca'], drenaje: ['bueno'] },
      clima: { temperaturaMin: 5, temperaturaMax: 25, precipitacionMin: 500 }
    }
  };
  const soil = { status: 'REAL', ph: 4.2, textura: 'arcillosa', drenaje: 'pobre', tipo: 'Suelo medido' };
  const climate = {
    status: 'REAL',
    climatologyStatus: 'REAL',
    temperaturaMediaVal: 18,
    precipitacionesAnualesVal: 850,
    heladas: 'Riesgo bajo'
  };
  const result = calcularCompatibilidad(crop, soil, climate);
  assert.equal(result.categoria, AptitudCategoria.BAJA);
});

test('los candidatos se diferencian por el perfil de la subregión', async () => {
  const [crops, provinces] = await Promise.all([
    readFile(new URL('../data/cultivos.json', import.meta.url), 'utf8'),
    readFile(new URL('../data/provincias.json', import.meta.url), 'utf8')
  ]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    const value = String(url).includes('forestales.json') ? '{}' :
      String(url).includes('provincias.json') ? provinces : crops;
    return { ok: true, json: async () => JSON.parse(value) };
  };
  try {
    const north = await getCropsToEvaluate('corrientes', {
      suelo: { aptitud: 'Alta para Yerba Mate, Té, Citrus, Pino Elliottii y Eucalyptus Grandis' }
    });
    const south = await getCropsToEvaluate('corrientes', {
      suelo: { aptitud: 'Excelente para el cultivo de Arroz bajo inundación controlada y ganadería' }
    });
    assert.ok(north.some(name => /yerba mate/i.test(name)));
    assert.ok(!north.some(name => /^arroz$/i.test(name)));
    assert.deepEqual(south, ['Arroz']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
