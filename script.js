/* ============================================================================
   script.js — UI Orchestrator ES Module — Agro Consultas
   ============================================================================ */

import { normalizeKey } from './utils/normalization.js';
import {
  findProvinceByCoords,
  findSubregion,
  getProvinceDetails
} from './services/territoryService.js?v=20261118-crops-fix';
import { calculateArea, calculateCentroid } from './forestal/utils/geo.js';
import { getClimateData } from './services/climateService.js';
import { getSoilReport } from './services/soilService.js';
import { generateRecommendations, loadCultivosData, getCropCatalog, getCropsToEvaluate, getForestToEvaluate } from './services/recommendationEngine.js?v=20261118-crops-fix';
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
import { getSentinel1SarAnalysis } from './forestal/services/satelliteService.js';
import { MapViewer } from './services/mapViewer.js';
import { setLotContext, getLotContext, clearLotContext, onLotContextChange } from './services/lotContext.js';

let mapViewerInstance = null;
let currentMarker = null;
let userLocationCircle = null;
let drawnPolygonLayer = null;
let suitabilityOverlayLayer = null;
let gaezMapOverlayLayer = null;

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

let climateHistoryCache = { key: null, promise: null, result: null };

async function getClimateHistoryCached(lat, lng, months = 12) {
  const key = `${Number(lat).toFixed(4)}:${Number(lng).toFixed(4)}:${months}`;
  if (climateHistoryCache.key === key) {
    if (climateHistoryCache.result) return climateHistoryCache.result;
    if (climateHistoryCache.promise) return climateHistoryCache.promise;
  }
  const promise = getClimateHistory(lat, lng, months);
  climateHistoryCache = { key, promise, result: null };
  try {
    const result = await promise;
    if (climateHistoryCache.key === key) climateHistoryCache = { key, promise: null, result };
    return result;
  } catch (error) {
    const result = { status: 'UNAVAILABLE', message: error.message, data: null };
    if (climateHistoryCache.key === key) climateHistoryCache = { key, promise: null, result };
    return result;
  }
}

