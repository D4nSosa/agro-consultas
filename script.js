/* ============================================================================
   script.js — UI Orchestrator ES Module — Agro Consultas
   ============================================================================ */

import { normalizeKey } from './utils/normalization.js';
import {
  findProvinceByCoords,
  findSubregion,
  getProvinceDetails
} from './services/territoryService.js';
import { getClimateData } from './services/climateService.js';
import { getSoilReport } from './services/soilService.js';
import { generateRecommendations, loadCultivosData } from './services/recommendationEngine.js';
import { geocodeLocation } from './services/sources/geocodingService.js';
import { DataStatus } from './utils/dataModel.js';
import {
  analyzeUploadedImages,
  getCurrentBatch,
  removeImageFromBatch,
  clearBatch
} from './services/imageAnalysisService.js';
import { getClimateHistory } from './services/sources/nasaPowerService.js';
import { MapViewer } from './services/mapViewer.js';

let mapViewerInstance = null;
let currentMarker = null;
let userLocationCircle = null;
let drawnPolygonLayer = null;
let suitabilityOverlayLayer = null;

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

  // Registrar capas WMS oficiales reales (INTA GeoServer, IGN, OTBN)
  mapViewerInstance.registerOfficialGISLayers();

  leafletMap.on('click', (e) => {
    const { lat, lng } = e.latlng;
    procesarSeleccionCoordenadas(lat, lng, "PUNTO DE MAPA SELECCIONADO", "PUNTO / COORDENADA EXACTA");
  });

  // Renderizar panel de control de capas en el contenedor
  const layerContainer = document.getElementById("map-layer-controls-container");
  if (layerContainer) {
    mapViewerInstance.renderControlPanel("map-layer-controls-container");
  }

  const btnGeo = document.getElementById("btn-geolocalizar");
  if (btnGeo) {
    btnGeo.addEventListener("click", usarGeolocalizacion);
  }

  const selectAlcance = document.getElementById("select-alcance-radio");
  if (selectAlcance) {
    selectAlcance.addEventListener("change", (e) => {
      currentRadioKm = parseFloat(e.target.value) || 15;
      if (currentLat !== null && currentLng !== null) {
        dibujarCirculoAlcance(currentLat, currentLng, currentRadioKm);
      }
    });
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

  const catalogo = await loadCultivosData();

  let html = `<option value="todos">🌾 Todos los cultivos/especies (${Object.keys(catalogo).length} perfiles)</option>`;
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
}

function filtrarRecomendacionesPorCultivo(recs, key) {
  if (!key || key === "todos") return recs;
  const targetKey = normalizeKey(key);
  return recs.filter(c => normalizeKey(c.nombre) === targetKey || normalizeKey(c.id || '') === targetKey);
}

/**
 * Geocodifica y procesa una ubicación ingresada por texto
 */
