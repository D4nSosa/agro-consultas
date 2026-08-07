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
 * Busca la provincia más cercana a un par de coordenadas dadas.
 * @param {number} lat - Latitud.
 * @param {number} lng - Longitud.
 * @returns {Promise<string>} Clave normalizada de la provincia más cercana.
 */
export async function findProvinceByCoords(lat, lng) {
  await loadTerritoryData();

  let provinciaCercana = null;
  let distanciaMinima = Infinity;

  for (const [provKey, data] of Object.entries(provinciasData)) {
    const coords = data.coordenadas;
    if (!coords) continue;

    const d = Math.pow(lat - coords.lat, 2) + Math.pow(lng - coords.lng, 2);
    if (d < distanciaMinima) {
      distanciaMinima = d;
      provinciaCercana = provKey;
    }
  }

  return provinciaCercana;
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