function buildClimateEvidenceForScoring(climateReport, climateHistory) {
  const historical = climateHistory?.data?.historicalAverages || {};
  const temperature = Number(historical.temperaturaMediaHistoricaC);
  const precipitation = Number(historical.precipitacionMediaAnualMm);
  const hasHistoricalValues = climateHistory?.status === 'REAL' &&
    Number.isFinite(temperature) && Number.isFinite(precipitation);

  if (!hasHistoricalValues) {
    return {
      ...climateReport,
      temperaturaMediaVal: null,
      precipitacionesAnualesVal: null,
      climatologyStatus: 'UNAVAILABLE',
      climatologySource: null
    };
  }

  return {
    ...climateReport,
    temperaturaMediaVal: temperature,
    precipitacionesAnualesVal: precipitation,
    climatologyStatus: 'REAL',
    climatologySource: 'NASA POWER',
    climatologyBaseline: '2001–2020'
  };
}

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

  const renderDraft = () => {
    mainDrawMarkerLayers.forEach(layer => leafletMap.removeLayer(layer));
    mainDrawMarkerLayers = [];
    mainDrawPoints.forEach((point, index) => {
      const marker = L.circleMarker([point[1], point[0]], { radius: 6, color: '#27ae60', fillColor: '#2ecc71', fillOpacity: 1 }).addTo(leafletMap);
      marker.bindPopup(`Vértice ${index + 1}`);
      mainDrawMarkerLayers.push(marker);
    });
    if (drawnPolygonLayer) { leafletMap.removeLayer(drawnPolygonLayer); drawnPolygonLayer = null; }
    if (mainDrawPoints.length > 1) {
      const line = L.polyline(mainDrawPoints.map(p => [p[1], p[0]]), { color: '#27ae60', weight: 2, dashArray: '5 5' }).addTo(leafletMap);
      mainDrawMarkerLayers.push(line);
    }
    const btnDraw = document.getElementById('btn-start-draw-main');
    if (btnDraw) btnDraw.innerText = isDrawingMainLot ? `✏️ ${mainDrawPoints.length} vértices · cerrar cuando quieras` : '✏️ Dibujar Lote';
  };

  const closeDraft = () => {
    if (mainDrawPoints.length < 3) return alert('Agregá al menos 3 vértices antes de cerrar el lote.');
    const ring = [...mainDrawPoints, mainDrawPoints[0]];
    const feature = { type: 'Feature', properties: { name: `Lote dibujado (${mainDrawPoints.length} vértices)`, source: 'map-drawing' }, geometry: { type: 'Polygon', coordinates: [ring] } };
    try {
      const saved = setLotContext(feature, { source: 'map-drawing' });
      currentAOIPolygon = saved.geometry;
      const areaCalc = calculateArea(saved.geometry);
      if (drawnPolygonLayer) leafletMap.removeLayer(drawnPolygonLayer);
      drawnPolygonLayer = L.geoJSON(saved, { style: { color: '#27ae60', weight: 3, fillColor: '#2ecc71', fillOpacity: 0.3 } }).addTo(leafletMap);
      drawnPolygonLayer.bindPopup(`Lote seleccionado · ${areaCalc.hectares} ha · ${mainDrawPoints.length} vértices`);
      isDrawingMainLot = false;
      mainDrawMarkerLayers.forEach(layer => leafletMap.removeLayer(layer));
      mainDrawMarkerLayers = [];
      const btnDraw = document.getElementById('btn-start-draw-main');
      if (btnDraw) btnDraw.innerText = '✏️ Redibujar lote';
      const center = drawnPolygonLayer.getBounds().getCenter();
      procesarSeleccionCoordenadas(center.lat, center.lng, `Lote dibujado (${areaCalc.hectares} ha)`, 'LOTE / POLÍGONO');
    } catch (error) { alert(error.message); }
  };

  leafletMap.on('click', (e) => {
    if (!isDrawingMainLot) return;
    mainDrawPoints.push([e.latlng.lng, e.latlng.lat]);
    renderDraft();
    const clearBtn = document.getElementById('btn-clear-draw-main');
    if (clearBtn) clearBtn.style.display = 'inline-block';
  });

  const btnDrawMain = document.getElementById('btn-start-draw-main');
  const btnClearMain = document.getElementById('btn-clear-draw-main');
  if (btnDrawMain) {
    btnDrawMain.addEventListener('click', () => {
      if (isDrawingMainLot && mainDrawPoints.length >= 3) return closeDraft();
      if (!isDrawingMainLot) {
        isDrawingMainLot = true;
        mainDrawPoints = [];
        currentAOIPolygon = null;
        if (drawnPolygonLayer) { leafletMap.removeLayer(drawnPolygonLayer); drawnPolygonLayer = null; }
      }
      renderDraft();
      if (btnClearMain) btnClearMain.style.display = 'inline-block';
      if (mainDrawPoints.length === 0) alert('Modo dibujo activo. Tocá el mapa para agregar todos los vértices que necesites. Volvé a pulsar este botón para cerrar el polígono cuando tengas al menos 3.');
    });
  }
  if (btnClearMain) {
    btnClearMain.addEventListener('click', () => {
      if (isDrawingMainLot && mainDrawPoints.length) {
        mainDrawPoints.pop();
        renderDraft();
        return;
      }
      isDrawingMainLot = false;
      mainDrawPoints = [];
      mainDrawMarkerLayers.forEach(layer => leafletMap.removeLayer(layer));
      mainDrawMarkerLayers = [];
      if (drawnPolygonLayer) { leafletMap.removeLayer(drawnPolygonLayer); drawnPolygonLayer = null; }
      currentAOIPolygon = null;
      clearLotContext();
      btnClearMain.style.display = 'none';
      if (btnDrawMain) btnDrawMain.innerText = '✏️ Dibujar Lote';
    });
    btnClearMain.innerText = '↶ Deshacer vértice / limpiar lote';
  }

  const sharedLot = getLotContext();
  if (sharedLot) {
    currentAOIPolygon = sharedLot.geometry;
    drawnPolygonLayer = L.geoJSON(sharedLot, { style: { color: '#27ae60', weight: 3, fillColor: '#2ecc71', fillOpacity: 0.25 } }).addTo(leafletMap);
    leafletMap.fitBounds(drawnPolygonLayer.getBounds(), { padding: [24, 24] });
    const centroid = calculateCentroid(sharedLot);
    if (centroid) {
      await procesarSeleccionCoordenadas(
        centroid.lat,
        centroid.lng,
        sharedLot.properties?.name || 'Lote seleccionado',
        'LOTE / POLÍGONO'
      );
    }
  }

  onLotContextChange(async feature => {
    if (!leafletMap) return;
    if (!feature) {
      if (drawnPolygonLayer) leafletMap.removeLayer(drawnPolygonLayer);
      drawnPolygonLayer = null;
      currentAOIPolygon = null;
      isDrawingMainLot = false;
      mainDrawPoints = [];
      mainDrawMarkerLayers.forEach(layer => leafletMap.removeLayer(layer));
      mainDrawMarkerLayers = [];
      if (userLocationCircle) leafletMap.removeLayer(userLocationCircle);
      userLocationCircle = null;
      currentLat = null;
      currentLng = null;
      currentUbicacionNombre = 'Sin seleccionar';
      currentSpatialLevel = 'LOCALIDAD / PUNTO DE REFERENCIA';
      const territoryDetails = document.getElementById('territory-details');
      if (territoryDetails) territoryDetails.innerHTML = '';
      lastRecommendationsCache = [];
      lastSoilReportCache = null;
      lastClimateReportCache = null;
      if (currentMarker) leafletMap.removeLayer(currentMarker);
      currentMarker = null;
      if (suitabilityOverlayLayer) leafletMap.removeLayer(suitabilityOverlayLayer);
      suitabilityOverlayLayer = null;
      await renderRecomendaciones('Sin seleccionar', null, null);
      await renderHistoriaClimaticaUI(null, null, '');
      return;
    }
    if (JSON.stringify(currentAOIPolygon) === JSON.stringify(feature.geometry)) return;
    currentAOIPolygon = feature.geometry;
    if (gaezMapOverlayLayer && leafletMap.hasLayer(gaezMapOverlayLayer)) leafletMap.removeLayer(gaezMapOverlayLayer);
    gaezMapOverlayLayer = null;
    const gaezResult = document.getElementById("gaez-map-result");
    if (gaezResult) gaezResult.textContent = "Cambió el lote. Volvé a ejecutar GAEZ para actualizar la capa.";
    isDrawingMainLot = false;
    mainDrawPoints = [];
    mainDrawMarkerLayers.forEach(layer => leafletMap.removeLayer(layer));
    mainDrawMarkerLayers = [];
    if (userLocationCircle) leafletMap.removeLayer(userLocationCircle);
    userLocationCircle = null;
    if (drawnPolygonLayer) leafletMap.removeLayer(drawnPolygonLayer);
    drawnPolygonLayer = L.geoJSON(feature, {
      style: { color: '#27ae60', weight: 3, fillColor: '#2ecc71', fillOpacity: 0.25 }
    }).addTo(leafletMap);
    const bounds = drawnPolygonLayer.getBounds();
    if (bounds.isValid()) leafletMap.fitBounds(bounds, { padding: [24, 24] });
    const centroid = calculateCentroid(feature);
    if (centroid) {
      await procesarSeleccionCoordenadas(
        centroid.lat,
        centroid.lng,
        feature.properties?.name || 'Lote seleccionado',
        'LOTE / POLÍGONO'
      );
    }
  });

  // Renderizar panel de control de capas en el contenedor
  const layerContainer = document.getElementById("map-layer-controls-container");
  if (layerContainer) {
    mapViewerInstance.renderControlPanel("map-layer-controls-container");
  }

  await inicializarControlesGAEZ(leafletMap);

  const btnGeo = document.getElementById("btn-geolocalizar");
  if (btnGeo) {
    btnGeo.addEventListener("click", usarGeolocalizacion);
  }


  if (isSpecificUbicacion) {
    await buscarYProcesarUbicacion(provinciaRaw);
  }
}

