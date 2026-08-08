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

let mapInstance = null;
let currentMarker = null;
let subregionesLayers = [];

// Variables para el Simulador de Lote
let simuladorValoresPersonalizados = null;
let currentUbicacionNombre = "Argentina";
let currentLat = -38.4161;
let currentLng = -63.6167;

/**
 * Inicializa el mapa interactivo de Leaflet
 */
export async function inicializarMapa(provinciaRaw) {
  const mapElement = document.getElementById("map");
  if (!mapElement) return;

  // Centro por defecto: Argentina (Rosario/Córdoba aprox)
  let defaultLat = -38.4161;
  let defaultLng = -63.6167;
  let defaultZoom = 4;

  const key = normalizeKey(provinciaRaw);
  const coords = await getProvinceCoordinates(key);
  if (coords) {
    defaultLat = coords.lat;
    defaultLng = coords.lng;
    defaultZoom = coords.zoom;
    currentLat = coords.lat;
    currentLng = coords.lng;
    currentUbicacionNombre = provinciaRaw;
  }

  // Si ya existía una instancia de mapa, destruirla
  if (mapInstance) {
    mapInstance.remove();
    mapInstance = null;
  }

  // Crear la instancia de mapa
  mapInstance = L.map('map').setView([defaultLat, defaultLng], defaultZoom);

  // Agregar capa base de OpenStreetMap
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
  }).addTo(mapInstance);

  // Si hay una provincia seleccionada, colocar un marcador inicial y dibujar subregiones
  if (coords) {
    colocarMarcador(defaultLat, defaultLng, provinciaRaw);
    await dibujarSubregionesColoreadas(key);
  }

  // Evento de Click en el mapa
  mapInstance.on('click', (e) => {
    const { lat, lng } = e.latlng;
    procesarSeleccionCoordenadas(lat, lng);
  });

  // Inicializar geolocalización
  const btnGeo = document.getElementById("btn-geolocalizar");
  if (btnGeo) {
    btnGeo.addEventListener("click", usarGeolocalizacion);
  }
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
 * Dibuja círculos interactivos para cada subregión de la provincia seleccionada,
 * coloreándolos según su aptitud predominante.
 */
export async function dibujarSubregionesColoreadas(provinciaKey) {
  if (!mapInstance) return;

  // Limpiar capas anteriores
  subregionesLayers.forEach(layer => mapInstance.removeLayer(layer));
  subregionesLayers = [];

  const provDetails = await getProvinceDetails(provinciaKey);
  if (!provDetails) return;

  // Obtener subregiones para esta provincia desde regionesData
  const response = await fetch('/data/regiones.json');
  if (!response.ok) return;
  const regionesData = await response.json();
  const subregiones = regionesData.subregiones[provinciaKey];

  if (!subregiones) return;

  subregiones.forEach(sub => {
    const aptitud = (sub.suelo.aptitud || '').toLowerCase();

    // Determinar color en base a aptitud predominante
    let color = '#3498db'; // Azul por defecto (Riego/Vid/General)
    if (aptitud.includes('pino') || aptitud.includes('eucalyptus') || aptitud.includes('silvicultura') || aptitud.includes('forestal')) {
      color = '#2ecc71'; // Verde para forestal
    } else if (aptitud.includes('soja') || aptitud.includes('maiz') || aptitud.includes('trigo') || aptitud.includes('cebada') || aptitud.includes('sorgo')) {
      color = '#f1c40f'; // Amarillo para pampeano/cereales
    } else if (aptitud.includes('citrus') || aptitud.includes('limon') || aptitud.includes('naranja') || aptitud.includes('banana')) {
      color = '#e67e22'; // Naranja para citricos y frutales subtropicales
    } else if (aptitud.includes('vid') || aptitud.includes('olivo') || aptitud.includes('nogal')) {
      color = '#9b59b6'; // Purpura para vides y olivos de oasis
    } else if (aptitud.includes('horticultura') || aptitud.includes('lechuga') || aptitud.includes('huertas')) {
      color = '#1abc9c'; // Turquesa para horticultura urbana/protegida
    }

    // Dibujar círculo interactivo
    const circle = L.circle([sub.lat, sub.lng], {
      color: color,
      fillColor: color,
      fillOpacity: 0.5,
      radius: 35000 // Radio de 35 km para ser bien visible
    }).addTo(mapInstance);

    // Popup detallado al hacer click en el círculo
    circle.bindPopup(`
      <div style="font-family: Arial, sans-serif; font-size: 0.9rem;">
        <strong style="color: ${color}; font-size: 1rem;">${sub.nombre}</strong><br>
        <strong>Aptitud:</strong> ${sub.suelo.aptitud}<br>
        <strong>Suelo:</strong> ${sub.suelo.tipo} (${sub.suelo.textura})<br>
        <span style="font-size: 0.8rem; color: #7f8c8d;">Haz click aquí para seleccionar esta subregión</span>
      </div>
    `);

    // Al hacer click sobre la subregión, procesar coordenadas
    circle.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      procesarSeleccionCoordenadas(sub.lat, sub.lng);
    });

    subregionesLayers.push(circle);
  });
}

