/**
 * changeDetectionService.js - Detección preliminar de cambios de cobertura/vegetación
 * Compara NDVI Fecha A vs NDVI Fecha B: deltaNDVI = NDVI_B - NDVI_A
 * Funciona exclusivamente con observaciones comparables reales.
 */

import { calculateArea } from '../utils/geo.js';

/**
 * Detecta cambios temporales entre dos análisis NDVI (Fecha A y Fecha B)
 */
export function detectChanges(analysisA, analysisB, geometry) {
  if (!analysisA || !analysisB || analysisA.available === false || analysisB.available === false || typeof analysisA.stats?.mean !== 'number' || typeof analysisB.stats?.mean !== 'number') {
    return {
      success: false,
      status: 'UNAVAILABLE',
      primaryMessage: 'NO DISPONIBLE CON LOS DATOS DISPONIBLES',
      description: 'Se requieren observaciones ráster satelitales reales e imágenes comparables en ambas fechas para ejecutar el cálculo de variación espectral (deltaNDVI) y detección de cambios.',
      deltaNDVI: 'NO DISPONIBLE',
      breakdown: {
        decrease: { percent: 'N/D', hectares: 'N/D' },
        stable: { percent: 'N/D', hectares: 'N/D' },
        increase: { percent: 'N/D', hectares: 'N/D' }
      },
      limitations: [
        'Se requieren imágenes satelitales multiespectrales procesadas para ambas fechas comparadas.',
        'No se generan porcentajes ni superficies simuladas cuando falta evidencia directa.'
      ]
    };
  }

  const dateA = analysisA.date;
  const dateB = analysisB.date;
  const meanA = analysisA.stats.mean;
  const meanB = analysisB.stats.mean;

  const deltaNDVI = Math.round((meanB - meanA) * 100) / 100;
  const areaInfo = calculateArea(geometry);
  const totalAreaHa = areaInfo.hectares || 0;

  // Comparar muestras punto a punto para calcular la superficie por categoría si existen samples
  const samplesA = analysisA.gridSample || [];
  const samplesB = analysisB.gridSample || [];
  const minLen = Math.min(samplesA.length, samplesB.length);

  let decreasePoints = 0;
  let stablePoints = 0;
  let increasePoints = 0;

  for (let i = 0; i < minLen; i++) {
    const diff = samplesB[i] - samplesA[i];
    if (diff <= -0.15) decreasePoints++;
    else if (diff >= 0.15) increasePoints++;
    else stablePoints++;
  }

  const totalPoints = minLen || 1;
  const decreasePct = Math.round((decreasePoints / totalPoints) * 100);
  const stablePct = Math.round((stablePoints / totalPoints) * 100);
  const increasePct = Math.round((increasePoints / totalPoints) * 100);

  const decreaseHa = Math.round(((decreasePct / 100) * totalAreaHa) * 10) / 10;
  const increaseHa = Math.round(((increasePct / 100) * totalAreaHa) * 10) / 10;
  const stableHa = Math.round((totalAreaHa - decreaseHa - increaseHa) * 10) / 10;

  let classification = 'ESTABLE';
  let primaryMessage = 'Sin cambios significativos en el índice de vegetación.';
  let detailedDescription = 'La respuesta espectral se mantiene estable entre ambas fechas dentro de los márgenes normales de estacionalidad.';

  if (deltaNDVI <= -0.15 || decreasePct > 30) {
    classification = 'DISMINUCION_SIGNIFICATIVA';
    primaryMessage = 'Disminución significativa del índice de vegetación detectada.';
    detailedDescription = 'Se observa una reducción del vigor vegetativo. Puede deberse a cosecha, raleo o fenología. Se requiere verificación de campo.';
  } else if (deltaNDVI >= 0.15 || increasePct > 30) {
    classification = 'AUMENTO_SIGNIFICATIVO';
    primaryMessage = 'Aumento significativo del índice de vegetación detectado.';
    detailedDescription = 'Se observa un incremento sustancial en la respuesta del infrarrojo cercano, compatible con crecimiento foliar o regeneración.';
  }

  return {
    success: true,
    status: 'REAL',
    period: {
      dateA: dateA,
      dateB: dateB,
      productA: analysisA.productId,
      productB: analysisB.productId
    },
    deltaNDVI: deltaNDVI,
    ndviA: meanA,
    ndviB: meanB,
    totalAreaHa: totalAreaHa,
    classification: classification,
    primaryMessage: primaryMessage,
    description: detailedDescription,
    breakdown: {
      decrease: { percent: decreasePct, hectares: decreaseHa },
      stable: { percent: stablePct, hectares: stableHa },
      increase: { percent: increasePct, hectares: increaseHa }
    },
    confidence: 'Población real de muestras',
    limitations: [
      'Factores atmosféricos y ángulo solar influyen en la reflectancia.',
      'Requiere validación agronómica o forestal de terreno.'
    ]
  };
}
