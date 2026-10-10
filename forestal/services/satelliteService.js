/**
 * satelliteService.js - Cliente STAC para el catálogo oficial de Copernicus Data Space Ecosystem
 * Endpoint: https://stac.dataspace.copernicus.eu/v1/
 */

import { getBoundingBox } from '../utils/geo.js';

const EARTH_SEARCH_STAC_URL = 'https://earth-search.aws.element84.com/v1/search';
const COPERNICUS_STAC_URL = 'https://stac.dataspace.copernicus.eu/v1/search';
const PUBLIC_CATALOG_NAME = 'AWS Earth Search (Sentinel-2 L2A COGs Public Catalog)';

/**
 * Busca imágenes Sentinel-2 L2A en el catálogo STAC para un lote GeoJSON y rango de fechas.
 * Retorna datos exclusivamente reales. Si no se encuentran escenas o falla la consulta,
 * devuelve status NO DISPONIBLE sin fabricar productos ficticios.
 */
/**
 * Busca imágenes Sentinel-2 L2A en el catálogo STAC alrededor de una fecha objetivo (ventana configurable).
 */
export async function searchSentinelImagesByTargetDate(geometry, targetDateStr, windowDays = 45, maxCloudCover = 30) {
  const targetDate = new Date(targetDateStr);
  if (isNaN(targetDate.getTime())) {
    return unavailableResult(`Fecha objetivo inválida: "${targetDateStr}"`, targetDateStr, windowDays);
  }

  const startDate = new Date(targetDate.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const endDate = new Date(targetDate.getTime() + windowDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const searchRes = await searchSentinelImages(geometry, startDate, endDate, maxCloudCover);

  if (!searchRes.success || !searchRes.products || searchRes.products.length === 0) {
    return {
      ...searchRes,
      targetDate: targetDateStr,
      windowDays: windowDays,
      windowRange: `${startDate} a ${endDate}`,
      message: `NO DISPONIBLE — No se encontraron escenas Sentinel-2 en la ventana de ±${windowDays} días (${startDate} a ${endDate}) respecto a la fecha objetivo ${targetDateStr}.`
    };
  }

  // Calcular diferencia en días respecto a la fecha objetivo para cada escena
  const productsWithDelta = searchRes.products.map(prod => {
    const prodDate = new Date(prod.date);
    const diffMs = Math.abs(prodDate.getTime() - targetDate.getTime());
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    return {
      ...prod,
      targetDate: targetDateStr,
      daysFromTarget: diffDays
    };
  });

  // Criterio explícito de selección: menor nubosidad y cercanía a fecha objetivo
  productsWithDelta.sort((a, b) => {
    if (Math.abs(a.cloudCover - b.cloudCover) > 5) {
      return a.cloudCover - b.cloudCover;
    }
    return a.daysFromTarget - b.daysFromTarget;
  });

  const best = productsWithDelta[0];

  return {
    success: true,
    source: COPERNICUS_CATALOG_NAME,
    catalogUrl: 'https://stac.dataspace.copernicus.eu/v1/',
    productsCount: productsWithDelta.length,
    targetDate: targetDateStr,
    windowDays: windowDays,
    windowRange: `${startDate} a ${endDate}`,
    bestProduct: best,
    products: productsWithDelta
  };
}

export async function searchSentinelImages(geometry, startDate, endDate, maxCloudCover = 30) {
  try {
    const bbox = getBoundingBox(geometry);

    const searchBody = {
      collections: ['sentinel-2-l2a'],
      bbox: bbox,
      datetime: `${startDate}T00:00:00Z/${endDate}T23:59:59Z`,
      limit: 10,
      query: {
        'eo:cloud_cover': {
          lte: maxCloudCover
        }
      }
    };

    // 1. Intentar catálogo público Earth Search STAC (Acceso anónimo a COGs)
    try {
      const respAws = await fetch(EARTH_SEARCH_STAC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(searchBody)
      });

      if (respAws.ok) {
        const dataAws = await respAws.json();
        const featuresAws = dataAws.features || [];
        if (featuresAws.length > 0) {
          const productsAws = featuresAws.map(feat => parseSTACItem(feat, 'AWS Earth Search (Sentinel-2 L2A COG)'));
          productsAws.sort((a, b) => a.cloudCover - b.cloudCover);
          return {
            success: true,
            source: PUBLIC_CATALOG_NAME,
            catalogUrl: 'https://earth-search.aws.element84.com/v1/',
            productsCount: productsAws.length,
            bestProduct: productsAws[0],
            products: productsAws
          };
        }
      }
    } catch (awsErr) {
      console.warn('[satelliteService] Earth Search STAC fail, intentando Copernicus CDSE STAC:', awsErr);
    }

    // 2. Fallback a Copernicus STAC
    const response = await fetch(COPERNICUS_STAC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(searchBody)
    });

    if (!response.ok) {
      return unavailableResult(`Error de servicio STAC (HTTP ${response.status})`);
    }

    const data = await response.json();
    const features = data.features || [];

    if (!features.length) {
      return unavailableResult(`No se encontraron imágenes Sentinel-2 reales con nubosidad <= ${maxCloudCover}% para el período seleccionado (${startDate} a ${endDate}).`);
    }

    const products = features.map(feat => parseSTACItem(feat, 'Copernicus CDSE STAC'));
    products.sort((a, b) => a.cloudCover - b.cloudCover);

    return {
      success: true,
      source: 'Copernicus Data Space Ecosystem (Sentinel-2 L2A)',
      catalogUrl: 'https://stac.dataspace.copernicus.eu/v1/',
      productsCount: products.length,
      bestProduct: products[0],
      products: products
    };

  } catch (err) {
    console.error('[satelliteService] Error al consultar catálogo STAC:', err);
    return unavailableResult(`Error de conexión al consultar el catálogo satelital: ${err.message}`);
  }
}