export async function buscarYProcesarUbicacion(queryTexto) {
  if (!queryTexto || !queryTexto.trim()) return;

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
    const zoomLevel = currentSpatialLevel === 'PROVINCIA' ? 7 : 11;
    mapViewerInstance.map.setView([currentLat, currentLng], zoomLevel);
  }

  colocarMarcador(currentLat, currentLng, currentUbicacionNombre);
  dibujarCirculoAlcance(currentLat, currentLng, currentRadioKm);

  limpiarEstadoConsultasAnteriores();

  await renderRecomendaciones(currentUbicacionNombre, currentLat, currentLng, val);
  await actualizarPanelTerritorialBasico(currentUbicacionNombre, currentLat, currentLng, val);
  await renderHistoriaClimaticaUI(currentLat, currentLng, currentUbicacionNombre);
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

  userLocationCircle = L.circle([lat, lng], {
    color: '#27ae60',
    fillColor: '#2ecc71',
    fillOpacity: 0.15,
    weight: 2,
    dashArray: '5, 5',
    radius: radioKm * 1000
  }).addTo(mapViewerInstance.map);
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

  if (mapViewerInstance && mapViewerInstance.map && mapViewerInstance.map.getZoom() < 9) {
    mapViewerInstance.map.setView([lat, lng], 10);
  }

  dibujarCirculoAlcance(lat, lng, currentRadioKm);

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
        <span style="font-size: 0.8rem; display: block; color: var(--verde-principal); font-weight: 600; margin-top: 2px;">🎯 Alcance de Análisis: ${currentRadioKm} km alrededor</span>
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
          <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
            <span>🌤️ <strong>Condición:</strong></span>
            <span>${climateReport.condicionActualTexto}</span>
          </div>
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
        <div style="font-size: 0.78rem; color: var(--texto-secundario); font-weight: 600;">🌧️ Precipitación Acumulada</div>
        <div style="font-size: 1.3rem; font-weight: 800; color: var(--verde-principal); margin: 4px 0;">${d.periodMetrics.precipitacionAcumuladaMm} mm</div>
        <div style="font-size: 0.8rem; color: var(--texto-principal);">Promedio Histórico: ${d.historicalAverages.precipitacionMediaAnualMm} mm/año</div>
        <span class="compatibility-badge ${precDiffBadge}" style="display: inline-block; margin-top: 6px; font-size: 0.75rem;">${d.comparison.clasificacionPrecipitacion}</span>
      </div>

      <div style="background: rgba(0,0,0,0.03); border: 1px solid var(--borde-suave); border-radius: 8px; padding: 12px;">
        <div style="font-size: 0.78rem; color: var(--texto-secundario); font-weight: 600;">🌡️ Temperatura Media Período</div>
        <div style="font-size: 1.3rem; font-weight: 800; color: #e67e22; margin: 4px 0;">${d.periodMetrics.temperaturaMediaC}°C</div>
        <div style="font-size: 0.8rem; color: var(--texto-principal);">Promedio Histórico: ${d.historicalAverages.temperaturaMediaHistoricaC}°C</div>
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
  } else if (firstRec.compatibilidad.includes('EVIDENCIA INSUFFICIENT') || firstRec.compatibilidad.includes('NO EVALUABLE')) {
    color = '#7f8c8d';
    textLabel = '⚪ No evaluble / Evidencia insuficiente';
  }

  const suitabilityCircle = L.circle([lat, lng], {
    color: color,
    fillColor: color,
    fillOpacity: 0.25,
    weight: 3,
    radius: currentRadioKm * 1000
  });

  suitabilityCircle.bindPopup(`
    <div style="font-size:0.85rem;">
      <strong>Aptitud Territorial: ${firstRec.nombre}</strong><br>
      <span>${textLabel}</span><br>
      <small style="color:#666;">Factores: ${firstRec.motivos[0] || 'Trazables'}</small>
    </div>
  `);

  suitabilityOverlayLayer = suitabilityCircle;

  // Registrar en MapViewer para control de capas
  mapViewerInstance.registerOverlayLayer('aptitud_cultivo', suitabilityOverlayLayer, `🌾 Aptitud Territorial para ${firstRec.nombre}`, true, 'Análisis');
  mapViewerInstance.toggleOverlayLayer('aptitud_cultivo', true);
  mapViewerInstance.renderControlPanel("map-layer-controls-container");
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
      // Evaluar los 29 perfiles completos del catálogo
      cultivosAEvaluar = Object.values(catalogo).map(item => item.nombre || item.id);
    }

    const recomendaciones = await generateRecommendations(cultivosAEvaluar, soilReport, climateReport);
    lastRecommendationsCache = recomendaciones;

    const filtradas = filtrarRecomendacionesPorCultivo(recomendaciones, selectedCropKey);
    renderRecommendationsCards(filtradas, soilReport, climateReport, geoVal);
    actualizarCapaAptitudMapa(filtradas, lat, lng);

  } catch (err) {
    console.error("ERROR in renderRecomendaciones:", err);
  }
}

