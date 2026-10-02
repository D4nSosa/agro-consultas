/* ============================================================================
   script.js — UI Orchestrator ES Module — Agro Consultas
   ============================================================================ */

import { normalizeKey } from './utils/normalization.js';
import {
  findProvinceByCoords,
  findSubregion,
  getProvinceDetails,
  getProvinceCoordinates
} from './services/territoryService.js';
import { getClimateData } from './services/climateService.js';
import { getSoilReport } from './services/soilService.js';
import { generateRecommendations } from './services/recommendationEngine.js';
import { analyzeLocation } from './services/coreAnalysis.js';
import { geocodeLocation } from './services/sources/geocodingService.js';
import { DataStatus } from './utils/dataModel.js';
import { analyzeUploadedImage } from './services/imageAnalysisService.js';
import { getClimateHistory } from './services/sources/nasaPowerService.js';

let mapInstance = null;
let currentMarker = null;
let userLocationCircle = null;

let currentUbicacionNombre = "Sin seleccionar";
let currentLat = null;
let currentLng = null;
let currentRadioKm = 15;
let currentSpatialLevel = "LOCALIDAD / PUNTO DE REFERENCIA";
let activeEvidenceImage = null;

/**
 * Inicializa el mapa interactivo de Leaflet
 */
export async function inicializarMapa(provinciaRaw) {
  const mapElement = document.getElementById("map");
  if (!mapElement) return;

  let defaultLat = -38.4161;
  let defaultLng = -63.6167;
  let defaultZoom = 4;

  const isSpecificUbicacion = provinciaRaw && provinciaRaw.trim() !== "" && provinciaRaw !== "Argentina" && provinciaRaw !== "Sin seleccionar";

  if (mapInstance) {
    mapInstance.remove();
    mapInstance = null;
  }

  mapInstance = L.map('map').setView([defaultLat, defaultLng], defaultZoom);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors | IGN Argentina'
  }).addTo(mapInstance);

  L.control.scale({ imperial: false, metric: true }).addTo(mapInstance);

  mapInstance.on('click', (e) => {
    const { lat, lng } = e.latlng;
    procesarSeleccionCoordenadas(lat, lng, "PUNTO DE MAPA SELECCIONADO", "PUNTO / COORDENADA EXACTA");
  });

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

  if (mapInstance) {
    const zoomLevel = currentSpatialLevel === 'PROVINCIA' ? 7 : 11;
    mapInstance.setView([currentLat, currentLng], zoomLevel);
  }

  colocarMarcador(currentLat, currentLng, currentUbicacionNombre);
  dibujarCirculoAlcance(currentLat, currentLng, currentRadioKm);

  // Reiniciar la vista del panel antes de renderizar los nuevos datos de la ubicación actual
  limpiarEstadoConsultasAnteriores();

  await renderRecomendaciones(currentUbicacionNombre, currentLat, currentLng, val);
  await actualizarPanelTerritorialBasico(currentUbicacionNombre, currentLat, currentLng, val);
  await renderHistoriaClimaticaUI(currentLat, currentLng, currentUbicacionNombre);
}

/**
 * Dibuja un círculo de alcance/radio alrededor de la ubicación seleccionada
 */
export function dibujarCirculoAlcance(lat, lng, radioKm) {
  if (!mapInstance) return;

  if (userLocationCircle) {
    mapInstance.removeLayer(userLocationCircle);
    userLocationCircle = null;
  }

  userLocationCircle = L.circle([lat, lng], {
    color: '#27ae60',
    fillColor: '#2ecc71',
    fillOpacity: 0.15,
    weight: 2,
    dashArray: '5, 5',
    radius: radioKm * 1000
  }).addTo(mapInstance);
}

/**
 * Coloca o mueve el marcador en el mapa
 */