/**
 * Procesa la selección de coordenadas (ya sea por click o geolocalización)
 */
export async function procesarSeleccionCoordenadas(lat, lng) {
  currentLat = lat;
  currentLng = lng;

  const provinciaKey = await findProvinceByCoords(lat, lng);
  if (!provinciaKey) return;

  const provDetails = await getProvinceDetails(provinciaKey);
  const nombreProvinciaBonito = provDetails ? provDetails.nombre?.cultivos ? provinciaKey.charAt(0).toUpperCase() + provinciaKey.slice(1) : provDetails.nombre || provinciaKey : provinciaKey;

  // Encontrar el nombre bonito de la provincia (con capitalización correcta)
  const nombreFormateado = nombreProvinciaBonito.split(" ")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  currentUbicacionNombre = nombreFormateado;

  colocarMarcador(lat, lng, nombreFormateado);

  // Actualizar las recomendaciones de cultivos y la información territorial
  await renderRecomendaciones(nombreFormateado, lat, lng);
  await dibujarSubregionesColoreadas(provinciaKey);
  await actualizarPanelTerritorialBasico(nombreFormateado, lat, lng);
}

/**
 * Actualiza el panel lateral con datos de coordenadas y datos agroambientales integrados (Fase 2 + Fase A Subregiones)
 */
