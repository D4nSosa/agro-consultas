/**
 * Small, non-sensitive UI preferences. Never store lot geometries, credentials,
 * API responses, or historical datasets here.
 */
export const USER_PREFERENCES_KEY = 'agro_user_preferences_v1';
const VERSION = 1;
const DEFAULT_FIRE = {
  baseMap: 'satellite',
  layers: { modis: true, viirs: true, goes: true, fwi: false, lot: true, burned: false, fuel: false },
  burnedProduct: 'EmergenciasCONAE:MODIS_AQM_1',
  fuelProduct: 'AlertaTemprana:INC_SIARTIVGEOL89_DC_3',
  minConfidence: 0
};
const BURNED_PRODUCTS = new Set(Array.from({ length: 13 }, (_, i) => `EmergenciasCONAE:MODIS_AQM_${i + 1}`));
const FUEL_PRODUCTS = new Set([
  ...Array.from({ length: 3 }, (_, i) => `AlertaTemprana:INC_SIARTIVGEOL89_DC_${i + 1}`),
  ...Array.from({ length: 6 }, (_, i) => `AlertaTemprana:INC_SIARTIVGEOSNPP_DC_${i + 1}`)
]);

function readAll() {
  try {
    const raw = globalThis.localStorage?.getItem(USER_PREFERENCES_KEY);
    if (!raw || raw.length > 8192) return { version: VERSION, fire: {} };
    const parsed = JSON.parse(raw);
    if (parsed?.version !== VERSION || !parsed.fire || typeof parsed.fire !== 'object') {
      return { version: VERSION, fire: {} };
    }
    return parsed;
  } catch (_) {
    return { version: VERSION, fire: {} };
  }
}

export function getFireMapPreferences() {
  const saved = readAll().fire || {};
  const layers = saved.layers && typeof saved.layers === 'object' ? saved.layers : {};
  return {
    baseMap: saved.baseMap === 'streets' ? 'streets' : DEFAULT_FIRE.baseMap,
    layers: Object.fromEntries(Object.entries(DEFAULT_FIRE.layers).map(([key, fallback]) =>
      [key, typeof layers[key] === 'boolean' ? layers[key] : fallback])),
    burnedProduct: BURNED_PRODUCTS.has(saved.burnedProduct) ? saved.burnedProduct : DEFAULT_FIRE.burnedProduct,
    fuelProduct: FUEL_PRODUCTS.has(saved.fuelProduct) ? saved.fuelProduct : DEFAULT_FIRE.fuelProduct,
    minConfidence: Number.isInteger(saved.minConfidence) && saved.minConfidence >= 0 && saved.minConfidence <= 100 && saved.minConfidence % 5 === 0
      ? saved.minConfidence : DEFAULT_FIRE.minConfidence
  };
}

export function saveFireMapPreferences(patch = {}) {
  const current = getFireMapPreferences();
  const next = {
    baseMap: patch.baseMap === 'streets' || patch.baseMap === 'satellite' ? patch.baseMap : current.baseMap,
    layers: { ...current.layers },
    burnedProduct: BURNED_PRODUCTS.has(patch.burnedProduct) ? patch.burnedProduct : current.burnedProduct,
    fuelProduct: FUEL_PRODUCTS.has(patch.fuelProduct) ? patch.fuelProduct : current.fuelProduct,
    minConfidence: Number.isInteger(patch.minConfidence) && patch.minConfidence >= 0 && patch.minConfidence <= 100 && patch.minConfidence % 5 === 0
      ? patch.minConfidence : current.minConfidence
  };
  if (patch.layers && typeof patch.layers === 'object') {
    for (const key of Object.keys(DEFAULT_FIRE.layers)) {
      if (typeof patch.layers[key] === 'boolean') next.layers[key] = patch.layers[key];
    }
  }
  try {
    const storage = globalThis.localStorage;
    if (!storage) return false;
    const payload = JSON.stringify({ version: VERSION, fire: next });
    if (payload.length > 8192) return false;
    storage.setItem(USER_PREFERENCES_KEY, payload);
    return storage.getItem(USER_PREFERENCES_KEY) === payload;
  } catch (_) {
    return false;
  }
}