export function colocarMarcador(lat, lng, titulo) {
  if (!mapInstance) return;

  if (currentMarker) {
    currentMarker.setLatLng([lat, lng]);
  } else {
    currentMarker = L.marker([lat, lng], { draggable: false }).addTo(mapInstance);
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

  if (mapInstance && mapInstance.getZoom() < 9) {
    mapInstance.setView([lat, lng], 10);
  }

  dibujarCirculoAlcance(lat, lng, currentRadioKm);

  const provinciaKey = await findProvinceByCoords(lat, lng);
  const provDetails = provinciaKey ? await getProvinceDetails(provinciaKey) : null;
  const nombreProvincia = provDetails ? provDetails.nombre || provinciaKey : "Argentina";

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

  // Reiniciar la vista del panel antes de renderizar los nuevos datos de la ubicación actual
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

    const soilBadgeClass = soilReport.status === DataStatus.REAL ? 'badge-real' : 'badge-regional';
    const soilBadgeText = soilReport.status === DataStatus.REAL ? 'REAL (INTA WMS)' : 'ESTIMACIÓN REGIONAL';

    const climateBadgeClass = climateReport.liveWeatherPoint?.available ? 'badge-real' : 'badge-regional';
    const climateBadgeText = climateReport.liveWeatherPoint?.available ? 'REAL (Open-Meteo)' : 'DATOS REGIONALES';

    const levelText = geoVal?.spatialLevel || currentSpatialLevel || "LOCALIDAD / PUNTO DE REFERENCIA";

    detailsContainer.innerHTML = `
      <div class="info-item">
        <strong>📍 Ubicación Seleccionada</strong>
        <span style="font-weight: 600; color: var(--verde-principal);">${provincia}</span>
        <span class="badge-origin regional" style="margin-top: 4px; display: inline-block;">NIVEL ESPACIAL: ${levelText}</span>
        <span style="font-size: 0.8rem; display: block; color: var(--texto-secundario); margin-top: 4px;">Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}</span>
        <span style="font-size: 0.8rem; display: block; color: var(--verde-principal); font-weight: 600; margin-top: 2px;">🎯 Alcance de Análisis: ${currentRadioKm} km alrededor</span>
      </div>

      <!-- Advertencia de Nivel Espacial -->
      <div style="background: rgba(2, 119, 189, 0.08); border: 1px solid rgba(2, 119, 189, 0.25); border-radius: 8px; padding: 10px; margin-bottom: 12px; font-size: 0.8rem; line-height: 1.4; color: var(--texto-principal);">
        <strong>ℹ️ Escala Geográfica:</strong> Los datos climáticos y edáficos reflejan el contexto de la ${levelText.toLowerCase()}. Para análisis técnico de una parcela o campo específico, delimite o seleccione las coordenadas exactas del lote.
      </div>

      <!-- Clima en Vivo -->
      <div class="info-section-title" style="margin: 12px 0 5px 0; font-weight: bold; border-bottom: 1px solid var(--borde-suave); padding-bottom: 3px; color: var(--verde-principal); font-size: 0.95rem; display: flex; justify-content: space-between; align-items: center;">
        <span>⚡ Clima en Vivo</span>
        <span class="data-status-badge ${climateBadgeClass}">${climateBadgeText}</span>
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
        <span class="data-status-badge ${soilBadgeClass}">${soilBadgeText}</span>
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

    if (mapInstance) {
      mapInstance.setView([latitude, longitude], 12);
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
        <div style="font-size: 0.75rem; color: var(--texto-secundario); margin-top: 10px;">
          Fuente: NASA POWER | Ubicación: ${lat.toFixed(4)}, ${lng.toFixed(4)}
        </div>
      </div>
    `;
    return;
  }

  const d = climateHistory.data;
  const trace = climateHistory.traceability;

  const tempDiffBadge = d.comparison.temperaturaAnomalia > 0 ? 'badge-baja' : 'badge-alta';
  const precDiffBadge = d.comparison.precipitacionesDiferenciaPct >= 0 ? 'badge-alta' : 'badge-media';

  container.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 15px;">
      <div style="background: rgba(0,0,0,0.03); border: 1px solid var(--borde-suave); border-radius: 8px; padding: 12px;">
        <div style="font-size: 0.78rem; color: var(--texto-secundario); font-weight: 600;">🌧️ Precipitación Acumulada</div>
        <div style="font-size: 1.3rem; font-weight: 800; color: var(--verde-principal); margin: 4px 0;">${d.periodMetrics.precipitacionAcumuladaMm} mm</div>
        <div style="font-size: 0.8rem; color: var(--texto-principal);">Promedio Histórico: ${d.historicalAverages.precipitacionMediaAnualMm} mm/año</div>
        <div style="font-size: 0.78rem; margin-top: 4px;">
          Diferencia: <strong>${d.comparison.precipitacionesDiferenciaMm > 0 ? '+' : ''}${d.comparison.precipitacionesDiferenciaMm} mm (${d.comparison.precipitacionesDiferenciaPct > 0 ? '+' : ''}${d.comparison.precipitacionesDiferenciaPct}%)</strong>
        </div>
        <span class="compatibility-badge ${precDiffBadge}" style="display: inline-block; margin-top: 6px; font-size: 0.75rem;">${d.comparison.clasificacionPrecipitacion}</span>
      </div>

      <div style="background: rgba(0,0,0,0.03); border: 1px solid var(--borde-suave); border-radius: 8px; padding: 12px;">
        <div style="font-size: 0.78rem; color: var(--texto-secundario); font-weight: 600;">🌡️ Temperatura Media Período</div>
        <div style="font-size: 1.3rem; font-weight: 800; color: #e67e22; margin: 4px 0;">${d.periodMetrics.temperaturaMediaC}°C</div>
        <div style="font-size: 0.8rem; color: var(--texto-principal);">Promedio Histórico: ${d.historicalAverages.temperaturaMediaHistoricaC}°C</div>
        <div style="font-size: 0.78rem; margin-top: 4px;">
          Anomalía Térmica: <strong>${d.comparison.temperaturaAnomalia > 0 ? '+' : ''}${d.comparison.temperaturaAnomalia}°C</strong>
        </div>
        <span class="compatibility-badge ${tempDiffBadge}" style="display: inline-block; margin-top: 6px; font-size: 0.75rem;">${d.comparison.clasificacionTemperatura}</span>
      </div>

      <div style="background: rgba(0,0,0,0.03); border: 1px solid var(--borde-suave); border-radius: 8px; padding: 12px;">
        <div style="font-size: 0.78rem; color: var(--texto-secundario); font-weight: 600;">📊 Extremos y Variables Agroclimáticas</div>
        <div style="font-size: 0.82rem; margin-top: 6px; line-height: 1.5; color: var(--texto-principal);">
          <div>🔥 <strong>Temp. Máxima Absoluta:</strong> ${d.periodMetrics.temperaturaMaximaAbsolutaC}°C</div>
          <div>❄️ <strong>Temp. Mínima Absoluta:</strong> ${d.periodMetrics.temperaturaMinimaAbsolutaC}°C</div>
          <div>💧 <strong>Humedad Relativa:</strong> ${d.periodMetrics.humedadRelativaMediaPct}%</div>
          <div>💨 <strong>Viento Medio (10m):</strong> ${d.periodMetrics.vientoMedioKmH} km/h</div>
          <div>☀️ <strong>Radiación Solar:</strong> ${d.periodMetrics.radiacionSolarMediaMjM2Day} MJ/m²/día</div>
        </div>
      </div>
    </div>

    <!-- Trazabilidad y Nota Metodológica -->
    <details style="background: rgba(0,0,0,0.02); border: 1px solid var(--borde-suave); border-radius: 8px; padding: 8px 12px; font-size: 0.78rem;">
      <summary style="cursor: pointer; font-weight: bold; color: var(--verde-principal);">
        🛡️ Trazabilidad y Metodología NASA POWER
      </summary>
      <div style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--borde-suave); color: var(--texto-secundario); line-height: 1.4;">
        <div><strong>Fuente Oficial:</strong> ${trace.fuente} (${trace.apiEndpoint})</div>
        <div><strong>Ubicación Consultada:</strong> Lat ${trace.coordenadas.lat}, Lng ${trace.coordenadas.lng}</div>
        <div><strong>Período Analizado:</strong> ${trace.periodo} (${trace.mesesAnalizados} meses consultados)</div>
        <div><strong>Variables Recuperadas:</strong> ${trace.variablesConsultadas.join(', ')}</div>
        <div><strong>Fecha de Consulta:</strong> ${trace.fechaConsulta}</div>
        <div style="margin-top: 4px; color: #d35400;"><strong>Nota Trazable:</strong> ${trace.disclaimer}</div>
      </div>
    </details>
  `;
}

/**
 * Renderiza las tarjetas de cultivo
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

    const finalLat = lat;
    const finalLng = lng;

    const subregion = key ? await findSubregion(key, finalLat, finalLng) : null;

    const soilReport = await getSoilReport(finalLat, finalLng, subregion?.suelo);
    const climateReport = await getClimateData(finalLat, finalLng, provinciaRaw, subregion?.clima);

    const listadoCultivos = provDetails?.nombre?.cultivos || provDetails?.cultivos || null;

    if (!listadoCultivos || !Array.isArray(listadoCultivos) || listadoCultivos.length === 0) {
      container.innerHTML = `
        <div class="unavailable-card-block" style="grid-column: 1 / -1; padding: 25px; text-align: center;">
          <span style="font-size: 2rem; display: block; margin-bottom: 8px;">🌾</span>
          <h3>CULTIVOS DISPONIBLES: NO DISPONIBLE</h3>
          <p class="explanation" style="max-width: 500px; margin: 8px auto; font-size: 0.9rem;">
            No se dispone de un listado oficial o registrado de cultivos para la provincia o jurisdicción correspondiente a las coordenadas seleccionadas.
          </p>
        </div>
      `;
      return;
    }

    const recomendaciones = await generateRecommendations(listadoCultivos, soilReport, climateReport);

    container.innerHTML = recomendaciones.map(c => {
      let badgeClass = "badge-alta";
      if (c.compatibilidad === "MEDIA") badgeClass = "badge-media";
      if (c.compatibilidad === "BAJA") badgeClass = "badge-baja";

      let icon = "🌱";
      const nom = c.nombre.toLowerCase();
      if (nom.includes("trigo") || nom.includes("cebada") || nom.includes("avena")) icon = "🌾";
      else if (nom.includes("soja") || nom.includes("poroto")) icon = "🫛";
      else if (nom.includes("maiz") || nom.includes("sorgo")) icon = "🌽";
      else if (nom.includes("mani")) icon = "🥜";
      else if (nom.includes("pino") || nom.includes("eucalyptus")) icon = "🌲";
      else if (nom.includes("vid")) icon = "🍇";
      else if (nom.includes("citrus") || nom.includes("limon")) icon = "🍊";

      return `
        <article class="crop-card">
          <!-- Capa 1: Resumen -->
          <div class="crop-card-header" style="flex-wrap: wrap; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span class="crop-icon">${icon}</span>
              <div>
                <h3 style="margin: 0; font-weight: 700; text-transform: capitalize;">${c.nombre}</h3>
                <span class="badge-origin ${c.nivelConfianza === 'high' ? 'real' : 'regional'}">${c.confianza}</span>
              </div>
            </div>
            <div>
              <span class="compatibility-badge ${badgeClass}">Compatibilidad: ${c.compatibilidad}</span>
            </div>
          </div>

          <p class="desc"><strong>¿Qué significa esto para mí?</strong><br>${c.descripcion}</p>

          <!-- Capa 2: Detalle Técnico -->
          <div class="crop-grid-details">
            <div class="sub-card calendar-sub-card">
              <h4>📅 Calendario Agrícola</h4>
              <div style="margin-top: 5px;"><strong>Siembra:</strong> ${c.siembra}</div>
              <div><strong>Cosecha:</strong> ${c.cosecha}</div>
            </div>

            <div class="sub-card req-sub-card">
              <h4>🌱 Requerimientos</h4>
              <div style="margin-top: 5px;"><strong>Suelo:</strong> ${c.reqSuelo}</div>
              <div style="margin-top: 4px;"><strong>Clima:</strong> ${c.reqClima}</div>
            </div>
          </div>

          <!-- Variedades Trazables -->
          ${c.variedades && c.variedades.length > 0 ? `
          <div style="background: rgba(0,0,0,0.02); border: 1px solid var(--borde-suave); border-radius: 8px; padding: 10px; margin-bottom: 12px; font-size: 0.82rem;">
            <strong style="color: var(--verde-principal);">🧬 Variedades Documentadas:</strong>
            <ul style="margin: 4px 0 0 0; padding-left: 16px;">
              ${c.variedades.map(v => `<li>${v}</li>`).join('')}
            </ul>
            ${c.fuenteVariedades ? `<span style="font-size:0.75rem; color:var(--texto-secundario); display:block; margin-top:4px;">Fuente: ${c.fuenteVariedades}</span>` : ''}
          </div>
          ` : ''}

          <!-- Reporte de Evidencia -->
          <div class="compatibility-report premium-report">
            <div class="report-header">
              <span>📍</span> Factores de Análisis
            </div>
            <div class="report-body">
              <div class="report-block">
                <strong>💡 Factores Favorables:</strong>
                <ul>${c.motivos.map(m => `<li>${m}</li>`).join("")}</ul>
              </div>
              ${c.riesgos && c.riesgos.length > 0 ? `
              <div class="report-block">
                <strong>⚠️ Limitantes / Riesgos:</strong>
                <ul>${c.riesgos.map(r => `<li>${r}</li>`).join("")}</ul>
              </div>
              ` : ''}
              ${c.datosFaltantes && c.datosFaltantes.length > 0 ? `
              <div class="report-block" style="font-size:0.8rem; color:#7f8c8d;">
                <strong>ℹ️ Datos Faltantes / Aportar en Terreno:</strong>
                <ul>${c.datosFaltantes.map(df => `<li>${df}</li>`).join("")}</ul>
              </div>
              ` : ''}
            </div>
          </div>

          <!-- Capa 3: Fuente, Metodología y Limitaciones -->
          <details style="background: rgba(0,0,0,0.02); border: 1px solid var(--borde-suave); border-radius: 8px; padding: 8px 12px; font-size: 0.82rem;">
            <summary style="cursor: pointer; font-weight: bold; color: var(--verde-principal);">
              ℹ️ Ver Fuente, Metodología y Limitaciones
            </summary>
            <div style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--borde-suave); color: var(--texto-secundario); line-height: 1.4;">
              <div><strong>Fuente de Suelo:</strong> ${soilReport.fuente || 'INTA Cartografía Regional'}</div>
              <div><strong>Fuente Climática:</strong> ${climateReport.liveWeatherPoint?.available ? 'Open-Meteo API en tiempo real' : 'SMN Climatología Histórica'}</div>
              <div><strong>Nivel Espacial:</strong> ${geoVal?.spatialLevel || currentSpatialLevel}</div>
              <div><strong>Metodología:</strong> Evaluación edafoclimática reproducible sin puntuaciones ni matrices artificiales.</div>
              <div style="margin-top: 4px;"><strong>Limitación:</strong> No reemplaza la inspección agronómica de campo ni análisis físico de laboratorio.</div>
            </div>
          </details>
        </article>
      `;
    }).join("");
  } catch (err) {
    console.error("ERROR in renderRecomendaciones:", err);
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
        No se encontraron registros geográficos reales en los servicios de datos abiertos para <strong>"${queryTexto}"</strong>.
      </p>
      <p style="font-size: 0.85rem; color: var(--texto-secundario); margin-top: 15px;">
        Por favor, verificá el nombre ingresado o seleccioná directamente un punto en el mapa interactivo.
      </p>
    </div>
  `;

  if (container) container.innerHTML = msg;
  if (detailsContainer) detailsContainer.innerHTML = msg;
}

