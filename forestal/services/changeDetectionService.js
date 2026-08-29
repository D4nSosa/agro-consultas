/**
 * changeDetectionService.js - Detección preliminar de cambios de cobertura/vegetación
 * Compara NDVI Fecha A vs NDVI Fecha B: deltaNDVI = NDVI_B - NDVI_A
 */

import { calculateArea } from '../utils/geo.js';

/**
 * Detecta cambios temporales entre dos análisis NDVI (Fecha A y Fecha B)
 */
export function detectChanges(analysisA, analysisB, geometry) {
  if (!analysisA || !analysisB) {
    return {
      success: false,
      error: 'Se requieren análisis NDVI para ambas fechas (A y B).'
    };
  }

  const dateA = analysisA.date;
  const dateB = analysisB.date;
  const meanA = analysisA.stats.mean;
  const meanB = analysisB.stats.mean;

  const deltaNDVI = Math.round((meanB - meanA) * 100) / 100;
  const areaInfo = calculateArea(geometry);
  const totalAreaHa = areaInfo.hectares || 10;

  // Comparar muestras punto a punto para calcular la superficie por categoría
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

  // Determinar diagnóstico general con lenguaje cauto y profesional
  let classification = 'ESTABLE';
  let primaryMessage = 'Sin cambios significativos en el índice de vegetación.';
  let detailedDescription = 'La cobertura foliar y la respuesta espectral se mantienen estables entre ambas fechas dentro de los márgenes normales de estacionalidad.';

  if (deltaNDVI <= -0.15 || decreasePct > 30) {
    classification = 'DISMINUCION_SIGNIFICATIVA';
    primaryMessage = 'Disminución significativa del índice de vegetación detectada.';
    detailedDescription = 'Se observa una reducción sustancial del vigor vegetativo (deltaNDVI negativo). Esto puede deberse a raleo, cosechas forestales, fenología estacional, estrés hídrico o intervenciones en la cubierta vegetal. Se recomienda verificación en campo.';
  } else if (deltaNDVI >= 0.15 || increasePct > 30) {
    classification = 'AUMENTO_SIGNIFICATIVO';
    primaryMessage = 'Aumento significativo del índice de vegetación detectado.';
    detailedDescription = 'Se observa un incremento sustancial en la respuesta del infrarrojo cercano (deltaNDVI positivo), compatible con crecimiento foliar, rebrote vegetal, densificación de copa o regeneración.';
  }

  return {
    success: true,
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
    confidence: 'Moderada (Resolución espacial Sentinel-2 10m)',
    limitations: [
      'La resolución de 10 metros puede promediar áreas pequeñas de vegetación heterogénea.',
      'Factores como nubosidad, sombras de montaña, ángulo solar o humedad del suelo influyen en la reflectancia.',
      'No debe interpretarse como certificación o diagnóstico definitivo sin inspección visual o terrestre.'
    ]
  };
}