/**
 * Mapea un elemento STAC individual a la estructura normalizada de trazabilidad
 */
function parseSTACItem(item, customSource = null) {
  const props = item.properties || {};
  const assets = item.assets || {};

  const cloudCover = typeof props['eo:cloud_cover'] === 'number'
    ? Math.round(props['eo:cloud_cover'] * 10) / 10
    : 0.0;

  const date = props.datetime
    ? props.datetime.split('T')[0]
    : 'NO DISPONIBLE';

  const productId = item.id || 'NO DISPONIBLE';

  return {
    id: productId,
    date: date,
    datetime: props.datetime || null,
    cloudCover: cloudCover,
    collection: 'sentinel-2-l2a',
    source: customSource || 'Sentinel-2 L2A Public STAC',
    productType: 'Level-2A (Bottom of Atmosphere Reflectance)',
    spatialResolution: '10 metros',
    bands: [
      { name: 'B04', description: 'Red (665 nm)', resolution: '10m' },
      { name: 'B08', description: 'Near Infrared / NIR (842 nm)', resolution: '10m' }
    ],
    assets: {
      thumbnail: assets.thumbnail?.href || assets.preview?.href || null,
      visual: assets.visual?.href || assets.rendered_preview?.href || null,
      b04: assets.B04_10m?.href || assets.B04?.href || null,
      b08: assets.B08_10m?.href || assets.B08?.href || assets.nir?.href || null,
      scl: assets.scl?.href || assets.SCL?.href || null
    },
    bbox: item.bbox || null,
    stacSelf: item.links?.find(l => l.rel === 'self')?.href || null
  };
}

function unavailableResult(message, targetDate = null, windowDays = null) {
  return {
    success: false,
    source: COPERNICUS_CATALOG_NAME,
    catalogUrl: 'https://stac.dataspace.copernicus.eu/v1/',
    productsCount: 0,
    targetDate: targetDate,
    windowDays: windowDays,
    bestProduct: null,
    products: [],
    message: message || 'NO DISPONIBLE'
  };
}
