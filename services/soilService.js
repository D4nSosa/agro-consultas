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
    tipo: baseSoil.tipo,
    textura: baseSoil.textura,
    drenaje: baseSoil.drenaje,
    limitantes: baseSoil.limitantes,
    aptitud: baseSoil.aptitud,
    ph: baseSoil.ph,
    escala: baseSoil.escala,
    fuente: baseSoil.fuente,
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
      reporteFinal.fuente = `${baseSoil.fuente} + Simulación de Lote Manual`;
      reporteFinal.esSimulado = true;
    }
  }

  return reporteFinal;
}