async function inicializarControlesGAEZ(leafletMap) {
  const root = document.getElementById("gaez-map-controls");
  if (!root || root.dataset.initialized === "true") return;
  root.dataset.initialized = "true";

  const fields = [
    { id: "gaez-mapset", key: "mapset_code", option: "mapset_codes", preferred: "RES05-SIX" },
    { id: "gaez-crop", key: "crop", option: "crops", preferred: "MZE" },
    { id: "gaez-period", key: "period", option: "periods", preferred: "HP0120" },
    { id: "gaez-climate", key: "climate_data_source", option: "climate_data_sources", preferred: "AgERA5" },
    { id: "gaez-ssp", key: "ssp", option: "ssps", preferred: "HIST" },
    { id: "gaez-input", key: "input_level", option: "input_levels", preferred: "HRLM" }
  ];
  const cropLabels = {
    ALF: "Alfalfa", AVOC: "Palta", BAN: "Banana", BCK: "Trigo sarraceno", MAI: "Maíz",
    BRL: "Cebada", CAB: "Repollo", CAR: "Zanahoria", CIT: "Cítricos",
    CSV: "Mandioca", MZE: "Maíz", MZS: "Maíz para silo", OAT: "Avena",
    RCW: "Arroz inundado", RCD: "Arroz de secano", SFL: "Girasol",
    SOY: "Soja", TEA: "Té", TOM: "Tomate", WHE: "Trigo"
  };
  const cropCodesByName = {
    maiz: "MZE", soja: "SOY", trigo: "WHE", arroz: "RCW",
    naranja: "CIT", mandarina: "CIT", citricos: "CIT", mandioca: "CSV",
    te: "TEA", girasol: "SFL", avena: "OAT", tomate: "TOM",
    alfalfa: "ALF", banana: "BAN"
  };
  const status = document.getElementById("gaez-map-status");
  const result = document.getElementById("gaez-map-result");
  const runButton = document.getElementById("gaez-map-run");
  const clearButton = document.getElementById("gaez-map-clear");

  const clearOverlay = () => {
    if (gaezMapOverlayLayer && leafletMap.hasLayer(gaezMapOverlayLayer)) leafletMap.removeLayer(gaezMapOverlayLayer);
    gaezMapOverlayLayer = null;
    const legend = document.getElementById("gaez-map-legend");
    if (legend) legend.textContent = "";
  };

  function preferredCropCode() {
    const selected = document.getElementById("selectCropFilter")?.value;
    if (selected && selected !== "todos") {
      const normalized = normalizeKey(selected);
      return cropCodesByName[normalized] || null;
    }
    return "MZE";
  }

  async function refreshOptions(startIndex = 0) {
    for (let index = startIndex; index < fields.length; index += 1) {
      const params = new URLSearchParams();
      fields.slice(0, index).forEach(field => {
        const value = document.getElementById(field.id)?.value;
        if (value) params.set(field.key, value);
      });
      const response = await fetch("/api/territorial/gaez/catalog?" + params.toString());
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail?.message || payload.detail || "No se pudo cargar el catálogo FAO GAEZ v5.");
      const field = fields[index];
      const select = document.getElementById(field.id);
      if (!select) continue;
      const previous = select.value;
      let options = payload.options?.[field.option] || [];

      // This control is specifically for crop suitability, not evapotranspiration,
      // water deficit or unrelated GAEZ indicators.
      if (field.id === "gaez-mapset") options = options.filter(value => value === "RES05-SIX");

      select.replaceChildren();
      options.forEach(value => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = field.id === "gaez-mapset"
          ? "RES05-SIX · Índice de aptitud (toda la celda)"
          : field.id === "gaez-crop"
            ? `${cropLabels[value] || value} (${value})`
            : value;
        select.appendChild(option);
      });

      const preferred = field.id === "gaez-crop" ? (preferredCropCode() || field.preferred) : field.preferred;
      if (options.includes(previous)) select.value = previous;
      else if (options.includes(preferred)) select.value = preferred;
      else if (options.length) select.value = options[0];
      select.disabled = options.length === 0;
    }
  }

  fields.forEach((field, index) => {
    document.getElementById(field.id)?.addEventListener("change", async () => {
      try {
        status.textContent = "Actualizando combinaciones disponibles…";
        clearOverlay();
        await refreshOptions(index + 1);
        status.textContent = "Producto de aptitud actualizado. GAEZ tiene resolución regional; no equivale a una medición dentro del lote.";
      } catch (error) {
        status.textContent = error.message;
      }
    });
  });

  document.getElementById("selectCropFilter")?.addEventListener("change", async () => {
    const code = preferredCropCode();
    const cropSelect = document.getElementById("gaez-crop");
    if (code && cropSelect && Array.from(cropSelect.options).some(option => option.value === code)) {
      cropSelect.value = code;
      await refreshOptions(2);
      status.textContent = `GAEZ configurado para ${cropLabels[code] || code}. Podés cambiar el cultivo en el selector GAEZ.`;
    } else if (document.getElementById("selectCropFilter")?.value !== "todos") {
      status.textContent = "Ese cultivo no tiene un código equivalente en el catálogo GAEZ v5. Elegí un cultivo disponible en el selector GAEZ para consultar la capa.";
    }
  });

  runButton?.addEventListener("click", async () => {
    if (!currentAOIPolygon || !["Polygon", "MultiPolygon"].includes(currentAOIPolygon.type)) {
      result.textContent = "Primero dibujá, importá o seleccioná un lote poligonal en este mapa.";
      return;
    }
    const body = { geometry: currentAOIPolygon };
    fields.forEach(field => {
      body[field.key] = document.getElementById(field.id)?.value || null;
    });
    if (body.mapset_code !== "RES05-SIX") {
      result.textContent = "Seleccioná el Índice de aptitud RES05-SIX.";
      return;
    }
    runButton.disabled = true;
    status.textContent = "Consultando FAO GAEZ v5 y calculando el resumen del área…";
    result.textContent = "Procesando las celdas GAEZ que intersectan el lote.";
    try {
      const response = await fetch("/api/territorial/gaez/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await response.json();
      if (!response.ok && payload.detail?.code === "GAEZ_NO_VALID_PIXELS") {
        const detail = payload.detail;
        result.replaceChildren();
        const explanation = document.createElement("p");
        explanation.textContent = detail.message || "La fuente no tiene celdas válidas para esta combinación.";
        result.appendChild(explanation);
        if (Array.isArray(detail.alternatives) && detail.alternatives.length) {
          const heading = document.createElement("strong");
          heading.textContent = "Combinaciones alternativas publicadas por FAO para este cultivo:";
          result.appendChild(heading);
          detail.alternatives.forEach(alternative => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "btn outline";
            button.style.margin = "6px 6px 0 0";
            button.textContent = [alternative.period, alternative.climate_data_source, alternative.ssp, alternative.input_level].join(" · ");
            button.addEventListener("click", async () => {
              document.getElementById("gaez-period").value = alternative.period;
              document.getElementById("gaez-climate").value = alternative.climate_data_source;
              document.getElementById("gaez-ssp").value = alternative.ssp;
              document.getElementById("gaez-input").value = alternative.input_level;
              try {
                await refreshOptions(2);
                runButton.click();
              } catch (optionError) {
                status.textContent = optionError.message;
              }
            });
            result.appendChild(button);
          });
        } else {
          const note = document.createElement("p");
          note.textContent = "El catálogo no ofrece otra combinación para este cultivo. Elegí otro cultivo GAEZ o consultá el período histórico si está disponible.";
          result.appendChild(note);
        }
        status.textContent = "GAEZ no tiene valores válidos en este lote para la combinación elegida. No equivale a aptitud cero.";
        return;
      }
      if (!response.ok) throw new Error(payload.detail?.message || payload.detail || "No se pudo procesar el índice de aptitud FAO.");
      if (!payload.map_overlay?.image_data_url || !payload.map_overlay?.bounds) {
        throw new Error("FAO respondió sin una imagen cartográfica válida para esta selección.");
      }
      clearOverlay();
      gaezMapOverlayLayer = L.imageOverlay(
        payload.map_overlay.image_data_url,
        payload.map_overlay.bounds,
        { opacity: 0.82, interactive: false, alt: "Índice de aptitud agroecológica FAO GAEZ v5" }
      ).addTo(leafletMap);
      if (drawnPolygonLayer?.bringToFront) drawnPolygonLayer.bringToFront();
      const stats = payload.statistics;
      const legend = document.getElementById("gaez-map-legend");
      if (legend) legend.textContent = "Índice de aptitud FAO · valores del ráster";
      result.textContent = [
        "Fuente: FAO/IIASA GAEZ v5 · RES05-SIX (índice de aptitud de toda la celda).",
        "Cultivo: " + (cropLabels[body.crop] || body.crop) + " (" + body.crop + ")",
        "Período: " + body.period + " · Clima: " + body.climate_data_source + " · Escenario: " + body.ssp,
        "Manejo / agua: " + body.input_level,
        "Media del área intersectada: " + Number(stats.mean).toLocaleString("es-AR", { maximumFractionDigits: 2 }),
        "Mediana: " + Number(stats.median).toLocaleString("es-AR", { maximumFractionDigits: 2 }),
        "Rango: " + Number(stats.minimum).toLocaleString("es-AR", { maximumFractionDigits: 2 }) + " – " + Number(stats.maximum).toLocaleString("es-AR", { maximumFractionDigits: 2 }),
        "Celdas válidas intersectadas: " + Number(stats.pixel_count).toLocaleString("es-AR"),
        payload.interpretation_limit
      ].join("\n");
      status.textContent = "Capa GAEZ aplicada al mapa. La resolución del modelo es regional: no describe variaciones internas de parcelas pequeñas.";
    } catch (error) {
      result.textContent = error.message;
      status.textContent = "No se pudo generar la capa GAEZ.";
    } finally {
      runButton.disabled = false;
    }
  });

  clearButton?.addEventListener("click", () => {
    clearOverlay();
    result.textContent = "Se quitó la capa GAEZ del mapa.";
    status.textContent = "La capa está desactivada.";
  });

  try {
    status.textContent = "Cargando el catálogo de aptitud FAO GAEZ v5…";
    await refreshOptions(0);
    status.textContent = "Índice de aptitud listo. Seleccioná un lote para superponer la referencia agroecológica FAO.";
  } catch (error) {
    status.textContent = error.message;
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

    const forestCount = Object.values(catalogo).filter(item => item.categoria === "Forestal" || item.pino_eucalyptus).length;
    let html = `<option value="todos">🌱 Todos los perfiles (${cropCount} agrícolas / ${forestCount} forestales)</option>`;
    const keys = Object.keys(catalogo).sort((a, b) => (catalogo[a].nombre || a).localeCompare(catalogo[b].nombre || b));
    const agriculturalKeys = keys.filter(k => catalogo[k].categoria !== "Forestal" && !catalogo[k].pino_eucalyptus);
    const forestryKeys = keys.filter(k => catalogo[k].categoria === "Forestal" || catalogo[k].pino_eucalyptus);

    html += '<optgroup label="Agrícolas, hortícolas y frutícolas">';
    agriculturalKeys.forEach(k => {
      const item = catalogo[k];
      html += `<option value="${k}">${item.nombre}</option>`;
    });
    html += '</optgroup><optgroup label="Forestales">';
    forestryKeys.forEach(k => {
      const item = catalogo[k];
      html += `<option value="${k}">${item.nombre}</option>`;
    });
    html += '</optgroup>';

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
    // No usar polygonGeoJSON: no existe en este flujo. Solo enviar el polígono activo si la selección es un lote.
    const sarGeometry = currentSpatialLevel === "LOTE / POLÍGONO" ? currentAOIPolygon : null;
    await renderSarRadarUI(currentLat, currentLng, sarGeometry);
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
    const locationTitle = document.getElementById("resultado_ubicacion");
    if (locationTitle) locationTitle.innerText = currentUbicacionNombre;

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
    // Ejecutar SAR también cuando la selección llega desde el mapa/GPS (no solo desde el buscador).
    // Enviar el polígono únicamente cuando la selección actual corresponde al lote dibujado.
    const sarGeometry = currentSpatialLevel === "LOTE / POLÍGONO" ? currentAOIPolygon : null;
    await renderSarRadarUI(currentLat, currentLng, sarGeometry);
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

    const soilBadgeText = soilReport.status === DataStatus.REAL ? 'Consulta cartográfica INTA' : 'Referencia regional';
    const climateBadgeText = climateReport.liveWeatherPoint?.available ? 'Estimación meteorológica puntual (Open-Meteo)' : 'Referencia regional / no disponible';

    const levelText = geoVal?.spatialLevel || currentSpatialLevel || "PUNTO DE REFERENCIA";

    detailsContainer.innerHTML = `
      <div class="info-item">
        <strong>📍 Contexto Territorial de Ubicación (PUNTO)</strong>
        <span style="font-weight: 600; color: var(--verde-principal);">${provincia}</span>
        <span style="font-size: 0.8rem; display: block; color: var(--texto-secundario); margin-top: 4px;">Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}</span>
        <span style="font-size: 0.8rem; display: block; color: var(--texto-secundario); margin-top: 2px;">Provincia asignada por referencia geográfica más cercana; no es una verificación por límites administrativos.</span>
        ${subregion?.nombre ? `<span style="font-size: 0.8rem; display: block; color: var(--texto-secundario); margin-top: 3px;">Zona de referencia agroambiental más cercana: <strong>${subregion.nombre}</strong> (perfil regional, no límite cartográfico).</span>` : ""}
      </div>

      <div style="background: rgba(2, 119, 189, 0.08); border: 1px solid rgba(2, 119, 189, 0.25); border-radius: 8px; padding: 10px; margin-bottom: 12px; font-size: 0.8rem; line-height: 1.4; color: var(--texto-principal);">
        <strong>ℹ️ Escala Geográfica:</strong> Clima y suelos se consultan para este punto representativo. Si seleccionaste un lote, estos valores no son estadísticas zonales de toda su superficie. La provincia se aproxima por coordenadas de referencia, no por intersección con límites administrativos.
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
      ${soilReport.fuente && !/perfil agroambiental de referencia de agro consultas|sin fuente primaria asociada|fuente no disponible/i.test(soilReport.fuente) ? `
      <div class="info-item">
        <strong>Fuente:</strong>
        <span style="font-size:0.8rem; color: var(--texto-secundario);">${soilReport.fuente}</span>
      </div>` : ""}
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
        <p><strong>Serie climática histórica de NASA POWER</strong></p>
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

  const climateHistory = await getClimateHistoryCached(lat, lng, months);

  if (climateHistory.status === 'UNAVAILABLE' || !climateHistory.data) {
    const detail = String(climateHistory.message || '')
      .replace(/^NO DISPONIBLE\\s*[—-]\\s*/i, '')
      .trim();
    container.innerHTML = `
      <div style="background: var(--gris-card); border: 1px solid var(--borde-suave); border-radius: 8px; padding: 15px;">
        <h4 style="margin: 0 0 6px 0; color: var(--texto-principal);">Serie histórica de NASA POWER</h4>
        <p style="margin: 0; font-size: 0.85rem; color: var(--texto-secundario);">La consulta de la serie histórica para estas coordenadas no pudo completarse. ${detail || 'Reintentá la consulta más tarde.'}</p>
      </div>
    `;
    return;
  }

  const d = climateHistory.data;
  const periodStart = d.traceability?.periodoMensual?.inicio || d.monthlyBreakdown?.[0]?.monthKey || null;
  const periodEnd = d.traceability?.periodoMensual?.fin || d.monthlyBreakdown?.[d.monthlyBreakdown.length - 1]?.monthKey || null;
  const periodCount = d.traceability?.periodoMensual?.cantidadRegistros || d.monthlyBreakdown?.length || months;
  const periodLabel = periodStart && periodEnd
    ? periodCount + ' meses consolidados (' + periodStart + ' a ' + periodEnd + ')'
    : periodCount + ' meses mensuales consolidados';
  const tempDiffBadge = d.comparison.temperaturaAnomalia > 0 ? 'badge-baja' : 'badge-alta';
  const precDiffBadge = d.comparison.precipitacionesDiferenciaPct >= 0 ? 'badge-alta' : 'badge-media';

  container.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 15px;">
      <div style="background: rgba(0,0,0,0.03); border: 1px solid var(--borde-suave); border-radius: 8px; padding: 12px;">
          <div style="font-size: 0.78rem; color: var(--texto-secundario); font-weight: 600;">🌧️ Precipitación acumulada · ${periodLabel}</div>
        <div style="font-size: 1.3rem; font-weight: 800; color: var(--verde-principal); margin: 4px 0;">${d.periodMetrics.precipitacionAcumuladaMm} mm</div>
          <div style="font-size: 0.8rem; color: var(--texto-principal);">Línea Base Histórica (2001–2020): ${d.historicalAverages.precipitacionMediaAnualMm} mm/año</div>
        <span class="compatibility-badge ${precDiffBadge}" style="display: inline-block; margin-top: 6px; font-size: 0.75rem;">${d.comparison.clasificacionPrecipitacion}</span>
      </div>

      <div style="background: rgba(0,0,0,0.03); border: 1px solid var(--borde-suave); border-radius: 8px; padding: 12px;">
          <div style="font-size: 0.78rem; color: var(--texto-secundario); font-weight: 600;">🌡️ Temperatura media · ${periodLabel}</div>
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
 * Renderiza la sección de Radar SAR Sentinel-1 (Banda C Todo Clima)
 */
export async function renderSarRadarUI(lat, lng, geom = null) {
  const container = document.getElementById("sar-radar-container");
  if (!container) return;

  if (lat === null || lng === null) {
    container.innerHTML = `
      <div class="empty-state" style="text-align: center; padding: 20px;">
        <span style="font-size: 2rem;">📡</span>
        <p><strong>Consulta radar Sentinel-1</strong></p>
        <p class="text-muted" style="font-size: 0.85rem;">Seleccioná una ubicación para iniciar el análisis radar Sentinel-1.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="text-align: center; padding: 20px;">
      <span style="font-size: 1.5rem; display: block; margin-bottom: 8px;">⏳</span>
      <p style="margin: 0; color: var(--texto-secundario); font-size: 0.9rem;">Consultando imágenes Radar SAR Sentinel-1 (Banda C todo clima)...</p>
    </div>
  `;

  const targetGeom = geom || { type: "Point", coordinates: [lng, lat] };
  const sarRes = await getSentinel1SarAnalysis(targetGeom);

  if (!sarRes || sarRes.status === "UNAVAILABLE" || !sarRes.stats) {
    container.innerHTML = `
      <div style="background: rgba(231, 76, 60, 0.08); border: 1px solid rgba(231, 76, 60, 0.3); border-radius: 8px; padding: 15px;">
        <h4 style="margin: 0 0 6px 0; color: #c0392b;">📡 OBSERVACIONES RADAR SAR PENDIENTES</h4>
        <p style="margin: 0; font-size: 0.85rem; color: var(--texto-secundario);">${sarRes?.message || 'No se pudieron recuperar escenas radar de la red AWS STAC para la ubicación seleccionada.'}</p>
      </div>
    `;
    return;
  }

  const s = sarRes.stats;
  const interp = sarRes.interpretation || {};

  container.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px;">
      <div style="background: rgba(0,0,0,0.03); border: 1px solid var(--borde-suave); border-radius: 8px; padding: 12px;">
        <div style="font-size: 0.78rem; color: var(--texto-secundario); font-weight: 600;">💧 Retrodispersión VV (polarización VV)</div>
        <div style="font-size: 1.3rem; font-weight: 800; color: #2980b9; margin: 4px 0;">${s.vv_mean_dB} dB</div>
        <div style="font-size: 0.8rem; color: var(--texto-principal);">${interp.sueloHumedad || 'Respuesta edáfica'}</div>
      </div>

      <div style="background: rgba(0,0,0,0.03); border: 1px solid var(--borde-suave); border-radius: 8px; padding: 12px;">
        <div style="font-size: 0.78rem; color: var(--texto-secundario); font-weight: 600;">🌿 Retrodispersión VH (polarización VH)</div>
        <div style="font-size: 1.3rem; font-weight: 800; color: var(--verde-principal); margin: 4px 0;">${s.vh_mean_dB} dB</div>
        <div style="font-size: 0.8rem; color: var(--texto-principal);">${interp.estructuraBiomasa || 'Estructura vegetativa'}</div>
      </div>

      <div style="background: rgba(0,0,0,0.03); border: 1px solid var(--borde-suave); border-radius: 8px; padding: 12px;">
        <div style="font-size: 0.78rem; color: var(--texto-secundario); font-weight: 600;">📊 Diferencia VH − VV (dB)</div>
        <div style="font-size: 1.3rem; font-weight: 800; color: #8e44ad; margin: 4px 0;">${s.vh_vv_ratio_dB} dB</div>
        <div style="font-size: 0.75rem; color: var(--texto-secundario); margin-top: 4px;">
          Equivale a 10·log₁₀(VH/VV); no es una medición directa de biomasa.<br>Escena: ${sarRes.productId ? sarRes.productId.slice(0, 25) + '...' : 'Sentinel-1 GRD'}<br>
          Fecha: ${sarRes.date} | Satélite: Sentinel-1A (Radar Banda C)
        </div>
      </div>
    </div>
  `;
}

