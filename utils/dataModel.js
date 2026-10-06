/**
 * utils/dataModel.js — Modelo Unificado y Estándar de Datos Territoriales y Agroambientales
 * Define las estructuras normalizadas para cualquier dato o métrica espacial en Agro Consultas.
 * Garantiza cero datos ficticios y trazabilidad completa de metadatos.
 */

export const DataStatus = {
  REAL: 'REAL',
  ESTIMATED: 'ESTIMATED',
  REGIONAL: 'REGIONAL',
  CALCULATED: 'CALCULATED',
  UNAVAILABLE: 'UNAVAILABLE'
};

export const ConfidenceLevel = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  NONE: 'none'
};

/**
 * Crea una estructura de metadatos estandarizada para trazabilidad.
 */
export function createMetadata({
  source = "Desconocida",
  sourceUrl = null,
  dataset = null,
  api = null,
  variable = null,
  unit = null,
  spatialResolution = "N/D",
  temporalResolution = "N/D",
  acquisitionDate = null,
  updateDate = null,
  geographicCoverage = "Argentina",
  methodology = null,
  limitations = null
} = {}) {
  return {
    source,
    sourceUrl,
    dataset,
    api,
    variable,
    unit,
    spatialResolution,
    temporalResolution,
    acquisitionDate: acquisitionDate || new Date().toISOString().split('T')[0],
    updateDate: updateDate || new Date().toISOString().split('T')[0],
    geographicCoverage,
    methodology: methodology || "Consulta directa a servicio oficial o dataset de referencia.",
    limitations: limitations || "Sujeto a la resolución espacial y temporal de la fuente primaria."
  };
}

/**
 * Empaqueta un valor o conjunto de valores en la estructura estándar DataPoint.
 */
export function createDataPoint({
  value = null,
  unit = null,
  source = "Desconocida",
  sourceUrl = null,
  dataset = null,
  api = null,
  variable = null,
  spatialResolution = null,
  temporalResolution = null,
  acquisitionDate = null,
  updateDate = null,
  geographicCoverage = "Argentina",
  methodology = null,
  limitations = null,
  date = null,
  retrievedAt = null,
  resolution = null,
  scale = null,
  status = DataStatus.REAL,
  confidence = ConfidenceLevel.HIGH,
  message = null
}) {
  const isAvailable = status !== DataStatus.UNAVAILABLE && value !== null && value !== undefined;

  const metadata = createMetadata({
    source,
    sourceUrl,
    dataset,
    api,
    variable,
    unit,
    spatialResolution: spatialResolution || resolution || "15 km (Radio local)",
    temporalResolution: temporalResolution || "Serie histórica / Tiempo real",
    acquisitionDate: acquisitionDate || date || new Date().toISOString().split('T')[0],
    updateDate,
    geographicCoverage,
    methodology,
    limitations
  });

  return {
    available: isAvailable,
    value: isAvailable ? value : null,
    unit: unit,
    source: source,
    sourceUrl: sourceUrl,
    dataset: dataset,
    metadata: metadata,
    date: date || new Date().toISOString().split('T')[0],
    retrievedAt: retrievedAt || new Date().toISOString(),
    resolution: resolution || spatialResolution || "15 km",
    scale: scale,
    methodology: methodology,
    status: isAvailable ? status : DataStatus.UNAVAILABLE,
    confidence: isAvailable ? confidence : ConfidenceLevel.NONE,
    message: message || (isAvailable ? null : "Datos no disponibles para esta ubicación")
  };
}

/**
 * Retorna un DataPoint estándar para cuando una fuente no está disponible o no tiene cobertura.
 */
export function createUnavailableDataPoint(source, message = "Datos no disponibles para esta ubicación") {
  return createDataPoint({
    value: null,
    source: source,
    status: DataStatus.UNAVAILABLE,
    confidence: ConfidenceLevel.NONE,
    message: message,
    limitations: "La fuente consultada no posee cobertura o presentó error de servicio para las coordenadas indicadas."
  });
}
