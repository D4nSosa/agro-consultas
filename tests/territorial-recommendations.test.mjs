import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calcularCompatibilidad, AptitudCategoria } from '../utils/scoring.js';
import { getCropsToEvaluate } from '../services/recommendationEngine.js';

test('un perfil regional orienta candidatos pero no certifica aptitud', () => {
  const crop = {
    nombre: 'Naranja',
    requerimientos: {
      suelo: { texturas: ['franca'], drenaje: ['bueno'] },
      clima: { temperaturaMin: 15, temperaturaMax: 28, precipitacionMin: 900 }
    }
  };
  const soil = {
    status: 'REGIONAL',
    textura: 'arenosa',
    drenaje: 'bueno',
    tipo: 'Alfisol',
    aptitud: 'Alta para Yerba Mate, Té, Citrus, Pino Elliottii y Eucalyptus Grandis'
  };
  const climate = {
    status: 'REGIONAL',
    climatologyStatus: 'REGIONAL',
    temperaturaMediaVal: 21,
    precipitacionesAnualesVal: 1400,
    heladas: 'Riesgo muy bajo'
  };
  const result = calcularCompatibilidad(crop, soil, climate);
  assert.equal(result.categoria, AptitudCategoria.NO_EVALUABLE);
  assert.ok(!String(result.categoria).includes('REGIONAL'));
  assert.ok(result.motivos.some(reason => reason.includes('perfil agroambiental')));
  assert.ok(result.riesgos.some(reason => reason.includes('Textura arenosa')));
  assert.equal(result.calidadEvidencia, 'EVIDENCIA INSUFICIENTE PARA CLASIFICAR');
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


test('no asigna aptitud alta cuando el perfil regional no identifica el cultivo', () => {
  const crop = {
    nombre: 'Trigo',
    requerimientos: {
      suelo: { texturas: ['franca'], drenaje: ['bueno'] },
      clima: { temperaturaMin: 10, temperaturaMax: 25, precipitacionMin: 500 }
    }
  };
  const soil = {
    status: 'REGIONAL',
    textura: 'franca',
    drenaje: 'bueno',
    tipo: 'Molisol',
    aptitud: 'Perfil regional orientado a yerba mate y forestación'
  };
  const climate = {
    status: 'REAL',
    climatologyStatus: 'REGIONAL',
    temperaturaMediaVal: 18,
    precipitacionesAnualesVal: 900
  };
  const result = calcularCompatibilidad(crop, soil, climate);
  assert.equal(result.categoria, AptitudCategoria.NO_EVALUABLE);
  assert.ok(result.datosFaltantes.some(item => item.includes('no identifica este cultivo')));
});

test('no asigna aptitud alta cuando faltan comparaciones edáficas o climáticas', () => {
  const crop = {
    nombre: 'Maíz',
    requerimientos: {
      suelo: { texturas: ['franca'] },
      clima: { temperaturaMin: 15, temperaturaMax: 32 }
    }
  };
  const soil = { status: 'REAL', textura: 'franca', tipo: 'Molisol' };
  const climate = { status: 'REAL', climatologyStatus: 'UNAVAILABLE', temperaturaMediaVal: 23 };
  const result = calcularCompatibilidad(crop, soil, climate);
  assert.equal(result.categoria, AptitudCategoria.NO_EVALUABLE);
});

test('puede clasificar aptitud alta cuando hay comparaciones locales completas y compatibles', () => {
  const crop = {
    nombre: 'Maíz',
    requerimientos: {
      suelo: { texturas: ['franca'], drenaje: ['bueno'] },
      clima: { temperaturaMin: 15, temperaturaMax: 32, precipitacionMin: 600 }
    }
  };
  const soil = { status: 'REAL', textura: 'franca', drenaje: 'bueno', tipo: 'Molisol' };
  const climate = {
    status: 'REAL',
    climatologyStatus: 'REAL',
    temperaturaMediaVal: 23,
    precipitacionesAnualesVal: 900
  };
  const result = calcularCompatibilidad(crop, soil, climate);
  assert.equal(result.categoria, AptitudCategoria.ALTA);
});

test('no confunde la sílaba te dentro de otras palabras con el cultivo Té', () => {
  const crop = {
    nombre: 'Té',
    requerimientos: {
      suelo: { texturas: ['franca'], drenaje: ['bueno'] },
      clima: { temperaturaMin: 15, temperaturaMax: 28, precipitacionMin: 900 }
    }
  };
  const soil = {
    status: 'REGIONAL',
    textura: 'franca',
    drenaje: 'bueno',
    tipo: 'Alfisol',
    aptitud: 'Temperatura media adecuada y drenaje bueno para cultivos varios'
  };
  const climate = {
    status: 'REGIONAL',
    climatologyStatus: 'REGIONAL',
    temperaturaMediaVal: 21,
    precipitacionesAnualesVal: 1400
  };
  const result = calcularCompatibilidad(crop, soil, climate);
  assert.equal(result.categoria, AptitudCategoria.NO_EVALUABLE);
});