/**
 * Renderiza la capa visual de aptitud del cultivo seleccionado en el mapa
 */

function actualizarCapaAptitudMapa(recomendaciones, lat, lng) {
  const aptitudeLegend = document.querySelector(".map-legend");
  const hasClassifiedResult = Array.isArray(recomendaciones) && recomendaciones.some(item =>
    /APTITUD ALTA|APTITUD MEDIA|APTITUD BAJA/.test(String(item?.compatibilidad || "").toUpperCase())
  );
  if (aptitudeLegend) aptitudeLegend.style.display = hasClassifiedResult ? "" : "none";
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
    textLabel = '📘 Perfil de referencia';
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

    const [soilReport, climateReport, climateHistory] = await Promise.all([
      getSoilReport(lat, lng, subregion?.suelo),
      getClimateData(lat, lng, provinciaRaw, subregion?.clima),
      getClimateHistoryCached(lat, lng, 12)
    ]);
    const climateEvidenceForScoring = buildClimateEvidenceForScoring(climateReport, climateHistory);

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
      const [candidatosAgricolas, candidatosForestales] = await Promise.all([
        getCropsToEvaluate(key, subregion),
        getForestToEvaluate(key)
      ]);
      cultivosAEvaluar = [...new Set([...candidatosAgricolas, ...candidatosForestales])];
    }

    if (!cultivosAEvaluar.length) {
      lastRecommendationsCache = [];
      container.innerHTML = `
        <div class="empty-state card" style="grid-column: 1 / -1; text-align: center; padding: 25px;">
          <span style="font-size: 2rem; display: block; margin-bottom: 8px;">🌱</span>
          <h3>No hay candidatos territoriales para esta ubicación</h3>
          <p class="text-muted">No se encontró un perfil de cultivos aplicable a la provincia o subregión seleccionada. No se mostrarán cultivos del catálogo nacional como si fueran recomendaciones locales.</p>
        </div>`;
      actualizarCapaAptitudMapa([], lat, lng);
      return;
    }

    const recomendaciones = await generateRecommendations(cultivosAEvaluar, soilReport, climateEvidenceForScoring);
    lastRecommendationsCache = recomendaciones;

    const filtradas = filtrarRecomendacionesPorCultivo(recomendaciones, selectedCropKey);
    renderRecommendationsCards(filtradas, soilReport, climateReport, geoVal);
    actualizarCapaAptitudMapa(filtradas, lat, lng);

  } catch (err) {
    console.error("ERROR in renderRecomendaciones:", err);
    lastRecommendationsCache = [];
    container.innerHTML = `
      <div class="empty-state card" style="grid-column: 1 / -1; text-align: center; padding: 25px;">
        <span style="font-size: 2rem; display: block; margin-bottom: 8px;">⚠️</span>
        <h3>No se pudo completar la evaluación territorial</h3>
        <p class="text-muted" style="font-size:0.88rem;">Una o más fuentes o servicios no respondieron. No se reemplazará la ubicación seleccionada por recomendaciones genéricas. Reintentá la consulta más tarde.</p>
      </div>`;
  }
}

