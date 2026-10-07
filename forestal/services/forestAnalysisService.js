/**
 * forestAnalysisService.js - Servicio orquestador del Análisis Forestal
 * Conecta satélites, NDVI, detección de cambios y el recommendationEngine existente.
 * Basado exclusivamente en evidencia y datos reales.
 */

import { searchSentinelImagesByTargetDate } from './satelliteService.js';
import { analyzeVegetation } from './vegetationService.js';
import { detectChanges } from './changeDetectionService.js';
import { calculateCentroid, calculateArea } from '../utils/geo.js';
import { findProvinceByCoords, getProvinceDetails } from '../../services/territoryService.js';
import { getSoilReport } from '../../services/soilService.js';
import { getClimateData } from '../../services/climateService.js';
import { generateRecommendations, getForestCatalog } from '../../services/recommendationEngine.js';

/**
 * Ejecuta un análisis forestal integral para un lote GeoJSON
 */
export async function runFullForestAnalysis(geometry, dateA, dateB, cloudMax = 30, windowDays = 45) {
  const centroid = calculateCentroid(geometry);
  const areaInfo = calculateArea(geometry);

  // 1. Buscar imágenes satelitales Sentinel-2 en catálogo STAC usando ventana temporal alrededor de fecha objetivo
  const searchPromiseA = Promise.race([
    searchSentinelImagesByTargetDate(geometry, dateA, windowDays, cloudMax),
    new Promise(res => setTimeout(() => res({ bestProduct: null, products: [], productsCount: 0, targetDate: dateA, windowDays }), 6000))
  ]);
  const searchPromiseB = Promise.race([
    searchSentinelImagesByTargetDate(geometry, dateB, windowDays, cloudMax),
    new Promise(res => setTimeout(() => res({ bestProduct: null, products: [], productsCount: 0, targetDate: dateB, windowDays }), 6000))
  ]);

  const [searchResA, searchResB] = await Promise.all([searchPromiseA, searchPromiseB]);

  const prodA = searchResA.bestProduct;
  const prodB = searchResB.bestProduct;

  // 2. Calcular NDVI para ambas fechas
  const [vegA, vegB] = await Promise.all([
    analyzeVegetation(geometry, prodA),
    analyzeVegetation(geometry, prodB)
  ]);

  // 3. Detectar cambios entre observaciones reales
  const changes = detectChanges(vegA, vegB, geometry);

  // 4. Construir dataset de línea temporal compuesto exclusivamente por datos reales
  const timeline = buildRealForestTimeline([searchResA, searchResB]);

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
    const provinciaKey = await findProvinceByCoords(centroid.lat, centroid.lng);

    if (!provinciaKey) {
      return {
        recommendations: [],
        limitations: ['PROVINCIA NO DETERMINABLE — Coordenadas fuera de jurisdicción provincial reconocida.'],
        explanation: [`Ubicación lat: ${centroid.lat.toFixed(4)}, lng: ${centroid.lng.toFixed(4)}: No se pudo determinar provincia de referencia.`]
      };
    }

    const provDetails = await getProvinceDetails(provinciaKey);
    const nombreProvincia = provDetails ? (provDetails.nombre?.cultivos ? provinciaKey : provDetails.nombre || provinciaKey) : provinciaKey;

    const soilReport = soil || await getSoilReport(centroid.lat, centroid.lng);
    const climateReport = climate || await getClimateData(centroid.lat, centroid.lng, nombreProvincia);

    // Cargar catálogo de especies estrictamente forestales
    let especiesForestales = [];
    try {
      const forestCatalog = await getForestCatalog();
      especiesForestales = Object.values(forestCatalog).map(item => item.nombre || item.id).filter(Boolean);
    } catch (e) {
      return {
        recommendations: [],
        limitations: ['CATÁLOGO NO DISPONIBLE — Error al cargar los perfiles forestales.'],
        explanation: ['No se pudo evaluar aptitud porque el catálogo técnico no está accesible.']
      };
    }

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
 * Construye la línea temporal utilizando únicamente productos satelitales reales recuperados.
 */
function buildRealForestTimeline(searchResults) {
  const items = [];
  const addedIds = new Set();

  for (const res of searchResults) {
    if (res && res.products) {
      for (const prod of res.products) {
        if (prod && prod.id && !addedIds.has(prod.id)) {
          addedIds.add(prod.id);
          items.push({
            date: prod.date,
            product: prod.id,
            cloudCover: prod.cloudCover,
            source: prod.source,
            status: 'REAL'
          });
        }
      }
    }
  }

  return items;
}

function getYearStartDate(dateStr) {
  if (!dateStr) return '2025-01-01';
  const parts = dateStr.split('-');
  return `${parts[0]}-01-01`;
}
