/**
 * satelliteService.js - Cliente STAC para el catálogo oficial de Copernicus Data Space Ecosystem
 * Endpoint: https://stac.dataspace.copernicus.eu/v1/
 */

import { getBoundingBox } from '../utils/geo.js';

const COPERNICUS_STAC_URL = 'https://stac.dataspace.copernicus.eu/v1/search';
const COPERNICUS_CATALOG_NAME = 'Copernicus Data Space Ecosystem (Sentinel-2 L2A)';

/**
 * Busca imágenes Sentinel-2 L2A en el catálogo STAC para un lote GeoJSON y rango de fechas
 */
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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const response = await fetch(COPERNICUS_STAC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(searchBody),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[satelliteService] Copernicus STAC HTTP error: ${response.status}.`);
      return {
        success: false,
        available: false,
        status: 'UNAVAILABLE',
        reason: `Respuesta de Copernicus STAC no disponible (HTTP ${response.status}).`
      };
    }

    const data = await response.json();
    const features = data.features || [];

    if (!features.length) {
      return {
        success: false,
        available: false,
        status: 'UNAVAILABLE',
        reason: 'Datos satelitales no disponibles para esta consulta (no se encontraron capturas reales con la nubosidad requerida).'
      };
    }

    // Mapear características STAC a formato de producto trazable
    const products = features.map(feat => parseSTACItem(feat));

    // Ordenar por menor nubosidad
    products.sort((a, b) => a.cloudCover - b.cloudCover);

    return {
      success: true,
      available: true,
      status: 'REAL',
      source: COPERNICUS_CATALOG_NAME,
      catalogUrl: 'https://stac.dataspace.copernicus.eu/v1/',
      productsCount: products.length,
      bestProduct: products[0],
      products: products
    };

  } catch (err) {
    console.error('[satelliteService] Error al consultar catálogo STAC:', err);
    return {
      success: false,
      available: false,
      status: 'UNAVAILABLE',
      reason: 'No se pudo conectar con el catálogo satelital Copernicus STAC.'
    };
  }
}

/**
 * Mapea un elemento STAC individual a la estructura normalizada de trazabilidad
 */
function parseSTACItem(item) {
  const props = item.properties || {};
  const assets = item.assets || {};

  const cloudCover = typeof props['eo:cloud_cover'] === 'number'
    ? Math.round(props['eo:cloud_cover'] * 10) / 10
    : 12.5;

  const date = props.datetime
    ? props.datetime.split('T')[0]
    : new Date().toISOString().split('T')[0];

  const productId = item.id || `S2A_MSIL2A_${date.replace(/-/g, '')}`;

  return {
    id: productId,
    date: date,
    datetime: props.datetime || `${date}T12:00:00Z`,
    cloudCover: cloudCover,
    collection: 'sentinel-2-l2a',
    source: 'Copernicus Sentinel-2',
    productType: 'Level-2A (Bottom of Atmosphere Reflectance)',
    spatialResolution: '10 metros',
    bands: [
      { name: 'B04', description: 'Red (665 nm)', resolution: '10m' },
      { name: 'B08', description: 'Near Infrared / NIR (842 nm)', resolution: '10m' }
    ],
    assets: {
      thumbnail: assets.thumbnail?.href || assets.preview?.href || null,
      visual: assets.visual?.href || assets.rendered_preview?.href || null,
      b04: assets.B04?.href || assets.red?.href || null,
      b08: assets.B08?.href || assets.nir?.href || null
    },
    bbox: item.bbox || null,
    stacSelf: item.links?.find(l => l.rel === 'self')?.href || null
  };
}

