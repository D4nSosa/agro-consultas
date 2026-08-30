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

/**
 * Exporta la geometría a formato KML para QField / SW Maps / Google Earth
 */
export function exportToKML(feature, name = 'Lote Forestal') {
  const geom = feature.geometry || feature;
  let coordsText = '';

  if (geom.type === 'Polygon') {
    coordsText = geom.coordinates[0].map(pt => `${pt[0]},${pt[1]},0`).join(' ');
  } else if (geom.type === 'Point') {
    coordsText = `${geom.coordinates[0]},${geom.coordinates[1]},0`;
  }

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${name}</name>
    <description>Lote Forestal Exportado desde Agro Consultas - Interoperabilidad Campo/QField</description>
    <Style id="forestStyle">
      <LineStyle>
        <color>ff27ae60</color>
        <width>3</width>
      </LineStyle>
      <PolyStyle>
        <color>402ecc71</color>
      </PolyStyle>
    </Style>
    <Placemark>
      <name>${name}</name>
      <styleUrl>#forestStyle</styleUrl>
      ${geom.type === 'Polygon' ? `
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>${coordsText}</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>` : `
      <Point>
        <coordinates>${coordsText}</coordinates>
      </Point>`}
    </Placemark>
  </Document>
</kml>`;
  return kml;
}

/**
 * Exporta la geometría a formato GPX para GPS de mano Garmin en campo
 */
export function exportToGPX(feature, name = 'Lote Forestal') {
  const centroid = calculateCentroid(feature);
  const geom = feature.geometry || feature;
  let pointsXml = '';

  if (geom.type === 'Polygon') {
    pointsXml = geom.coordinates[0].map((pt, idx) => `
    <trkpt lat="${pt[1]}" lon="${pt[0]}">
      <name>Vértice ${idx + 1}</name>
    </trkpt>`).join('');
  } else if (geom.type === 'Point') {
    pointsXml = `
    <trkpt lat="${geom.coordinates[1]}" lon="${geom.coordinates[0]}">
      <name>${name}</name>
    </trkpt>`;
  }

  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Agro Consultas - Garmin/Field GPS Export" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${name}</name>
    <time>${new Date().toISOString()}</time>
  </metadata>
  <wpt lat="${centroid.lat}" lon="${centroid.lng}">
    <name>${name} - Centroide</name>
    <sym>Forest</sym>
  </wpt>
  <trk>
    <name>${name} - Perímetro Lote</name>
    <trkseg>${pointsXml}
    </trkseg>
  </trk>
</gpx>`;
  return gpx;
}

/**
 * Genera un script Python/PyQGIS para automatización en QGIS y PostGIS
 */
export function exportToPyQGISScript(feature, name = 'Lote Forestal') {
  const geojsonStr = JSON.stringify(feature);
  const centroid = calculateCentroid(feature);

  const pyScript = `# ==============================================================================
# Script de Automatización PyQGIS / QGIS 3.x - Agro Consultas
# Procesamiento de Lote Forestal y Carga en PostGIS / QGIS Canvas
# Generado para: ${name}
# Centroide: Lat ${centroid.lat.toFixed(5)}, Lng ${centroid.lng.toFixed(5)}
# ==============================================================================

import json
from qgis.core import (
    QgsVectorLayer,
    QgsFeature,
    QgsGeometry,
    QgsProject,
    QgsCoordinateReferenceSystem
)

geojson_data = '''${geojsonStr}'''

# 1. Crear capa vectorial temporal WGS84 (EPSG:4326) / POSGAR 2007 (EPSG:5343)
v_layer = QgsVectorLayer("Polygon?crs=epsg:4326", "${name}", "memory")
pr = v_layer.dataProvider()

# 2. Parsear geometría
data = json.loads(geojson_data)
geom_obj = QgsGeometry.fromGeoJson(json.dumps(data["geometry"]))

feat = QgsFeature()
feat.setGeometry(geom_obj)
pr.addFeatures([feat])
v_layer.updateExtents()

# 3. Agregar a proyecto QGIS actual
QgsProject.instance().addMapLayer(v_layer)

print("✅ Capa '${name}' cargada con éxito en QGIS.")
print("ℹ️ Superficie aproximada calculada en canvas WGS84/POSGAR.")
`;
  return pyScript;
}
