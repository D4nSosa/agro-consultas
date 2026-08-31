/* ============================================================================
   script.js — UI Orchestrator ES Module — Agro Consultas v1.0
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
import { DataStatus } from './utils/dataModel.js';

let mapInstance = null;
let currentMarker = null;
let subregionesLayers = [];
let userLocationCircle = null;
let watchPositionId = null;

// Variables para el Simulador de Lote
let simuladorValoresPersonalizados = null;
let currentUbicacionNombre = "Argentina";
let currentLat = -38.4161;
let currentLng = -63.6167;
let currentRadioKm = 15;

/**
 * Inicializa el mapa interactivo de Leaflet
 */
export async function inicializarMapa(provinciaRaw) {
  const mapElement = document.getElementById("map");
  if (!mapElement) return;

  let defaultLat = -38.4161;
  let defaultLng = -63.6167;
  let defaultZoom = 4;

  let coords = null;
  const isSpecificUbicacion = provinciaRaw && provinciaRaw.trim() !== "" && provinciaRaw !== "Argentina";

  if (isSpecificUbicacion) {
    const key = normalizeKey(provinciaRaw);
    coords = await getProvinceCoordinates(key);
    if (coords) {
      defaultLat = coords.lat;
      defaultLng = coords.lng;
      defaultZoom = coords.zoom;
      currentLat = coords.lat;
      currentLng = coords.lng;
      currentUbicacionNombre = provinciaRaw;
    }
  }

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

  if (isSpecificUbicacion && coords) {
    const key = normalizeKey(provinciaRaw);
    colocarMarcador(defaultLat, defaultLng, provinciaRaw);
    await dibujarSubregionesColoreadas(key);
  }

  mapInstance.on('click', (e) => {
    const { lat, lng } = e.latlng;
    procesarSeleccionCoordenadas(lat, lng);
  });

  const btnGeo = document.getElementById("btn-geolocalizar");
  if (btnGeo) {
    btnGeo.addEventListener("click", usarGeolocalizacion);
  }

  const selectAlcance = document.getElementById("select-alcance-radio");
  if (selectAlcance) {
    selectAlcance.addEventListener("change", (e) => {
      currentRadioKm = parseFloat(e.target.value) || 15;
      if (currentLat && currentLng) {
        dibujarCirculoAlcance(currentLat, currentLng, currentRadioKm);
      }
    });
  }
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
 * Dibuja círculos interactivos para cada subregión
 */
export async function dibujarSubregionesColoreadas(provinciaKey) {
  if (!mapInstance) return;

  subregionesLayers.forEach(layer => mapInstance.removeLayer(layer));
  subregionesLayers = [];

  const provDetails = await getProvinceDetails(provinciaKey);
  if (!provDetails) return;

  try {
    const response = await fetch('/data/regiones.json');
    if (!response.ok) return;
    const regionesData = await response.json();
    const subregiones = regionesData.subregiones[provinciaKey];

    if (!subregiones) return;

    subregiones.forEach(sub => {
      const aptitud = (sub.suelo.aptitud || '').toLowerCase();

      let color = '#3498db';
      if (aptitud.includes('pino') || aptitud.includes('eucalyptus') || aptitud.includes('silvicultura') || aptitud.includes('forestal')) {
        color = '#2ecc71';
      } else if (aptitud.includes('soja') || aptitud.includes('maiz') || aptitud.includes('trigo') || aptitud.includes('cebada') || aptitud.includes('sorgo')) {
        color = '#f1c40f';
      } else if (aptitud.includes('citrus') || aptitud.includes('limon') || aptitud.includes('naranja') || aptitud.includes('banana')) {
        color = '#e67e22';
      } else if (aptitud.includes('vid') || aptitud.includes('olivo') || aptitud.includes('nogal')) {
        color = '#9b59b6';
      } else if (aptitud.includes('horticultura') || aptitud.includes('lechuga') || aptitud.includes('huertas')) {
        color = '#1abc9c';
      }

      const circle = L.circle([sub.lat, sub.lng], {
        color: color,
        fillColor: color,
        fillOpacity: 0.5,
        radius: 35000
      }).addTo(mapInstance);

      circle.bindPopup(`
        <div style="font-family: Arial, sans-serif; font-size: 0.9rem;">
          <strong style="color: ${color}; font-size: 1rem;">${sub.nombre}</strong><br>
          <strong>Aptitud:</strong> ${sub.suelo.aptitud}<br>
          <strong>Suelo:</strong> ${sub.suelo.tipo} (${sub.suelo.textura})<br>
          <span style="font-size: 0.8rem; color: #7f8c8d;">Haz click para seleccionar subregión</span>
        </div>
      `);

      circle.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        procesarSeleccionCoordenadas(sub.lat, sub.lng);
      });

      subregionesLayers.push(circle);
    });
  } catch (e) {
    console.warn("Error al cargar regiones:", e);
  }
}

