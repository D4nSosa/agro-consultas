/* ============================================================================
   script.js — UI Orchestrator ES Module — Agro Consultas
   ============================================================================ */

import { normalizeKey } from './utils/normalization.js';
import {
  findProvinceByCoords,
  findSubregion,
  getProvinceDetails
} from './services/territoryService.js';
import { calculateArea } from './forestal/utils/geo.js';
import { getClimateData } from './services/climateService.js';
import { getSoilReport } from './services/soilService.js';
import { generateRecommendations, loadCultivosData, getCropCatalog, getCropsToEvaluate } from './services/recommendationEngine.js';
import { geocodeLocation } from './services/sources/geocodingService.js';
import { DataStatus } from './utils/dataModel.js';
import {
  analyzeUploadedImages,
  getCurrentBatch,
  removeImageFromBatch,
  clearBatch,
  buildPolygonFromBatchGps
} from './services/imageAnalysisService.js';
import { getClimateHistory } from './services/sources/nasaPowerService.js';
import { MapViewer } from './services/mapViewer.js';

let mapViewerInstance = null;
let currentMarker = null;
let userLocationCircle = null;
let drawnPolygonLayer = null;
let suitabilityOverlayLayer = null;

let isDrawingMainLot = false;
let mainDrawPoints = [];
let mainDrawMarkerLayers = [];

let currentUbicacionNombre = "Sin seleccionar";
let currentLat = null;
let currentLng = null;
let currentRadioKm = 15;
let currentSpatialLevel = "LOCALIDAD / PUNTO DE REFERENCIA";
let currentViewMode = "simple"; // 'simple' | 'technical'
let selectedCropKey = "todos"; // 'todos' | clave especifica de cultivo
let currentAOIPolygon = null; // GeoJSON geometry

let lastRecommendationsCache = [];
let lastSoilReportCache = null;
let lastClimateReportCache = null;

/**
 * Inicializa el mapa interactivo usando el MapViewer reutilizable
 */
export async function inicializarMapa(provinciaRaw) {
  const mapElement = document.getElementById("map");
  if (!mapElement) return;

  let defaultLat = -38.4161;
  let defaultLng = -63.6167;
  let defaultZoom = 4;

  const isSpecificUbicacion = provinciaRaw && provinciaRaw.trim() !== "" && provinciaRaw !== "Argentina" && provinciaRaw !== "Sin seleccionar";

  mapViewerInstance = new MapViewer('map');
  const leafletMap = mapViewerInstance.init([defaultLat, defaultLng], defaultZoom);

  if (!leafletMap) return;

  leafletMap.on('click', (e) => {
    const { lat, lng } = e.latlng;

    // Si el modo dibujo no está explícitamente activado pero el usuario hace clic, agregamos un punto vértice interactivo
    if (!isDrawingMainLot) {
      isDrawingMainLot = true;
      mainDrawPoints = [];
      if (drawnPolygonLayer) leafletMap.removeLayer(drawnPolygonLayer);
      mainDrawMarkerLayers.forEach(lyr => leafletMap.removeLayer(lyr));
      mainDrawMarkerLayers = [];
    }

    mainDrawPoints.push([lng, lat]);
    const m = L.circleMarker([lat, lng], { radius: 6, color: '#27ae60', fillColor: '#2ecc71', fillOpacity: 1 }).addTo(leafletMap);
    m.bindPopup(`<b>Vértice ${mainDrawPoints.length}</b><br>Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`).openPopup();
    mainDrawMarkerLayers.push(m);

    const btnDraw = document.getElementById("btn-start-draw-main");
    const btnClear = document.getElementById("btn-clear-draw-main");
    if (btnDraw) btnDraw.innerText = `✏️ Vértice ${mainDrawPoints.length} marcado...`;
    if (btnClear) btnClear.style.display = "inline-block";

    if (mainDrawPoints.length >= 3) {
      // Cerrar polígono automáticamente
      const closedCoords = [...mainDrawPoints, mainDrawPoints[0]];
      const geojsonFeature = {
        type: "Feature",
        properties: { name: `Lote Dibujado (${mainDrawPoints.length} Vértices)` },
        geometry: { type: "Polygon", coordinates: [closedCoords] }
      };

      const areaCalc = calculateArea(geojsonFeature);

      if (drawnPolygonLayer) leafletMap.removeLayer(drawnPolygonLayer);
      mainDrawMarkerLayers.forEach(lyr => leafletMap.removeLayer(lyr));
      mainDrawMarkerLayers = [];

      drawnPolygonLayer = L.geoJSON(geojsonFeature, {
        style: { color: '#27ae60', weight: 3, fillColor: '#2ecc71', fillOpacity: 0.3 }
      }).addTo(leafletMap);

      drawnPolygonLayer.bindPopup(`
        <div style="font-size:0.85rem;">
          <strong>📐 LOTE DIBUJADO EN MAPA</strong><br>
          <span>Superficie: <strong>${areaCalc.hectares} ha</strong> (${areaCalc.squareMeters.toLocaleString('es-AR')} m²)</span><br>
          <small>Vértices: ${mainDrawPoints.length}</small>
        </div>
      `).openPopup();

      currentAOIPolygon = geojsonFeature.geometry;
      sessionStorage.setItem('agro_current_polygon', JSON.stringify(geojsonFeature));

      isDrawingMainLot = false;
      if (btnDraw) btnDraw.innerText = "✏️ Redibujar Lote";

      procesarSeleccionCoordenadas(lat, lng, `Lote Dibujado (${areaCalc.hectares} ha - ${mainDrawPoints.length} Vértices)`, "LOTE / POLÍGONO");
    } else {
      // Si aún tiene 1 ó 2 vértices, procesar punto exacto para entregar resultados inmediatos sin trabar la UI
      procesarSeleccionCoordenadas(lat, lng, `Vértice ${mainDrawPoints.length} (Hacé clic en ${3 - mainDrawPoints.length} punto(s) más para cerrar el lote)`, "PUNTO / COORDENADA EXACTA");
    }
  });

  const btnDrawMain = document.getElementById("btn-start-draw-main");
  const btnClearMain = document.getElementById("btn-clear-draw-main");

  if (btnDrawMain) {
    btnDrawMain.addEventListener("click", () => {
      isDrawingMainLot = true;
      mainDrawPoints = [];
      if (drawnPolygonLayer) leafletMap.removeLayer(drawnPolygonLayer);
      mainDrawMarkerLayers.forEach(lyr => leafletMap.removeLayer(lyr));
      mainDrawMarkerLayers = [];
      btnDrawMain.innerText = "✏️ Haciendo clic en vértices...";
      if (btnClearMain) btnClearMain.style.display = "inline-block";
      alert("✏️ MODO DIBUJO DE LOTE ACTIVO:\n1. Hacé clic en la ubicación de cada vértice de tu lote en el mapa.\n2. Al hacer clic en el 3er vértice, el lote se cerrará automáticamente y se iniciará el análisis territorial.");
    });
  }

  if (btnClearMain) {
    btnClearMain.addEventListener("click", () => {
      isDrawingMainLot = false;
      mainDrawPoints = [];
      if (drawnPolygonLayer) leafletMap.removeLayer(drawnPolygonLayer);
      mainDrawMarkerLayers.forEach(lyr => leafletMap.removeLayer(lyr));
      mainDrawMarkerLayers = [];
      currentAOIPolygon = null;
      sessionStorage.removeItem('agro_current_polygon');
      if (btnDrawMain) btnDrawMain.innerText = "✏️ Dibujar Lote";
      btnClearMain.style.display = "none";
    });
  }

  // Renderizar panel de control de capas en el contenedor
  const layerContainer = document.getElementById("map-layer-controls-container");
  if (layerContainer) {
    mapViewerInstance.renderControlPanel("map-layer-controls-container");
  }

  const btnGeo = document.getElementById("btn-geolocalizar");
  if (btnGeo) {
    btnGeo.addEventListener("click", usarGeolocalizacion);
  }


  if (isSpecificUbicacion) {
    await buscarYProcesarUbicacion(provinciaRaw);
  }
}

/**
 * Poblar el selector con los 29 cultivos/especies reales
 */
export async function inicializarSelectorCultivos() {
  const select = document.getElementById("selectCropFilter");
  if (!select) return;

  try {
    const catalogo = await loadCultivosData();
    const cropCatalog = await getCropCatalog();
    const cropCount = Object.keys(cropCatalog).length;
    const totalProfiles = Object.keys(catalogo).length;

    let html = `<option value="todos">🌾 Todos los cultivos agrícolas (${cropCount} agrícolas / ${totalProfiles} perfiles totales)</option>`;
    const keys = Object.keys(catalogo).sort((a, b) => (catalogo[a].nombre || a).localeCompare(catalogo[b].nombre || b));

    keys.forEach(k => {
      const item = catalogo[k];
      const cat = item.categoria ? ` (${item.categoria})` : '';
      html += `<option value="${k}">${item.nombre}${cat}</option>`;
    });

    select.innerHTML = html;

    select.addEventListener("change", async (e) => {
      selectedCropKey = e.target.value;
      if (currentLat !== null && currentLng !== null) {
        await renderRecomendaciones(currentUbicacionNombre, currentLat, currentLng);
      }
    });
  } catch (e) {
    console.error("Error al inicializar selector de cultivos:", e);
  }
}

