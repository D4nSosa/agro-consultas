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
    if (!Array.isArray(geojson.features) || geojson.features.length === 0) {
      return { valid: false, error: 'FeatureCollection vacía.' };
    }

    const geometries = geojson.features.map(feature => feature?.type === 'Feature' ? feature.geometry : null);
    if (geometries.some(item => !item || !['Point', 'Polygon', 'MultiPolygon', 'LineString'].includes(item.type) || !item.coordinates)) {
      return { valid: false, error: 'FeatureCollection contiene una geometría inválida o no soportada.' };
    }

    if (geometries.length === 1) {
      geometry = geometries[0];
    } else if (geometries.every(item => item.type === 'Polygon' || item.type === 'MultiPolygon')) {
      geometry = {
        type: 'MultiPolygon',
        coordinates: geometries.flatMap(item => item.type === 'Polygon' ? [item.coordinates] : item.coordinates)
      };
    } else {
      return { valid: false, error: 'La FeatureCollection contiene varias geometrías; solo se pueden combinar polígonos en un lote.' };
    }
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

  return {
    valid: true,
    geometry,
    feature: geojson.type === 'Feature' && geometry === geojson.geometry
      ? geojson
      : toGeoJSONFeature(geometry, geojson.type === 'Feature' ? geojson.properties : {})
  };
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
function calculateRingArea(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return 0;

  const radius = 6378137;
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const current = ring[i];
    const next = ring[i + 1];
    if (!Array.isArray(current) || !Array.isArray(next) ||
        !Number.isFinite(current[0]) || !Number.isFinite(current[1]) ||
        !Number.isFinite(next[0]) || !Number.isFinite(next[1])) {
      return 0;
    }
    const lat1 = current[1] * Math.PI / 180;
    const lat2 = next[1] * Math.PI / 180;
    const deltaLng = (next[0] - current[0]) * Math.PI / 180;
    sum += deltaLng * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  return Math.abs(sum * radius * radius / 2);
}

function calculatePolygonArea(rings) {
  if (!Array.isArray(rings) || rings.length === 0) return 0;
  const outerArea = calculateRingArea(rings[0]);
  const holesArea = rings.slice(1).reduce((total, ring) => total + calculateRingArea(ring), 0);
  return Math.max(0, outerArea - holesArea);
}

/**
 * Calcula el área geodésica aproximada de Polygon/MultiPolygon.
 * Cada polígono se calcula por separado; los anillos interiores se descuentan
 * como huecos y las partes de un MultiPolygon nunca se conectan entre sí.
 */
export function calculateArea(geometry) {
  if (!geometry) return { hectares: 0, squareMeters: 0, isPoint: false };

  const geom = geometry.type === 'Feature' ? geometry.geometry : geometry;
  if (!geom) return { hectares: 0, squareMeters: 0, isPoint: false };

  if (geom.type === 'Point') {
    return { hectares: 0, squareMeters: 0, isPoint: true, message: 'Un punto de consulta no posee superficie definida.' };
  }

  let area = 0;
  if (geom.type === 'Polygon') {
    area = calculatePolygonArea(geom.coordinates);
  } else if (geom.type === 'MultiPolygon') {
    if (!Array.isArray(geom.coordinates)) return { hectares: 0, squareMeters: 0, isPoint: false };
    area = geom.coordinates.reduce((total, polygon) => total + calculatePolygonArea(polygon), 0);
  } else {
    return { hectares: 0, squareMeters: 0, isPoint: false };
  }

  const squareMeters = Math.round(area * 100) / 100;
  const hectares = Math.round((squareMeters / 10000) * 100) / 100;

  let warning = null;
  if (hectares > 10000) {
    warning = `⚠️ AOI MUY GRANDE: La geometría ingresada tiene ${hectares.toLocaleString('es-AR')} ha (${squareMeters.toLocaleString('es-AR')} m²). Esto excede el tamaño normal de un lote forestal individual. Revisá los vértices antes de ejecutar el análisis.`;
  }

  return { hectares, squareMeters, isPoint: false, warning };
}

