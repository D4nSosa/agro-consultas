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

  // 1. Si productInfo ya trae estadísticas ráster previamente procesadas en el backend
  if (productInfo.stats && typeof productInfo.stats.mean === 'number') {
    return {
      available: true,
      state: 'NDVI_CALCULADO_RASTER',
      indicator: 'NDVI (Normalized Difference Vegetation Index)',
      formula: 'NDVI = (B08_NIR - B04_RED) / (B08_NIR + B04_RED)',
      bandsUsed: { red: 'B04 (Red, 665 nm)', nir: 'B08 (Near Infrared, 842 nm)' },
      targetDate: productInfo.targetDate || productInfo.date,
      acquisitionDate: productInfo.date,
      cloudCover: typeof productInfo.cloudCover === 'number' ? `${productInfo.cloudCover}%` : (productInfo.cloudCover || 'N/D'),
      productId: productInfo.id,
      source: productInfo.source || 'AWS Earth Search (Sentinel-2 L2A COGs)',
      assets: productInfo.assets || {},
      stats: productInfo.stats,
      interpretation: `RÁSTER PROCESADO - NDVI calculado en ROI a partir de píxeles COG reales. Media: ${productInfo.stats.mean}`,
      gridSample: [],
      message: 'NDVI por píxel calculado con éxito'
    };
  }

  // 2. Si no trae estadísticas, realizar la consulta directa al endpoint serverless /api/forest/ndvi
  try {
    const response = await fetch('/api/forest/ndvi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        geometry: geometry.geometry || geometry,
        date: productInfo.date,
        productId: productInfo.id
      })
    });

    if (response.ok) {
      const data = await response.json();
      if (data.status === 'REAL' && data.stats) {
        return {
          available: true,
          state: 'NDVI_CALCULADO_RASTER',
          indicator: 'NDVI (Normalized Difference Vegetation Index)',
          formula: 'NDVI = (B08_NIR - B04_RED) / (B08_NIR + B04_RED)',
          bandsUsed: { red: 'B04 (Red, 665 nm)', nir: 'B08 (Near Infrared, 842 nm)' },
          targetDate: data.date || productInfo.date,
          acquisitionDate: data.date || productInfo.date,
          cloudCover: data.cloudCover || `${productInfo.cloudCover}%`,
          productId: data.productId || productInfo.id,
          source: data.source || productInfo.source || 'AWS Earth Search (Sentinel-2 L2A COGs)',
          assets: productInfo.assets || {},
          stats: data.stats,
          interpretation: getVegetationInterpretation(data.stats.mean),
          gridSample: [],
          message: 'NDVI por píxel recortado en ROI calculado con éxito'
        };
      }
    }
  } catch (err) {
    console.warn('[vegetationService] Falló la llamada a /api/forest/ndvi:', err);
  }

  const hasCloudMetadata = typeof productInfo.cloudCover === 'number';
  const cloudText = hasCloudMetadata ? `${productInfo.cloudCover}%` : 'NO DISPONIBLE';

  const assets = productInfo.assets || {};
  const bandRedUrl = assets.b04 || assets.B04 || null;
  const bandNirUrl = assets.b08 || assets.B08 || assets.nir || null;

  return {
    available: false,
    state: 'SCENE_IDENTIFIED',
    indicator: 'NDVI (Normalized Difference Vegetation Index)',
    formula: 'NDVI = (B08_NIR - B04_RED) / (B08_NIR + B04_RED)',
    bandsUsed: {
      red: 'B04 (Red, 665 nm - 10m)',
      nir: 'B08 (Near Infrared, 842 nm - 10m)',
      b04_url: bandRedUrl,
      b08_url: bandNirUrl
    },
    targetDate: productInfo.targetDate || productInfo.date,
    acquisitionDate: productInfo.date,
    date: productInfo.date,
    cloudCover: cloudText,
    productId: productInfo.id,
    source: productInfo.source || 'AWS Earth Search (Sentinel-2 L2A COGs)',
    assets: assets,
    stats: null,
    interpretation: `ESCENA IDENTIFICADA EN CATÁLOGO STAC (${productInfo.id}, fecha: ${productInfo.date}). Cobertura de nubes: ${cloudText}. Metadatos y enlaces a bandas B04 (Red) y B08 (NIR) recuperados. La descarga y cálculo de la matriz de píxeles por ROI permanece pendiente de procesamiento en el servidor backend.`,
    gridSample: [],
    message: 'Escena identificada en catálogo STAC con enlaces a bandas B04 y B08. Descarga y extracción de la matriz de píxeles pendiente de procesamiento en servidor.'
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
    return 'NDVI alto: respuesta espectral compatible con cobertura vegetal relativamente densa. No permite determinar por sí solo especie, edad, biomasa ni estado sanitario.';
  } else if (meanNDVI >= 0.50) {
    return 'NDVI moderado-alto: respuesta espectral de vegetación. Interpretar junto con fecha, estacionalidad, nubosidad y uso/cobertura del suelo.';
  } else if (meanNDVI >= 0.30) {
    return 'NDVI intermedio: puede corresponder a cobertura parcial, vegetación menos vigorosa o mezcla de vegetación y suelo. Requiere contexto local.';
  } else {
    return 'NDVI bajo: puede asociarse a suelo expuesto, agua, vegetación escasa o estrés; el índice aislado no permite distinguir estas causas.';
  }
}
