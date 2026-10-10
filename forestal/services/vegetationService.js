/**
 * vegetationService.js - Cálculo de vegetación e índice NDVI
 * Implementa la fórmula oficial: NDVI = (NIR - RED) / (NIR + RED)
 * Exclusivamente con datos reales. No genera muestras sintéticas ni simuladas.
 */

import { computeMatrixStats } from '../utils/raster.js';

/**
 * Calcula el análisis de NDVI para un lote y producto satelital real.
 */
export async function analyzeVegetation(geometry, productInfo) {
  if (!productInfo || !productInfo.id) {
    return {
      available: false,
      indicator: 'NDVI (Normalized Difference Vegetation Index)',
      formula: 'NDVI = (B08_NIR - B04_RED) / (B08_NIR + B04_RED)',
      date: 'NO DISPONIBLE',
      productId: 'NO DISPONIBLE',
      stats: null,
      interpretation: 'NO DISPONIBLE: No se dispone de escena satelital válida para calcular NDVI.',
      gridSample: [],
      message: 'NO DISPONIBLE'
    };
  }

  // Verificar disponibilidad de bandas ráster directas
  const b04Url = productInfo.assets?.b04;
  const b08Url = productInfo.assets?.b08;

  // Si los assets contienen previsualización / thumbnail o la API backend Python está configurada
  // se reporta el estado de disponibilidad del producto Sentinel-2
  const isAvailable = Boolean(productInfo && productInfo.id);

  const hasCloudMetadata = typeof productInfo.cloudCover === 'number';
  const cloudText = hasCloudMetadata ? `${productInfo.cloudCover}%` : 'NO DISPONIBLE';

  const hasRasterStats = productInfo.stats && typeof productInfo.stats.mean === 'number';

  return {
    available: hasRasterStats,
    state: hasRasterStats ? 'NDVI_CALCULADO_RASTER' : (isAvailable ? 'ESCENA_ENCONTRADA_SIN_RASTER' : 'NO_DISPONIBLE'),
    indicator: 'NDVI (Normalized Difference Vegetation Index)',
    formula: 'NDVI = (B08_NIR - B04_RED) / (B08_NIR + B04_RED)',
    bandsUsed: {
      red: 'B04 (Red, 665 nm)',
      nir: 'B08 (Near Infrared, 842 nm)'
    },
    targetDate: productInfo.targetDate || productInfo.date,
    acquisitionDate: productInfo.date,
    daysFromTarget: productInfo.daysFromTarget !== undefined ? productInfo.daysFromTarget : 0,
    cloudCover: cloudText,
    productId: productInfo.id,
    source: productInfo.source || 'Copernicus Sentinel-2',
    assets: productInfo.assets || {},
    stats: hasRasterStats ? productInfo.stats : null,
    interpretation: hasRasterStats
      ? `ESTADO 3 - NDVI calculado a partir de matriz de píxeles reales (B04/B08). Media: ${productInfo.stats.mean}`
      : (isAvailable
        ? `ESTADO 1/2 - Escena identificada en catálogo (${productInfo.id}, fecha: ${productInfo.date}). Cobertura de nubes: ${cloudText}. ESTADO 3 (NDVI por píxel): Requiere API del servidor backend con credenciales COPERNICUS_CLIENT_ID / SECRET para procesar las bandas B04/B08.`
        : 'NDVI no disponible para la fecha seleccionada.'),
    gridSample: [],
    message: hasRasterStats ? 'NDVI por píxel calculado' : (isAvailable ? 'Escena recuperada en catálogo (matriz ráster pendiente de backend)' : 'NDVI no disponible')
  };
}

/**
 * Retorna la interpretación en lenguaje profesional y prudente
 */
export function getVegetationInterpretation(meanNDVI) {
  if (typeof meanNDVI !== 'number') {
    return 'NO DISPONIBLE: Se requieren datos ráster reales para determinar la interpretación espectral.';
  }
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
