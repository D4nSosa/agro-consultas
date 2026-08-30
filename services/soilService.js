/**
 * Servicio de Suelos Integrado
 * Obtiene la información de suelo desde INTA (remoto o base local) y procesa las simulaciones de lote.
 */

import { fetchINTASoilData } from './sources/intaService.js';
import { createDataValue, DATA_STATUS, CONFIDENCE_LEVELS } from '../utils/dataModel.js';

/**
 * Obtiene el reporte de suelo consolidado para una ubicación, aplicando simulaciones de lote si existen.
 * Retorna datos estructurados acordes al Modelo Unificado de Datos.
 * @param {number} lat - Latitud.
 * @param {number} lng - Longitud.
 * @param {Object} subregionStaticSuelo - Datos de suelo estáticos de la subregión (de regiones.json).
 * @param {Object|null} simuladorCustomValues - Valores personalizados ingresados por el usuario para simular el lote {ph, textura, drenaje, limitantes}.
 * @returns {Promise<Object>} Reporte de suelo consolidado y metadatos trazables.
 */
export async function getSoilReport(lat, lng, subregionStaticSuelo = null, simuladorCustomValues = null) {
  const baseSoil = await fetchINTASoilData(lat, lng, subregionStaticSuelo);

  let status = baseSoil.isRegional ? DATA_STATUS.REGIONAL : (baseSoil.available === false ? DATA_STATUS.UNAVAILABLE : DATA_STATUS.REAL);
  let confidence = status === DATA_STATUS.REAL ? CONFIDENCE_LEVELS.HIGH : (status === DATA_STATUS.REGIONAL ? CONFIDENCE_LEVELS.MEDIUM : CONFIDENCE_LEVELS.NONE);
  let esSimulado = false;

  const reporteFinal = {
    available: baseSoil.available !== false,
    tipo: baseSoil.tipo,
    textura: baseSoil.textura,
    drenaje: baseSoil.drenaje,
    limitantes: baseSoil.limitantes,
    aptitud: baseSoil.aptitud,
    ph: baseSoil.ph,
    escala: baseSoil.escala || "1:250.000",
    fuente: baseSoil.fuente,
    status,
    confidence,
    esSimulado: false,
    metadatos: createDataValue({
      available: baseSoil.available !== false,
      value: baseSoil.ph,
      unit: "pH",
      source: baseSoil.fuente,
      sourceUrl: "https://geoserver.inta.gob.ar/geoserver/wms",
      dataset: "cartografia_nacional_suelos",
      status,
      confidence
    })
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
      reporteFinal.fuente = `${baseSoil.fuente} + Simulación Manual`;
      reporteFinal.status = DATA_STATUS.SIMULATED;
      reporteFinal.confidence = CONFIDENCE_LEVELS.MEDIUM;
      reporteFinal.esSimulado = true;
    }
  }

  return reporteFinal;
}
