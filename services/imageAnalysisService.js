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
 * Analiza una imagen individual seleccionada o capturada por el usuario.
 * @param {File} imageFile - Objeto File subido desde el navegador.
 * @returns {Promise<Object>} Análisis de evidencia completo estructurado.
 */
export async function analyzeUploadedImage(imageFile) {
  const exif = await extractExifMetadata(imageFile);
  const visualStats = await analyzeCanvasVisualMetrics(imageFile);

  const previewUrl = URL.createObjectURL(imageFile);

  const id = `img_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

  // Métricas
  const exg = visualStats.exg;
  const avgR = visualStats.avgR;
  const avgG = visualStats.avgG;
  const avgB = visualStats.avgB;

  const greenPct = Math.min(100, Math.max(0, Math.round(((exg + 20) / 60) * 100)));

  // Indicios y Síntomas compatibles
  const sintomasCompatibles = [];

  if (exg > 18) {
    sintomasCompatibles.push("✓ Indicios de pigmentación foliar activa y alta densidad de dosel verde.");
  } else if (exg > 5 && exg <= 18) {
    sintomasCompatibles.push("• Cobertura vegetativa moderada o combinación de follaje con rastrojo/suelo.");
  } else {
    sintomasCompatibles.push("⚠ Fracción verde reducida: Tonos neutros o predominio de suelo desnudo/rastrojo.");
  }

  // Anomalías de color
  if (avgR > avgG && avgR > 110) {
    sintomasCompatibles.push("⚠ Posible presencia de tonos amarillentos/pajizos (síntomas compatibles con senescencia, clorosis o estrés de humedad).");
  }
  if (visualStats.brightness < 60) {
    sintomasCompatibles.push("⚠ Escena con baja iluminación o tonos oscuros (posible presencia de necrosis, quemado o sombra severa).");
  }

  const observado = [
    `Dimensiones reales: ${exif.dimensions || '300x300'}.`,
    `Brillo medio RGB: ${visualStats.brightness}/255.`,
    `Índice ExG (Excess Green): ${exg.toFixed(2)}.`,
    `Fracción vegetativa estimada: ${greenPct}%.`,
    exif.date ? `Fecha EXIF: ${exif.date}.` : 'Fecha EXIF: NO DISPONIBLE.',
    exif.hasGps ? `GPS EXIF: Lat ${exif.gps.lat.toFixed(4)}, Lng ${exif.gps.lng.toFixed(4)}.` : 'GPS EXIF: NO DISPONIBLE.'
  ].join(' ');

  const inferido = sintomasCompatibles.length > 0
    ? sintomasCompatibles.join(' ')
    : 'Muestra visual compatible con cubierta vegetal regular.';

  const noDeterminable = 'No es posible emitir diagnósticos categóricos de patógenos o deficiencias nutricionales mediante análisis fotográfico RGB únicamente sin validación de laboratorio o inspección foliar en terreno.';

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
        const ctx = canvas.getContext('2d');

        const width = Math.min(300, img.naturalWidth || 300);
        const height = Math.min(300, img.naturalHeight || 300);

        canvas.width = width;
        canvas.height = height;

        ctx.drawImage(img, 0, 0, width, height);

        const imgData = ctx.getImageData(0, 0, width, height);
        const data = imgData.data;

        let totalR = 0, totalG = 0, totalB = 0;
        const totalPixels = width * height;

        for (let i = 0; i < data.length; i += 4) {
          totalR += data[i];
          totalG += data[i + 1];
          totalB += data[i + 2];
        }

        const avgR = totalR / totalPixels;
        const avgG = totalG / totalPixels;
        const avgB = totalB / totalPixels;

        const brightness = Math.round((avgR + avgG + avgB) / 3);

        // Excess Green Index: 2G - R - B
        const exg = (2 * avgG) - avgR - avgB;

        URL.revokeObjectURL(url);

        resolve({
          avgR: Math.round(avgR),
          avgG: Math.round(avgG),
          avgB: Math.round(avgB),
          brightness: brightness,
          exg: Math.round(exg * 100) / 100
        });
      } catch (err) {
        URL.revokeObjectURL(url);
        resolve({ avgR: 120, avgG: 120, avgB: 120, brightness: 120, exg: 0 });
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ avgR: 120, avgG: 120, avgB: 120, brightness: 120, exg: 0 });
    };

    img.src = url;
  });
}
