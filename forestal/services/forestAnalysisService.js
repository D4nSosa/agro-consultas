/**
 * forestAnalysisService.js - Servicio orquestador del Análisis Forestal
 * Conecta satélites, NDVI, detección de cambios y el recommendationEngine existente.
 * Basado exclusivamente en evidencia y datos reales.
 */

import { searchSentinelImagesByTargetDate } from './satelliteService.js';
import { analyzeVegetation } from './vegetationService.js';
import { detectChanges } from './changeDetectionService.js';
import { calculateCentroid, calculateArea } from '../utils/geo.js';
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
    timeline: timeline
  };
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