/**
 * Limpia el estado de la UI y evidencias previas para garantizar una consulta estricta y limpia
 */
export function limpiarEstadoConsultasAnteriores() {
  activeEvidenceImage = null;

  const evidenceCard = document.getElementById("evidence-results-card");
  if (evidenceCard) {
    evidenceCard.style.display = "none";
    evidenceCard.innerHTML = "";
  }

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

window.limpiarEstadoConsultasAnteriores = limpiarEstadoConsultasAnteriores;
window.procesarSeleccionCoordenadas = procesarSeleccionCoordenadas;
window.inicializarMapa = inicializarMapa;
window.renderRecomendaciones = renderRecomendaciones;
window.buscarYProcesarUbicacion = buscarYProcesarUbicacion;

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

  const periodSelect = document.getElementById("select-climate-period");
  if (periodSelect) {
    periodSelect.addEventListener("change", async () => {
      if (currentLat !== null && currentLng !== null) {
        await renderHistoriaClimaticaUI(currentLat, currentLng, currentUbicacionNombre);
      }
    });
  }

  // Configurar input de Evidencia Fotográfica en la UI
  const evidenceFileInput = document.getElementById("evidence-file-input");
  if (evidenceFileInput) {
    evidenceFileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const analysis = await analyzeUploadedImage(file);
      renderFichaEvidenciaUI(analysis);
    });
  }

  setTimeout(async () => {
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
      // Estado inicial limpio sin ubicación predeterminada ni fallbacks
      const tituloUbicacion = document.getElementById("resultado_ubicacion");
      if (tituloUbicacion) tituloUbicacion.innerText = "Sin seleccionar";

      const detailsContainer = document.getElementById("territory-details");
      if (detailsContainer) {
        detailsContainer.innerHTML = `
          <div class="empty-state">
            <span style="font-size: 2rem;">📍</span>
            <p><strong>Sin ubicación seleccionada</strong></p>
            <p class="text-muted" style="font-size: 0.85rem;">Ingresá una localidad, seleccioná un punto del mapa o utilizá tu ubicación GPS para comenzar.</p>
          </div>
        `;
      }

      const cropContainer = document.getElementById("crop-results");
      if (cropContainer) {
        cropContainer.innerHTML = `
          <div class="empty-state card" style="grid-column: 1 / -1; text-align: center; padding: 30px;">
            <span style="font-size: 2.5rem; display: block; margin-bottom: 10px;">🌱</span>
            <h3>Sin ubicación seleccionada</h3>
            <p class="text-muted">Ingresá una localidad, seleccioná un punto del mapa o utilizá tu ubicación GPS para comenzar.</p>
          </div>
        `;
      }

      const climateContainer = document.getElementById("climate-history-content");
      if (climateContainer) {
        climateContainer.innerHTML = `
          <div class="empty-state" style="text-align: center; padding: 20px;">
            <span style="font-size: 2rem;">📊</span>
            <p><strong>DATOS CLIMÁTICOS NO DISPONIBLES</strong></p>
            <p class="text-muted" style="font-size: 0.85rem;">Seleccioná una ubicación para consultar la serie climática histórica de NASA POWER.</p>
          </div>
        `;
      }
    }
  }, 100);
}

