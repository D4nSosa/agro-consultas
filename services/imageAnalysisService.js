/**
 * imageAnalysisService.js — Servicio de Análisis Técnico de Imágenes Aportadas por el Usuario
 * Soporta carga múltiple, extracción EXIF real y métricas visuales Canvas API.
 * Identifica indicios visuales (estrés, clorosis, necrosis, suelo expuesto) con estricto lenguaje prudente.
 */

import { extractExifMetadata } from '../utils/exifExtractor.js';

let uploadedImagesBatch = [];

/**
 * Analiza un conjunto de múltiples imágenes subidas por el usuario.
 * @param {Array<File>} imageFiles - Lista de archivos subidos.
 * @returns {Promise<Array<Object>>} Lista de análisis estructurados.
 */
export async function analyzeUploadedImages(imageFiles) {
  const fileArray = Array.from(imageFiles).slice(0, 10); // Máximo 10 imágenes por lote
  const results = [];

  for (const file of fileArray) {
    const singleAnalysis = await analyzeUploadedImage(file);
    results.push(singleAnalysis);
  }

  uploadedImagesBatch = [...uploadedImagesBatch, ...results];
  return results;
}

/**
 * Elimina una imagen del lote por ID o índice.
 */
export function removeImageFromBatch(index) {
  if (index >= 0 && index < uploadedImagesBatch.length) {
    const removed = uploadedImagesBatch.splice(index, 1)[0];
    if (removed && removed.previewUrl) {
      URL.revokeObjectURL(removed.previewUrl);
    }
  }
  return uploadedImagesBatch;
}

/**
 * Obtiene el lote actual de imágenes procesadas.
 */
export function getCurrentBatch() {
  return uploadedImagesBatch;
}

/**
 * Limpia todo el lote de imágenes.
 */
export function clearBatch() {
  uploadedImagesBatch.forEach(img => {
    if (img && img.previewUrl) URL.revokeObjectURL(img.previewUrl);
  });
  uploadedImagesBatch = [];
  return uploadedImagesBatch;
}

/**
 * Intenta reconstruir un polígono GeoJSON de Lote a partir del conjunto de fotos con GPS EXIF
 * @returns {Object|null} Objeto de Lote GeoJSON o null si hay menos de 3 puntos
 */
export function buildPolygonFromBatchGps() {
  const pointsWithGps = uploadedImagesBatch.filter(img => img.exif && img.exif.hasGps && img.exif.gps);

  if (pointsWithGps.length < 3) {
    return {
      success: false,
      message: `Se requieren al menos 3 imágenes con GPS EXIF para reconstruir el perímetro del lote (se encontraron ${pointsWithGps.length}).`,
      pointsCount: pointsWithGps.length,
      points: pointsWithGps.map(p => ({ lat: p.exif.gps.lat, lng: p.exif.gps.lng, name: p.filename, previewUrl: p.previewUrl }))
    };
  }

  // Extraer puntos [lng, lat]
  const coordinates = pointsWithGps.map(p => [p.exif.gps.lng, p.exif.gps.lat]);

  // Cerrar polígono conectando el último punto con el primero
  const closedCoordinates = [...coordinates, coordinates[0]];

  const geoJsonPolygon = {
    type: "Feature",
    properties: {
      name: `Lote Reconstruido por Fotografía (${pointsWithGps.length} puntos GPS)`,
      source: "EXIF GPS Cameras / Smartphone Batch",
      createdAt: new Date().toISOString()
    },
    geometry: {
      type: "Polygon",
      coordinates: [closedCoordinates]
    }
  };

  return {
    success: true,
    feature: geoJsonPolygon,
    pointsCount: pointsWithGps.length,
    points: pointsWithGps.map(p => ({ lat: p.exif.gps.lat, lng: p.exif.gps.lng, name: p.filename, previewUrl: p.previewUrl }))
  };
}

/**
 * Analiza una imagen individual seleccionada o capturada por el usuario.
 * @param {File} imageFile - Objeto File subido desde el navegador.
 * @returns {Promise<Object>} Análisis de evidencia completo estructurado.
 */
