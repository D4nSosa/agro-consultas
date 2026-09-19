/**
 * forestAnalysisService.js - Servicio orquestador del Análisis Forestal
 * Conecta satélites, NDVI, detección de cambios y el recommendationEngine existente.
 */

import { searchSentinelImages } from './satelliteService.js';
import { analyzeVegetation } from './vegetationService.js';
import { detectChanges } from './changeDetectionService.js';
import { calculateCentroid, calculateArea } from '../utils/geo.js';
import { findProvinceByCoords, getProvinceDetails } from '../../services/territoryService.js';
import { getSoilReport } from '../../services/soilService.js';
import { getClimateData } from '../../services/climateService.js';
import { generateRecommendations } from '../../services/recommendationEngine.js';

/**
 * Ejecuta un análisis forestal integral para un lote GeoJSON
 */
export async function runFullForestAnalysis(geometry, dateA, dateB, cloudMax = 30) {
  const centroid = calculateCentroid(geometry);
  const areaInfo = calculateArea(geometry);

  // 1. Buscar imágenes satelitales Sentinel-2 en catálogo STAC de Copernicus
  const [searchResA, searchResB] = await Promise.all([
    searchSentinelImages(geometry, getYearStartDate(dateA), dateA, cloudMax),
    searchSentinelImages(geometry, getYearStartDate(dateB), dateB, cloudMax)
  ]);

  const prodA = searchResA.bestProduct || null;
  const prodB = searchResB.bestProduct || null;

  // 2. Calcular NDVI para ambas fechas solo si existen productos reales
  const [vegA, vegB] = await Promise.all([
    prodA ? analyzeVegetation(geometry, prodA) : { available: false, status: 'UNAVAILABLE', reason: 'No hay producto satelital para la Fecha A.' },
    prodB ? analyzeVegetation(geometry, prodB) : { available: false, status: 'UNAVAILABLE', reason: 'No hay producto satelital para la Fecha B.' }
  ]);

  // 3. Detectar cambios preliminares (deltaNDVI) solo si ambas observaciones NDVI son reales
  const changes = detectChanges(vegA, vegB, geometry);

  // 4. Generar dataset de línea temporal basada exclusivamente en observaciones reales
  const timeline = buildRealForestTimeline(searchResA, searchResB, vegA, vegB);

  // 5. Integrar aptitud territorial de especies forestales mediante analyzeForestLocation
  const forestAptitude = await analyzeForestLocation({
    geometry: geometry,
    lat: centroid.lat,
    lng: centroid.lng
  });

  return {
    timestamp: new Date().toISOString(),
    lot: {
      geometry: geometry,
      centroid: centroid,
      area: areaInfo
    },
    dates: { dateA, dateB },
    products: { productA: prodA, productB: prodB },
    ndvi: { analysisA: vegA, analysisB: vegB },
    changes: changes,
    timeline: timeline,
    aptitude: forestAptitude
  };
}

/**
 * Interfaz oficial requerida por la arquitectura: analyzeForestLocation
 * Recibe geometry, soil, climate, terrain, vegetation -> Devuelve recomendaciones forestales desacopladas
 */
export async function analyzeForestLocation({ geometry, soil = null, climate = null, lat = null, lng = null }) {
  try {
    const centroid = lat && lng ? { lat, lng } : calculateCentroid(geometry);
    const provinciaKey = await findProvinceByCoords(centroid.lat, centroid.lng) || 'misiones';
    const provDetails = await getProvinceDetails(provinciaKey);
    const nombreProvincia = provDetails ? provDetails.nombre || provinciaKey : provinciaKey;

    const soilReport = soil || await getSoilReport(centroid.lat, centroid.lng);
    const climateReport = climate || await getClimateData(centroid.lat, centroid.lng, nombreProvincia);

    // Lista de especies forestales a evaluar
    const especiesForestales = [
      'Pino Taeda',
      'Pino Elliottii',
      'Eucalyptus Grandis',
      'Eucalyptus Globulus',
      'Forestacion',
      'Sauce',
      'Alamo'
    ];

    const recommendations = await generateRecommendations(especiesForestales, soilReport, climateReport);

    const limitations = [
      ...(soilReport.limitantes ? [soilReport.limitantes] : []),
      ...(climateReport.deficitHidrico ? [`Déficit hídrico: ${climateReport.deficitHidrico}`] : [])
    ];

    return {
      recommendations: recommendations,
      limitations: limitations,
      explanation: [
        `Evaluación calculada para lat: ${centroid.lat.toFixed(4)}, lng: ${centroid.lng.toFixed(4)}.`,
        `Suelo dominante: ${soilReport.tipo || "Fuente no disponible para esta zona."}`,
        `Clima regional: ${climateReport.precipitacionesAnuales || "Fuente no disponible para esta zona."}`
      ]
    };
  } catch (err) {
    console.error('[forestAnalysisService] Error en analyzeForestLocation:', err);
    return {
      recommendations: [],
      limitations: ['Fuente no disponible para esta zona.'],
      explanation: ['No se pudieron recuperar datos territoriales para la ubicación.']
    };
  }
}

/**
 * Construye la línea temporal exclusivamente con productos y observaciones NDVI reales
 */
function buildRealForestTimeline(searchResA, searchResB, vegA, vegB) {
  const items = [];

  if (searchResA?.success && searchResA.bestProduct && vegA?.available) {
    const prod = searchResA.bestProduct;
    items.push({
      year: parseInt(prod.date.substring(0, 4)),
      date: prod.date,
      product: prod.id,
      cloudCover: prod.cloudCover,
      ndviMean: vegA.stats?.mean || 'N/A',
      ndviMin: vegA.stats?.min || 'N/A',
      ndviMax: vegA.stats?.max || 'N/A'
    });
  }

  if (searchResB?.success && searchResB.bestProduct && vegB?.available) {
    const prod = searchResB.bestProduct;
    // Evitar duplicados si A y B corresponden al mismo producto
    if (!items.find(i => i.product === prod.id)) {
      items.push({
        year: parseInt(prod.date.substring(0, 4)),
        date: prod.date,
        product: prod.id,
        cloudCover: prod.cloudCover,
        ndviMean: vegB.stats?.mean || 'N/A',
        ndviMin: vegB.stats?.min || 'N/A',
        ndviMax: vegB.stats?.max || 'N/A'
      });
    }
  }

  return items;
}

function getYearStartDate(dateStr) {
  if (!dateStr) return '2025-01-01';
  const parts = dateStr.split('-');
  return `${parts[0]}-01-01`;
}
