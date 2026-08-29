/**
 * raster.js - Utilidades de procesamiento de imágenes y ráster para NDVI
 */

/**
 * Calcula el valor NDVI a partir de las bandas NIR (B08) y RED (B04)
 * Fórmula: NDVI = (NIR - RED) / (NIR + RED)
 */
export function calculateNDVIValue(nir, red) {
  if (nir === null || red === null || undefined === nir || undefined === red) return 0;
  const denominator = nir + red;
  if (denominator === 0) return 0;
  const ndvi = (nir - red) / denominator;
  return Math.max(-1, Math.min(1, ndvi));
}

/**
 * Retorna un color hexadecimal según el valor de NDVI (Paleta Estándar Teledetección)
 */
export function getNDVIColor(value) {
  if (value < 0) return '#2b83ba';      // Agua / Humedad alta / Nieve
  if (value < 0.1) return '#d7191c';    // Suelo desnudo / Inerte / Urbano
  if (value < 0.25) return '#fdae61';   // Vegetación muy escasa / Rastrojo
  if (value < 0.45) return '#ffffbf';   // Vegetación moderada / Pastizal seco
  if (value < 0.65) return '#a6d96a';   // Vegetación densa / Cultivo activo
  return '#1a9850';                     // Cobertura forestal muy densa / Vigor alto
}

/**
 * Calcula estadísticas avanzadas (mín, máx, promedio, mediano, distribución) de una matriz/array de valores NDVI
 */
export function computeMatrixStats(values) {
  if (!values || !values.length) {
    return { min: 0, max: 0, mean: 0, median: 0, distribution: [] };
  }

  const valid = values.filter(v => typeof v === 'number' && !isNaN(v) && v >= -1 && v <= 1);
  if (!valid.length) {
    return { min: 0, max: 0, mean: 0, median: 0, distribution: [] };
  }

  valid.sort((a, b) => a - b);

  const min = Math.round(valid[0] * 100) / 100;
  const max = Math.round(valid[valid.length - 1] * 100) / 100;
  const sum = valid.reduce((acc, v) => acc + v, 0);
  const mean = Math.round((sum / valid.length) * 100) / 100;

  const mid = Math.floor(valid.length / 2);
  const median = valid.length % 2 !== 0
    ? Math.round(valid[mid] * 100) / 100
    : Math.round(((valid[mid - 1] + valid[mid]) / 2) * 100) / 100;

  // Histogram bins (-0.2 a 1.0 en 6 rangos)
  const bins = [
    { label: '< 0.0 (Agua/Suelo)', count: 0, min: -1, max: 0 },
    { label: '0.0 - 0.2 (Escaso)', count: 0, min: 0, max: 0.2 },
    { label: '0.2 - 0.4 (Bajo)', count: 0, min: 0.2, max: 0.4 },
    { label: '0.4 - 0.6 (Medio)', count: 0, min: 0.4, max: 0.6 },
    { label: '0.6 - 0.8 (Alto)', count: 0, min: 0.6, max: 0.8 },
    { label: '> 0.8 (Muy Alto)', count: 0, min: 0.8, max: 1.0 }
  ];

  valid.forEach(v => {
    for (const b of bins) {
      if (v >= b.min && (v < b.max || (b.max === 1.0 && v <= 1.0))) {
        b.count++;
        break;
      }
    }
  });

  return { min, max, mean, median, distribution: bins };
}