export async function analyzeUploadedImage(imageFile) {
  const exif = await extractExifMetadata(imageFile);
  const visualStats = await analyzeCanvasVisualMetrics(imageFile);

  const previewUrl = URL.createObjectURL(imageFile);

  const id = `img_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

  if (!visualStats) {
    return {
      id: id,
      filename: imageFile.name,
      fileSize: exif.fileSize,
      dimensions: exif.dimensions,
      previewUrl: previewUrl,
      exif: exif,
      visualMetrics: null,
      visualAnalysis: {
        observado: 'NO DISPONIBLE (Fallo al procesar matriz de píxeles Canvas en navegador).',
        inferido: 'NO DISPONIBLE',
        sintomasList: [],
        noDeterminable: 'No fue posible realizar el análisis visual preliminar de píxeles.'
      },
      analyzedAt: new Date().toISOString()
    };
  }

  // Métricas RGB: describen color de la fotografía, no reflectancia multiespectral.
  const greenPct = visualStats.greenDominancePercent;
  const sintomasCompatibles = [];

  if (greenPct >= 40) {
    sintomasCompatibles.push(`La muestra presenta dominancia de tonos verdes en ${greenPct}% de los píxeles analizados.`);
  } else if (greenPct >= 15) {
    sintomasCompatibles.push(`La muestra presenta una señal RGB verde intermedia (${greenPct}% de píxeles con dominancia verde).`);
  } else {
    sintomasCompatibles.push(`La muestra presenta baja dominancia RGB verde (${greenPct}%); puede reflejar suelo, rastrojo, sombra, material seco o vegetación poco visible.`);
  }

  const observado = [
    `Dimensiones: ${exif.dimensions || 'NO DISPONIBLE'}.`,
    `Brillo RGB medio: ${visualStats.brightness}/255.`,
    `ExG medio: ${visualStats.exg.toFixed(3)}.`,
    `VARI medio: ${visualStats.vari == null ? 'NO DISPONIBLE' : visualStats.vari.toFixed(3)}.`,
    `GLI medio: ${visualStats.gli == null ? 'NO DISPONIBLE' : visualStats.gli.toFixed(3)}.`,
    `Píxeles con dominancia verde: ${greenPct}%.`,
    exif.date && exif.date !== 'Fecha EXIF: NO DISPONIBLE' ? `Fecha EXIF: ${exif.date}.` : 'Fecha EXIF: NO DISPONIBLE.',
    exif.hasGps ? `GPS EXIF: Lat ${exif.gps.lat.toFixed(4)}, Lng ${exif.gps.lng.toFixed(4)}.` : 'GPS EXIF: NO DISPONIBLE.'
  ].join(' ');

  const inferido = sintomasCompatibles.join(' ');
  const noDeterminable = 'Los índices RGB son descriptores de color de una fotografía. No equivalen a NDVI/NDRE, no miden clorofila, biomasa, humedad ni rendimiento y no permiten diagnosticar plagas, enfermedades o deficiencias nutricionales.';


  return {
    id: id,
    filename: imageFile.name,
    fileSize: exif.fileSize,
    dimensions: exif.dimensions,
    previewUrl: previewUrl,
    exif: exif,
    visualMetrics: visualStats,
    visualAnalysis: {
      observado: observado,
      inferido: inferido,
      sintomasList: sintomasCompatibles,
      noDeterminable: noDeterminable
    },
    analysisScope: 'RGB_PHOTO_ONLY',
    analyzedAt: new Date().toISOString()
  };
}

/**
 * Procesa los píxeles de la imagen en un Canvas HTML5 para calcular métricas de color y brillo.
 */
function analyzeCanvasVisualMetrics(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('Canvas 2D no disponible');

        const scale = Math.min(1, 600 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
        const width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
        const height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        const data = ctx.getImageData(0, 0, width, height).data;
        let totalR = 0, totalG = 0, totalB = 0;
        let exgSum = 0, variSum = 0, variCount = 0, gliSum = 0, gliCount = 0;
        let greenDominantCount = 0;
        let sampleCount = 0;

        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 16) continue;
          const r = data[i], g = data[i + 1], b = data[i + 2];
          totalR += r; totalG += g; totalB += b;
          exgSum += (2 * g) - r - b;
          const variDenominator = g + r - b;
          if (Math.abs(variDenominator) > 1e-6) {
            variSum += (g - r) / variDenominator;
            variCount++;
          }
          const gliDenominator = (2 * g) + r + b;
          if (gliDenominator > 1e-6) {
            gliSum += ((2 * g) - r - b) / gliDenominator;
            gliCount++;
          }
          if (g > r * 1.08 && g > b * 1.08 && g > 40) greenDominantCount++;
          sampleCount++;
        }

        URL.revokeObjectURL(url);
        if (!sampleCount) return resolve(null);
        const avgR = totalR / sampleCount;
        const avgG = totalG / sampleCount;
        const avgB = totalB / sampleCount;

        resolve({
          avgR: Math.round(avgR * 100) / 100,
          avgG: Math.round(avgG * 100) / 100,
          avgB: Math.round(avgB * 100) / 100,
          brightness: Math.round((avgR + avgG + avgB) / 3),
          exg: Math.round((exgSum / sampleCount) * 1000) / 1000,
          vari: variCount ? Math.round((variSum / variCount) * 1000) / 1000 : null,
          gli: gliCount ? Math.round((gliSum / gliCount) * 1000) / 1000 : null,
          greenDominancePercent: Math.round((greenDominantCount * 100 / sampleCount) * 10) / 10,
          sampleCount
        });
      } catch (err) {
        URL.revokeObjectURL(url);
        resolve(null);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}