function renderFichaEvidenciaUI(evidence) {
  const container = document.getElementById("evidence-results-card");
  if (!container) return;

  activeEvidenceImage = evidence;

  container.style.display = "block";
  container.innerHTML = `
    <h3 style="margin-top: 0; color: var(--verde-principal); display: flex; align-items: center; gap: 8px;">
      <span>📷</span> Ficha de Evidencia de Campo Aportada por el Usuario
    </h3>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 15px; margin-top: 15px;">
      <div>
        <img src="${evidence.previewUrl}" alt="Foto de Campo" style="width: 100%; height: 200px; object-fit: cover; border-radius: 8px; border: 1px solid var(--borde-suave);" />
        <div style="font-size: 0.78rem; color: var(--texto-secundario); margin-top: 6px;">
          <strong>Archivo:</strong> ${evidence.filename} (${evidence.dimensions})
        </div>
      </div>

      <div>
        <h4 style="margin: 0 0 8px 0; color: var(--verde-principal); font-size: 0.95rem;">📌 Metadatos Extraídos (EXIF)</h4>
        <div style="font-size: 0.85rem; line-height: 1.5; color: var(--texto-principal);">
          <div><strong>Fecha de Captura:</strong> ${evidence.exif?.date || 'NO DISPONIBLE'}</div>
          <div><strong>GPS EXIF:</strong> ${evidence.exif?.hasGps ? `Lat: ${evidence.exif.gps.lat.toFixed(4)}, Lng: ${evidence.exif.gps.lng.toFixed(4)}` : 'NO DISPONIBLE / No contiene metadatos GPS'}</div>
          <div><strong>Cámara / Dispositivo:</strong> ${evidence.exif?.camera || 'NO DISPONIBLE'}</div>
        </div>

        <h4 style="margin: 12px 0 6px 0; color: var(--verde-principal); font-size: 0.95rem;">👁️ Análisis de Imagen Real</h4>
        <div style="font-size: 0.82rem; line-height: 1.4;">
          <div style="margin-bottom: 6px;">
            <strong style="color: #2e7d32;">OBSERVADO EN IMAGEN:</strong>
            <p style="margin: 2px 0 0 0; color: var(--texto-secundario);">${evidence.visualAnalysis?.observado}</p>
          </div>
          <div style="margin-bottom: 6px;">
            <strong style="color: #ef6c00;">INFERIDO:</strong>
            <p style="margin: 2px 0 0 0; color: var(--texto-secundario);">${evidence.visualAnalysis?.inferido}</p>
          </div>
          <div>
            <strong style="color: #c62828;">NO DETERMINABLE:</strong>
            <p style="margin: 2px 0 0 0; color: var(--texto-secundario);">${evidence.visualAnalysis?.noDeterminable}</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
