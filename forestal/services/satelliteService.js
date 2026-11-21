/**
 * Cliente satelital del módulo Forestal.
 * El backend centraliza Earth Search STAC, conserva radiometría y filtra escenas por geometría exacta.
 */

const BACKEND_STAC_ENDPOINT = '/api/forest/stac';
const PUBLIC_CATALOG_NAME = 'AWS Earth Search STAC (consulta backend)';

export async function searchSentinelImagesByTargetDate(
  geometry,
  targetDateStr,
  windowDays = 90,
  maxCloudCover = 30,
  collection = 'sentinel-2-l2a'
) {
  const targetDate = new Date(targetDateStr);
  if (isNaN(targetDate.getTime())) {
    return unavailableResult(`Fecha objetivo inválida: "${targetDateStr}"`, targetDateStr, windowDays);
  }

  const windowsToTry = [windowDays, Math.max(windowDays, 60), Math.max(windowDays, 90), 120];
  const uniqueWindows = [...new Set(windowsToTry)];
  let searchRes = null;
  let effectiveWindow = windowDays;
  let startDate = '';
  let endDate = '';

  for (const days of uniqueWindows) {
    effectiveWindow = days;
    startDate = new Date(targetDate.getTime() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    // No se consultan escenas posteriores a la fecha objetivo.
    endDate = targetDateStr;

    searchRes = await searchSentinelImages(geometry, startDate, endDate, maxCloudCover, collection);
    if (searchRes.success && searchRes.products?.length) break;

    if (days >= 90 && maxCloudCover < 50) {
      searchRes = await searchSentinelImages(geometry, startDate, endDate, 50, collection);
      if (searchRes.success && searchRes.products?.length) break;
    }
  }

  if (!searchRes?.success || !searchRes.products?.length) {
    return {
      ...searchRes,
      targetDate: targetDateStr,
      windowDays: effectiveWindow,
      windowRange: `${startDate} a ${endDate}`,
      message: `NO DISPONIBLE — No se encontraron escenas ${collection} en la ventana histórica de ${effectiveWindow} días (${startDate} a ${endDate}) respecto a ${targetDateStr}.`
    };
  }

  const productsWithDelta = searchRes.products.map(product => {
    const productDate = new Date(product.date);
    const diffDays = Math.round(Math.abs(productDate.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24));
    return { ...product, targetDate: targetDateStr, daysFromTarget: diffDays };
  });

  productsWithDelta.sort((a, b) => {
    const cloudA = a.cloudCover !== null ? a.cloudCover : 999;
    const cloudB = b.cloudCover !== null ? b.cloudCover : 999;
    if (Math.abs(cloudA - cloudB) > 5) return cloudA - cloudB;
    return a.daysFromTarget - b.daysFromTarget;
  });

  return {
    ...searchRes,
    source: searchRes.source || PUBLIC_CATALOG_NAME,
    targetDate: targetDateStr,
    windowDays: effectiveWindow,
    windowRange: `${startDate} a ${endDate}`,
    bestProduct: productsWithDelta[0],
    products: productsWithDelta
  };
}

/**
 * Consulta el endpoint STAC del backend. No replica filtros ni inventa resoluciones/radiometría.
 */
export async function searchSentinelImages(
  geometry,
  startDate,
  endDate,
  maxCloudCover = 30,
  collection = 'sentinel-2-l2a'
) {
  try {
    const geojson = geometry?.type === 'Feature' ? geometry.geometry : geometry;
    if (!geojson || !['Polygon', 'MultiPolygon'].includes(geojson.type)) {
      return unavailableResult('La búsqueda satelital requiere un polígono GeoJSON válido.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let response;
    try {
      response = await fetch(BACKEND_STAC_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          geometry: geojson,
          startDate,
          endDate,
          maxCloudCover,
          collection
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      return unavailableResult(`Error de servicio STAC backend (HTTP ${response.status}).`);
    }

    const data = await response.json();
    if (!data.success || !Array.isArray(data.products) || data.products.length === 0) {
      return {
        ...unavailableResult(data.message || 'No se encontraron escenas satelitales válidas.'),
        collection,
        cloudCoverThreshold: maxCloudCover,
        calibrationRejectedCount: data.calibrationRejectedCount || 0
      };
    }

    const products = data.products.map(normalizeBackendProduct);
    return {
      success: true,
      source: data.source || PUBLIC_CATALOG_NAME,
      catalogUrl: 'https://earth-search.aws.element84.com/v1/',
      collection,
      productsCount: products.length,
      cloudCoverThreshold: maxCloudCover,
      calibrationRejectedCount: data.calibrationRejectedCount || 0,
      bestProduct: products[0],
      products
    };
  } catch (error) {
    const detail = error?.name === 'AbortError'
      ? 'La consulta STAC superó el límite de 20 segundos.'
      : `Error de conexión: ${error.message}`;
    return unavailableResult(`No se pudo consultar el catálogo satelital. ${detail}`);
  }
}

function normalizeBackendProduct(product) {
  const assets = product.assets || {};
  const resolution = product.resolution;
  return {
    ...product,
    productType: product.product,
    spatialResolution: resolution !== null && resolution !== undefined ? `${resolution} metros` : 'NO DISPONIBLE',
    bands: (product.bands || []).map(name => ({
      name,
      description: name,
      resolution: resolution !== null && resolution !== undefined ? `${resolution}m` : 'NO DISPONIBLE'
    })),
    assets: {
      ...assets,
      b04: assets.red || null,
      b08: assets.nir || null,
      thumbnail: assets.thumbnail || null,
      visual: assets.visual || null,
      scl: assets.scl || null,
      qaPixel: assets.qaPixel || null
    },
    bbox: product.geometry?.bbox || null,
    stacSelf: null
  };
}

/**
 * Consulta la API Backend para el procesamiento de imágenes Radar SAR Sentinel-1.
 */
export async function getSentinel1SarAnalysis(geometry, startDate = null, endDate = null) {
  try {
    const response = await fetch('/api/forest/sar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ geometry, startDate, endDate })
    });
    if (!response.ok) {
      return { status: 'UNAVAILABLE', message: `HTTP ${response.status} - No se pudo conectar con la API Radar SAR.` };
    }
    return await response.json();
  } catch (error) {
    return { status: 'UNAVAILABLE', message: `Error de red al consultar Radar SAR: ${error.message}` };
  }
}

function unavailableResult(message, targetDate = null, windowDays = null) {
  return {
    success: false,
    source: PUBLIC_CATALOG_NAME,
    catalogUrl: 'https://earth-search.aws.element84.com/v1/',
    productsCount: 0,
    targetDate,
    windowDays,
    bestProduct: null,
    products: [],
    message: message || 'NO DISPONIBLE'
  };
}
