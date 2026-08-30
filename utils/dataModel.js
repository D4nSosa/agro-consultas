/**
 * utils/dataModel.js — Modelo Unificado y Estándar de Datos Territoriales y Agroambientales
 * Define las estructuras normalizadas para cualquier dato o métrica espacial en Agro Consultas.
 */

export const DataStatus = {
  REAL: 'real',
  ESTIMATED: 'estimated',
  REGIONAL: 'regional',
  SIMULATED: 'simulated',
  UNAVAILABLE: 'unavailable'
};

export const ConfidenceLevel = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  NONE: 'none'
};

/**
 * Empaqueta un valor o conjunto de valores en la estructura estándar DataPoint.
 *
 * @param {Object} params
 * @param {any} params.value - Valor numérico, cualitativo u objeto.
 * @param {string|null} [params.unit=null] - Unidad de medida (ej. "mm", "°C", "pH", "%").
 * @param {string} [params.source="Agro Consultas Core"] - Nombre de la fuente oficial/adaptador.
 * @param {string|null} [params.sourceUrl=null] - URL de referencia del servicio o portal.
 * @param {string|null} [params.dataset=null] - Nombre del dataset o capa específica.
 * @param {string|null} [params.date=null] - Fecha de observación/medición del dato (YYYY-MM-DD).
 * @param {string|null} [params.retrievedAt=null] - Fecha/hora de recuperación (ISO String).
 * @param {string|null} [params.resolution=null] - Resolución espacial (ej. "10m", "1km").
 * @param {string|null} [params.scale=null] - Escala cartográfica (ej. "1:50.000").
 * @param {string|null} [params.methodology=null] - Descripción metodológica o fórmula.
 * @param {string} [params.status=DataStatus.REAL] - Estado del dato ('real'|'estimated'|'regional'|'simulated'|'unavailable').
 * @param {string} [params.confidence=ConfidenceLevel.HIGH] - Nivel de confianza ('high'|'medium'|'low'|'none').
 * @param {string|null} [params.message=null] - Mensaje informativo o causa de indisponibilidad.
 * @returns {Object} DataPoint normalizado.
 */
export function createDataPoint({
  value = null,
  unit = null,
  source = "Desconocida",
  sourceUrl = null,
  dataset = null,
  date = null,
  retrievedAt = null,
  resolution = null,
  scale = null,
  methodology = null,
  status = DataStatus.REAL,
  confidence = ConfidenceLevel.HIGH,
  message = null
}) {
  const isAvailable = status !== DataStatus.UNAVAILABLE && value !== null && value !== undefined;

  return {
    available: isAvailable,
    value: isAvailable ? value : null,
    unit: unit,
    source: source,
    sourceUrl: sourceUrl,
    dataset: dataset,
    date: date || new Date().toISOString().split('T')[0],
    retrievedAt: retrievedAt || new Date().toISOString(),
    resolution: resolution,
    scale: scale,
    methodology: methodology,
    status: isAvailable ? status : DataStatus.UNAVAILABLE,
    confidence: isAvailable ? confidence : ConfidenceLevel.NONE,
    message: message || (isAvailable ? null : "Datos no disponibles para esta ubicación")
  };
}

/**
 * Retorna un DataPoint estándar para cuando una fuente no está disponible o no tiene cobertura.
 *
 * @param {string} source - Nombre de la fuente intentada.
 * @param {string} [message="Datos no disponibles para esta ubicación"] - Mensaje explicativo.
 * @returns {Object} DataPoint con status 'unavailable'.
 */
export function createUnavailableDataPoint(source, message = "Datos no disponibles para esta ubicación") {
  return createDataPoint({
    value: null,
    source: source,
    status: DataStatus.UNAVAILABLE,
    confidence: ConfidenceLevel.NONE,
    message: message
  });
}