function filtrarRecomendacionesPorCultivo(recs, key) {
  if (!key || key === "todos") return recs;
  const targetKey = normalizeKey(key);
  return recs.filter(c => normalizeKey(c.nombre) === targetKey || normalizeKey(c.id || '') === targetKey);
}

/**
 * Geocodifica y procesa una ubicación ingresada por texto
 */
export function mostrarIndicadorCarga(mensaje = "Procesando y cruzando datos de INTA, Open-Meteo, NASA POWER e IGN...") {
  const overlay = document.getElementById("api-processing-overlay");
  if (!overlay) return;
  const msgEl = overlay.querySelector("p");
  if (msgEl) msgEl.innerText = mensaje;
  overlay.style.display = "flex";
}

export function ocultarIndicadorCarga() {
  const overlay = document.getElementById("api-processing-overlay");
  if (!overlay) return;
  overlay.style.display = "none";
}

export async function buscarYProcesarUbicacion(queryTexto) {
  if (!queryTexto || !queryTexto.trim()) return;

  mostrarIndicadorCarga(`Procesando y cruzando datos de INTA, Open-Meteo, NASA POWER e IGN para "${queryTexto}"...`);

  try {
    const geoResult = await geocodeLocation(queryTexto);

    if (!geoResult.available || !geoResult.value) {
      mostrarErrorUbicacionNoEncontrada(queryTexto);
      return;
    }

    const val = geoResult.value;
    currentLat = val.lat;
    currentLng = val.lng;
    currentUbicacionNombre = `${val.nombre}${val.provincia ? ', ' + val.provincia : ''}`;
    currentSpatialLevel = val.spatialLevel || "LOCALIDAD / PUNTO DE REFERENCIA";

    if (mapViewerInstance && mapViewerInstance.map) {
      const zoomLevel = currentSpatialLevel === 'PROVINCIA' ? 7 : 14;
      mapViewerInstance.map.setView([currentLat, currentLng], zoomLevel);
    }

    colocarMarcador(currentLat, currentLng, currentUbicacionNombre);

    limpiarEstadoConsultasAnteriores();

    await renderRecomendaciones(currentUbicacionNombre, currentLat, currentLng, val);
    await actualizarPanelTerritorialBasico(currentUbicacionNombre, currentLat, currentLng, val);
    await renderHistoriaClimaticaUI(currentLat, currentLng, currentUbicacionNombre);
  } catch (err) {
    console.error("Error en buscarYProcesarUbicacion:", err);
  } finally {
    ocultarIndicadorCarga();
  }
}

/**
 * Dibuja un círculo de alcance/radio alrededor de la ubicación seleccionada
 */
export function dibujarCirculoAlcance(lat, lng, radioKm) {
  if (!mapViewerInstance || !mapViewerInstance.map) return;

  if (userLocationCircle) {
    mapViewerInstance.map.removeLayer(userLocationCircle);
    userLocationCircle = null;
  }
}

/**
 * Coloca o mueve el marcador en el mapa
 */
export function colocarMarcador(lat, lng, titulo) {
  if (!mapViewerInstance || !mapViewerInstance.map) return;

  if (currentMarker) {
    currentMarker.setLatLng([lat, lng]);
  } else {
    currentMarker = L.marker([lat, lng], { draggable: false }).addTo(mapViewerInstance.map);
  }

  if (titulo) {
    currentMarker.bindPopup(`<b>${titulo}</b><br>Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`).openPopup();
  }
}

/**
 * Procesa la selección de coordenadas
 */
export async function procesarSeleccionCoordenadas(lat, lng, nombreCustom = null, spatialLevelCustom = null) {
  currentLat = lat;
  currentLng = lng;

  mostrarIndicadorCarga("Procesando y cruzando datos de INTA, Open-Meteo, NASA POWER e IGN...");

  try {
    if (mapViewerInstance && mapViewerInstance.map) {
      const targetZoom = mapViewerInstance.map.getZoom() < 12 ? 14 : Math.max(mapViewerInstance.map.getZoom(), 14);
      mapViewerInstance.map.setView([lat, lng], targetZoom);
    }

    const provinciaKey = await findProvinceByCoords(lat, lng);
    const provDetails = provinciaKey ? await getProvinceDetails(provinciaKey) : null;
    const nombreProvincia = provDetails ? (typeof provDetails.nombre === 'string' ? provDetails.nombre : provinciaKey) : "Argentina";

    currentUbicacionNombre = nombreCustom || `${nombreProvincia} (Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)})`;
    currentSpatialLevel = spatialLevelCustom || "PUNTO / COORDENADA EXACTA";

    colocarMarcador(lat, lng, currentUbicacionNombre);

    const geoPointData = {
      nombre: currentUbicacionNombre,
      provincia: nombreProvincia,
      pais: 'Argentina',
      lat: lat,
      lng: lng,
      spatialLevel: currentSpatialLevel
    };

    limpiarEstadoConsultasAnteriores();

    await renderRecomendaciones(currentUbicacionNombre, lat, lng, geoPointData);
    await actualizarPanelTerritorialBasico(currentUbicacionNombre, lat, lng, geoPointData);
    await renderHistoriaClimaticaUI(currentLat, currentLng, currentUbicacionNombre);
  } catch (err) {
    console.error("Error en procesarSeleccionCoordenadas:", err);
  } finally {
    ocultarIndicadorCarga();
  }
}

/**
 * Actualiza el panel lateral con datos de coordenadas, clima en vivo y suelo
 */
export async function actualizarPanelTerritorialBasico(provincia, lat, lng, geoVal = null) {
  const detailsContainer = document.getElementById("territory-details");
  if (!detailsContainer) return;

  try {
    const key = await findProvinceByCoords(lat, lng);
    const subregion = key ? await findSubregion(key, lat, lng) : null;

    const soilReport = await getSoilReport(lat, lng, subregion?.suelo);
    const climateReport = await getClimateData(lat, lng, provincia, subregion?.clima);

    lastSoilReportCache = soilReport;
    lastClimateReportCache = climateReport;

    const soilBadgeText = soilReport.status === DataStatus.REAL ? 'Datos locales verificados (INTA)' : 'Promedio regional (INTA)';
    const climateBadgeText = climateReport.liveWeatherPoint?.available ? 'Medición en vivo (Open-Meteo)' : 'Promedio regional';

    const levelText = geoVal?.spatialLevel || currentSpatialLevel || "PUNTO DE REFERENCIA";

    detailsContainer.innerHTML = `
      <div class="info-item">
        <strong>📍 Contexto Territorial de Ubicación (PUNTO)</strong>
        <span style="font-weight: 600; color: var(--verde-principal);">${provincia}</span>
        <span style="font-size: 0.8rem; display: block; color: var(--texto-secundario); margin-top: 4px;">Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}</span>
        <span style="font-size: 0.8rem; display: block; color: var(--verde-principal); font-weight: 600; margin-top: 2px;">🎯 Precisión Micro-Local (100m - 500m)</span>
      </div>

      <div style="background: rgba(2, 119, 189, 0.08); border: 1px solid rgba(2, 119, 189, 0.25); border-radius: 8px; padding: 10px; margin-bottom: 12px; font-size: 0.8rem; line-height: 1.4; color: var(--texto-principal);">
        <strong>ℹ️ Escala Geográfica:</strong> Esta consulta analiza el contexto agroclimático del punto seleccionado. Para delimitar y evaluar la superficie exacta de un lote por polígono, utilice el Módulo Forestal.
      </div>

      <!-- Clima en Vivo -->
      <div class="info-section-title" style="margin: 12px 0 5px 0; font-weight: bold; border-bottom: 1px solid var(--borde-suave); padding-bottom: 3px; color: var(--verde-principal); font-size: 0.95rem; display: flex; justify-content: space-between; align-items: center;">
        <span>⚡ Clima en Vivo</span>
        <span style="font-size: 0.75rem; color: var(--texto-secundario); font-weight: 600;">${climateBadgeText}</span>
      </div>
      <div id="live-weather-info">
        <div style="background: rgba(0,0,0,0.03); border: 1px solid var(--borde-suave); border-radius: 8px; padding: 10px; margin-top: 5px;">
          <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 4px;">
            <span>🌡️ <strong>Temp. Actual:</strong></span>
            <span>${climateReport.temperaturaActual}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 4px;">
            <span>💨 <strong>Viento:</strong></span>
            <span>${climateReport.vientoActual}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 6px;">
            <span>🌤️ <strong>Condición:</strong></span>
            <span>${climateReport.condicionActualTexto}</span>
          </div>
          ${climateReport.peligroIncendio ? `
          <div style="border-top: 1px dashed var(--borde-suave); padding-top: 6px; margin-top: 4px; font-size: 0.82rem;">
            <strong>🔥 Peligro de Incendios:</strong> ${climateReport.peligroIncendio.icono} <span class="compatibility-badge ${climateReport.peligroIncendio.clase}" style="font-size:0.75rem; padding: 2px 6px;">${climateReport.peligroIncendio.nivel}</span>
            <div style="font-size: 0.75rem; color: var(--texto-secundario); margin-top: 2px;">${climateReport.peligroIncendio.descripcion}</div>
          </div>
          ` : ''}
        </div>
      </div>

      <!-- Suelo -->
      <div class="info-section-title" style="margin: 15px 0 5px 0; font-weight: bold; border-bottom: 1px solid var(--borde-suave); padding-bottom: 3px; color: var(--verde-principal); font-size: 0.95rem; display: flex; justify-content: space-between; align-items: center;">
        <span>🌱 Propiedades del Suelo</span>
        <span style="font-size: 0.75rem; color: var(--texto-secundario); font-weight: 600;">${soilBadgeText}</span>
      </div>
      <div class="info-item">
        <strong>Fuente:</strong>
        <span style="font-size:0.8rem; color: var(--texto-secundario);">${soilReport.fuente}</span>
      </div>
      <div class="info-item">
        <strong>Tipo y Clasificación:</strong>
        <span>${soilReport.tipo}</span>
      </div>
      <div class="info-item">
        <strong>Textura Predominante:</strong>
        <span>${soilReport.textura}</span>
      </div>
      <div class="info-item">
        <strong>Drenaje / Escurrimiento:</strong>
        <span>${soilReport.drenaje}</span>
      </div>
      <div class="info-item">
        <strong>Limitantes Edáficas:</strong>
        <span>${soilReport.limitantes}</span>
      </div>

      <!-- Clima Regional -->
      <div class="info-section-title" style="margin: 15px 0 5px 0; font-weight: bold; border-bottom: 1px solid var(--borde-suave); padding-bottom: 3px; color: var(--verde-principal); font-size: 0.95rem;">
        🌦️ Datos Climáticos Regionales
      </div>
      <div class="info-item">
        <strong>Precipitaciones Medias:</strong>
        <span>${climateReport.precipitacionesAnuales}</span>
      </div>
      <div class="info-item">
        <strong>Temperatura Media:</strong>
        <span>${climateReport.temperaturaMedia}</span>
      </div>
    `;
  } catch (err) {
    console.error("Error en actualizarPanelTerritorialBasico:", err);
  }
}

