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
  const hasObsA = Boolean(analysisA && (analysisA.available !== false || analysisA.productId));
  const hasObsB = Boolean(analysisB && (analysisB.available !== false || analysisB.productId));

  if (!hasObsA || !hasObsB) {
    return {
      success: false,
      status: 'UNAVAILABLE',
      primaryMessage: 'NO DISPONIBLE CON LOS DATOS DISPONIBLES',
      description: 'Se requieren observaciones satelitales Sentinel-2 válidas en ambas fechas para ejecutar el cálculo de variación espectral y detección de cambios.',
      deltaNDVI: 'NO DISPONIBLE',
      breakdown: {
        decrease: { percent: 'N/D', hectares: 'N/D' },
        stable: { percent: 'N/D', hectares: 'N/D' },
        increase: { percent: 'N/D', hectares: 'N/D' }
      },
      limitations: [
        'Se requieren imágenes satelitales multiespectrales procesadas para ambas fechas comparadas.',
        'No se generan porcentajes ni superficies simuladas cuando falta evidencia directa de matriz de píxeles.'
      ]
    };
  }

  const dateA = analysisA.acquisitionDate || analysisA.date || analysisA.targetDate || 'Fecha A';
  const dateB = analysisB.acquisitionDate || analysisB.date || analysisB.targetDate || 'Fecha B';
  const productA = analysisA.productId || 'Escena A';
  const productB = analysisB.productId || 'Escena B';

  const areaInfo = calculateArea(geometry);
  const totalAreaHa = areaInfo.hectares || 0;

  // Si ambas observaciones cuentan con estadísticas cuantitativas de NDVI
  if (typeof analysisA.stats?.mean === 'number' && typeof analysisB.stats?.mean === 'number') {
    const meanA = analysisA.stats.mean;
    const meanB = analysisB.stats.mean;
    const deltaNDVI = Math.round((meanB - meanA) * 100) / 100;

    let diffs = [];
    const crsA = analysisA.stats?.crs;
    const crsB = analysisB.stats?.crs;
    const trA = analysisA.stats?.transform;
    const trB = analysisB.stats?.transform;

    const gridMatches = (!crsA || !crsB || crsA === crsB) &&
                        (!trA || !trB || JSON.stringify(trA) === JSON.stringify(trB));

    if (gridMatches && Array.isArray(analysisA.stats?.ndviMatrix) && Array.isArray(analysisB.stats?.ndviMatrix)) {
      const flatA = analysisA.stats.ndviMatrix.flat(Infinity);
      const flatB = analysisB.stats.ndviMatrix.flat(Infinity);
      if (flatA.length === flatB.length) {
        for (let i = 0; i < flatA.length; i++) {
          const vA = flatA[i];
          const vB = flatB[i];
          if (vA !== null && vA !== undefined && !isNaN(vA) && vB !== null && vB !== undefined && !isNaN(vB)) {
            diffs.push(vB - vA);
          }
        }
      }
    } else if (gridMatches) {
      const samplesA = analysisA.gridSample || [];
      const samplesB = analysisB.gridSample || [];
      const minLen = Math.min(samplesA.length, samplesB.length);
      for (let i = 0; i < minLen; i++) {
        const vA = samplesA[i];
        const vB = samplesB[i];
        if (vA !== null && vA !== undefined && !isNaN(vA) && vB !== null && vB !== undefined && !isNaN(vB)) {
          diffs.push(vB - vA);
        }
      }
    }

    let classification = 'ESTABLE';
    let primaryMessage = 'Sin cambios significativos en el índice de vegetación.';
    let detailedDescription = `La respuesta espectral se mantiene estable entre ambas fechas (${dateA} y ${dateB}) dentro de los márgenes normales de estacionalidad.`;

    if (deltaNDVI <= -0.15) {
      classification = 'DISMINUCION_SIGNIFICATIVA';
      primaryMessage = 'Disminución significativa del índice de vegetación detectada.';
      detailedDescription = 'Se observa una reducción del vigor vegetativo. Puede deberse a cosecha, raleo o fenología. Se requiere verificación de campo.';
    } else if (deltaNDVI >= 0.15) {
      classification = 'AUMENTO_SIGNIFICATIVO';
      primaryMessage = 'Aumento significativo del índice de vegetación detectado.';
      detailedDescription = 'Se observa un incremento sustancial en la respuesta del infrarrojo cercano, compatible con crecimiento foliar o regeneración.';
    }

    if (diffs.length > 0) {
      let decreasePoints = 0;
      let stablePoints = 0;
      let increasePoints = 0;

      for (const diff of diffs) {
        if (diff <= -0.15) decreasePoints++;
        else if (diff >= 0.15) increasePoints++;
        else stablePoints++;
      }

      const totalPoints = diffs.length;
      const decreasePct = Math.round((decreasePoints / totalPoints) * 100);
      const stablePct = Math.round((stablePoints / totalPoints) * 100);
      const increasePct = Math.round((increasePoints / totalPoints) * 100);

      const decreaseHa = Math.round(((decreasePct / 100) * totalAreaHa) * 10) / 10;
      const increaseHa = Math.round(((increasePct / 100) * totalAreaHa) * 10) / 10;
      const stableHa = Math.round((totalAreaHa - decreaseHa - increaseHa) * 10) / 10;

      if (decreasePct > 30) {
        classification = 'DISMINUCION_SIGNIFICATIVA';
        primaryMessage = 'Disminución significativa del índice de vegetación detectada.';
        detailedDescription = 'Se observa una reducción del vigor vegetativo en sectores del lote. Se requiere verificación de campo.';
      } else if (increasePct > 30) {
        classification = 'AUMENTO_SIGNIFICATIVO';
        primaryMessage = 'Aumento significativo del índice de vegetación detectado.';
        detailedDescription = 'Se observa un incremento sustancial en la respuesta del infrarrojo cercano en sectores del lote.';
      }

      return {
        success: true,
        status: 'REAL',
        spatialComparisonAvailable: true,
        period: { dateA, dateB, productA, productB },
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
        confidence: 'Población real de muestras de píxeles',
        limitations: [
          'Factores atmosféricos y ángulo solar influyen en la reflectancia.',
          'Requiere validación agronómica o forestal de terreno.'
        ]
      };
    } else {
      return {
        success: true,
        status: 'REAL',
        spatialComparisonAvailable: false,
        period: { dateA, dateB, productA, productB },
        deltaNDVI: deltaNDVI,
        ndviA: meanA,
        ndviB: meanB,
        totalAreaHa: totalAreaHa,
        classification: classification,
        primaryMessage: primaryMessage,
        description: `${detailedDescription} (Comparación espacial píxel a píxel no disponible).`,
        breakdown: {
          decrease: { percent: 'N/D', hectares: 'N/D (Comparación espacial no disponible)' },
          stable: { percent: 'N/D', hectares: 'N/D (Comparación espacial no disponible)' },
          increase: { percent: 'N/D', hectares: 'N/D (Comparación espacial no disponible)' }
        },
        confidence: 'Variación entre medias espectrales generales del lote',
        limitations: [
          'Comparación espacial por píxeles no disponible debido a falta de matrices de píxeles alineadas.',
          'Se reporta la variación de la media espectral del lote.'
        ]
      };
    }
  }

  // Si no disponemos de matriz ráster calculada de ambas fechas (stats.mean ausente), reportar status SCENE_IDENTIFIED sin desgloses sintéticos
  let classification = 'PENDIENTE_PROCESAMIENTO_RASTER';
  let primaryMessage = 'Escenas satelitales identificadas en catálogo STAC. Extracción de píxeles ráster pendiente.';
  let detailedDescription = `Se identificaron escenas Sentinel-2 en catálogo STAC para ${dateA} (${productA}) y ${dateB} (${productB}). La cuantificación espacial por categoría de cambio (aumento, estabilidad, disminución) requiere la descarga de bandas multiespectrales B04 y B08 y el procesamiento espacial por píxel en el servidor backend.`;

  return {
    success: true,
    status: 'SCENE_IDENTIFIED',
    period: { dateA, dateB, productA, productB },
    deltaNDVI: 'Pendiente de extracción de píxeles ráster',
    totalAreaHa: totalAreaHa,
    classification: classification,
    primaryMessage: primaryMessage,
    description: detailedDescription,
    breakdown: {
      decrease: { percent: 'Pendiente', hectares: 'Pendiente' },
      stable: { percent: 'Pendiente', hectares: 'Pendiente' },
      increase: { percent: 'Pendiente', hectares: 'Pendiente' }
    },
    confidence: 'Metadatos y enlaces a bandas B04 y B08 recuperados desde catálogo STAC',
    limitations: [
      'La cuantificación espacial por categoría de cambio requiere la descarga y procesamiento espacial por píxel en el servidor backend.'
    ]
  };
}
