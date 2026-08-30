/**
 * ForestMap.js - Componente para la gestión interactiva del mapa Leaflet en el módulo Forestal
 */

import { calculateArea, calculateCentroid, validateGeoJSON, toGeoJSONFeature } from '../utils/geo.js';
import { getNDVIColor } from '../utils/raster.js';

export class ForestMap {
  constructor(mapContainerId, onLotChangedCallback) {
    this.containerId = mapContainerId;
    this.onLotChanged = onLotChangedCallback;
    this.map = null;
    this.currentLayer = null;
    this.ndviOverlayLayer = null;
    this.drawPolygonPoints = [];
    this.isDrawing = false;
    this.currentFeature = null;
    this.userGpsMarker = null;

    this.initMap();
  }

  initMap() {
    const el = document.getElementById(this.containerId);
    if (!el) return;

    // Centro inicial: Misiones (Zona Forestal por excelencia en Argentina)
    const defaultLat = -26.8756;
    const defaultLng = -54.6543;

    this.map = L.map(this.containerId).setView([defaultLat, defaultLng], 9);

    // Capa satelital de OpenStreetMap / CartoDB Positron para contraste visual
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors | Copernicus STAC'
    }).addTo(this.map);

    // Eventos de click para dibujo interactivo
    this.map.on('click', (e) => this.handleMapClick(e));

    // Lote predeterminado inicial (Lote experimental Misiones)
    this.loadDefaultSampleLot();
  }

  loadDefaultSampleLot() {
    const samplePolygon = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-54.68, -26.85],
          [-54.62, -26.85],
          [-54.62, -26.90],
          [-54.68, -26.90],
          [-54.68, -26.85]
        ]]
      },
      properties: {
        name: "Lote Misiones Nordeste"
      }
    };

    this.setGeoJSON(samplePolygon);
  }

  handleMapClick(e) {
    if (!this.isDrawing) return;

    const { lat, lng } = e.latlng;
    this.drawPolygonPoints.push([lng, lat]);

    // Renderizar marcador temporal del punto
    L.circleMarker([lat, lng], { radius: 5, color: '#27ae60', fillColor: '#2ecc71', fillOpacity: 1 }).addTo(this.map);

    if (this.drawPolygonPoints.length >= 3) {
      // Cerrar polígono temporal
      const closedCoords = [...this.drawPolygonPoints, this.drawPolygonPoints[0]];
      const geom = {
        type: "Polygon",
        coordinates: [closedCoords]
      };
      const feature = toGeoJSONFeature(geom, { name: "Lote Dibujado" });
      this.setGeoJSON(feature);
      this.isDrawing = false;
    }
  }

  startDrawing() {
    this.isDrawing = true;
    this.drawPolygonPoints = [];
    if (this.currentLayer) {
      this.map.removeLayer(this.currentLayer);
    }
    if (this.ndviOverlayLayer) {
      this.map.removeLayer(this.ndviOverlayLayer);
    }
  }

  setGeoJSON(geojson) {
    const validation = validateGeoJSON(geojson);
    if (!validation.valid) {
      alert(`GeoJSON inválido: ${validation.error}`);
      return false;
    }

    this.currentFeature = validation.feature;

    if (this.currentLayer) {
      this.map.removeLayer(this.currentLayer);
    }
    if (this.ndviOverlayLayer) {
      this.map.removeLayer(this.ndviOverlayLayer);
    }

    // Estilo Leaflet para el polígono forestal
    this.currentLayer = L.geoJSON(this.currentFeature, {
      style: {
        color: '#27ae60',
        weight: 3,
        opacity: 0.9,
        fillColor: '#2ecc71',
        fillOpacity: 0.25
      }
    }).addTo(this.map);

    // Ajustar vista del mapa al lote
    const bounds = this.currentLayer.getBounds();
    if (bounds.isValid()) {
      this.map.fitBounds(bounds, { padding: [30, 30] });
    }

    const centroid = calculateCentroid(this.currentFeature);
    const area = calculateArea(this.currentFeature);

    if (this.onLotChanged) {
      this.onLotChanged(this.currentFeature, centroid, area);
    }

    return true;
  }

  renderNDVIOverlay(gridSamples) {
    if (!this.currentFeature || !gridSamples || !gridSamples.length) return;

    if (this.ndviOverlayLayer) {
      this.map.removeLayer(this.ndviOverlayLayer);
    }

    const bounds = this.currentLayer.getBounds();
    const southWest = bounds.getSouthWest();
    const northEast = bounds.getNorthEast();

    const rows = 6;
    const cols = 6;
    const dLat = (northEast.lat - southWest.lat) / rows;
    const dLng = (northEast.lng - southWest.lng) / cols;

    const layersGroup = [];

    let sampleIdx = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const minLat = southWest.lat + r * dLat;
        const maxLat = minLat + dLat;
        const minLng = southWest.lng + c * dLng;
        const maxLng = minLng + dLng;

        const val = gridSamples[sampleIdx % gridSamples.length];
        const color = getNDVIColor(val);

        const rect = L.rectangle([[minLat, minLng], [maxLat, maxLng]], {
          color: color,
          weight: 0.5,
          fillColor: color,
          fillOpacity: 0.65
        });

        rect.bindPopup(`<b>Píxel NDVI Sentinel-2</b><br>Valor: ${val}<br>Categoría: ${getNDVILabel(val)}`);
        layersGroup.push(rect);
        sampleIdx++;
      }
    }

    this.ndviOverlayLayer = L.layerGroup(layersGroup).addTo(this.map);
  }

  useUserGPSLocation() {
    if (!navigator.geolocation) {
      alert("La geolocalización no está disponible en este navegador.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        this.map.setView([latitude, longitude], 14);

        if (this.userGpsMarker) {
          this.map.removeLayer(this.userGpsMarker);
        }
        this.userGpsMarker = L.circleMarker([latitude, longitude], {
          radius: 8,
          color: '#2980b9',
          fillColor: '#3498db',
          fillOpacity: 0.9
        }).addTo(this.map).bindPopup("<b>📍 Tu Ubicación GPS en Campo</b>").openPopup();

        // Crear polígono de 1 ha centrado en las coordenadas del usuario (~100m x 100m)
        const delta = 0.00045;
        const squarePoly = {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [[
              [longitude - delta, latitude - delta],
              [longitude + delta, latitude - delta],
              [longitude + delta, latitude + delta],
              [longitude - delta, latitude + delta],
              [longitude - delta, latitude - delta]
            ]]
          },
          properties: {
            name: `Lote Campo GPS (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`
          }
        };

        this.setGeoJSON(squarePoly);
      },
      (err) => {
        alert("No se pudo obtener la ubicación GPS del dispositivo: " + err.message);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  getCurrentFeature() {
    return this.currentFeature;
  }
}

function getNDVILabel(val) {
  if (val >= 0.7) return 'Forestal Muy Denso';
  if (val >= 0.5) return 'Vigor Saludable';
  if (val >= 0.3) return 'Cobertura Baja';
  return 'Suelo Expuesto / Inerte';
}
