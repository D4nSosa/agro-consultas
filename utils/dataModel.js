/**
 * Modelo común de datos territoriales y agroambientales.
 * Los metadatos describen únicamente lo que la fuente o el proceso informa:
 * no se completan cobertura, resolución, fechas ni metodología por defecto.
 */

export const DataStatus = {
  REAL: 'REAL',
  ESTIMATED: 'ESTIMATED',
  REGIONAL: 'REGIONAL',
  CARTOGRAPHIC: 'CARTOGRAPHIC',
  CALCULATED: 'CALCULATED',
  UNAVAILABLE: 'UNAVAILABLE'
};

export const ConfidenceLevel = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  NONE: 'none'
};

export function createMetadata({
  source = "Desconocida",
  sourceUrl = null,
  dataset = null,
  api = null,
  variable = null,
  unit = null,
  spatialResolution = null,
  temporalResolution = null,
  acquisitionDate = null,
  updateDate = null,
  geographicCoverage = null,
  crs = null,
  license = null,
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
    acquisitionDate: acquisitionDate || null,
    updateDate: updateDate || null,
    geographicCoverage,
    crs,
    license,
    methodology,
    limitations
  };
}

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
  geographicCoverage = null,
  crs = null,
  license = null,
  methodology = null,
  limitations = null,
  date = null,
  retrievedAt = null,
  resolution = null,
  scale = null,
  status = DataStatus.UNAVAILABLE,
  confidence = ConfidenceLevel.NONE,
  message = null
} = {}) {
  const isAvailable = status !== DataStatus.UNAVAILABLE && value !== null && value !== undefined;
  const effectiveResolution = spatialResolution ?? resolution ?? null;
  const effectiveAcquisitionDate = acquisitionDate ?? date ?? null;
  const actualRetrievedAt = retrievedAt || new Date().toISOString();

  const metadata = createMetadata({
    source,
    sourceUrl,
    dataset,
    api,
    variable,
    unit,
    spatialResolution: effectiveResolution,
    temporalResolution,
    acquisitionDate: effectiveAcquisitionDate,
    updateDate,
    geographicCoverage,
    crs,
    license,
    methodology,
    limitations
  });

  return {
    available: isAvailable,
    value: isAvailable ? value : null,
    unit,
    source,
    sourceUrl,
    dataset,
    metadata,
    date: effectiveAcquisitionDate,
    retrievedAt: actualRetrievedAt,
    resolution: effectiveResolution,
    scale,
    methodology,
    status: isAvailable ? status : DataStatus.UNAVAILABLE,
    confidence: isAvailable ? confidence : ConfidenceLevel.NONE,
    message: message || (isAvailable ? null : "Datos no disponibles para esta ubicación")
  };
}

export function createUnavailableDataPoint(
  source,
  message = "La fuente no devolvió datos utilizables para esta consulta"
) {
  return createDataPoint({
    value: null,
    source,
    status: DataStatus.UNAVAILABLE,
    confidence: ConfidenceLevel.NONE,
    message
  });
}