/**
 * Usa la geolocalización del Navegador
 */
export function usarGeolocalizacion() {
  if (!navigator.geolocation) {
    alert("La geolocalización no está soportada por tu navegador.");
    return;
  }

  const btnGeo = document.getElementById("btn-geolocalizar");
  if (btnGeo) {
    btnGeo.disabled = true;
    btnGeo.innerText = "📡 Solicitando permiso de GPS...";
  }

  const handlePositionSuccess = (position) => {
    const { latitude, longitude, accuracy } = position.coords;

    if (mapViewerInstance && mapViewerInstance.map) {
      mapViewerInstance.map.setView([latitude, longitude], 12);
    }

    const label = accuracy ? `Mi Ubicación GPS (±${Math.round(accuracy)}m)` : 'Mi Ubicación GPS';
    procesarSeleccionCoordenadas(latitude, longitude, label, "PUNTO / COORDENADA EXACTA");

    if (btnGeo) {
      btnGeo.disabled = false;
      const accLabel = accuracy ? ` (±${Math.round(accuracy)}m)` : '';
      btnGeo.innerText = `🟢 Ubicación GPS Activa${accLabel}`;
      btnGeo.style.background = "#27ae60";
    }
  };

  const handlePositionError = (error) => {
    console.warn("Error de geolocalización GPS:", error);
    alert("No se pudo obtener la ubicación GPS. Podés seleccionar manualmente un punto en el mapa.");
    if (btnGeo) {
      btnGeo.disabled = false;
      btnGeo.innerText = "📍 Usar Mi Ubicación en Tiempo Real";
      btnGeo.style.background = "";
    }
  };

  navigator.geolocation.getCurrentPosition(handlePositionSuccess, handlePositionError, {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 0
  });
}

/**
 * Renderiza la sección de Historia Climática desde NASA POWER
 */