export async function actualizarPanelTerritorialBasico(provincia, lat, lng) {
  const detailsContainer = document.getElementById("territory-details");
  if (!detailsContainer) return;

  const key = normalizeKey(provincia);
  const subregion = await findSubregion(key, lat, lng);

  // Obtener reportes de suelo y clima
  const subregionStaticSuelo = subregion ? subregion.suelo : null;
  const subregionStaticClima = subregion ? subregion.clima : null;

  const soilReport = await getSoilReport(lat, lng, subregionStaticSuelo, simuladorValoresPersonalizados);
  const climateReport = await getClimateData(lat, lng, provincia, subregionStaticClima);

  let nombreTerritorio = provincia;
  if (subregion) {
    nombreTerritorio = `${provincia} (${subregion.nombre})`;
  }

  detailsContainer.innerHTML = `
    <div class="info-item">
      <strong>📍 Ubicación Seleccionada</strong>
      <span style="font-weight: 600; color: var(--verde-principal);">${nombreTerritorio}</span>
      <span style="font-size: 0.8rem; display: block; color: var(--texto-secundario);">(Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)})</span>
    </div>

    <!-- Clima en Vivo (Fase B) -->
    <div class="info-section-title" style="margin: 12px 0 5px 0; font-weight: bold; border-bottom: 1px solid var(--borde-suave); padding-bottom: 3px; color: var(--verde-principal); font-size: 0.95rem;">
      ⚡ Clima en Vivo (Open-Meteo)
    </div>
    <div id="live-weather-info">
      <div style="background: rgba(0,0,0,0.03); border: 1px solid var(--borde-suave); border-radius: 8px; padding: 10px; margin-top: 5px;">
        <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 4px;">
          <span>🌡️ <strong>Temp. Actual:</strong></span>
          <span>${climateReport.temperaturaActual}°C</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 4px;">
          <span>💨 <strong>Viento:</strong></span>
          <span>${climateReport.vientoActual} km/h</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
          <span>🌤️ <strong>Condición:</strong></span>
          <span>${climateReport.condicionActualTexto}</span>
        </div>
        ${climateReport.alertas.length > 0 ? `
          <div style="margin-top: 8px; padding: 6px; background: rgba(198, 40, 40, 0.1); border: 1px solid #c62828; border-radius: 6px; font-size: 0.8rem; color: #c62828;">
            ⚠️ <strong>Alerta SMN/En Vivo:</strong> ${climateReport.alertas[0].titulo} - ${climateReport.alertas[0].descripcion}
          </div>
        ` : ''}
      </div>
    </div>

    <div class="info-section-title" style="margin: 15px 0 5px 0; font-weight: bold; border-bottom: 1px solid var(--borde-suave); padding-bottom: 3px; color: var(--verde-principal); font-size: 0.95rem;">
      🌱 Propiedades del Suelo (INTA)
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

    <div class="info-section-title" style="margin: 15px 0 5px 0; font-weight: bold; border-bottom: 1px solid var(--borde-suave); padding-bottom: 3px; color: var(--verde-principal); font-size: 0.95rem;">
      🌦️ Datos Climáticos (SMN / Regional)
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
    <div class="info-item">
      <strong>Déficit Hídrico:</strong>
      <span>${climateReport.deficitHidrico}</span>
    </div>

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
    btnGeo.innerText = "📍 Buscando ubicación...";
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;

      if (mapInstance) {
        mapInstance.setView([latitude, longitude], 9);
      }
      procesarSeleccionCoordenadas(latitude, longitude);

      if (btnGeo) {
        btnGeo.disabled = false;
        btnGeo.innerText = "📍 Usar mi Geolocalización";
      }
    },
    (error) => {
      alert("No se pudo obtener la geolocalización. Asegúrate de otorgar permisos.");
      if (btnGeo) {
        btnGeo.disabled = false;
        btnGeo.innerText = "📍 Usar mi Geolocalización";
      }
    },
    { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
  );
}

/**
 * Renderiza las tarjetas de cultivo utilizando el motor de recomendaciones.
 */
export async function renderRecomendaciones(provinciaRaw, lat, lng) {
  console.log("renderRecomendaciones CALLED for", provinciaRaw, lat, lng);
  const container = document.getElementById("crop-results");
  const tituloUbicacion = document.getElementById("resultado_ubicacion");

  if (!container) return;

  if (tituloUbicacion) tituloUbicacion.innerText = provinciaRaw;

  try {
    const key = normalizeKey(provinciaRaw);
    const provDetails = await getProvinceDetails(key);
    console.log("provDetails in renderRecomendaciones:", provDetails);

    if (!provDetails) {
      container.innerHTML = `
        <div class="error-msg">
          <p>Lo sentimos, no tenemos datos registrados para la provincia: <strong>${provinciaRaw}</strong>.</p>
          <p>Asegúrate de escribir correctamente el nombre (ej. Córdoba, Buenos Aires, Santa Fe).</p>
        </div>`;
      return;
    }

    // Si no se pasaron coordenadas, usar centroide
    const finalLat = lat !== undefined ? lat : provDetails.coordenadas.lat;
    const finalLng = lng !== undefined ? lng : provDetails.coordenadas.lng;

    const subregion = await findSubregion(key, finalLat, finalLng);
    const subregionStaticSuelo = subregion ? subregion.suelo : null;
    const subregionStaticClima = subregion ? subregion.clima : null;

    // Obtener reportes consolidados
    const soilReport = await getSoilReport(finalLat, finalLng, subregionStaticSuelo, simuladorValoresPersonalizados);
    const climateReport = await getClimateData(finalLat, finalLng, provinciaRaw, subregionStaticClima);

    // Obtener listado de cultivos para esta provincia (de provinciaData)
    const listadoCultivos = provDetails.nombre?.cultivos || provDetails.cultivos || [];
    console.log("listadoCultivos in renderRecomendaciones:", listadoCultivos);

    // Generar recomendaciones enriquecidas
    const recomendaciones = await generateRecommendations(listadoCultivos, soilReport, climateReport);
    console.log("recomendaciones generated:", recomendaciones);

    container.innerHTML = recomendaciones.map(c => {
      let badgeClass = "badge-alta";
      if (c.compatibilidad === "MEDIA") badgeClass = "badge-media";
      if (c.compatibilidad === "BAJA") badgeClass = "badge-baja";

      // Icono correspondiente según cultivo
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
      else if (nom.includes("manzana")) icon = "🍎";
      else if (nom.includes("pera")) icon = "🍐";
      else if (nom.includes("cana")) icon = "🎋";
      else if (nom.includes("papa") || nom.includes("mandioca")) icon = "🥔";
      else if (nom.includes("quinoa")) icon = "🌾";
      else if (nom.includes("arandano")) icon = "🫐";
      else if (nom.includes("durazno") || nom.includes("ciruela")) icon = "🍑";
      else if (nom.includes("almendro") || nom.includes("nuez")) icon = "🌰";
      else if (nom.includes("ajo")) icon = "🧄";
      else if (nom.includes("lupulo")) icon = "🌿";
      else if (nom.includes("lavanda") || nom.includes("oregano")) icon = "🪻";
      else if (nom.includes("tomate") || nom.includes("pimiento")) icon = "🍅";
      else if (nom.includes("melon") || nom.includes("sandia")) icon = "🍉";

      return `
        <article class="crop-card">
          <div class="crop-card-header">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span class="crop-icon">${icon}</span>
              <h3 style="margin: 0; font-weight: 700; text-transform: capitalize;">${c.nombre}</h3>
            </div>
            <span class="compatibility-badge ${badgeClass}">${c.compatibilidad}</span>
          </div>

          <p class="desc">${c.descripcion}</p>

          <!-- Sub-cards internas para mejorar la visual de dashboard premium -->
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
              <span style="font-size: 1.1rem;">📍</span> Reporte de Compatibilidad Territorial
            </div>
            <div class="report-body">
              <div class="report-block">
                <strong>💡 Factores de Éxito / Motivos:</strong>
                <ul>
                  ${c.motivos.map(m => `<li>${m}</li>`).join("")}
                </ul>
              </div>
              <div class="report-block">
                <strong>⚠️ Limitantes / Riesgos Identificados:</strong>
                <ul style="color: var(--texto-secundario);">
                  ${c.riesgos.map(r => `<li>${r}</li>`).join("")}
                </ul>
              </div>
            </div>
          </div>

          <!-- Sección de Prácticas Sostenibles -->
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

// Registrar funciones de orquestación en window para retrocompatibilidad total (y tests Playwright)
window.procesarSeleccionCoordenadas = procesarSeleccionCoordenadas;
window.inicializarMapa = inicializarMapa;
window.renderRecomendaciones = renderRecomendaciones;

/* ============================================================================
   Inicialización de Eventos y DOM
   ============================================================================ */

document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const ubic = params.get("ubicacion") || "Argentina";

  // Inicialización del Simulador de Lote
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
    btnSimular.addEventListener("click", () => {
      simuladorValoresPersonalizados = {
        ph: parseFloat(simPh.value),
        textura: simTextura.value,
        drenaje: simDrenaje.value,
        limitantes: simLimitantes.value
      };

      renderRecomendaciones(currentUbicacionNombre, currentLat, currentLng);
      actualizarPanelTerritorialBasico(currentUbicacionNombre, currentLat, currentLng);
    });
  }

  if (btnRestablecerSim) {
    btnRestablecerSim.addEventListener("click", () => {
      simuladorValoresPersonalizados = null;
      if (simPh && valPh) {
        simPh.value = "6.0";
        valPh.innerText = "6.0";
      }
      if (simTextura) simTextura.value = "franca";
      if (simDrenaje) simDrenaje.value = "bueno";
      if (simLimitantes) simLimitantes.value = "ninguna";

      renderRecomendaciones(currentUbicacionNombre, currentLat, currentLng);
      actualizarPanelTerritorialBasico(currentUbicacionNombre, currentLat, currentLng);
    });
  }

  // Inicializar mapa de forma segura
  setTimeout(async () => {
    await inicializarMapa(ubic);

    // Si hay una provincia en la URL, cargar sus datos en el panel lateral e inicializar recomendaciones
    if (ubic && ubic !== "Argentina") {
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
    }
  }, 100);
});
