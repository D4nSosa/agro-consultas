/**
 * ForestMap.js - Componente para la gestión interactiva del mapa Leaflet en el módulo Forestal
 */

import { calculateArea, calculateCentroid, validateGeoJSON, toGeoJSONFeature } from '../utils/geo.js';

export class ForestMap {
  constructor(mapContainerId, onLotChangedCallback) {
    this.containerId = mapContainerId;
    this.onLotChanged = onLotChangedCallback;
    this.map = null;
    this.currentLayer = null;
    this.drawPolygonPoints = [];
    this.isDrawing = false;
    this.currentFeature = null;
    this.userGpsMarker = null;
    this.watchGpsTrackingId = null;
    this.gpsTrackPoints = [];
    this.gpsTrackPolyline = null;

    this.initMap();
  }

  startGpsTracking() {
    if (!navigator.geolocation) {
      alert("La geolocalización no está disponible en este navegador.");
      return;
    }

    this.gpsTrackPoints = [];
    if (this.gpsTrackPolyline) {
      this.map.removeLayer(this.gpsTrackPolyline);
      this.gpsTrackPolyline = null;
    }

    alert("🚶 MODO CAMINATA GPS ACTIVO:\n1. Comenzá a caminar alrededor del perímetro de tu lote.\n2. La app irá trazando tu recorrido en tiempo real en el mapa.\n3. Al dar la vuelta completa, presioná '🔴 Finalizar y Cerrar Lote' para calcular la superficie exacta.");

    this.watchGpsTrackingId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const pt = [longitude, latitude];
        const latLng = [latitude, longitude];

        this.gpsTrackPoints.push(pt);

        if (!this.gpsTrackPolyline) {
          this.gpsTrackPolyline = L.polyline([latLng], { color: '#e67e22', weight: 4, dashArray: '5, 10' }).addTo(this.map);
        } else {
          this.gpsTrackPolyline.addLatLng(latLng);
        }

        if (this.userGpsMarker) {
          this.userGpsMarker.setLatLng(latLng);
        } else {
          this.userGpsMarker = L.circleMarker(latLng, {
            radius: 8,
            color: '#d35400',
            fillColor: '#e67e22',
            fillOpacity: 1
          }).addTo(this.map);
        }

        this.map.setView(latLng, 17);
      },
      (err) => {
        console.warn("Error en tracking GPS:", err);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  stopGpsTrackingAndCloseLot() {
    if (this.watchGpsTrackingId !== null) {
      navigator.geolocation.clearWatch(this.watchGpsTrackingId);
      this.watchGpsTrackingId = null;
    }

    if (this.gpsTrackPolyline) {
      this.map.removeLayer(this.gpsTrackPolyline);
      this.gpsTrackPolyline = null;
    }

    if (this.gpsTrackPoints.length < 3) {
      alert(`⚠️ Puntos insuficientes (${this.gpsTrackPoints.length}). Se necesitan al menos 3 puntos registrados para cerrar la superficie del lote.`);
      return false;
    }

    // Cerrar el polígono
    const closedCoords = [...this.gpsTrackPoints, this.gpsTrackPoints[0]];
    const geom = {
      type: "Polygon",
      coordinates: [closedCoords]
    };

    const feature = toGeoJSONFeature(geom, { name: `Lote Caminado por GPS (${this.gpsTrackPoints.length} Puntos)` });
    return this.setGeoJSON(feature);
  }

  initMap() {
    const el = document.getElementById(this.containerId);
    if (!el) return;

    // Centro inicial: Argentina (sin lote pre-cargado)
    const defaultLat = -38.4161;
    const defaultLng = -63.6167;

    this.map = L.map(this.containerId).setView([defaultLat, defaultLng], 4);

    // Capa satelital de OpenStreetMap
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors | Copernicus STAC | IGN Argentina'
    }).addTo(this.map);

    L.control.scale({ imperial: false, metric: true }).addTo(this.map);

    // Eventos de click para dibujo interactivo
    this.map.on('click', (e) => this.handleMapClick(e));
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
    alert("✏️ MODO DIBUJO ACTIVO:\n1. Hacé clic en cada uno de los vértices del lote.\n2. Al hacer clic en el 3er punto, el polígono se cerrará y validará automáticamente.");
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

    // Ajustar vista del mapa al lote con zoom coherente
    const bounds = this.currentLayer.getBounds();
    if (bounds.isValid()) {
      this.map.fitBounds(bounds, { padding: [35, 35], maxZoom: 16 });
    }

    const centroid = calculateCentroid(this.currentFeature);
    const area = calculateArea(this.currentFeature);

    if (area.warning) {
      alert(area.warning);
    }

    if (this.onLotChanged) {
      this.onLotChanged(this.currentFeature, centroid, area);
    }

    return true;
  }

  useUserGPSLocation() {
    if (!navigator.geolocation) {
      alert("La geolocalización no está disponible en este navegador.");
      return;
    }

    const btnGps = document.getElementById("btn-gps-loc");
    if (btnGps) {
      btnGps.disabled = true;
      btnGps.innerText = "📡 Consultando GPS...";
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const accText = accuracy ? ` (±${Math.round(accuracy)}m)` : '';

        this.map.setView([latitude, longitude], 14);

        if (this.userGpsMarker) {
          this.map.removeLayer(this.userGpsMarker);
        }
        this.userGpsMarker = L.circleMarker([latitude, longitude], {
          radius: 8,
          color: '#2980b9',
          fillColor: '#3498db',
          fillOpacity: 0.9
        }).addTo(this.map).bindPopup(`<b>📍 UBICACIÓN GPS CAPTURADA</b><br>Tipo de geometría: PUNTO<br>Precisión:${accText}`).openPopup();

        // Un GPS proporciona un PUNTO, NO un polígono ni una superficie artificial.
        if (this.currentLayer) {
          this.map.removeLayer(this.currentLayer);
          this.currentLayer = null;
        }
        this.currentFeature = null;

        if (this.onLotChanged) {
          this.onLotChanged(null, { lat: latitude, lng: longitude }, { hectares: "LOTE/POLÍGONO NO DEFINIDO", squareMeters: "N/A" });
        }

        if (btnGps) {
          btnGps.disabled = false;
          btnGps.innerText = `🟢 Ubicación GPS${accText}`;
        }
      },
      (err) => {
        console.warn("Error GPS en campo:", err);
        let msg = "No se pudo obtener la ubicación GPS.";
        if (err.code === err.PERMISSION_DENIED) {
          msg = "Permiso de ubicación rechazado. Podés seleccionar manualmente un punto en el mapa.";
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          msg = "La ubicación GPS no está disponible actualmente. Podés seleccionar un punto en el mapa.";
        } else if (err.code === err.TIMEOUT) {
          msg = "Tiempo de espera agotado al consultar GPS. Podés seleccionar manualmente un punto en el mapa.";
        }

        alert(msg);

        if (btnGps) {
          btnGps.disabled = false;
          btnGps.innerText = "📍 Mi Ubicación GPS (Campo)";
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  getCurrentFeature() {
    return this.currentFeature;
  }
}