/**
 * Procesa la selección de coordenadas
 */
export async function procesarSeleccionCoordenadas(lat, lng) {
  currentLat = lat;
  currentLng = lng;

  if (mapInstance && mapInstance.getZoom() < 9) {
    mapInstance.setView([lat, lng], 10);
  }

  dibujarCirculoAlcance(lat, lng, currentRadioKm);

  const provinciaKey = await findProvinceByCoords(lat, lng);
  if (!provinciaKey) return;

  const provDetails = await getProvinceDetails(provinciaKey);
  const nombreProvinciaBonito = provDetails ? provDetails.nombre?.cultivos ? provinciaKey.charAt(0).toUpperCase() + provinciaKey.slice(1) : provDetails.nombre || provinciaKey : provinciaKey;

  const nombreFormateado = nombreProvinciaBonito.split(" ")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  currentUbicacionNombre = nombreFormateado;

  colocarMarcador(lat, lng, nombreFormateado);

  await renderRecomendaciones(nombreFormateado, lat, lng);
  await dibujarSubregionesColoreadas(provinciaKey);
  await actualizarPanelTerritorialBasico(nombreFormateado, lat, lng);
}

/**
 * Actualiza el panel lateral con datos de coordenadas y trazabilidad
 */
export async function actualizarPanelTerritorialBasico(provincia, lat, lng) {
  const detailsContainer = document.getElementById("territory-details");
  if (!detailsContainer) return;

  try {
    const key = normalizeKey(provincia);
    const subregion = await findSubregion(key, lat, lng);

    const subregionStaticSuelo = subregion ? subregion.suelo : null;
    const subregionStaticClima = subregion ? subregion.clima : null;

    const soilReport = await getSoilReport(lat, lng, subregionStaticSuelo, simuladorValoresPersonalizados);
    const climateReport = await getClimateData(lat, lng, provincia, subregionStaticClima);

    let nombreTerritorio = provincia;
    if (subregion) {
      nombreTerritorio = `${provincia} (${subregion.nombre})`;
    }

    const isSoilSim = soilReport.status === DataStatus.SIMULATED || soilReport.esSimulado;
    const soilBadgeClass = soilReport.status === DataStatus.REAL ? 'badge-real' : (isSoilSim ? 'badge-simulado' : 'badge-regional');
    const soilBadgeText = soilReport.status === DataStatus.REAL ? 'REAL (INTA WMS)' : (isSoilSim ? 'DEMO / SIMULADO' : 'ESTIMACIÓN REGIONAL');

    const climateBadgeClass = climateReport.liveWeatherPoint?.available ? 'badge-real' : 'badge-regional';
    const climateBadgeText = climateReport.liveWeatherPoint?.available ? 'REAL (Open-Meteo)' : 'DATOS REGIONALES';

    detailsContainer.innerHTML = `
      <div class="info-item">
        <strong>📍 Ubicación Seleccionada</strong>
        <span style="font-weight: 600; color: var(--verde-principal);">${nombreTerritorio}</span>
        <span style="font-size: 0.8rem; display: block; color: var(--texto-secundario);">(Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)})</span>
        <span style="font-size: 0.8rem; display: block; color: var(--verde-principal); font-weight: 600; margin-top: 2px;">🎯 Alcance de Análisis: ${currentRadioKm} km alrededor</span>
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
          ${climateReport.alertas && climateReport.alertas.length > 0 ? `
            <div style="margin-top: 8px; padding: 6px; background: rgba(198, 40, 40, 0.1); border: 1px solid #c62828; border-radius: 6px; font-size: 0.8rem; color: #c62828;">
              ⚠️ <strong>Alerta:</strong> ${climateReport.alertas[0].titulo} - ${climateReport.alertas[0].descripcion}
            </div>
          ` : ''}
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
      <div class="info-item">
        <strong>Aptitud Productiva:</strong>
        <span>${soilReport.aptitud}</span>
      </div>

      <!-- Clima Regional -->
      <div class="info-section-title" style="margin: 15px 0 5px 0; font-weight: bold; border-bottom: 1px solid var(--borde-suave); padding-bottom: 3px; color: var(--verde-principal); font-size: 0.95rem;">
        🌦️ Datos Climáticos Regionales (SMN/Climatología)
      </div>
      <div class="info-item">
        <strong>Precipitaciones Medias:</strong>
        <span>${climateReport.precipitacionesAnuales}</span>
      </div>
      <div class="info-item">
        <strong>Temperatura Media:</strong>
        <span>${climateReport.temperaturaMedia}</span>
      </div>
      <div class="info-item">
        <strong>Riesgo de Heladas:</strong>
        <span>${climateReport.heladasPeriodo}</span>
      </div>

      <!-- Relieve -->
      <div class="info-section-title" style="margin: 15px 0 5px 0; font-weight: bold; border-bottom: 1px solid var(--borde-suave); padding-bottom: 3px; color: var(--verde-principal); font-size: 0.95rem;">
        🗺️ Geografía y Relieve (IGN)
      </div>
      <div class="info-item">
        <strong>Relieve y Topografía:</strong>
        <span>${subregion?.geografia?.relieve || "Ondulado suave"}</span>
      </div>
      <div class="info-item">
        <strong>Hidrografía y Cuencas:</strong>
        <span>${subregion?.geografia?.hidrografia || "Arroyos y ríos locales"}</span>
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
      let targetZoom = 12;
      if (currentRadioKm <= 5) targetZoom = 14;
      else if (currentRadioKm <= 15) targetZoom = 12;
      else if (currentRadioKm <= 35) targetZoom = 10;
      else targetZoom = 9;

      mapInstance.setView([latitude, longitude], targetZoom);
    }

    const label = accuracy ? `Mi Ubicación GPS (±${Math.round(accuracy)}m)` : 'Mi Ubicación GPS';
    colocarMarcador(latitude, longitude, label);

    procesarSeleccionCoordenadas(latitude, longitude);

    if (btnGeo) {
      btnGeo.disabled = false;
      const accLabel = accuracy ? ` (±${Math.round(accuracy)}m)` : '';
      btnGeo.innerText = `🟢 Ubicación GPS Activa${accLabel}`;
      btnGeo.style.background = "#27ae60";
    }
  };

  const handlePositionError = (error) => {
    console.warn("Error de geolocalización GPS:", error);
    let msg = "No se pudo obtener la ubicación GPS.";

    if (error.code === error.PERMISSION_DENIED) {
      msg = "Permiso de ubicación rechazado. Podés seleccionar manualmente un punto en el mapa.";
    } else if (error.code === error.POSITION_UNAVAILABLE) {
      msg = "La ubicación GPS no está disponible en tu dispositivo. Podés seleccionar manualmente un punto en el mapa.";
    } else if (error.code === error.TIMEOUT) {
      msg = "Tiempo de espera agotado al consultar GPS. Podés seleccionar manualmente un punto en el mapa.";
    }

    alert(msg);

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
 * Renderiza las tarjetas de cultivo utilizando el motor de recomendaciones.
 */
export async function renderRecomendaciones(provinciaRaw, lat, lng) {
  const container = document.getElementById("crop-results");
  const tituloUbicacion = document.getElementById("resultado_ubicacion");

  if (!container) return;

  if (tituloUbicacion) tituloUbicacion.innerText = provinciaRaw;

  try {
    const key = normalizeKey(provinciaRaw);
    const provDetails = await getProvinceDetails(key);

    if (!provDetails) {
      container.innerHTML = `
        <div class="error-msg">
          <p>Lo sentimos, no tenemos datos registrados para la provincia: <strong>${provinciaRaw}</strong>.</p>
        </div>`;
      return;
    }

    const finalLat = lat !== undefined ? lat : provDetails.coordenadas.lat;
    const finalLng = lng !== undefined ? lng : provDetails.coordenadas.lng;

    const subregion = await findSubregion(key, finalLat, finalLng);
    const subregionStaticSuelo = subregion ? subregion.suelo : null;
    const subregionStaticClima = subregion ? subregion.clima : null;

    const soilReport = await getSoilReport(finalLat, finalLng, subregionStaticSuelo, simuladorValoresPersonalizados);
    const climateReport = await getClimateData(finalLat, finalLng, provinciaRaw, subregionStaticClima);

    const listadoCultivos = provDetails.nombre?.cultivos || provDetails.cultivos || [];
    const recomendaciones = await generateRecommendations(listadoCultivos, soilReport, climateReport);

    container.innerHTML = recomendaciones.map(c => {
      let badgeClass = "badge-alta";
      if (c.compatibilidad === "MEDIA") badgeClass = "badge-media";
      if (c.compatibilidad === "BAJA") badgeClass = "badge-baja";

      let icon = "🌱";
      const nom = c.nombre.toLowerCase();
      if (nom.includes("trigo") || nom.includes("cebada") || nom.includes("avena") || nom.includes("centeno")) icon = "🌾";
      else if (nom.includes("soja") || nom.includes("poroto") || nom.includes("arveja")) icon = "🫛";
      else if (nom.includes("maiz") || nom.includes("sorgo")) icon = "🌽";
      else if (nom.includes("arroz")) icon = "🌾";
      else if (nom.includes("mani")) icon = "🥜";
      else if (nom.includes("girasol") || nom.includes("colza")) icon = "🌻";
      else if (nom.includes("pino") || nom.includes("eucalyptus") || nom.includes("sauce") || nom.includes("alamo") || nom.includes("forestacion")) icon = "🌲";
      else if (nom.includes("yerba")) icon = "🧉";
      else if (nom.includes("te")) icon = "🍵";
      else if (nom.includes("citrus") || nom.includes("limon") || nom.includes("naranja") || nom.includes("mandarina") || nom.includes("pomelo")) icon = "🍊";
      else if (nom.includes("vid")) icon = "🍇";
      else if (nom.includes("olivo")) icon = "🫒";

      return `
        <article class="crop-card">
          <div class="crop-card-header">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span class="crop-icon">${icon}</span>
              <h3 style="margin: 0; font-weight: 700; text-transform: capitalize;">${c.nombre}</h3>
            </div>
            <div style="display: flex; gap: 6px; align-items: center;">
              <span class="compatibility-badge ${badgeClass}">Compatibilidad: ${c.compatibilidad}</span>
              <span class="confidence-badge badge-${(c.nivelConfianza || 'medium').toLowerCase()}">Confianza: ${c.confianza || 'MEDIA'}</span>
            </div>
          </div>

          <p class="desc">${c.descripcion}</p>

          <div class="crop-grid-details">
            <div class="sub-card calendar-sub-card">
              <h4>📅 Calendario Agrícola</h4>
              <div style="margin-top: 5px;"><strong>Siembra:</strong> ${c.siembra}</div>
              <div><strong>Cosecha:</strong> ${c.cosecha}</div>
            </div>

            <div class="sub-card req-sub-card">
              <h4>🌱 Requerimientos de Cultivo</h4>
              <div style="margin-top: 5px;"><strong>Suelo:</strong> ${c.reqSuelo}</div>
              <div style="margin-top: 4px;"><strong>Clima:</strong> ${c.reqClima}</div>
            </div>
          </div>

          <div class="compatibility-report premium-report">
            <div class="report-header">
              <span style="font-size: 1.1rem;">📍</span> Reporte de Evidencia y Trazabilidad
            </div>
            <div class="report-body">
              <div class="report-block">
                <strong>💡 Factores de Éxito / Motivos:</strong>
                <ul>
                  ${c.motivos.map(m => `<li>${m}</li>`).join("")}
                </ul>
              </div>
              ${c.riesgos && c.riesgos.length > 0 ? `
              <div class="report-block">
                <strong>⚠️ Limitantes / Riesgos Identificados:</strong>
                <ul style="color: var(--texto-secundario);">
                  ${c.riesgos.map(r => `<li>${r}</li>`).join("")}
                </ul>
              </div>
              ` : ''}
              ${c.datosFaltantes && c.datosFaltantes.length > 0 ? `
              <div class="report-block" style="margin-top: 6px; font-size: 0.8rem; color: #7f8c8d;">
                <strong>ℹ️ Datos Faltantes / Estimados:</strong>
                <ul>
                  ${c.datosFaltantes.map(df => `<li>${df}</li>`).join("")}
                </ul>
              </div>
              ` : ''}
            </div>
          </div>

          <div class="sustainability-report premium-sustainability">
            <div class="sustainability-header">
              <span>🔄</span> Manejo Sostenible Recomendado
            </div>
            <div style="margin-top: 6px;"><strong>🚜 Rotación Recomendada:</strong> ${c.sostenibilidad.rotacion}</div>
            <div style="margin-top: 4px;"><strong>🌍 Conservación de Suelo:</strong> ${c.sostenibilidad.manejo}</div>
          </div>
        </article>
      `;
    }).join("");
  } catch (err) {
    console.error("ERROR in renderRecomendaciones:", err);
  }
}

// Registrar funciones globales
window.procesarSeleccionCoordenadas = procesarSeleccionCoordenadas;
window.inicializarMapa = inicializarMapa;
window.renderRecomendaciones = renderRecomendaciones;
window.analyzeLocation = analyzeLocation;

function renderEstadoInicialLimpio() {
  const tituloUbicacion = document.getElementById("resultado_ubicacion");
  const detailsContainer = document.getElementById("territory-details");
  const cropContainer = document.getElementById("crop-results");

  if (tituloUbicacion) {
    tituloUbicacion.innerText = "Ninguna ubicación seleccionada";
  }

  if (detailsContainer) {
    detailsContainer.innerHTML = `
      <div class="empty-state" style="padding: 20px 10px; text-align: center;">
        <span style="font-size: 2.5rem; display: block; margin-bottom: 8px;">📍</span>
        <strong style="display: block; font-size: 1rem; color: var(--verde-principal); margin-bottom: 5px;">
          Seleccioná una ubicación para comenzar el análisis.
        </strong>
        <p class="text-muted" style="font-size: 0.85rem; margin-bottom: 0;">
          Hacé click en cualquier punto del mapa, usá el botón "Usar Mi Ubicación" o realizá una búsqueda desde la página principal.
        </p>
      </div>
    `;
  }

  if (cropContainer) {
    cropContainer.innerHTML = `
      <div class="empty-state card" style="grid-column: 1 / -1; text-align: center; padding: 40px 20px;">
        <span style="font-size: 2.8rem; display: block; margin-bottom: 12px;">🌾</span>
        <h3 style="margin-top: 0; color: var(--verde-principal); font-weight: 700;">Seleccioná una ubicación para comenzar el análisis</h3>
        <p style="color: var(--texto-secundario); max-width: 500px; margin: 0 auto;">
          Seleccioná un punto específico sobre el mapa o usá tu geolocalización para obtener la evaluación de suelos, clima en vivo y aptitud agropecuaria.
        </p>
      </div>
    `;
  }
}

function initApp() {
  const params = new URLSearchParams(window.location.search);
  const rawUbic = params.get("ubicacion");
  const paramLat = params.get("lat");
  const paramLng = params.get("lng");

  const hasSpecificQuery = (rawUbic && rawUbic.trim() !== "" && rawUbic !== "Argentina") || (paramLat && paramLng);
  const ubic = rawUbic || "Argentina";

  const simPh = document.getElementById("sim-ph");
  const valPh = document.getElementById("val-ph");
  const simTextura = document.getElementById("sim-textura");
  const simDrenaje = document.getElementById("sim-drenaje");
  const simLimitantes = document.getElementById("sim-limitantes");
  const btnSimular = document.getElementById("btn-simular");
  const btnRestablecerSim = document.getElementById("btn-restablecer-sim");

  if (simPh && valPh) {
    simPh.addEventListener("input", (e) => {
      valPh.innerText = parseFloat(e.target.value).toFixed(1);
    });
  }

  if (btnSimular) {
    btnSimular.addEventListener("click", async () => {
      if (!currentLat || !currentLng || currentUbicacionNombre === "Argentina") {
        alert("Por favor, seleccioná primero una ubicación en el mapa.");
        return;
      }
      simuladorValoresPersonalizados = {
        ph: parseFloat(simPh.value),
        textura: simTextura.value,
        drenaje: simDrenaje.value,
        limitantes: simLimitantes.value
      };

      await renderRecomendaciones(currentUbicacionNombre, currentLat, currentLng);
      await actualizarPanelTerritorialBasico(currentUbicacionNombre, currentLat, currentLng);
    });
  }

  if (btnRestablecerSim) {
    btnRestablecerSim.addEventListener("click", async () => {
      simuladorValoresPersonalizados = null;
      if (simPh && valPh) {
        simPh.value = "6.0";
        valPh.innerText = "6.0";
      }
      if (simTextura) simTextura.value = "franca";
      if (simDrenaje) simDrenaje.value = "bueno";
      if (simLimitantes) simLimitantes.value = "ninguna";

      if (currentLat && currentLng && currentUbicacionNombre !== "Argentina") {
        await renderRecomendaciones(currentUbicacionNombre, currentLat, currentLng);
        await actualizarPanelTerritorialBasico(currentUbicacionNombre, currentLat, currentLng);
      }
    });
  }

  setTimeout(async () => {
    await inicializarMapa(hasSpecificQuery ? ubic : null);

    if (paramLat && paramLng) {
      const latVal = parseFloat(paramLat);
      const lngVal = parseFloat(paramLng);
      if (!isNaN(latVal) && !isNaN(lngVal)) {
        await procesarSeleccionCoordenadas(latVal, lngVal);
        return;
      }
    }

    if (hasSpecificQuery && ubic && ubic !== "Argentina") {
      const key = normalizeKey(ubic);
      const coords = await getProvinceCoordinates(key);
      if (coords) {
        currentLat = coords.lat;
        currentLng = coords.lng;
        currentUbicacionNombre = ubic;
        await renderRecomendaciones(ubic, coords.lat, coords.lng);
        await actualizarPanelTerritorialBasico(ubic, coords.lat, coords.lng);
      } else {
        await renderRecomendaciones(ubic);
      }
    } else {
      renderEstadoInicialLimpio();
    }
  }, 100);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