function renderRecommendationsCards(recomendaciones, soilReport, climateReport, geoVal) {
  const container = document.getElementById("crop-results");
  if (!container) return;

  if (recomendaciones.length === 0) {
    container.innerHTML = `
      <div class="empty-state card" style="grid-column: 1 / -1; text-align: center; padding: 25px;">
        <span style="font-size: 2rem; display: block; margin-bottom: 8px;">🔍</span>
        <h3>No se encontraron resultados para el cultivo seleccionado</h3>
        <p class="text-muted">Elegí "Todos los cultivos" en el selector para ver la aptitud general de la zona.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = recomendaciones.map(c => {
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

    if (currentViewMode === 'simple') {
      // VISTA SIMPLE / RESUMEN DE DECISIÓN
      return `
        <article class="crop-card card" style="padding: 20px; border-left: 5px solid ${semaforoIcon === '🟢' ? '#27ae60' : (semaforoIcon === '🟡' ? '#f39c12' : (semaforoIcon === '🔴' ? '#e74c3c' : '#7f8c8d'))};">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span style="font-size: 2rem;">${icon}</span>
              <div>
                <h3 style="margin: 0; font-size: 1.2rem; font-weight: 800;">${c.nombre}</h3>
                <span style="font-size: 0.8rem; color: var(--texto-secundario);">${c.confianza}</span>
              </div>
            </div>
            <span class="compatibility-badge ${badgeClass}" style="font-size: 0.85rem; padding: 6px 12px;">
              ${semaforoIcon} ${semaforoText}
            </span>
          </div>

          <p style="font-size: 0.9rem; line-height: 1.4; color: var(--texto-principal); margin-bottom: 12px;">
            ${c.descripcion}
          </p>

          <div style="background: rgba(0,0,0,0.03); border-radius: 8px; padding: 12px; font-size: 0.85rem; margin-bottom: 12px;">
            <strong>💡 Factor Clave:</strong> ${c.motivos[0] || 'Factores compatibles con el contexto regional.'}
            ${c.riesgos && c.riesgos.length > 0 ? `<div style="margin-top: 6px; color: #c0392b;"><strong>⚠️ Principal Limitante:</strong> ${c.riesgos[0]}</div>` : ''}
          </div>

          <div style="font-size: 0.82rem; color: var(--texto-secundario); display: flex; justify-content: space-between;">
            <span>📅 Siembra: <strong>${c.siembra}</strong></span>
            <span>🌾 Cosecha: <strong>${c.cosecha}</strong></span>
          </div>
        </article>
      `;
    } else {
      // VISTA TÉCNICA / DETALLE Y METODOLOGÍA
      return `
        <article class="crop-card card" style="padding: 20px;">
          <div class="crop-card-header" style="flex-wrap: wrap; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span class="crop-icon" style="font-size: 1.8rem;">${icon}</span>
              <div>
                <h3 style="margin: 0; font-weight: 700;">${c.nombre}</h3>
                <span class="badge-origin ${c.nivelConfianza === 'high' ? 'real' : 'regional'}">${c.confianza}</span>
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

          <!-- Factores y Riesgos -->
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

          <details style="background: rgba(0,0,0,0.02); border: 1px solid var(--borde-suave); border-radius: 8px; padding: 8px 12px; font-size: 0.78rem;">
            <summary style="cursor: pointer; font-weight: bold; color: var(--verde-principal);">
              ℹ️ Ver Fuentes y Metodología Agronómica
            </summary>
            <div style="margin-top: 6px; line-height: 1.4; color: var(--texto-secundario);">
              <div><strong>Fuente de Suelo:</strong> ${soilReport.fuente || 'INTA Cartografía Regional'}</div>
              <div><strong>Fuente Climática:</strong> ${climateReport.liveWeatherPoint?.available ? 'Open-Meteo API' : 'SMN Climatología Histórica'}</div>
              <div><strong>Metodología:</strong> Evaluación multicriterio transparente sin puntuaciones simuladas.</div>
            </div>
          </details>
        </article>
      `;
    }
  }).join("");
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
        No se encontraron registros geográficos reales en los servicios de datos abiertos para <strong>"${queryTexto}"</strong>.
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

  // Botón Exportar PDF
  const btnPDF = document.getElementById("btnExportPDF");
  if (btnPDF) {
    btnPDF.addEventListener("click", () => {
      window.print();
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

  container.style.display = "block";
  container.innerHTML = `
    <h3 style="margin-top: 0; color: var(--verde-principal); font-size: 1.1rem; display: flex; justify-content: space-between; align-items: center;">
      <span>📷 Evidencia Fotográfica de Campo (${batch.length} ${batch.length === 1 ? 'imagen' : 'imágenes'})</span>
    </h3>

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
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
