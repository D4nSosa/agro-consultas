/**
 * Servicio de Suelos Integrado
 * Obtiene la información de suelo desde INTA (remoto o cartografía regional).
 */

import { fetchINTASoilData } from './sources/intaService.js';

/**
 * Obtiene el reporte de suelo consolidado para una ubicación.
 * @param {number} lat - Latitud.
 * @param {number} lng - Longitud.
 * @param {Object} subregionStaticSuelo - Datos de suelo estáticos de la subregión (de regiones.json).
 * @returns {Promise<Object>} Reporte de suelo consolidado.
 */
export async function getSoilReport(lat, lng, subregionStaticSuelo = null) {
  // Obtener la información base desde INTA / Cartografía Regional
  const baseSoil = await fetchINTASoilData(lat, lng, subregionStaticSuelo);

  return {
    tipo: baseSoil.tipo || 'NO DISPONIBLE',
    textura: baseSoil.textura || 'NO DISPONIBLE',
    drenaje: baseSoil.drenaje || 'NO DISPONIBLE',
    limitantes: baseSoil.limitantes || 'Ninguna registrada',
    aptitud: baseSoil.aptitud || 'NO DISPONIBLE',
    ph: baseSoil.ph !== undefined && baseSoil.ph !== null ? baseSoil.ph : 'NO DISPONIBLE',
    escala: baseSoil.escala || '1:500.000',
    status: baseSoil.status || 'regional',
    confidence: baseSoil.confidence || 'medium',
    fuente: baseSoil.fuente || 'INTA / Cartografía Edáfica Regional'
  };
}
