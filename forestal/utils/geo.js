/**
 * geo.js - Utilidades geoespaciales para el módulo Análisis Forestal
 */

/**
 * Valida un objeto GeoJSON (Feature, Polygon, MultiPolygon o Point)
 */
export function validateGeoJSON(geojson) {
  if (!geojson || typeof geojson !== 'object') {
    return { valid: false, error: 'Objeto GeoJSON no válido.' };
  }

  let geometry = geojson;
  if (geojson.type === 'FeatureCollection') {
    if (!geojson.features || !geojson.features.length) {
      return { valid: false, error: 'FeatureCollection vacía.' };
    }
    geometry = geojson.features[0].geometry;
  } else if (geojson.type === 'Feature') {
    geometry = geojson.geometry;
  }

  if (!geometry || !geometry.type || !geometry.coordinates) {
    return { valid: false, error: 'Estructura de geometría no válida (falta type o coordinates).' };
  }

  const validTypes = ['Point', 'Polygon', 'MultiPolygon', 'LineString'];
  if (!validTypes.includes(geometry.type)) {
    return { valid: false, error: `Tipo de geometría no soportado: ${geometry.type}` };
  }

  return { valid: true, geometry, feature: geojson.type === 'Feature' ? geojson : toGeoJSONFeature(geometry) };
}

/**
 * Envuelve una geometría en una Feature GeoJSON estándar
 */
export function toGeoJSONFeature(geometry, properties = {}) {
  return {
    type: 'Feature',
    geometry: geometry,
    properties: {
      name: properties.name || 'Lote Forestal',
      createdAt: properties.createdAt || new Date().toISOString(),
      ...properties
    }
  };
}

/**
 * Calcula el área en hectáreas y metros cuadrados de una geometría Polygon/MultiPolygon
 */
export function calculateArea(geometry) {
  if (!geometry) return { hectares: 0, squareMeters: 0 };

  const geom = geometry.type === 'Feature' ? geometry.geometry : geometry;
  if (geom.type === 'Point') {
    return { hectares: 0.1, squareMeters: 1000 }; // Área nominal para punto
  }

  let coords = [];
  if (geom.type === 'Polygon') {
    coords = geom.coordinates[0];
  } else if (geom.type === 'MultiPolygon') {
    coords = geom.coordinates.flatMap(p => p[0]);
  } else {
    return { hectares: 0, squareMeters: 0 };
  }

  // Geodesic area approximation (Shoelace formula scaled to meters on WGS84)
  const RADIUS = 6378137; // Earth radius in meters
  let area = 0;

  if (coords.length > 2) {
    for (let i = 0; i < coords.length - 1; i++) {
      const p1 = coords[i];
      const p2 = coords[i + 1];
      const rad1 = (p1[1] * Math.PI) / 180;
      const rad2 = (p2[1] * Math.PI) / 180;
      const dLng = ((p2[0] - p1[0]) * Math.PI) / 180;

      area += dLng * (2 + Math.sin(rad1) + Math.sin(rad2));
    }
    area = Math.abs((area * RADIUS * RADIUS) / 2.0);
  }

  const squareMeters = Math.round(area * 100) / 100;
  const hectares = Math.round((squareMeters / 10000) * 100) / 100;

  return { hectares, squareMeters };
}

/**
 * Calcula el centroide [lat, lng] de una geometría
 */
export function calculateCentroid(geometry) {
  const geom = geometry.type === 'Feature' ? geometry.geometry : geometry;

  if (geom.type === 'Point') {
    return { lat: geom.coordinates[1], lng: geom.coordinates[0] };
  }

  let points = [];
  if (geom.type === 'Polygon') {
    points = geom.coordinates[0];
  } else if (geom.type === 'MultiPolygon') {
    points = geom.coordinates.flatMap(p => p[0]);
  }

  if (!points.length) return { lat: -38.4161, lng: -63.6167 };

  let sumLat = 0;
  let sumLng = 0;
  points.forEach(p => {
    sumLng += p[0];
    sumLat += p[1];
  });

  return {
    lat: sumLat / points.length,
    lng: sumLng / points.length
  };
}

/**
 * Retorna el Bounding Box [minLng, minLat, maxLng, maxLat]
 */
export function getBoundingBox(geometry) {
  const geom = geometry.type === 'Feature' ? geometry.geometry : geometry;

  if (geom.type === 'Point') {
    const delta = 0.01;
    return [
      geom.coordinates[0] - delta,
      geom.coordinates[1] - delta,
      geom.coordinates[0] + delta,
      geom.coordinates[1] + delta
    ];
  }

  let points = [];
  if (geom.type === 'Polygon') {
    points = geom.coordinates[0];
  } else if (geom.type === 'MultiPolygon') {
    points = geom.coordinates.flatMap(p => p[0]);
  }

  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  points.forEach(p => {
    if (p[0] < minLng) minLng = p[0];
    if (p[0] > maxLng) maxLng = p[0];
    if (p[1] < minLat) minLat = p[1];
    if (p[1] > maxLat) maxLat = p[1];
  });

  return [minLng, minLat, maxLng, maxLat];
}
