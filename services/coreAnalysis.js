/**
 * Núcleo de análisis territorial por ubicación.
 * Los candidatos se limitan al catálogo de la provincia identificada; no se
 * amplían silenciosamente al catálogo nacional cuando falta cobertura territorial.
 */
import { findProvinceByCoords, findSubregion, getProvinceDetails } from './territoryService.js';
import { getSoilReport } from './soilService.js';
import { getClimateData } from './climateService.js';
import { generateRecommendations, getCropsToEvaluate, getForestToEvaluate } from './recommendationEngine.js';
import { DataStatus, ConfidenceLevel } from '../utils/dataModel.js';

const upper = value => String(value || '').toUpperCase();

export function summarizeEvidenceQuality(soilData = {}, climateData = {}) {
  const soilStatus = upper(soilData.status);
  const climateStatus = upper(climateData.climatologyStatus || climateData.status);
  const hasNumericPh = typeof soilData.ph === 'number' && Number.isFinite(soilData.ph);
  const hasDescriptiveSoilValue = ['textura', 'drenaje', 'limitantes', 'aptitud'].some(key =>
    typeof soilData[key] === 'string' &&
    soilData[key].trim() !== '' &&
    !/no disponible|no informado|no especificad/i.test(soilData[key])
  );
  // A product label such as "Cartografía modelada de pH" is provenance,
  // not evidence that a usable soil variable was returned.
  const soilAvailable = soilStatus !== DataStatus.UNAVAILABLE &&
    (hasNumericPh || hasDescriptiveSoilValue);
  const climateAvailable = climateStatus !== DataStatus.UNAVAILABLE &&
    (climateData.temperaturaMediaVal !== null && climateData.temperaturaMediaVal !== undefined ||
      climateData.precipitacionesAnualesVal !== null && climateData.precipitacionesAnualesVal !== undefined);
  const liveWeatherAvailable = Boolean(climateData.liveWeatherPoint?.available);
  const anyEvidence = soilAvailable || climateAvailable || liveWeatherAvailable;
  const pointSoilEvidence = soilStatus === DataStatus.REAL &&
    !['CARTOGRAPHIC', 'REGIONAL_PROFILE'].includes(upper(soilData.evidenceType));
  const completeComparableEvidence = pointSoilEvidence &&
    climateStatus === DataStatus.REAL && soilAvailable && climateAvailable;

  let status = DataStatus.UNAVAILABLE;
  if (anyEvidence) {
    if (soilStatus === DataStatus.REGIONAL || climateStatus === DataStatus.REGIONAL) {
      status = DataStatus.REGIONAL;
    } else if (completeComparableEvidence) {
      status = DataStatus.REAL;
    } else {
      status = DataStatus.ESTIMATED;
    }
  }

  let confidence = ConfidenceLevel.NONE;
  if (completeComparableEvidence) confidence = ConfidenceLevel.HIGH;
  else if (soilAvailable && climateAvailable) confidence = ConfidenceLevel.MEDIUM;
  else if (anyEvidence) confidence = ConfidenceLevel.LOW;

  return {
    status,
    confidence,
    components: {
      soil: { status: soilStatus || DataStatus.UNAVAILABLE, evidenceType: soilData.evidenceType || 'UNSPECIFIED', available: soilAvailable },
      climateReference: { status: climateStatus || DataStatus.UNAVAILABLE, available: climateAvailable },
      currentWeather: { available: liveWeatherAvailable }
    },
    recommendationEligibility: completeComparableEvidence,
    sources: [soilData.fuente, climateData.fuenteClimaVivo, climateData.fuenteAlertas].filter(Boolean)
  };
}

/**
 * Analiza una ubicación por coordenadas. Las recomendaciones son candidatas
 * provinciales, no aptitud del lote; la clasificación final depende de evidencia
 * comparable y suficiente en el motor agronómico.
 */
export async function analyzeLocation({ lat, lng, radiusKm = 15 }) {
  const query = { lat, lng, radiusKm };
  try {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new Error('Coordenadas inválidas. Se espera latitud [-90, 90] y longitud [-180, 180].');
    }

    const provinciaKey = await findProvinceByCoords(lat, lng);
    const provDetails = provinciaKey ? await getProvinceDetails(provinciaKey) : null;
    const provinciaNombre = provDetails ? provDetails.nombre || provinciaKey : 'Argentina';
    const subregion = provinciaKey ? await findSubregion(provinciaKey, lat, lng) : null;

    const [soilData, climateData] = await Promise.all([
      getSoilReport(lat, lng),
      getClimateData(lat, lng, provinciaNombre, subregion?.clima || null)
    ]);

    const [cropNames, forestNames] = await Promise.all([
      getCropsToEvaluate(provinciaKey, subregion),
      getForestToEvaluate(provinciaKey)
    ]);

    const [cropRecommendations, forestRecommendations] = await Promise.all([
      generateRecommendations(cropNames, soilData, climateData),
      generateRecommendations(forestNames, soilData, climateData)
    ]);

    return {
      success: true,
      query,
      territory: {
        provinceKey: provinciaKey,
        provinceName: provinciaNombre,
        subregion: subregion?.nombre || null,
        geography: subregion?.geografia || null,
        candidateScope: provinciaKey ? 'PROVINCIAL_CATALOG' : 'UNRESOLVED',
        candidateScopeMessage: provinciaKey
          ? 'La lista identifica cultivos y especies declarados para la provincia; no representa aptitud del lote.'
          : 'No se identificó una provincia argentina; no se generaron candidatos nacionales genéricos.'
      },
      soil: soilData,
      climate: climateData,
      recommendations: {
        crops: cropRecommendations,
        forest: forestRecommendations
      },
      quality: summarizeEvidenceQuality(soilData, climateData),
      analyzedAt: new Date().toISOString()
    };
  } catch (err) {
    console.error('[coreAnalysis] Error al analizar ubicación:', err);
    return {
      success: false,
      error: err.message,
      query,
      status: DataStatus.UNAVAILABLE,
      confidence: ConfidenceLevel.NONE
    };
  }
}

export async function getSoilData(lat, lng) {
  return await getSoilReport(lat, lng);
}

export async function getTerritoryData(provincia, lat, lng) {
  const key = await findProvinceByCoords(lat, lng);
  const subregion = await findSubregion(key, lat, lng);
  const details = await getProvinceDetails(key);
  return { key, details, subregion };
}