/**
 * Calcula el centroide [lat, lng] de una geometría
 */
function calculateRingCentroid(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return null;
  let crossSum = 0;
  let xSum = 0;
  let ySum = 0;

  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i] || [];
    const [x2, y2] = ring[i + 1] || [];
    if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
    const cross = x1 * y2 - x2 * y1;
    crossSum += cross;
    xSum += (x1 + x2) * cross;
    ySum += (y1 + y2) * cross;
  }

  if (Math.abs(crossSum) < 1e-15) return null;
  return {
    area: Math.abs(crossSum / 2),
    lng: xSum / (3 * crossSum),
    lat: ySum / (3 * crossSum)
  };
}

function calculatePolygonCentroid(rings) {
  if (!Array.isArray(rings) || rings.length === 0) return null;
  const outer = calculateRingCentroid(rings[0]);
  if (!outer) return null;

  let weightedArea = outer.area;
  let weightedLng = outer.lng * outer.area;
  let weightedLat = outer.lat * outer.area;

  for (const holeRing of rings.slice(1)) {
    const hole = calculateRingCentroid(holeRing);
    if (!hole) continue;
    weightedArea -= hole.area;
    weightedLng -= hole.lng * hole.area;
    weightedLat -= hole.lat * hole.area;
  }

  if (weightedArea <= 1e-15) return null;
  return { area: weightedArea, lng: weightedLng / weightedArea, lat: weightedLat / weightedArea };
}

/**
 * Calcula un centroide ponderado por superficie para Polygon/MultiPolygon.
 * La ponderación evita que una parte pequeña de un MultiPolygon tenga el
 * mismo peso que una parte extensa al elegir el punto de consulta territorial.
 */
