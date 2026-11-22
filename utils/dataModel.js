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
  sensor = null,
  product = null,
  api = null,
  variable = null,
  unit = null,
  spatialResolution = null,
  resolution = null,
  temporalResolution = null,
  acquisitionDate = null,
  acquiredAt = null,
  updateDate = null,
  publishedAt = null,
  geometry = null,
  coverage = null,
  geographicCoverage = null,
  crs = null,
  license = null,
  methodology = null,
  quality = null,
  status = null,
  limitations = null,
  retrievedAt = null
} = {}) {
  const effectiveResolution = spatialResolution ?? resolution ?? null;
  const effectiveAcquiredAt = acquisitionDate ?? acquiredAt ?? null;
  const effectivePublishedAt = updateDate ?? publishedAt ?? null;
  const effectiveCoverage = coverage ?? geographicCoverage ?? null;

  return {
    source,
    sourceUrl,
    dataset,
    sensor,
    product,
    api,
    variable,
    unit,
    spatialResolution: effectiveResolution,
    resolution: effectiveResolution,
    temporalResolution,
    acquisitionDate: effectiveAcquiredAt,
    acquiredAt: effectiveAcquiredAt,
    updateDate: effectivePublishedAt,
    publishedAt: effectivePublishedAt,
    geometry,
    coverage: effectiveCoverage,
    geographicCoverage: effectiveCoverage,
    crs,
    license,
    methodology,
    quality,
    status,
    limitations,
    retrievedAt
  };
}

export function createDataPoint({
  value = null,
  unit = null,
  source = "Desconocida",
  sourceUrl = null,
  dataset = null,
  sensor = null,
  product = null,
  api = null,
  variable = null,
  spatialResolution = null,
  resolution = null,
  temporalResolution = null,
  acquisitionDate = null,
  acquiredAt = null,
  updateDate = null,
  publishedAt = null,
  geometry = null,
  coverage = null,
  geographicCoverage = null,
  crs = null,
  license = null,
  methodology = null,
  quality = null,
  limitations = null,
  date = null,
  retrievedAt = null,
  scale = null,
  status = DataStatus.UNAVAILABLE,
  confidence = ConfidenceLevel.NONE,
  message = null
} = {}) {
  const isAvailable = status !== DataStatus.UNAVAILABLE && value !== null && value !== undefined;
  const effectiveResolution = spatialResolution ?? resolution ?? null;
  const effectiveAcquiredAt = acquisitionDate ?? acquiredAt ?? date ?? null;
  const effectivePublishedAt = updateDate ?? publishedAt ?? null;
  const effectiveCoverage = coverage ?? geographicCoverage ?? null;
  const actualRetrievedAt = retrievedAt || new Date().toISOString();

  const metadata = createMetadata({
    source,
    sourceUrl,
    dataset,
    sensor,
    product,
    api,
    variable,
    unit,
    spatialResolution: effectiveResolution,
    temporalResolution,
    acquiredAt: effectiveAcquiredAt,
    publishedAt: effectivePublishedAt,
    geometry,
    coverage: effectiveCoverage,
    crs,
    license,
    methodology,
    quality,
    status: isAvailable ? status : DataStatus.UNAVAILABLE,
    limitations,
    retrievedAt: actualRetrievedAt
  });

  return {
    available: isAvailable,
    value: isAvailable ? value : null,
    unit,
    source,
    sourceUrl,
    dataset,
    sensor,
    product,
    api,
    variable,
    metadata,
    geometry,
    coverage: effectiveCoverage,
    geographicCoverage: effectiveCoverage,
    crs,
    license,
    date: effectiveAcquiredAt,
    acquisitionDate: effectiveAcquiredAt,
    acquiredAt: effectiveAcquiredAt,
    updateDate: effectivePublishedAt,
    publishedAt: effectivePublishedAt,
    retrievedAt: actualRetrievedAt,
    resolution: effectiveResolution,
    spatialResolution: effectiveResolution,
    temporalResolution,
    scale,
    methodology,
    quality,
    limitations,
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
