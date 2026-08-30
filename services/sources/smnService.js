/**
 * Adaptador de Servicio para la API del Servicio Meteorológico Nacional (SMN) de Argentina
 * Proporciona alertas en vivo con empaquetamiento DataPoint, caché y tolerancia a fallos.
 */

import { createDataPoint, createUnavailableDataPoint, DataStatus, ConfidenceLevel } from '../../utils/dataModel.js';

const CACHE_PREFIX = 'agro_cache_smn_';
const CACHE_EXPIRY = 60 * 60 * 1000; // 1 hora

/**
 * Obtiene las alertas meteorológicas activas desde el SMN para una provincia.
 * @param {string} provincia - Nombre normalizado o completo de la provincia.
 * @returns {Promise<Object>} DataPoint con alertas.
 */
export async function fetchSMNAlerts(provincia) {
  const provStr = typeof provincia === 'string' ? provincia : (provincia?.nombre || 'argentina');
  const cacheKey = `${CACHE_PREFIX}alerts_${provStr.toLowerCase().replace(/\s+/g, '_')}`;

  // 1. Intentar recuperar desde Caché
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_EXPIRY) {
        return { ...data, cached: true };
      }
    }
  } catch (err) {
    console.warn("[SMN] Error al leer caché de alertas:", err);
  }

  // 2. Intentar llamar a API Oficial SMN con timeout
  try {
    const url = `https://ws.smn.gob.ar/alerts/`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);

    const alertsList = await response.json();
    const provinciaNormalizada = provStr.toLowerCase().trim();

    const alertasProvinciales = alertsList.filter(alerta => {
      if (!alerta.zones) return false;
      return Object.values(alerta.zones).some(zona =>
        zona.toLowerCase().includes(provinciaNormalizada)
      );
    });

    const parsedAlerts = alertasProvinciales.map(alerta => ({
      id: alerta._id,
      titulo: alerta.title || "Alerta Meteorológica",
      descripcion: alerta.description || "",
      fecha: alerta.date || new Date().toLocaleDateString(),
      gravedad: alerta.severity || "Media/Alta"
    }));

    const data = createDataPoint({
      value: parsedAlerts,
      source: 'SMN Oficial (API en tiempo real)',
      sourceUrl: 'https://ws.smn.gob.ar/alerts/',
      dataset: 'Alertas Meteorológicas Tempranas',
      retrievedAt: new Date().toISOString(),
      status: DataStatus.REAL,
      confidence: ConfidenceLevel.HIGH
    });

    try {
      localStorage.setItem(cacheKey, JSON.stringify({ data, timestamp: Date.now() }));
    } catch (e) {}

    return data;
  } catch (err) {
    console.warn(`[SMN] Falló o expiró consulta de alertas en vivo para ${provStr}:`, err.message);

    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const { data } = JSON.parse(cached);
        return {
          ...data,
          status: DataStatus.ESTIMATED,
          confidence: ConfidenceLevel.LOW,
          message: 'Alertas SMN desde caché local previo'
        };
      }
    } catch (e) {}

    return createDataPoint({
      value: [],
      source: 'SMN Oficial',
      status: DataStatus.UNAVAILABLE,
      confidence: ConfidenceLevel.NONE,
      message: 'Alertas SMN en tiempo real no disponibles para esta zona'
    });
  }
}
