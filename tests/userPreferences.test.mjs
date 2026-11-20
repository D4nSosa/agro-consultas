import test from 'node:test';
import assert from 'node:assert/strict';
import { getFireMapPreferences, saveFireMapPreferences, USER_PREFERENCES_KEY } from '../services/userPreferences.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

function withStorage(t, storage) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  });
}

test('uses safe defaults when no preferences have been saved', t => {
  withStorage(t, memoryStorage());
  const preferences = getFireMapPreferences();
  assert.equal(preferences.baseMap, 'satellite');
  assert.equal(preferences.layers.modis, true);
  assert.equal(preferences.layers.fwi, false);
});

test('persists only allowlisted map preferences', t => {
  const storage = memoryStorage();
  withStorage(t, storage);
  assert.equal(saveFireMapPreferences({
    baseMap: 'streets',
    layers: { modis: false, burned: true, unknown: true },
    burnedProduct: 'EmergenciasCONAE:MODIS_AQM_4',
    fuelProduct: 'not-a-real-layer',
    apiKey: 'must-not-be-stored'
  }), true);
  const saved = getFireMapPreferences();
  assert.equal(saved.baseMap, 'streets');
  assert.equal(saved.layers.modis, false);
  assert.equal(saved.layers.burned, true);
  assert.equal(saved.burnedProduct, 'EmergenciasCONAE:MODIS_AQM_4');
  assert.equal(saved.fuelProduct, 'AlertaTemprana:INC_SIARTIVGEOL89_DC_3');
  assert.equal(storage.getItem(USER_PREFERENCES_KEY).includes('must-not-be-stored'), false);
});

test('ignores malformed or incompatible preference data', t => {
  const storage = memoryStorage();
  withStorage(t, storage);
  storage.setItem(USER_PREFERENCES_KEY, JSON.stringify({ version: 99, fire: { baseMap: 'streets' } }));
  assert.equal(getFireMapPreferences().baseMap, 'satellite');
});

test('does not throw when localStorage is unavailable', t => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  withStorage(t, blocked);
  assert.equal(saveFireMapPreferences({ baseMap: 'streets' }), false);
  assert.equal(getFireMapPreferences().baseMap, 'satellite');
});