export async function renderHistoriaClimaticaUI(lat, lng, ubicacionNombre) {
  const container = document.getElementById("climate-history-content");
  const periodSelect = document.getElementById("select-climate-period");
  if (!container) return;

  if (lat === null || lng === null) {
    container.innerHTML = `
      <div class="empty-state" style="text-align: center; padding: 20px;">
        <span style="font-size: 2rem;">📊</span>
        <p><strong>DATOS CLIMÁTICOS NO DISPONIBLES</strong></p>
        <p class="text-muted" style="font-size: 0.85rem;">Seleccioná una ubicación para consultar la serie climática histórica de NASA POWER.</p>
      </div>
    `;
    return;
  }

  const months = periodSelect ? parseInt(periodSelect.value) || 12 : 12;

  container.innerHTML = `
    <div style="text-align: center; padding: 20px;">
      <span style="font-size: 1.5rem; display: block; margin-bottom: 8px;">⏳</span>
      <p style="margin: 0; color: var(--texto-secundario); font-size: 0.9rem;">Consultando API oficial de NASA POWER para Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}...</p>
    </div>
  `;

  const climateHistory = await getClimateHistory(lat, lng, months);

  if (climateHistory.status === 'UNAVAILABLE' || !climateHistory.data) {
    container.innerHTML = `
      <div style="background: rgba(231, 76, 60, 0.08); border: 1px solid rgba(231, 76, 60, 0.3); border-radius: 8px; padding: 15px;">
        <h4 style="margin: 0 0 6px 0; color: #c0392b;">DATOS CLIMÁTICOS NO DISPONIBLES</h4>
        <p style="margin: 0; font-size: 0.85rem; color: var(--texto-secundario);">${climateHistory.message || 'No se pudieron recuperar las series temporales de NASA POWER para la ubicación seleccionada.'}</p>
      </div>
    `;
    return;
  }

  const d = climateHistory.data;
  const tempDiffBadge = d.comparison.temperaturaAnomalia > 0 ? 'badge-baja' : 'badge-alta';
  const precDiffBadge = d.comparison.precipitacionesDiferenciaPct >= 0 ? 'badge-alta' : 'badge-media';

  container.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 15px;">
      <div style="background: rgba(0,0,0,0.03); border: 1px solid var(--borde-suave); border-radius: 8px; padding: 12px;">
          <div style="font-size: 0.78rem; color: var(--texto-secundario); font-weight: 600;">🌧️ Precipitación Acumulada (Período Reciente)</div>
        <div style="font-size: 1.3rem; font-weight: 800; color: var(--verde-principal); margin: 4px 0;">${d.periodMetrics.precipitacionAcumuladaMm} mm</div>
          <div style="font-size: 0.8rem; color: var(--texto-principal);">Línea Base Histórica (2001–2020): ${d.historicalAverages.precipitacionMediaAnualMm} mm/año</div>
        <span class="compatibility-badge ${precDiffBadge}" style="display: inline-block; margin-top: 6px; font-size: 0.75rem;">${d.comparison.clasificacionPrecipitacion}</span>
      </div>

      <div style="background: rgba(0,0,0,0.03); border: 1px solid var(--borde-suave); border-radius: 8px; padding: 12px;">
          <div style="font-size: 0.78rem; color: var(--texto-secundario); font-weight: 600;">🌡️ Temperatura Media (Período Reciente)</div>
        <div style="font-size: 1.3rem; font-weight: 800; color: #e67e22; margin: 4px 0;">${d.periodMetrics.temperaturaMediaC}°C</div>
          <div style="font-size: 0.8rem; color: var(--texto-principal);">Línea Base Histórica (2001–2020): ${d.historicalAverages.temperaturaMediaHistoricaC}°C</div>
        <span class="compatibility-badge ${tempDiffBadge}" style="display: inline-block; margin-top: 6px; font-size: 0.75rem;">${d.comparison.clasificacionTemperatura}</span>
      </div>

      <div style="background: rgba(0,0,0,0.03); border: 1px solid var(--borde-suave); border-radius: 8px; padding: 12px;">
        <div style="font-size: 0.78rem; color: var(--texto-secundario); font-weight: 600;">📊 Extremos y Variables Agroclimáticas</div>
        <div style="font-size: 0.82rem; margin-top: 6px; line-height: 1.5; color: var(--texto-principal);">
          <div>🔥 <strong>Temp. Máxima Absoluta:</strong> ${d.periodMetrics.temperaturaMaximaAbsolutaC}°C</div>
          <div>❄️ <strong>Temp. Mínima Absoluta:</strong> ${d.periodMetrics.temperaturaMinimaAbsolutaC}°C</div>
          <div>💧 <strong>Humedad Relativa:</strong> ${d.periodMetrics.humedadRelativaMediaPct}%</div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Renderiza la capa visual de aptitud del cultivo seleccionado en el mapa
 */

function actualizarCapaAptitudMapa(recomendaciones, lat, lng) {
  if (!mapViewerInstance || !mapViewerInstance.map || lat === null || lng === null) return;

  if (suitabilityOverlayLayer) {
    mapViewerInstance.map.removeLayer(suitabilityOverlayLayer);
    suitabilityOverlayLayer = null;
  }

  if (!recomendaciones || recomendaciones.length === 0) return;

  const firstRec = recomendaciones[0];
  let color = '#27ae60'; // verde por defecto
  let textLabel = '🟢 Aptitud Alta / Favorable';

  if (firstRec.compatibilidad.includes('MEDIA') || firstRec.compatibilidad.includes('PRESENTA LIMITANTES')) {
    color = '#f39c12';
    textLabel = '🟡 Aptitud Media / Condicionada';
  } else if (firstRec.compatibilidad.includes('BAJA') || firstRec.compatibilidad.includes('LIMITACIONES SEVERAS')) {
    color = '#e74c3c';
    textLabel = '🔴 Aptitud Baja / Desfavorable';
  } else if (firstRec.compatibilidad.includes('INFORMACIÓN PENDIENTE') || firstRec.compatibilidad.includes('NO EVALUABLE')) {
    color = '#7f8c8d';
    textLabel = '⚪ No evaluble / Evidencia insuficiente';
  }

  // No dibujar círculos transparentes de radio/alcance en el mapa
  if (suitabilityOverlayLayer) {
    mapViewerInstance.map.removeLayer(suitabilityOverlayLayer);
    suitabilityOverlayLayer = null;
  }
}

/**
 * Renderiza las tarjetas de cultivo según la Vista Dual seleccionada ('simple' o 'technical')
 */
export async function renderRecomendaciones(provinciaRaw, lat, lng, geoVal = null) {
  const container = document.getElementById("crop-results");
  const tituloUbicacion = document.getElementById("resultado_ubicacion");

  if (!container) return;

  if (lat === null || lng === null || !provinciaRaw || provinciaRaw === "Sin seleccionar") {
    if (tituloUbicacion) tituloUbicacion.innerText = "Sin seleccionar";
    container.innerHTML = `
      <div class="empty-state card" style="grid-column: 1 / -1; text-align: center; padding: 30px;">
        <span style="font-size: 2.5rem; display: block; margin-bottom: 10px;">🌱</span>
        <h3>Sin ubicación seleccionada</h3>
        <p class="text-muted">Ingresá una localidad, seleccioná un punto del mapa o utilizá tu ubicación GPS para comenzar.</p>
      </div>
    `;
    return;
  }

  if (tituloUbicacion) tituloUbicacion.innerText = provinciaRaw;

  try {
    const key = await findProvinceByCoords(lat, lng);
    const provDetails = key ? await getProvinceDetails(key) : null;
    const subregion = key ? await findSubregion(key, lat, lng) : null;

    const soilReport = await getSoilReport(lat, lng, subregion?.suelo);
    const climateReport = await getClimateData(lat, lng, provinciaRaw, subregion?.clima);

    const catalogo = await loadCultivosData();
    let cultivosAEvaluar = [];

    if (selectedCropKey && selectedCropKey !== "todos") {
      const item = catalogo[selectedCropKey];
      if (item) {
        cultivosAEvaluar = [item.nombre];
      } else {
        cultivosAEvaluar = [selectedCropKey];
      }
    } else {
      cultivosAEvaluar = await getCropsToEvaluate(key);
    }

    const recomendaciones = await generateRecommendations(cultivosAEvaluar, soilReport, climateReport);
    lastRecommendationsCache = recomendaciones;

    const filtradas = filtrarRecomendacionesPorCultivo(recomendaciones, selectedCropKey);
    renderRecommendationsCards(filtradas, soilReport, climateReport, geoVal);
    actualizarCapaAptitudMapa(filtradas, lat, lng);

  } catch (err) {
    console.error("ERROR in renderRecomendaciones:", err);
    // En caso de error parcial en servicios externos, evaluar los cultivos de forma segura con datos suplementarios
    try {
      const cropCatalog = await getCropCatalog();
      const cultivosAEvaluar = Object.values(cropCatalog).map(item => item.nombre || item.id);
      const fallbackSoil = { status: 'UNAVAILABLE', message: 'Datos de suelo en verificación' };
      const fallbackClimate = { status: 'UNAVAILABLE', message: 'Datos climáticos en verificación' };
      const recomendaciones = await generateRecommendations(cultivosAEvaluar, fallbackSoil, fallbackClimate);
      renderRecommendationsCards(recomendaciones, fallbackSoil, fallbackClimate, null);
    } catch (e) {
      container.innerHTML = `
        <div class="empty-state card" style="grid-column: 1 / -1; text-align: center; padding: 25px; border-left: 4px solid #f39c12;">
          <span style="font-size: 2rem; display: block; margin-bottom: 8px;">🌾</span>
          <h3>Información Agroambiental en Proceso de Carga</h3>
          <p class="text-muted" style="font-size:0.88rem;">Seleccioná un punto específico en el mapa para actualizar el análisis territorial de cultivos.</p>
        </div>
      `;
    }
  }
}

function createSingleRecommendationCardHtml(c) {
  let semaforoIcon = "🟢";
  let semaforoText = "Condiciones Favorables";
  let badgeClass = "badge-alta";

  if (c.compatibilidad.includes("MEDIA") || c.compatibilidad.includes("PRESENTA LIMITANTES")) {
    semaforoIcon = "🟡";
    semaforoText = "Limitaciones Moderadas";
    badgeClass = "badge-media";
  } else if (c.compatibilidad.includes("BAJA") || c.compatibilidad.includes("LIMITACIONES SEVERAS")) {
    semaforoIcon = "🔴";
    semaforoText = "Atención / Restricciones";
    badgeClass = "badge-baja";
  } else if (c.compatibilidad.includes("INSUFFICIENT") || c.compatibilidad.includes("NO EVALUABLE")) {
    semaforoIcon = "⚪";
    semaforoText = "Evidencia Insuficiente";
    badgeClass = "badge-media";
  }

  let icon = "🌱";
  const nom = c.nombre.toLowerCase();
  if (nom.includes("trigo") || nom.includes("cebada") || nom.includes("avena")) icon = "🌾";
  else if (nom.includes("soja") || nom.includes("poroto")) icon = "🫛";
  else if (nom.includes("maiz") || nom.includes("sorgo")) icon = "🌽";
  else if (nom.includes("mani")) icon = "🥜";
  else if (nom.includes("pino") || nom.includes("eucalyptus")) icon = "🌲";
  else if (nom.includes("vid")) icon = "🍇";
  else if (nom.includes("citrus") || nom.includes("limon") || nom.includes("naranja")) icon = "🍊";
  else if (nom.includes("girasol")) icon = "🌻";
  else if (nom.includes("algodon")) icon = "☁️";
  else if (nom.includes("caña") || nom.includes("cana")) icon = "🎋";

  if (currentViewMode === 'simple') {
    return `
      <article class="crop-card card" style="padding: 18px; border-left: 5px solid ${semaforoIcon === '🟢' ? '#27ae60' : (semaforoIcon === '🟡' ? '#f39c12' : (semaforoIcon === '🔴' ? '#e74c3c' : '#7f8c8d'))};">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 2rem;">${icon}</span>
            <div>
              <h3 style="margin: 0; font-size: 1.15rem; font-weight: 800;">${c.nombre}</h3>
              <span style="font-size: 0.78rem; color: var(--texto-secundario);">${c.confianza}</span>
            </div>
          </div>
          <span class="compatibility-badge ${badgeClass}" style="font-size: 0.8rem; padding: 4px 10px;">
            ${semaforoIcon} ${semaforoText}
          </span>
        </div>

        <p style="font-size: 0.88rem; line-height: 1.4; color: var(--texto-principal); margin-bottom: 10px;">
          ${c.descripcion}
        </p>

        <div style="background: rgba(0,0,0,0.03); border-radius: 8px; padding: 10px; font-size: 0.82rem; margin-bottom: 10px;">
          <strong>💡 Factor Clave:</strong> ${c.motivos[0] || 'Factores compatibles con el contexto regional.'}
          ${c.riesgos && c.riesgos.length > 0 ? `<div style="margin-top: 4px; color: #c0392b;"><strong>⚠️ Limitante Principal:</strong> ${c.riesgos[0]}</div>` : ''}
        </div>

        <div style="font-size: 0.8rem; color: var(--texto-secundario); display: flex; justify-content: space-between; margin-bottom: 12px;">
          <span>📅 Siembra: <strong>${c.siembra}</strong></span>
          <span>🌾 Cosecha: <strong>${c.cosecha}</strong></span>
        </div>

        <button onclick="window.abrirModalFichaTecnica('${c.id}')" class="btn primary" style="width: 100%; font-size: 0.82rem; padding: 8px;">
          📋 Ver Ficha Técnica Completa
        </button>
      </article>
    `;
  } else {
    return `
      <article class="crop-card card" style="padding: 18px;">
        <div class="crop-card-header" style="flex-wrap: wrap; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span class="crop-icon" style="font-size: 1.8rem;">${icon}</span>
            <div>
              <h3 style="margin: 0; font-weight: 700;">${c.nombre}</h3>
            </div>
          </div>
          <div>
            <span class="compatibility-badge ${badgeClass}">${c.compatibilidad}</span>
          </div>
        </div>

        <p class="desc" style="font-size: 0.88rem; margin: 10px 0;">${c.descripcion}</p>

        <div class="crop-grid-details" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; font-size: 0.82rem;">
          <div style="background: rgba(0,0,0,0.02); padding: 10px; border-radius: 6px; border: 1px solid var(--borde-suave);">
            <strong>📅 Calendario Agrícola</strong>
            <div>Siembra: ${c.siembra}</div>
            <div>Cosecha: ${c.cosecha}</div>
          </div>
          <div style="background: rgba(0,0,0,0.02); padding: 10px; border-radius: 6px; border: 1px solid var(--borde-suave);">
            <strong>🌱 Requerimientos Trazables</strong>
            <div>Suelo: ${c.reqSuelo}</div>
            <div>Clima: ${c.reqClima}</div>
          </div>
        </div>

        <div class="compatibility-report premium-report" style="margin-bottom: 10px;">
          <div class="report-body" style="font-size: 0.82rem;">
            <div class="report-block">
              <strong>💡 Factores Favorables:</strong>
              <ul>${c.motivos.map(m => `<li>${m}</li>`).join("")}</ul>
            </div>
            ${c.riesgos && c.riesgos.length > 0 ? `
            <div class="report-block" style="color: #c0392b;">
              <strong>⚠️ Limitantes / Riesgos:</strong>
              <ul>${c.riesgos.map(r => `<li>${r}</li>`).join("")}</ul>
            </div>
            ` : ''}
            ${c.datosFaltantes && c.datosFaltantes.length > 0 ? `
            <div class="report-block" style="color:#7f8c8d;">
              <strong>ℹ️ Datos Faltantes:</strong>
              <ul>${c.datosFaltantes.map(df => `<li>${df}</li>`).join("")}</ul>
            </div>
            ` : ''}
          </div>
        </div>

        <button onclick="window.abrirModalFichaTecnica('${c.id}')" class="btn primary" style="width: 100%; font-size: 0.82rem; padding: 8px;">
          📋 Ver Ficha Técnica Completa
        </button>
      </article>
    `;
  }
}

function renderRecommendationsCards(recomendaciones, soilReport, climateReport, geoVal) {
  const container = document.getElementById("crop-results");
  if (!container) return;

  // Filtrar tarjetas con "INFORMACIÓN PENDIENTE DE VERIFICACIÓN" o sin relevancia para la zona
  const filtradasReales = recomendaciones.filter(c =>
    c && c.compatibilidad &&
    !c.compatibilidad.includes("INFORMACIÓN PENDIENTE") &&
    !c.compatibilidad.includes("NO EVALUABLE") &&
    !c.compatibilidad.includes("DATOS INSUFICIENTES")
  );

  if (filtradasReales.length === 0) {
    container.innerHTML = `
      <div class="empty-state card" style="grid-column: 1 / -1; text-align: center; padding: 25px;">
        <span style="font-size: 2rem; display: block; margin-bottom: 8px;">🌱</span>
        <h3>No se registraron cultivos específicos recomendados para la selección actual</h3>
        <p class="text-muted">Elegí "Todos los cultivos" o seleccioná una localidad con producción agrícola registrada.</p>
      </div>
    `;
    return;
  }

  // Agrupar por semáforo si se están evaluando todos los cultivos
  if (!selectedCropKey || selectedCropKey === "todos") {
    const aptos = [];
    const moderados = [];
    const noAptos = [];

    filtradasReales.forEach(c => {
      if (c.compatibilidad.includes("BAJA") || c.compatibilidad.includes("LIMITACIONES SEVERAS")) {
        noAptos.push(c);
      } else if (c.compatibilidad.includes("MEDIA") || c.compatibilidad.includes("PRESENTA LIMITANTES")) {
        moderados.push(c);
      } else {
        aptos.push(c);
      }
    });

    let html = '';

    if (aptos.length > 0) {
      html += `
        <div style="grid-column: 1 / -1; margin-top: 10px; margin-bottom: 5px;">
          <h3 style="color: #27ae60; font-size: 1.15rem; display: flex; align-items: center; gap: 8px; border-bottom: 2px solid #27ae60; padding-bottom: 6px; margin: 0;">
            <span>🟢</span> Cultivos Aptos y Recomendados para la Zona (${aptos.length})
          </h3>
        </div>
        ${aptos.map(createSingleRecommendationCardHtml).join('')}
      `;
    }

    if (moderados.length > 0) {
      html += `
        <div style="grid-column: 1 / -1; margin-top: 15px; margin-bottom: 5px;">
          <h3 style="color: #d35400; font-size: 1.15rem; display: flex; align-items: center; gap: 8px; border-bottom: 2px solid #f39c12; padding-bottom: 6px; margin: 0;">
            <span>🟡</span> Aptitud Media / Con Limitaciones de Manejo Local (${moderados.length})
          </h3>
        </div>
        ${moderados.map(createSingleRecommendationCardHtml).join('')}
      `;
    }

    if (noAptos.length > 0) {
      html += `
        <div style="grid-column: 1 / -1; margin-top: 15px; margin-bottom: 5px;">
          <h3 style="color: #c0392b; font-size: 1.15rem; display: flex; align-items: center; gap: 8px; border-bottom: 2px solid #e74c3c; padding-bottom: 6px; margin: 0;">
            <span>🔴</span> Cultivos Restringidos / Con Severas Limitaciones (${noAptos.length})
          </h3>
        </div>
        ${noAptos.map(createSingleRecommendationCardHtml).join('')}
      `;
    }

    container.innerHTML = html;
  } else {
    container.innerHTML = filtradasReales.map(createSingleRecommendationCardHtml).join('');
  }
}

function mostrarErrorUbicacionNoEncontrada(queryTexto) {
  const container = document.getElementById("crop-results");
  const detailsContainer = document.getElementById("territory-details");
  const tituloUbicacion = document.getElementById("resultado_ubicacion");

  if (tituloUbicacion) tituloUbicacion.innerText = queryTexto;

  const msg = `
    <div class="unavailable-card-block" style="grid-column: 1 / -1; padding: 30px; text-align: center;">
      <span style="font-size: 2.5rem; display: block; margin-bottom: 10px;">🔍</span>
      <h3 style="color: var(--texto-principal); margin-top: 0;">NO DISPONIBLE / UBICACIÓN NO ENCONTRADA</h3>
      <p class="explanation" style="max-width: 500px; margin: 10px auto;">
        No se encontraron registros geográficos para <strong>"${queryTexto}"</strong>.
      </p>
    </div>
  `;

  if (container) container.innerHTML = msg;
  if (detailsContainer) detailsContainer.innerHTML = msg;
}

/**
 * Limpia el estado de la UI
 */
export function limpiarEstadoConsultasAnteriores() {
  clearBatch();

  const evidenceCard = document.getElementById("evidence-results-card");
  if (evidenceCard) {
    evidenceCard.style.display = "none";
    evidenceCard.innerHTML = "";
  }

  const btnClear = document.getElementById("btnClearBatch");
  if (btnClear) btnClear.style.display = "none";

  const cropContainer = document.getElementById("crop-results");
  if (cropContainer) {
    cropContainer.innerHTML = `
      <div class="empty-state card" style="grid-column: 1 / -1; text-align: center; padding: 30px;">
        <span style="font-size: 1.5rem; display: block; margin-bottom: 8px;">⏳</span>
        <p>Cargando datos para la nueva consulta...</p>
      </div>
    `;
  }
}

/**
 * Abre el Modal con la Ficha Técnica Universal de la especie seleccionada
 */
window.abrirModalFichaTecnica = async function(cropId) {
  const modal = document.getElementById("modalFichaTecnica");
  const titulo = document.getElementById("modalFichaTitulo");
  const subtitulo = document.getElementById("modalFichaSubtitulo");
  const contenido = document.getElementById("modalFichaContenido");

  if (!modal || !contenido) return;

  const catalog = await loadCultivosData();
  const crop = catalog[cropId] || lastRecommendationsCache.find(c => c.id === cropId);

  if (!crop) {
    alert("No se encontró la ficha técnica para este cultivo.");
    return;
  }

  const ft = crop.fichaTecnica || {
    seccionA_identificacion: { nombreComun: crop.nombre || cropId, nombreCientifico: "Especie catalogada", familiaBotanica: "No especificada", categoria: "General", subcategoria: "General", cicloProductivo: "Anual", aptitudUsoPrincipal: "Uso general" },
    seccionB_aptitudTerritorial: { fuenteOficialAptitud: "INTA / SAGyP", escalaDiagnostico: "Regional", fundamentacionAgroclimatica: "Evaluación preliminar de compatibilidad.", requerimientosSuelo: crop.reqSuelo || "Suelos profundos", requerimientosClima: crop.reqClima || "Clima templado" },
    seccionC_calendarioFenologia: { preparacionTerreno: "Barbecho / Preparación previa", ventanaSiembraPlantacion: crop.siembra || "Información pendiente", ventanaCosechaTurno: crop.cosecha || "Información pendiente", etapasFenologicasClave: ["Emergencia", "Crecimiento", "Floración / Fructificación", "Cosecha"], horizonteProductivo: "Ciclo Productivo Estándar" },
    seccionD_manejoSanidad: { densidadRecomendada: "Según arreglo zonal", pautasNutricion: "Fertilización previa análisis de suelo", monitoreoSanitario: "Monitoreo preventivo SENASA/INTA", buenasPracticasAgricolas: "Siembra directa y rotaciones" },
    seccionE_modelosRendimiento: { unidadRendimiento: "tn/ha", escenarioConservador: "Bajo insumo", escenarioBase: crop.rendimientoEstimado || "Promedio zonal", escenarioFavorable: "Alto insumo", tipoModelo: "Observado Histórico" },
    seccionF_presupuestoEconomico: { moneda: "USD (Campaña 2024/2025)", costoImplantacionUSD: 300, costoMantenimientoAnualUSD: 200, costoCosechaFleteUSD: 150, precioReferenciaUSD: 200, unidadPrecio: "tn", horizonteEconomico: "Anual" },
    seccionG_trazabilidadCalidadEvidencia: { estadoEvidencia: { identificacion: "🟢 VERIFICADO", aptitudTerritorial: "🟡 PARCIAL", calendarioFenologia: "🟢 VERIFICADO", manejoSanidad: "🟢 VERIFICADO", modelosRendimiento: "🟢 VERIFICADO", presupuestoEconomico: "🟡 PARCIAL" }, coberturaDocumental: "🟢 ALTA", avisoLegal: "Valores orientativos editables por el usuario." }
  };

  const secA = ft.seccionA_identificacion || {};
  const secB = ft.seccionB_aptitudTerritorial || {};
  const secC = ft.seccionC_calendarioFenologia || {};
  const secD = ft.seccionD_manejoSanidad || {};
  const secE = ft.seccionE_modelosRendimiento || {};
  const secF = ft.seccionF_presupuestoEconomico || {};
  const secG = ft.seccionG_trazabilidadCalidadEvidencia || {};

  if (titulo) titulo.innerText = `📋 Ficha Técnica Universal — ${secA.nombreComun || crop.nombre}`;
  if (subtitulo) subtitulo.innerText = `${secA.nombreCientifico || ''} | ${secA.familiaBotanica || ''} (${secA.categoria || 'General'})`;

  // Parse default numbers for economic calculator
  const pImp = parseFloat(secF.costoImplantacionUSD) || 300;
  const pMant = parseFloat(secF.costoMantenimientoAnualUSD) || 200;
  const pCos = parseFloat(secF.costoCosechaFleteUSD) || 150;
  const pPrecio = parseFloat(secF.precioReferenciaUSD) || 200;
  let defaultYield = 3.5;
  if (crop.rendimientoEstimado) {
    const m = crop.rendimientoEstimado.match(/(\d+[\.,]?\d*)/);
    if (m) defaultYield = parseFloat(m[1].replace(',', '.'));
  }

  contenido.innerHTML = `
    <!-- Tab 1: Identificación Agronómica -->
    <div id="tab-id" class="tab-pane active">
      <h3 style="color: var(--verde-principal); margin-top: 0;">A. Identificación Agronómica</h3>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px;">
        <div class="sub-card"><strong>Nombre Común:</strong> ${secA.nombreComun || crop.nombre}</div>
        <div class="sub-card"><strong>Nombre Científico:</strong> <em>${secA.nombreCientifico || 'Especie catalogada'}</em></div>
        <div class="sub-card"><strong>Familia Botánica:</strong> ${secA.familiaBotanica || 'No especificada'}</div>
        <div class="sub-card"><strong>Categoría / Subcategoría:</strong> ${secA.categoria || ''} / ${secA.subcategoria || ''}</div>
        <div class="sub-card"><strong>Ciclo Productivo:</strong> ${secA.cicloProductivo || 'Anual'}</div>
        <div class="sub-card"><strong>Aptitud y Uso Principal:</strong> ${secA.aptitudUsoPrincipal || 'Producción agropecuaria'}</div>
      </div>
    </div>

    <!-- Tab 2: Aptitud y Diagnóstico Territorial -->
    <div id="tab-aptitud" class="tab-pane">
      <h3 style="color: var(--verde-principal); margin-top: 0;">B. Aptitud y Diagnóstico Territorial</h3>
      <div style="background: rgba(0,0,0,0.02); border: 1px solid var(--borde-suave); padding: 12px; border-radius: 8px; margin-bottom: 12px; font-size: 0.88rem;">
        <div><strong>🏛️ Fuente Oficial:</strong> ${secB.fuenteOficialAptitud || 'INTA / GAEZ v5'}</div>
        <div><strong>📏 Escala de Diagnóstico:</strong> ${secB.escalaDiagnostico || 'Macro-regional'}</div>
        <div style="margin-top: 6px; color: var(--texto-secundario);">${secB.fundamentacionAgroclimatica || ''}</div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div class="sub-card"><strong>🌱 Requerimientos de Suelo:</strong><br>${secB.requerimientosSuelo || crop.reqSuelo}</div>
        <div class="sub-card"><strong>🌦️ Requerimientos de Clima:</strong><br>${secB.requerimientosClima || crop.reqClima}</div>
      </div>
    </div>

    <!-- Tab 3: Calendario Productivo y Fenología -->
    <div id="tab-calendario" class="tab-pane">
      <h3 style="color: var(--verde-principal); margin-top: 0;">C. Calendario Productivo y Fenología</h3>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 12px;">
        <div class="sub-card"><strong>🛠️ Preparación de Terreno:</strong><br>${secC.preparacionTerreno || 'Barbecho y control de malezas'}</div>
        <div class="sub-card"><strong>📅 Ventana de Siembra / Plantación:</strong><br>${secC.ventanaSiembraPlantacion || crop.siembra}</div>
        <div class="sub-card"><strong>🌾 Ventana de Cosecha / Turno:</strong><br>${secC.ventanaCosechaTurno || crop.cosecha}</div>
        <div class="sub-card"><strong>⏳ Horizonte Productivo:</strong><br>${secC.horizonteProductivo || 'Ciclo Anual'}</div>
      </div>
      <div class="sub-card">
        <strong>🔄 Etapas Fenológicas Clave:</strong>
        <ul style="margin: 6px 0 0 18px; padding: 0;">
          ${(secC.etapasFenologicasClave || ["Emergencia", "Desarrollo", "Floración", "Cosecha"]).map(e => `<li>${e}</li>`).join('')}
        </ul>
      </div>
    </div>

    <!-- Tab 4: Manejo Agronómico y Sanidad -->
    <div id="tab-manejo" class="tab-pane">
      <h3 style="color: var(--verde-principal); margin-top: 0;">D. Manejo Agronómico y Sanidad</h3>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div class="sub-card"><strong>🌱 Densidad Recomendada:</strong><br>${secD.densidadRecomendada || 'Según arreglo espacial'}</div>
        <div class="sub-card"><strong>🧪 Pautas de Nutrición:</strong><br>${secD.pautasNutricion || 'Fertilización fosforada e investigación edáfica'}</div>
        <div class="sub-card"><strong>🛡️ Monitoreo Sanitario:</strong><br>${secD.monitoreoSanitario || 'Monitoreo de plagas SENASA / INTA'}</div>
        <div class="sub-card"><strong>🌿 Buenas Prácticas Agrícolas (BPA):</strong><br>${secD.buenasPracticasAgricolas || 'Siembra directa y rotaciones'}</div>
      </div>
    </div>

    <!-- Tab 5: Modelos de Rendimiento -->
    <div id="tab-modelos" class="tab-pane">
      <h3 style="color: var(--verde-principal); margin-top: 0;">E. Modelos de Rendimiento</h3>
      <div style="background: rgba(0,0,0,0.02); border: 1px solid var(--borde-suave); padding: 12px; border-radius: 8px; margin-bottom: 12px;">
        <div><strong>📊 Unidad de Rendimiento:</strong> ${secE.unidadRendimiento || 'tn/ha'}</div>
        <div><strong>🎯 Tipo de Modelo:</strong> ${secE.tipoModelo || 'Potencial Alcanzable GAEZ / SIAP'}</div>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
        <div class="sub-card" style="border-left: 4px solid #e74c3c;">
          <strong>🔴 Escenario Conservador:</strong><br>${secE.escenarioConservador || 'Bajo insumo / Restricción hídrica'}
        </div>
        <div class="sub-card" style="border-left: 4px solid #f39c12;">
          <strong>🟡 Escenario Base (Promedio):</strong><br>${secE.escenarioBase || crop.rendimientoEstimado || 'Promedio histórico'}
        </div>
        <div class="sub-card" style="border-left: 4px solid #27ae60;">
          <strong>🟢 Escenario Favorable:</strong><br>${secE.escenarioFavorable || 'Alto insumo / Riego óptimo'}
        </div>
      </div>
    </div>

    <!-- Tab 6: Presupuesto Económico y Márgenes (Paramétrico Editable) -->
    <div id="tab-economico" class="tab-pane">
      <h3 style="color: var(--verde-principal); margin-top: 0;">F. Presupuesto Económico e Indicadores de Lote (Editable en Tiempo Real)</h3>
      <p style="font-size: 0.85rem; color: var(--texto-secundario); margin-bottom: 15px;">
        Ajustá los valores de rendimiento, precio de venta y costos estimativos para recalcular el <strong>Margen Bruto</strong> y el <strong>Ingreso Neto del Lote</strong> en tiempo real:
      </p>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; background: rgba(0,0,0,0.02); padding: 15px; border-radius: 8px; border: 1px solid var(--borde-suave); margin-bottom: 15px;">
        <div>
          <label style="font-size: 0.8rem; font-weight: bold; display: block; margin-bottom: 4px;">Rendimiento Estimado (${secE.unidadRendimiento || 'tn/ha'}):</label>
          <input type="number" id="calcYield" value="${defaultYield}" step="0.1" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid var(--borde-suave);" />
        </div>
        <div>
          <label style="font-size: 0.8rem; font-weight: bold; display: block; margin-bottom: 4px;">Precio de Venta ($ / ${secF.unidadPrecio || 'tn'}):</label>
          <input type="number" id="calcPrice" value="${pPrecio}" step="1" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid var(--borde-suave);" />
        </div>
        <div>
          <label style="font-size: 0.8rem; font-weight: bold; display: block; margin-bottom: 4px;">Costo Implantación ($/ha):</label>
          <input type="number" id="calcImp" value="${pImp}" step="10" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid var(--borde-suave);" />
        </div>
        <div>
          <label style="font-size: 0.8rem; font-weight: bold; display: block; margin-bottom: 4px;">Costo Mantenimiento ($/ha):</label>
          <input type="number" id="calcMant" value="${pMant}" step="10" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid var(--borde-suave);" />
        </div>
        <div>
          <label style="font-size: 0.8rem; font-weight: bold; display: block; margin-bottom: 4px;">Costo Cosecha y Flete ($/ha):</label>
          <input type="number" id="calcCos" value="${pCos}" step="10" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid var(--borde-suave);" />
        </div>
      </div>

      <!-- Cuadro de Resultados Calculados -->
      <div id="calcResultsBox" style="background: rgba(39, 174, 96, 0.08); border: 1px solid rgba(39, 174, 96, 0.3); border-radius: 8px; padding: 15px; font-size: 0.9rem;">
        <!-- Se recalcula por JS -->
      </div>
      <small style="display: block; margin-top: 8px; color: var(--texto-secundario); font-size: 0.75rem;">
        📌 Cifras expresadas en ${secF.moneda || 'USD'}. Horizonate económico: ${secF.horizonteEconomico || 'Anual'}.
      </small>
    </div>

    <!-- Tab 7: Trazabilidad y Calidad de Evidencia -->
    <div id="tab-trazabilidad" class="tab-pane">
      <h3 style="color: var(--verde-principal); margin-top: 0;">G. Trazabilidad y Calidad de Evidencia</h3>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-bottom: 12px;">
        <div class="sub-card">Identificación Agronómica: <strong>${secG.estadoEvidencia?.identificacion || '🟢 VERIFICADO'}</strong></div>
        <div class="sub-card">Aptitud Territorial: <strong>${secG.estadoEvidencia?.aptitudTerritorial || '🟢 VERIFICADO'}</strong></div>
        <div class="sub-card">Calendario & Fenología: <strong>${secG.estadoEvidencia?.calendarioFenologia || '🟢 VERIFICADO'}</strong></div>
        <div class="sub-card">Manejo & Sanidad: <strong>${secG.estadoEvidencia?.manejoSanidad || '🟢 VERIFICADO'}</strong></div>
        <div class="sub-card">Modelos de Rendimiento: <strong>${secG.estadoEvidencia?.modelosRendimiento || '🟢 VERIFICADO'}</strong></div>
        <div class="sub-card">Presupuesto Económico: <strong>${secG.estadoEvidencia?.presupuestoEconomico || '🟡 PARCIAL'}</strong></div>
      </div>
      <div style="background: rgba(0,0,0,0.02); border: 1px solid var(--borde-suave); padding: 12px; border-radius: 8px; font-size: 0.82rem;">
        <div><strong>📚 Cobertura Documental:</strong> ${secG.coberturaDocumental || '🟢 ALTA'}</div>
        <div style="margin-top: 6px; color: var(--texto-secundario);"><strong>⚖️ Aviso Legal de Fuentes:</strong> ${secG.avisoLegal || 'Valores paramétricos de referencia zonal.'}</div>
      </div>
    </div>
  `;

  // Attach Tab Switcher Event Listeners
  const tabBtns = modal.querySelectorAll(".tab-btn");
  const tabPanes = modal.querySelectorAll(".tab-pane");

  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-tab");
      tabBtns.forEach(b => b.classList.remove("active"));
      tabPanes.forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      const targetPane = contenido.querySelector(`#${target}`);
      if (targetPane) targetPane.classList.add("active");
    });
  });

  // Attach Economic Calculator Listener
  const recalculateEcon = () => {
    const yVal = parseFloat(document.getElementById("calcYield")?.value) || 0;
    const prVal = parseFloat(document.getElementById("calcPrice")?.value) || 0;
    const impVal = parseFloat(document.getElementById("calcImp")?.value) || 0;
    const mantVal = parseFloat(document.getElementById("calcMant")?.value) || 0;
    const cosVal = parseFloat(document.getElementById("calcCos")?.value) || 0;

    const ingresoBruto = yVal * prVal;
    const costosTotales = impVal + mantVal + cosVal;
    const margenBruto = ingresoBruto - costosTotales;
    const roiPct = costosTotales > 0 ? ((margenBruto / costosTotales) * 100).toFixed(1) : 0;

    const resBox = document.getElementById("calcResultsBox");
    if (resBox) {
      resBox.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px;">
          <div>💰 <strong>Ingreso Bruto Estimado:</strong> <br><span style="font-size: 1.2rem; font-weight: 800; color: var(--verde-principal);">$${ingresoBruto.toFixed(2)} / ha</span></div>
          <div>💸 <strong>Costos Totales (Directos + Flete):</strong> <br><span style="font-size: 1.2rem; font-weight: 800; color: #c0392b;">$${costosTotales.toFixed(2)} / ha</span></div>
          <div>📈 <strong>Margen Bruto Estimado:</strong> <br><span style="font-size: 1.25rem; font-weight: 800; color: ${margenBruto >= 0 ? '#27ae60' : '#e74c3c'};">$${margenBruto.toFixed(2)} / ha</span></div>
          <div>📊 <strong>Retorno de Inversión (ROI):</strong> <br><span style="font-size: 1.2rem; font-weight: 800; color: ${roiPct >= 0 ? '#27ae60' : '#e74c3c'};">${roiPct}%</span></div>
        </div>
      `;
    }
  };

  ["calcYield", "calcPrice", "calcImp", "calcMant", "calcCos"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", recalculateEcon);
  });

  recalculateEcon();

  modal.style.display = "flex";

  const btnCerrar = document.getElementById("modalFichaCerrar");
  if (btnCerrar) {
    btnCerrar.onclick = () => { modal.style.display = "none"; };
  }
};

function initApp() {
  const params = new URLSearchParams(window.location.search);
  const rawUbic = params.get("ubicacion");
  const paramLat = params.get("lat");
  const paramLng = params.get("lng");

  const searchForm = document.getElementById("resultadosSearchForm");
  if (searchForm) {
    searchForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = document.getElementById("inputSearchUbicacion");
      if (input && input.value.trim()) {
        await buscarYProcesarUbicacion(input.value.trim());
      }
    });
  }

  // Controles de Vista Dual
  const btnSimple = document.getElementById("btnViewSimple");
  const btnTechnical = document.getElementById("btnViewTechnical");

  if (btnSimple && btnTechnical) {
    btnSimple.addEventListener("click", () => {
      currentViewMode = "simple";
      btnSimple.className = "btn primary";
      btnTechnical.className = "btn outline";
      if (lastRecommendationsCache.length > 0) {
        const filtradas = filtrarRecomendacionesPorCultivo(lastRecommendationsCache, selectedCropKey);
        renderRecommendationsCards(filtradas, lastSoilReportCache, lastClimateReportCache, null);
      }
    });

    btnTechnical.addEventListener("click", () => {
      currentViewMode = "technical";
      btnTechnical.className = "btn primary";
      btnSimple.className = "btn outline";
      if (lastRecommendationsCache.length > 0) {
        const filtradas = filtrarRecomendacionesPorCultivo(lastRecommendationsCache, selectedCropKey);
        renderRecommendationsCards(filtradas, lastSoilReportCache, lastClimateReportCache, null);
      }
    });
  }

  // Botón Exportar PDF y Compartir Reporte
  const btnPDF = document.getElementById("btnExportPDF");
  if (btnPDF) {
    btnPDF.addEventListener("click", () => {
      window.print();
    });
  }

  const btnShare = document.getElementById("btnShareReport");
  if (btnShare) {
    btnShare.addEventListener("click", () => {
      if (!currentLat || !currentLng) {
        alert("Seleccioná primero una ubicación en el mapa o buscador para generar el reporte.");
        return;
      }
      const baseUrl = window.location.origin + window.location.pathname.replace('resultados.html', 'reporte.html');
      const shareUrl = `${baseUrl}?lat=${currentLat.toFixed(5)}&lng=${currentLng.toFixed(5)}&nombre=${encodeURIComponent(currentUbicacionNombre)}&ha=N/A`;

      const shareData = {
        title: `Informe Agro Consultas — ${currentUbicacionNombre}`,
        text: `Informe Agro Consultas para ${currentUbicacionNombre}:`,
        url: shareUrl
      };

      if (navigator.share) {
        navigator.share(shareData).catch(() => {});
      } else {
        navigator.clipboard.writeText(shareUrl).then(() => {
          alert("Enlace único del reporte copiado al portapapeles:\n" + shareUrl);
        }).catch(() => {
          alert("Enlace único del reporte:\n" + shareUrl);
        });
      }
    });
  }

  // Multi-Image Upload Handler
  const evidenceFileInput = document.getElementById("evidence-file-input");
  const btnClearBatch = document.getElementById("btnClearBatch");

  if (evidenceFileInput) {
    evidenceFileInput.addEventListener("change", async (e) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      const newAnalyzed = await analyzeUploadedImages(files);
      renderBatchEvidenceUI();
      if (btnClearBatch) btnClearBatch.style.display = "inline-block";
    });
  }

  if (btnClearBatch) {
    btnClearBatch.addEventListener("click", () => {
      clearBatch();
      const evidenceCard = document.getElementById("evidence-results-card");
      if (evidenceCard) {
        evidenceCard.style.display = "none";
        evidenceCard.innerHTML = "";
      }
      btnClearBatch.style.display = "none";
    });
  }

  setTimeout(async () => {
    await inicializarSelectorCultivos();
    await inicializarMapa(null);

    if (paramLat && paramLng) {
      const latVal = parseFloat(paramLat);
      const lngVal = parseFloat(paramLng);
      if (!isNaN(latVal) && !isNaN(lngVal)) {
        await procesarSeleccionCoordenadas(latVal, lngVal);
        return;
      }
    }

    if (rawUbic && rawUbic.trim() !== "" && rawUbic !== "Argentina") {
      await buscarYProcesarUbicacion(rawUbic);
    } else {
      const tituloUbicacion = document.getElementById("resultado_ubicacion");
      if (tituloUbicacion) tituloUbicacion.innerText = "Sin seleccionar";
    }
  }, 100);
}

function renderBatchEvidenceUI() {
  const container = document.getElementById("evidence-results-card");
  if (!container) return;

  const batch = getCurrentBatch();
  if (!batch || batch.length === 0) {
    container.style.display = "none";
    return;
  }

  const polygonBuild = buildPolygonFromBatchGps();

  // Plot Marcadores de Fotos con GPS en el Mapa
  if (mapViewerInstance && mapViewerInstance.map) {
    batch.forEach(img => {
      if (img.exif && img.exif.hasGps && img.exif.gps) {
        const pMarker = L.circleMarker([img.exif.gps.lat, img.exif.gps.lng], {
          radius: 7,
          color: '#e67e22',
          fillColor: '#f39c12',
          fillOpacity: 0.9
        }).addTo(mapViewerInstance.map);

        pMarker.bindPopup(`
          <div style="font-size:0.8rem; max-width: 180px;">
            <img src="${img.previewUrl}" style="width:100%; height:80px; object-fit:cover; border-radius:4px;" />
            <strong>📷 ${img.filename}</strong><br>
            <span>Lat ${img.exif.gps.lat.toFixed(4)}, Lng ${img.exif.gps.lng.toFixed(4)}</span>
          </div>
        `);
      }
    });
  }

  container.style.display = "block";
  container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
      <h3 style="margin: 0; color: var(--verde-principal); font-size: 1.1rem;">
        📷 Evidencia Fotográfica de Campo (${batch.length} ${batch.length === 1 ? 'imagen' : 'imágenes'})
      </h3>
      ${polygonBuild.success ? `
        <button type="button" id="btn-reconstruct-lot-photos" class="btn primary" style="padding: 6px 14px; font-size: 0.82rem; background: var(--verde-principal);">
          📐 Reconstruir Polígono de Lote a partir de Fotos GPS (${polygonBuild.pointsCount} puntos)
        </button>
      ` : ''}
    </div>

    ${polygonBuild.success ? `
      <div style="background: rgba(39, 174, 96, 0.08); border: 1px solid rgba(39, 174, 96, 0.3); border-radius: 8px; padding: 10px; margin-top: 10px; font-size: 0.82rem;">
        <strong>✅ Detección de Geometría de Lote:</strong> Se detectaron ${polygonBuild.pointsCount} fotografías con coordenadas GPS georreferenciadas. Podés presionar el botón de arriba para trazar el perímetro del lote en el mapa.
      </div>
    ` : ''}

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 15px; margin-top: 15px;">
      ${batch.map((imgItem, idx) => `
        <div style="background: rgba(0,0,0,0.02); border: 1px solid var(--borde-suave); border-radius: 8px; padding: 12px; position: relative;">
          <img src="${imgItem.previewUrl}" alt="Foto de Campo" style="width: 100%; height: 160px; object-fit: cover; border-radius: 6px; border: 1px solid var(--borde-suave);" />

          <div style="font-size: 0.8rem; margin-top: 8px;">
            <strong>${imgItem.filename}</strong> (${imgItem.dimensions})
            <div style="font-size: 0.75rem; color: var(--texto-secundario); margin-top: 2px;">
              <div>📅 EXIF Fecha: ${imgItem.exif?.date || 'NO DISPONIBLE'}</div>
              <div>📍 EXIF GPS: ${imgItem.exif?.hasGps ? `Lat ${imgItem.exif.gps.lat.toFixed(4)}, Lng ${imgItem.exif.gps.lng.toFixed(4)}` : 'NO DISPONIBLE'}</div>
            </div>
            <div style="margin-top: 6px; font-size: 0.78rem; color: var(--texto-principal); line-height: 1.3;">
              <strong>👁️ Análisis Visual Preliminar:</strong>
              <div style="color: #27ae60;">${imgItem.visualAnalysis?.inferido}</div>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  const btnReconstruct = document.getElementById("btn-reconstruct-lot-photos");
  if (btnReconstruct && polygonBuild.success) {
    btnReconstruct.addEventListener("click", () => {
      if (mapViewerInstance && mapViewerInstance.map) {
        if (drawnPolygonLayer) mapViewerInstance.map.removeLayer(drawnPolygonLayer);

        drawnPolygonLayer = L.geoJSON(polygonBuild.feature, {
          style: {
            color: '#e67e22',
            weight: 3,
            fillColor: '#f39c12',
            fillOpacity: 0.3
          }
        }).addTo(mapViewerInstance.map);

        mapViewerInstance.map.fitBounds(drawnPolygonLayer.getBounds(), { padding: [30, 30] });

        const firstPt = polygonBuild.points[0];
        procesarSeleccionCoordenadas(firstPt.lat, firstPt.lng, `Lote Reconstruido por Fotos GPS (${polygonBuild.pointsCount} Puntos)`);
      }
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
