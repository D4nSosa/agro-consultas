const WFS_URL = 'https://geoservicios.conae.gov.ar/geoserver/GeoServiciosCONAE/wfs';
const LAYERS = [
  { name: 'FocosDeCalor', source: 'MODIS', label: 'MODIS · Aqua / Terra' },
  { name: 'FocosDeCalorVIIRS', source: 'VIIRS', label: 'VIIRS · SNPP / NOAA-20' }
];
const PAGE_SIZE = 1000;
const MAX_PAGES = 5;

const numberOrNull = value => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

function dateOf(properties = {}) {
  const raw = properties.Dia ?? properties.dia ?? properties.date ??
    properties.acq_date ?? properties.Fecha ?? properties.fecha ??
    properties.datetime ?? properties.timestamp;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    const crosses = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, rings) {
  if (!rings?.length || !pointInRing(point, rings[0])) return false;
  return !rings.slice(1).some(hole => pointInRing(point, hole));
}

function pointInGeometry(point, geometry) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') return pointInPolygon(point, geometry.coordinates);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some(poly => pointInPolygon(point, poly));
  return false;
}

function normalizeFeature(feature, source) {
  const coordinates = feature?.geometry?.coordinates;
  if (feature?.geometry?.type !== 'Point' || !Array.isArray(coordinates) || coordinates.length < 2) return null;
  const [lon, lat] = coordinates.map(Number);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  const properties = feature.properties || {};
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: {
      source,
      date: dateOf(properties),
      confidence: numberOrNull(properties.FP_Confidence ?? properties.confidence),
      powerMw: numberOrNull(properties.FP_Power ?? properties.FP_power ?? properties.power),
      raw: properties
    }
  };
}

async function fetchLayer(layer, bounds, signal) {
  const [west, south, east, north] = bounds;
  const features = [];
  let startIndex = 0;
  let truncated = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      service: 'WFS',
      version: '2.0.0',
      request: 'GetFeature',
      typeNames: 'GeoServiciosCONAE:' + layer.name,
      outputFormat: 'application/json',
      srsName: 'EPSG:4326',
      count: String(PAGE_SIZE),
      startIndex: String(startIndex),
      bbox: [west, south, east, north, 'CRS:84'].join(',')
    });
    const response = await fetch(WFS_URL + '?' + params.toString(), {
      signal,
      headers: { Accept: 'application/geo+json, application/json' }
    });
    if (!response.ok) throw new Error(layer.source + ': servicio CONAE respondió HTTP ' + response.status);
    const payload = await response.json();
    if (!Array.isArray(payload.features)) {
      throw new Error(layer.source + ': la respuesta WFS no contiene una colección GeoJSON válida.');
    }
    features.push(...payload.features);
    if (payload.features.length < PAGE_SIZE) break;
    startIndex += payload.features.length;
    if (page === MAX_PAGES - 1) truncated = true;
  }

  return { layer, features, truncated };
}

function boundsOf(geometry) {
  const values = [];
  const walk = node => {
    if (Array.isArray(node) && typeof node[0] === 'number') values.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
  };
  walk(geometry.coordinates);
  if (!values.length) throw new Error('No se pudieron calcular los límites del área seleccionada.');
  return [
    Math.min(...values.map(p => p[0])),
    Math.min(...values.map(p => p[1])),
    Math.max(...values.map(p => p[0])),
    Math.max(...values.map(p => p[1]))
  ];
}

