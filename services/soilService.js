/**
 * Servicio de Suelos Integrado
 * Obtiene la información de suelo desde INTA (remoto o base local) y procesa las simulaciones de lote.
 */

import { fetchINTASoilData } from './sources/intaService.js';

/**
 * Obtiene el reporte de suelo consolidado para una ubicación, aplicando simulaciones de lote si existen.
 * @param {number} lat - Latitud.
 * @param {number} lng - Longitud.
 * @param {Object} subregionStaticSuelo - Datos de suelo estáticos de la subregión (de regiones.json).
 * @param {Object|null} simuladorCustomValues - Valores personalizados ingresados por el usuario para simular el lote {ph, textura, drenaje, limitantes}.
 * @returns {Promise<Object>} Reporte de suelo consolidado.
 */
export async function getSoilReport(lat, lng, subregionStaticSuelo = null, simuladorCustomValues = null) {
  // 1. Obtener la información base desde INTA (con caché y fallback)
  const baseSoil = await fetchINTASoilData(lat, lng, subregionStaticSuelo);

  // 2. Si el usuario está simulando valores, sobrescribir los datos base
  let esSimulado = false;
  const reporteFinal = {
    tipo: baseSoil.tipo || 'NO DISPONIBLE',
    textura: baseSoil.textura || 'NO DISPONIBLE',
    drenaje: baseSoil.drenaje || 'NO DISPONIBLE',
    limitantes: baseSoil.limitantes || 'Sin datos de limitantes a esta escala',
    aptitud: baseSoil.aptitud || 'NO DISPONIBLE',
    ph: baseSoil.ph || null,
    escala: baseSoil.escala || '1:500.000 / Modelo Regional',
    status: baseSoil.status || 'REGIONAL',
    spatialScope: 'REGIONAL',
    resolution: '250m - 1km (Cartografía Digital INTA / ISRIC SoilGrids)',
    depth: '0 - 30 cm (Capa arable)',
    disclaimer: 'Dato edáfico regional/modelado espacial. No representa un muestreo físico puntual ni un análisis de laboratorio de lote.',
    confidence: baseSoil.confidence || 'medium',
    fuente: baseSoil.fuente || 'INTA Cartografía Digital de Suelos / Base Regional',
    esSimulado
  };

  if (simuladorCustomValues) {
    if (simuladorCustomValues.ph !== undefined && simuladorCustomValues.ph !== null) {
      reporteFinal.ph = parseFloat(simuladorCustomValues.ph);
      esSimulado = true;
    }
    if (simuladorCustomValues.textura) {
      reporteFinal.textura = simuladorCustomValues.textura;
      esSimulado = true;
    }
    if (simuladorCustomValues.drenaje) {
      reporteFinal.drenaje = simuladorCustomValues.drenaje;
      esSimulado = true;
    }
    if (simuladorCustomValues.limitantes) {
      reporteFinal.limitantes = simuladorCustomValues.limitantes;
      esSimulado = true;
    }

    if (esSimulado) {
      reporteFinal.fuente = `${baseSoil.fuente} + Simulación de Lote Manual (DEMO)`;
      reporteFinal.status = 'simulated';
      reporteFinal.esSimulado = true;
    }
  }

  return reporteFinal;
}
