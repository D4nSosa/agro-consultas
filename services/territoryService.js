/**
 * Servicio de Territorio y Ubicación Geográfica
 * Gestiona provincias, subregiones y centroides sin dependencias del DOM.
 */

import { normalizeKey } from '../utils/normalization.js';

let provinciasData = null;
let regionesData = null;

/**
 * Carga de manera asíncrona las bases de datos geográficas si no han sido cargadas.
 */
export async function loadTerritoryData() {
  if (!provinciasData) {
    const response = await fetch('/data/provincias.json');
    if (!response.ok) throw new Error("No se pudo cargar provincias.json");
    provinciasData = await response.json();
  }
  if (!regionesData) {
    const response = await fetch('/data/regiones.json');
    if (!response.ok) throw new Error("No se pudo cargar regiones.json");
    regionesData = await response.json();
  }
}

/**
 * Resuelve la jurisdicción que contiene el punto mediante el servicio oficial
 * Georef (datos.gob.ar). No sustituye límites administrativos por centroides.
 */
export async function getAdministrativeLocationByCoords(lat, lng) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;
  try {
    const url = new URL('https://apis.datos.gob.ar/georef/api/ubicacion');
    url.search = new URLSearchParams({
      lat: String(lat), lon: String(lng),
      campos: 'estandar', formato: 'json'
    }).toString();
    const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Georef respondió HTTP ${response.status}`);
    const payload = await response.json();
    const location = payload?.ubicacion;
    const provinceName = location?.provincia?.nombre || null;
    if (!provinceName) return null;
    await loadTerritoryData();
    const provinceKey = Object.keys(provinciasData).find(
      key => normalizeKey(key) === normalizeKey(provinceName)
    ) || null;
    return {
      provincia: provinceName,
      provinciaId: location?.provincia?.id || null,
      departamento: location?.departamento?.nombre || null,
      departamentoId: location?.departamento?.id || null,
      municipio: location?.municipio?.nombre || null,
      municipioId: location?.municipio?.id || null,
      provinceKey,
      fuente: 'Georef · datos.gob.ar'
    };
  } catch (error) {
    console.warn('[Territorio] No se pudo verificar la ubicación administrativa:', error);
    return null;
  }
}

/**
 * Devuelve la clave normalizada solo cuando Georef confirma la provincia.
 * Si el servicio falla, retorna null: nunca adivina usando centroides.
 */
export async function findProvinceByCoords(lat, lng) {
  const location = await getAdministrativeLocationByCoords(lat, lng);
  return location?.provinceKey || null;
}

/**
 * Busca la subregión más cercana dentro de una provincia.
 * @param {string} provinciaKey - Clave de la provincia.
 * @param {number} lat - Latitud.
 * @param {number} lng - Longitud.
 * @returns {Promise<Object|null>} Datos de la subregión más cercana.
 */
export async function findSubregion(provinciaKey, lat, lng) {
  await loadTerritoryData();
  const key = normalizeKey(provinciaKey);
  const subregiones = regionesData.subregiones[key];

  if (!subregiones || subregiones.length === 0) return null;

  let subregionMasCercana = null;
  let distMin = Infinity;

  for (const sub of subregiones) {
    const d = Math.pow(lat - sub.lat, 2) + Math.pow(lng - sub.lng, 2);
    if (d < distMin) {
      distMin = d;
      subregionMasCercana = sub;
    }
  }

  return subregionMasCercana;
}

/**
 * Obtiene los detalles de una provincia específica.
 * @param {string} provinciaKey - Clave de la provincia.
 * @returns {Promise<Object|null>} Detalles de la provincia.
 */
export async function getProvinceDetails(provinciaKey) {
  await loadTerritoryData();
  const key = normalizeKey(provinciaKey);
  return provinciasData[key] || null;
}

/**
 * Obtiene el listado completo de provincias disponibles.
 * @returns {Promise<Object>} Base de datos de provincias.
 */
export async function getAllProvincias() {
  await loadTerritoryData();
  return provinciasData;
}

/**
 * Retorna las coordenadas por defecto para una provincia (centroide).
 * @param {string} provinciaKey - Clave de la provincia.
 * @returns {Promise<Object|null>} Coordenadas {lat, lng, zoom}.
 */
export async function getProvinceCoordinates(provinciaKey) {
  await loadTerritoryData();
  const key = normalizeKey(provinciaKey);
  const prov = provinciasData[key];
  return prov ? prov.coordenadas : null;
}