export async function fetchFireDetections({ geometry, minConfidence = 0, signal } = {}) {
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) {
    throw new Error('El monitoreo de focos requiere un lote Polygon o MultiPolygon.');
  }
  const bounds = boundsOf(geometry);
  const responses = await Promise.allSettled(LAYERS.map(layer => fetchLayer(layer, bounds, signal)));
  const successful = responses.filter(x => x.status === 'fulfilled').map(x => x.value);
  const errors = responses.filter(x => x.status === 'rejected').map(x => x.reason?.message || 'Error de consulta');
  if (!successful.length) throw new Error(errors.join(' · ') || 'No fue posible consultar los servicios WFS de CONAE.');

  const detections = [];
  for (const response of successful) {
    for (const raw of response.features) {
      const feature = normalizeFeature(raw, response.layer.source);
      if (!feature) continue;
      const p = feature.properties;
      if (!p.date) continue;
      if (p.confidence !== null && p.confidence < minConfidence) continue;
      const [lon, lat] = feature.geometry.coordinates;
      if (!pointInGeometry([lon, lat], geometry)) continue;
      detections.push(feature);
    }
  }
  detections.sort((a, b) => a.properties.date.localeCompare(b.properties.date));
  return {
    detections,
    errors,
    truncated: successful.some(x => x.truncated),
    layersAvailable: successful.map(x => x.layer.source),
    queriedBounds: bounds
  };
}

function haversineMeters(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const lat1 = a[1] * rad, lat2 = b[1] * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function harmonizeFireDetections(detections = [], maxDistanceMeters = 1000) {
  const modis = detections.filter(f => f.properties?.source === 'MODIS');
  const viirs = detections.filter(f => f.properties?.source === 'VIIRS');
  const usedViirs = new Set();
  const events = [];

  for (const m of modis) {
    const mPoint = m.geometry.coordinates;
    let nearest = -1, nearestDistance = Infinity;
    for (let i = 0; i < viirs.length; i++) {
      if (usedViirs.has(i) || viirs[i].properties.date !== m.properties.date) continue;
      const distance = haversineMeters(mPoint, viirs[i].geometry.coordinates);
      if (distance <= maxDistanceMeters && distance < nearestDistance) {
        nearest = i;
        nearestDistance = distance;
      }
    }
    if (nearest >= 0) {
      usedViirs.add(nearest);
      const v = viirs[nearest];
      const vPoint = v.geometry.coordinates;
      events.push({
        id: 'paired-' + events.length,
        date: m.properties.date,
        coordinates: [(mPoint[0] + vPoint[0]) / 2, (mPoint[1] + vPoint[1]) / 2],
        sources: ['MODIS', 'VIIRS'],
        harmonization: 'coincident',
        distanceMeters: Math.round(nearestDistance),
        confidence: { MODIS: m.properties.confidence, VIIRS: v.properties.confidence },
        powerMw: { MODIS: m.properties.powerMw, VIIRS: v.properties.powerMw }
      });
    } else {
      events.push({
        id: 'modis-' + events.length,
        date: m.properties.date,
        coordinates: mPoint,
        sources: ['MODIS'],
        harmonization: 'single-sensor',
        distanceMeters: null,
        confidence: { MODIS: m.properties.confidence },
        powerMw: { MODIS: m.properties.powerMw }
      });
    }
  }

  viirs.forEach((v, i) => {
    if (usedViirs.has(i)) return;
    events.push({
      id: 'viirs-' + events.length,
      date: v.properties.date,
      coordinates: v.geometry.coordinates,
      sources: ['VIIRS'],
      harmonization: 'single-sensor',
      distanceMeters: null,
      confidence: { VIIRS: v.properties.confidence },
      powerMw: { VIIRS: v.properties.powerMw }
    });
  });

  return events.sort((a, b) => a.date.localeCompare(b.date));
}

export function aggregateFireDays(events = []) {
  const totals = new Map();
  for (const event of events) {
    const day = event.date;
    if (day) totals.set(day, (totals.get(day) || 0) + 1);
  }
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([date, events]) => ({ date, events }));
}

export const CONAE_FIRE_SOURCES = {
  wfs: WFS_URL,
  catalog: 'https://catalogos5.conae.gov.ar/catalogofocos/default.aspx',
  documentation: 'https://catalogos.conae.gov.ar/catalogo/catalogoGeoServiciosOGC.html'
};
