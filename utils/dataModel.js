/**
 * Modelo Unificado de Datos Geoespaciales y Ambientales para Agro Consultas
 * Define la estructura estándar para representar cualquier dato territorial de forma trazable y transparente.
 */

export const DATA_STATUS = {
  REAL: 'real',
  ESTIMATED: 'estimated',
  REGIONAL: 'regional',
  SIMULATED: 'simulated',
  UNAVAILABLE: 'unavailable'
};

export const CONFIDENCE_LEVELS = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  NONE: 'none'
};

/**
 * Crea una respuesta estandarizada para una variable de dato territorial.
 *
 * @param {Object} params - Parámetros de la variable.
 * @param {boolean} params.available - Indica si el dato está disponible.
 * @param {any} [params.value=null] - Valor numérico, textual o de objeto.
 * @param {string} [params.unit=""] - Unidad de medida (ej. "°C", "mm", "cm", "m3/ha").
 * @param {string} [params.source="Servicio Desconocido"] - Nombre de la fuente o proveedor oficial.
 * @param {string} [params.sourceUrl=""] - Enlace URL o nodo de la fuente oficial.
 * @param {string} [params.dataset=""] - Nombre del conjunto de datos o capa específica.
 * @param {string} [params.date=""] - Fecha de medición u observación (YYYY-MM-DD o ISO).
 * @param {string} [params.retrievedAt=""] - Fecha y hora exacta de consulta (ISO).
 * @param {string} [params.resolution=""] - Resolución espacial o escala del dato (ej. "10m", "1:50.000").
 * @param {string} [params.methodology=""] - Método utilizado para obtener o derivar el dato.
 * @param {string} [params.status=DATA_STATUS.UNAVAILABLE] - Estado del dato (real, estimated, regional, simulated, unavailable).
 * @param {string} [params.confidence=CONFIDENCE_LEVELS.NONE] - Nivel de confianza del dato (high, medium, low, none).
 * @param {string} [params.message=""] - Descripción adicional o motivo en caso de indisponibilidad.
 * @returns {Object} Objeto de dato territorial normalizado.
 */
export function createDataValue({
  available = true,
  value = null,
  unit = "",
  source = "Desconocido",
  sourceUrl = "",
  dataset = "",
  date = "",
  retrievedAt = new Date().toISOString(),
  resolution = "",
  methodology = "",
  status = DATA_STATUS.UNAVAILABLE,
  confidence = CONFIDENCE_LEVELS.NONE,
  message = ""
} = {}) {
  if (!available || value === null || value === undefined) {
    return {
      available: false,
      value: null,
      unit,
      source,
      sourceUrl,
      dataset,
      date,
      retrievedAt,
      resolution,
      methodology,
      status: DATA_STATUS.UNAVAILABLE,
      confidence: CONFIDENCE_LEVELS.NONE,
      message: message || "Datos no disponibles para esta ubicación"
    };
  }

  return {
    available: true,
    value,
    unit,
    source,
    sourceUrl,
    dataset,
    date,
    retrievedAt,
    resolution,
    methodology,
    status,
    confidence,
    message
  };
}
