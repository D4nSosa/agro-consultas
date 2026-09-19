/**
 * vegetationService.js - Cálculo de vegetación e índice NDVI
 * Implementa la fórmula oficial: NDVI = (NIR - RED) / (NIR + RED)
 */

import { calculateNDVIValue, computeMatrixStats, getNDVIColor } from '../utils/raster.js';

/**
 * Calcula el análisis de NDVI completo para un lote y producto satelital
 */
export async function analyzeVegetation(geometry, productInfo) {
  if (!productInfo || !productInfo.id || !productInfo.bands) {
    return {
      available: false,
      status: 'UNAVAILABLE',
      indicator: 'NDVI (Normalized Difference Vegetation Index)',
      formula: 'NDVI = (B08_NIR - B04_RED) / (B08_NIR + B04_RED)',
      reason: 'NDVI no disponible: se requieren bandas espectrales B04 (Red) y B08 (NIR) reales provenientes de un producto Sentinel-2 válido.'
    };
  }

  // Si existen bandas o muestras calculadas desde un ráster real
  if (productInfo.gridSample && Array.isArray(productInfo.gridSample) && productInfo.gridSample.length > 0) {
    const stats = computeMatrixStats(productInfo.gridSample);
    return {
      available: true,
      status: 'REAL',
      indicator: 'NDVI (Normalized Difference Vegetation Index)',
      formula: 'NDVI = (B08_NIR - B04_RED) / (B08_NIR + B04_RED)',
      bandsUsed: {
        red: 'B04 (Red, 665 nm)',
        nir: 'B08 (Near Infrared, 842 nm)'
      },
      date: productInfo.date,
      productId: productInfo.id,
      stats: stats,
      interpretation: getVegetationInterpretation(stats.mean),
      gridSample: productInfo.gridSample
    };
  }

  return {
    available: false,
    status: 'UNAVAILABLE',
    indicator: 'NDVI (Normalized Difference Vegetation Index)',
    formula: 'NDVI = (B08_NIR - B04_RED) / (B08_NIR + B04_RED)',
    date: productInfo.date,
    productId: productInfo.id,
    reason: 'NDVI no disponible: el producto Sentinel-2 recuperado no incluye píxeles procesados de bandas B04/B08 para esta área.'
  };
}

/**
 * Retorna la interpretación en lenguaje profesional y prudente sin afirmar tala categórica
 */
function getVegetationInterpretation(meanNDVI) {
  if (meanNDVI >= 0.70) {
    return 'Excelente vigor vegetativo y alta densidad de cobertura foliar. Compatible con masa forestal madura o dosel cerrado.';
  } else if (meanNDVI >= 0.50) {
    return 'Vigor vegetativo saludable y cobertura moderada a alta. Típico de plantaciones jóvenes en crecimiento o bosques abiertos.';
  } else if (meanNDVI >= 0.30) {
    return 'Cobertura vegetativa baja o en fase inicial de establecimiento. Presencia de suelo expuesto o rastrojo.';
  } else {
    return 'Índice de vegetación bajo/limitado. Suelo desnudo, escasa cobertura vegetativa o alteración del suelo.';
  }
}