function createSingleRecommendationCardHtml(c) {
  let semaforoIcon = "🟢";
  let semaforoText = "Condiciones Favorables";
  let badgeClass = "badge-alta";
  const compatibility = String(c.compatibilidad || '').toUpperCase();
  const isReferenceProfile = compatibility.includes("INFORMACIÓN PENDIENTE") ||
    compatibility.includes("NO EVALUABLE") || compatibility.includes("INSUFFICIENT") ||
    compatibility.includes("DATOS INSUFICIENTES");
  const compatibilityLabel = isReferenceProfile ? "Perfil de referencia" : (c.compatibilidad || semaforoText);
  const factorText = c.motivos?.[0] ||
    (isReferenceProfile
      ? "Incluido en el catálogo provincial; falta evidencia para clasificar aptitud."
      : "Factores agroambientales compatibles.");
  const displayedMotives = c.motivos?.length
    ? c.motivos
    : ["No hay observaciones comparables disponibles para esta ficha."];

  if (isReferenceProfile) {
    semaforoIcon = "📘";
    semaforoText = "Perfil de referencia";
    badgeClass = "badge-origin";
  } else if (compatibility.includes("BAJA") || compatibility.includes("LIMITACIONES SEVERAS")) {
    semaforoIcon = "🔴";
    semaforoText = "Atención / Restricciones";
    badgeClass = "badge-baja";
  } else if (compatibility.includes("MEDIA") || compatibility.includes("PRESENTA LIMITANTES")) {
    semaforoIcon = "🟡";
    semaforoText = "Limitaciones Moderadas";
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
          <strong>💡 Factor Clave:</strong> ${factorText}
          ${c.riesgos && c.riesgos.length > 0 ? `<div style="margin-top: 4px; color: #c0392b;"><strong>⚠️ Limitante Principal:</strong> ${c.riesgos[0]}</div>` : ''}
          ${c.datosFaltantes && c.datosFaltantes.length > 0 ? `<div style="margin-top: 6px;"><strong>Datos que faltan para clasificar:</strong><ul style="margin:4px 0 0 18px;padding:0;">${c.datosFaltantes.map(item => `<li>${item}</li>`).join("")}</ul></div>` : ''}
        </div>

        <div style="font-size: 0.8rem; color: var(--texto-secundario); display: flex; justify-content: space-between;">
          <span>📅 Siembra: <strong>${c.siembra}</strong></span>
          <span>🌾 Cosecha: <strong>${c.cosecha}</strong></span>
        </div>
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
            <span class="compatibility-badge ${badgeClass}">${compatibilityLabel}</span>
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
              <ul>${displayedMotives.map(m => `<li>${m}</li>`).join("")}</ul>
            </div>
            ${c.riesgos && c.riesgos.length > 0 ? `
            <div class="report-block" style="color: #c0392b;">
              <strong>⚠️ Limitantes / Riesgos:</strong>
              <ul>${c.riesgos.map(r => `<li>${r}</li>`).join("")}</ul>
            </div>
            ` : ''}
            ${c.datosFaltantes && c.datosFaltantes.length ? `
            <div class="report-block" style="color:var(--texto-secundario);">
              <strong>Datos que faltan para clasificar:</strong>
              <ul>${c.datosFaltantes.map(item => `<li>${item}</li>`).join("")}</ul>
            </div>` : ''}
            ${isReferenceProfile ? `
            <div class="report-block" style="color:var(--texto-secundario);">
              <strong>Alcance del perfil:</strong>
              <p>La especie figura en el catálogo provincial. Esta ficha describe sus requerimientos; no constituye una recomendación de implantación.</p>
            </div>
            ` : ''}
          </div>
        </div>
      </article>
    `;
  }
}

function renderRecommendationsCards(recomendaciones) {
  const container = document.getElementById("crop-results");
  if (!container) return;

  const candidates = Array.isArray(recomendaciones) ? recomendaciones : [];
  const evaluables = candidates.filter(c => {
    const status = String(c?.compatibilidad || "").toUpperCase();
    return status && !status.includes("INFORMACIÓN PENDIENTE") &&
      !status.includes("NO EVALUABLE") && !status.includes("DATOS INSUFICIENTES") &&
      !status.includes("INSUFFICIENT");
  });
  const pendientes = candidates.filter(c => !evaluables.includes(c));

  if (!candidates.length) {
    container.innerHTML = `
      <div class="empty-state card" style="grid-column:1/-1;text-align:center;padding:24px;">
        <span style="font-size:2rem;display:block;margin-bottom:8px;">🌱</span>
        <h3>No encontramos cultivos para evaluar en esta referencia territorial</h3>
        <p class="text-muted">Probá otra ubicación o seleccioná un cultivo concreto. No se completará la lista con especies de regiones no relacionadas.</p>
      </div>`;
    return;
  }

  const pendingNotice = pendientes.length ? `
    <div class="card" style="grid-column:1/-1;padding:12px 15px;border-left:4px solid #8a9691;">
      <strong>Perfiles que requieren más evidencia</strong>
      <p class="text-muted" style="margin:5px 0 0;font-size:.86rem;">Se muestran como referencia territorial, no como recomendaciones de implantación. La aptitud no pudo clasificarse con la evidencia disponible para este punto.</p>
    </div>` : "";

  container.innerHTML = `
    ${pendingNotice}
    <div style="grid-column:1/-1;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;">
      ${evaluables.map(createSingleRecommendationCardHtml).join("")}
      ${pendientes.map(createSingleRecommendationCardHtml).join("")}
    </div>`;
}

function mostrarErrorUbicacionNoEncontrada(queryTexto) {
  const container = document.getElementById("crop-results");
  const detailsContainer = document.getElementById("territory-details");
  const tituloUbicacion = document.getElementById("resultado_ubicacion");

  if (tituloUbicacion) tituloUbicacion.innerText = queryTexto;

  const msg = `
    <div class="unavailable-card-block" style="grid-column: 1 / -1; padding: 30px; text-align: center;">
      <span style="font-size: 2.5rem; display: block; margin-bottom: 10px;">🔍</span>
      <h3 style="color: var(--texto-principal); margin-top: 0;">No encontramos esa ubicación</h3>
      <p class="explanation" style="max-width: 500px; margin: 10px auto;">
        Georef no devolvió una jurisdicción para <strong>"${queryTexto}"</strong>. Revisá el nombre o seleccioná un punto directamente en el mapa.
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

      let haVal = 'N/A';
      let geomParam = '';

      if (currentAOIPolygon) {
        const areaCalc = calculateArea(currentAOIPolygon);
        if (areaCalc && areaCalc.hectares) {
          haVal = areaCalc.hectares;
        }
        geomParam = `&geom=${encodeURIComponent(JSON.stringify(currentAOIPolygon))}`;
      }

      const shareUrl = `${baseUrl}?lat=${currentLat.toFixed(5)}&lng=${currentLng.toFixed(5)}&nombre=${encodeURIComponent(currentUbicacionNombre)}&ha=${haVal}${geomParam}`;

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
              <div>📅 EXIF Fecha: ${imgItem.exif?.date || 'Sin fecha EXIF'}</div>
              <div>📍 EXIF GPS: ${imgItem.exif?.hasGps ? `Lat ${imgItem.exif.gps.lat.toFixed(4)}, Lng ${imgItem.exif.gps.lng.toFixed(4)}` : 'Sin coordenadas GPS'}</div>
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
