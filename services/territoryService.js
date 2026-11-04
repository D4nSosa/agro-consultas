/**
 * Servicio de Territorio y Ubicación Geográfica.
 * Las bases de provincias y subregiones se cargan de forma independiente:
 * un fallo en regiones.json no debe impedir identificar la provincia.
 */
import { normalizeKey } from '../utils/normalization.js';

let provinciasData = null;
let regionesData = null;

async function loadProvincias() {
  if (provinciasData) return provinciasData;
  const response = await fetch('/data/provincias.json');
  if (!response.ok) throw new Error(`No se pudo cargar provincias.json (HTTP ${response.status})`);
  provinciasData = await response.json();
  return provinciasData;
}

async function loadRegiones() {
  if (regionesData) return regionesData;
  const response = await fetch('/data/regiones.json');
  if (!response.ok) throw new Error(`No se pudo cargar regiones.json (HTTP ${response.status})`);
  regionesData = await response.json();
  return regionesData;
}

export async function loadTerritoryData() {
  const [provincias, regiones] = await Promise.allSettled([loadProvincias(), loadRegiones()]);
  if (provincias.status === 'rejected') throw provincias.reason;
  return { provincias: provincias.value, regiones: regiones.status === 'fulfilled' ? regiones.value : null };
}

export async function findProvinceByCoords(lat, lng) {
  const data = await loadProvincias();
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('Coordenadas inválidas para identificar la provincia.');
  let nearest = null;
  let minDistance = Infinity;
  for (const [key, province] of Object.entries(data)) {
    const coords = province?.coordenadas;
    if (!Number.isFinite(coords?.lat) || !Number.isFinite(coords?.lng)) continue;
    const distance = Math.pow(lat - coords.lat, 2) + Math.pow(lng - coords.lng, 2);
    if (distance < minDistance) { minDistance = distance; nearest = key; }
  }
  return nearest;
}

export async function findSubregion(provinciaKey, lat, lng) {
  const data = await loadRegiones();
  const key = normalizeKey(provinciaKey);
  const subregions = data?.subregiones?.[key];
  if (!Array.isArray(subregions) || !subregions.length) return null;
  let nearest = null;
  let minDistance = Infinity;
  for (const sub of subregions) {
    const subLat = Number(sub?.lat), subLng = Number(sub?.lng);
    if (!Number.isFinite(subLat) || !Number.isFinite(subLng)) continue;
    const distance = Math.pow(lat - subLat, 2) + Math.pow(lng - subLng, 2);
    if (distance < minDistance) { minDistance = distance; nearest = sub; }
  }
  return nearest;
}

export async function getProvinceDetails(provinciaKey) {
  const data = await loadProvincias();
  return data[normalizeKey(provinciaKey)] || null;
}

export async function getAllProvincias() {
  return await loadProvincias();
}

export async function getProvinceCoordinates(provinciaKey) {
  const data = await loadProvincias();
  const province = data[normalizeKey(provinciaKey)];
  return province ? province.coordenadas : null;
}