export function calculateCentroid(geometry) {
  if (!geometry) return null;
  const geom = geometry.type === 'Feature' ? geometry.geometry : geometry;
  if (!geom) return null;

  if (geom.type === 'Point') {
    if (Array.isArray(geom.coordinates) && geom.coordinates.length >= 2 &&
        Number.isFinite(geom.coordinates[0]) && Number.isFinite(geom.coordinates[1])) {
      return { lat: geom.coordinates[1], lng: geom.coordinates[0] };
    }
    return null;
  }

  const polygons = geom.type === 'Polygon'
    ? [geom.coordinates]
    : geom.type === 'MultiPolygon' ? geom.coordinates : null;
  if (!Array.isArray(polygons) || polygons.length === 0) return null;

  let totalArea = 0;
  let weightedLng = 0;
  let weightedLat = 0;
  for (const polygon of polygons) {
    const centroid = calculatePolygonCentroid(polygon);
    if (!centroid) continue;
    totalArea += centroid.area;
    weightedLng += centroid.lng * centroid.area;
    weightedLat += centroid.lat * centroid.area;
  }

  if (totalArea <= 1e-15) return null;
  return { lat: weightedLat / totalArea, lng: weightedLng / totalArea };
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
function xmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[char]);
}
function exportGeometry(feature) {
  const geometry = feature?.type === 'Feature' ? feature.geometry : feature;
  if (!geometry || !['Point','LineString','Polygon','MultiPolygon'].includes(geometry.type)) throw new TypeError('Geometría no soportada para exportación.');
  const positions = geometry.type === 'Point' ? [geometry.coordinates] :
    geometry.type === 'LineString' ? geometry.coordinates :
    geometry.type === 'Polygon' ? geometry.coordinates.flat() : geometry.coordinates.flat(2);
  const valid = p => Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])) && Number(p[0]) >= -180 && Number(p[0]) <= 180 && Number(p[1]) >= -90 && Number(p[1]) <= 90;
  if (!Array.isArray(positions) || !positions.length || positions.some(p => !valid(p))) throw new TypeError('La geometría contiene coordenadas WGS84 inválidas.');
  return geometry;
}
function kmlCoordinates(ring) {
  return ring.map(p => Number(p[0]) + ',' + Number(p[1]) + ',' + (Number.isFinite(Number(p[2])) ? Number(p[2]) : 0)).join(' ');
}
function kmlPolygon(rings) {
  if (!Array.isArray(rings) || !rings.length) throw new TypeError('Polígono sin anillo exterior.');
  const boundary = (ring, kind) => '<' + kind + '><LinearRing><coordinates>' + kmlCoordinates(ring) + '</coordinates></LinearRing></' + kind + '>';
  return '<Polygon>' + boundary(rings[0], 'outerBoundaryIs') + rings.slice(1).map(r => boundary(r, 'innerBoundaryIs')).join('') + '</Polygon>';
}
function kmlGeometry(g) {
  if (g.type === 'Point') return '<Point><coordinates>' + kmlCoordinates([g.coordinates]) + '</coordinates></Point>';
  if (g.type === 'LineString') return '<LineString><tessellate>1</tessellate><coordinates>' + kmlCoordinates(g.coordinates) + '</coordinates></LineString>';
  if (g.type === 'Polygon') return kmlPolygon(g.coordinates);
  return '<MultiGeometry>' + g.coordinates.map(kmlPolygon).join('') + '</MultiGeometry>';
}
export function exportToKML(feature, name = 'Lote Forestal') {
  const g = exportGeometry(feature), n = xmlEscape(name);
  return '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>' + n + '</name><Style id="forestStyle"><LineStyle><color>ff27ae60</color><width>3</width></LineStyle><PolyStyle><color>402ecc71</color></PolyStyle></Style><Placemark><name>' + n + '</name><styleUrl>#forestStyle</styleUrl>' + kmlGeometry(g) + '</Placemark></Document></kml>';
}
function gpxTrack(positions, label) {
  return '<trk><name>' + xmlEscape(label) + '</name><trkseg>' + positions.map((p,i) => '<trkpt lat="' + Number(p[1]) + '" lon="' + Number(p[0]) + '"><name>' + (i+1) + '</name></trkpt>').join('') + '</trkseg></trk>';
}
export function exportToGPX(feature, name = 'Lote Forestal') {
  const g = exportGeometry(feature), n = xmlEscape(name), tracks = [];
  if (g.type === 'Point') tracks.push(gpxTrack([g.coordinates], n));
  else if (g.type === 'LineString') tracks.push(gpxTrack(g.coordinates, n));
  else {
    const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    polygons.forEach((rings,pi) => rings.forEach((ring,ri) => tracks.push(gpxTrack(ring, n + ' - polígono ' + (pi+1) + ', anillo ' + (ri+1)))));
  }
  const c = calculateCentroid(g);
  const waypoint = c ? '<wpt lat="' + c.lat + '" lon="' + c.lng + '"><name>' + n + ' - Centroide</name></wpt>' : '';
  return '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Agro-Consultas" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>' + n + '</name><time>' + new Date().toISOString() + '</time></metadata>' + waypoint + tracks.join('') + '</gpx>';
}
export function exportToPyQGISScript(feature, name = 'Lote Forestal') {
  const g = exportGeometry(feature);
  const f = feature?.type === 'Feature' ? feature : {type:'Feature',properties:{},geometry:g};
  return '# PyQGIS generado por Agro-Consultas\nimport json\nfrom qgis.core import QgsVectorLayer, QgsFeature, QgsGeometry, QgsProject\ngeojson_data = json.loads(' + JSON.stringify(JSON.stringify(f)) + ')\nlayer_name = ' + JSON.stringify(String(name)) + '\nlayer = QgsVectorLayer("Unknown?crs=EPSG:4326", layer_name, "memory")\nif not layer.isValid(): raise RuntimeError("No se pudo crear la capa EPSG:4326")\nfeature = QgsFeature()\nfeature.setGeometry(QgsGeometry.fromGeoJson(json.dumps(geojson_data["geometry"])))\nprovider = layer.dataProvider()\nprovider.addFeatures([feature])\nlayer.updateExtents()\nQgsProject.instance().addMapLayer(layer)\n';
}
