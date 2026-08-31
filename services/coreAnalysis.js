/**
 * services/coreAnalysis.js — Núcleo de Análisis Agroambiental y Forestal
 * Funciones puras desacopladas de la UI, estructuradas en formato JSON para consumo directo o futuras APIs.
 */

import { findProvinceByCoords, findSubregion, getProvinceDetails } from './territoryService.js';
import { getSoilReport } from './soilService.js';
import { getClimateData } from './climateService.js';
import { generateRecommendations } from './recommendationEngine.js';
import { analyzeForestLocation } from '../forestal/services/forestAnalysisService.js';
import { DataStatus, ConfidenceLevel } from '../utils/dataModel.js';

/**
 * Analiza una ubicación por coordenadas (Punto + Radio de Alcance).
 *
 * @param {Object} params
 * @param {number} params.lat - Latitud.
 * @param {number} params.lng - Longitud.
 * @param {number} [params.radiusKm=15] - Radio de alcance en kilómetros.
 * @param {Object|null} [params.customSoilSimulator=null] - Valores manuales del simulador.
 * @returns {Promise<Object>} Análisis territorial completo estructurado.
 */
export async function analyzeLocation({ lat, lng, radiusKm = 15, customSoilSimulator = null }) {
  try {
    const provinciaKey = await findProvinceByCoords(lat, lng);
    const provDetails = provinciaKey ? await getProvinceDetails(provinciaKey) : null;
    const provinciaNombre = provDetails ? provDetails.nombre || provinciaKey : "Argentina";

    const subregion = provinciaKey ? await findSubregion(provinciaKey, lat, lng) : null;

    const soilData = await getSoilReport(lat, lng, subregion?.suelo, customSoilSimulator);
    const climateData = await getClimateData(lat, lng, provinciaNombre, subregion?.clima);

    const cultivosProvincia = provDetails?.nombre?.cultivos || provDetails?.cultivos || [
      'soja', 'maiz', 'trigo', 'pino taeda', 'eucalyptus grandis'
    ];

    const cropRecommendations = await generateRecommendations(cultivosProvincia, soilData, climateData);
    const forestRecommendations = await analyzeForestLocation({
      geometry: { type: 'Point', coordinates: [lng, lat] },
      soil: soilData,
      climate: climateData,
      lat,
      lng
    });

    return {
      success: true,
      query: { lat, lng, radiusKm },
      territory: {
        provinceKey: provinciaKey,
        provinceName: provinciaNombre,
        subregion: subregion?.nombre || null,
        geography: subregion?.geografia || null
      },
      soil: soilData,
      climate: climateData,
      recommendations: {
        crops: cropRecommendations,
        forest: forestRecommendations
      },
      quality: {
        status: soilData.status === DataStatus.REAL && climateData.status === DataStatus.REAL ? DataStatus.REAL : DataStatus.REGIONAL,
        confidence: soilData.confidence === ConfidenceLevel.HIGH ? ConfidenceLevel.HIGH : ConfidenceLevel.MEDIUM,
        sources: [soilData.fuente, climateData.fuenteClimaVivo, climateData.fuenteAlertas].filter(Boolean)
      },
      analyzedAt: new Date().toISOString()
    };
  } catch (err) {
    console.error('[coreAnalysis] Error al analizar ubicación:', err);
    return {
      success: false,
      error: err.message,
      query: { lat, lng, radiusKm },
      status: DataStatus.UNAVAILABLE,
      confidence: ConfidenceLevel.NONE
    };
  }
}

/**
 * Alias de compatibilidad para consultar suelo.
 */
export async function getSoilData(lat, lng) {
  return await getSoilReport(lat, lng);
}

/**
 * Alias de compatibilidad para consultar territorio.
 */
export async function getTerritoryData(provincia, lat, lng) {
  const key = await findProvinceByCoords(lat, lng);
  const subregion = await findSubregion(key, lat, lng);
  const details = await getProvinceDetails(key);
  return { key, details, subregion };
}
