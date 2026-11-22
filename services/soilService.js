/**
 * Servicio de Suelos Integrado.
 * Mantiene separados los datos cartográficos INTA de mediciones reales del lote.
 */

import { fetchINTASoilData } from './sources/intaService.js';

let sagypEstimaciones = null;

export async function loadSagypEstimaciones() {
  if (!sagypEstimaciones) {
    try {
      const res = await fetch('/data/estimaciones_agricolas.json');
      if (res.ok) sagypEstimaciones = await res.json();
    } catch (e) {
      console.warn("No se pudo cargar estimaciones_agricolas.json", e);
    }
  }
  return sagypEstimaciones;
}

export async function getSagypStatsByProvince(provinciaNombre, cultivoNombre) {
  const data = await loadSagypEstimaciones();
  if (!data || !data.provincias) return null;

  const provKey = (provinciaNombre || '').toLowerCase().trim();
  const cropKey = (cultivoNombre || '').toLowerCase().trim();
  const provData = data.provincias[provKey];
  if (!provData) return null;
  const cropStats = provData[cropKey];
  if (!cropStats) return null;

  return {
    fuenteOficial: data.fuenteOficial,
    datasetOficial: data.datasetOficial,
    campanaReferencia: data.campanaReferencia,
    fechaActualizacion: data.fechaActualizacion,
    estatusFuente: cropStats.estatusFuente || 'OFICIAL_VERIFICADO',
    fuenteEspecifica: cropStats.fuente || data.fuenteOficial,
    url: cropStats.url || data.datasetUrl,
    notaMetodologica: cropStats.nota || null,
    stats: cropStats
  };
}

/**
 * Obtiene cartografía edáfica para una ubicación.
 * Los perfiles estáticos regionales no se asignan como mediciones del lote.
 */
export async function getSoilReport(lat, lng, _subregionStaticSuelo = null) {
  const baseSoil = await fetchINTASoilData(lat, lng, null);

  return {
    tipo: baseSoil.tipo || 'NO DISPONIBLE',
    textura: baseSoil.textura || 'NO DISPONIBLE',
    drenaje: baseSoil.drenaje || 'NO DISPONIBLE',
    limitantes: baseSoil.limitantes || 'NO INFORMADO',
    aptitud: baseSoil.aptitud || 'NO DISPONIBLE',
    ph: baseSoil.ph ?? 'NO DISPONIBLE',
    ph_0_30: baseSoil.ph_0_30 ?? null,
    ph_30_100: baseSoil.ph_30_100 ?? null,
    ph_0_30_quality: baseSoil.ph_0_30_quality ?? null,
    ph_30_100_quality: baseSoil.ph_30_100_quality ?? null,
    phProfundidad: baseSoil.phProfundidad || '0-30 cm',
    salinidad: baseSoil.salinidad ?? 'NO DISPONIBLE',
    salinidad_0_30_raw: baseSoil.salinidad_0_30_raw ?? null,
    salinidad_30_100_raw: baseSoil.salinidad_30_100_raw ?? null,
    salinityClassInterpretation: baseSoil.salinityClassInterpretation || 'NOT_INTERPRETED',
    escala: baseSoil.escala || 'NO INFORMADA',
    resolution: baseSoil.resolution || null,
    status: baseSoil.status || 'UNAVAILABLE',
    confidence: baseSoil.confidence || 'none',
    evidenceType: baseSoil.evidenceType || 'UNAVAILABLE',
    fuente: baseSoil.fuente || 'Fuente no disponible; no se asigna un perfil regional al lote',
    sourceUrl: baseSoil.sourceUrl || null,
    dataset: baseSoil.dataset || null,
    products: baseSoil.products || {},
    sampleMethod: baseSoil.sampleMethod || null,
    limitations: baseSoil.limitations || [],
    fechaActualizacion: baseSoil.fechaActualizacion || null,
    fechaConsulta: baseSoil.fechaConsulta || null,
    retrievedAt: baseSoil.retrievedAt || null,
    cached: baseSoil.cached || false
  };
}
