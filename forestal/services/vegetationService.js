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

  // Si tenemos metadatos de producto satelital real pero no credenciales S3 para procesar el ráster .jp2 en cliente
  return {
    available: false,
    indicator: 'NDVI (Normalized Difference Vegetation Index)',
    formula: 'NDVI = (B08_NIR - B04_RED) / (B08_NIR + B04_RED)',
    bandsUsed: {
      red: 'B04 (Red, 665 nm)',
      nir: 'B08 (Near Infrared, 842 nm)'
    },
    date: productInfo.date || 'NO DISPONIBLE',
    productId: productInfo.id,
    stats: {
      mean: 'NO DISPONIBLE',
      min: 'NO DISPONIBLE',
      max: 'NO DISPONIBLE',
      median: 'NO DISPONIBLE'
    },
    interpretation: `Escena Sentinel-2 identificada (${productInfo.id}). El cálculo de matriz de píxeles ráster requiere token de autenticación Copernicus CDSE S3 para procesamiento de bandas B04/B08.`,
    gridSample: [],
    message: 'NO DISPONIBLE (Requiere credenciales Copernicus CDSE S3 para descarga y cálculo ráster)'
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
