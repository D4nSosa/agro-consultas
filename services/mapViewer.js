/**
 * mapViewer.js — Visor Territorial Reutilizable y Control de Capas Extensible
 * Agro Consultas - Plataforma de Inteligencia Territorial
 */


const OFFICIAL_LAYER_RULES = {
  idecor: /suelo|soil|cobertura|uso.?del.?suelo|forest|bosque|hidrog|erosion|aptitud|agro|rural/i,
  idecorr: /suelo|soil|cobertura|uso.?del.?suelo|forest|bosque|hidrog|erosion|aptitud|agro|rural|incendio|agua/i,
  ign: /provincia|departamento|hidrog|ruta|camino|localidad|limite|l[ií]mite|red.?vial/i,
  inta: /suelo|soil|edaf|cartografia|aptitud|salin|ph|capacidad.?de.?uso/i,
  conae_saocom: /DSS_(MSM|PSM)(KR)?_[1-7]/i,
  conae_smap: /SMAP_Pasada/i,
  conae_fuel: /INC_SIARTIVGEO/i,
  conae_burned: /area.?quemada|burned|aqm|incendio/i,
  mapbiomas: /vegetation_unit|ecorregion|regiones_forestales|protected_areas/i
};

/** Returns true only for layers relevant to existing Agro/Forestal analysis. */
export function isRelevantOfficialLayer(provider, layer) {
  const rule = OFFICIAL_LAYER_RULES[provider];
  return Boolean(rule && rule.test([layer?.name, layer?.title, layer?.abstract].filter(Boolean).join(' ')));
}

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export const BASE_MAPS = {
  NORMAL: {
    id: 'normal',
    name: 'Mapa Normal (OpenStreetMap)',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: { maxZoom: 19, attribution: '© OpenStreetMap contributors | IGN Argentina' }
  },
  SATELLITE: {
    id: 'satellite',
    name: 'Imágenes Satelitales (Esri)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 18, attribution: 'Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community' }
  },
  RELIEF: {
    id: 'relief',
    name: 'Relieve / Terreno (OpenTopoMap)',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    options: { maxZoom: 17, attribution: 'Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap (CC-BY-SA)' }
  },
  TOPO_3D: {
    id: '3d_topo',
    name: 'Relieve Topográfico (Esri Topo)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 18, attribution: 'Tiles © Esri — Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, IGN, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), swisstopo, MapmyIndia, © OpenStreetMap contributors, and the GIS User Community' }
  },
  HYBRID: {
    id: 'hybrid',
    name: 'Vista Híbrida (Satelital + Etiquetas)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 18, attribution: 'Esri World Imagery + Boundaries' }
  }
};

export class MapViewer {
  constructor(elementId, options = {}) {
    this.elementId = elementId;
    this.options = options;
    this.map = null;
    this.baseLayers = {};
    this.overlayLayers = {};
    this.activeOverlays = new Set();
    this.currentBaseMode = 'normal';
    this.layerControlUI = null;
  }

  init(defaultCenter = [-38.4161, -63.6167], defaultZoom = 4) {
    const container = document.getElementById(this.elementId);
    if (!container) return null;

    if (this.map) {
      this.map.remove();
      this.map = null;
    }

    this.map = L.map(this.elementId, {
      center: defaultCenter,
      zoom: defaultZoom,
      zoomControl: true
    });

    // Registrar Capas Base
    this.baseLayers.normal = L.tileLayer(BASE_MAPS.NORMAL.url, BASE_MAPS.NORMAL.options);
    this.baseLayers.satellite = L.tileLayer(BASE_MAPS.SATELLITE.url, BASE_MAPS.SATELLITE.options);
    this.baseLayers.relief = L.tileLayer(BASE_MAPS.RELIEF.url, BASE_MAPS.RELIEF.options);
    this.baseLayers['3d_topo'] = L.tileLayer(BASE_MAPS.TOPO_3D.url, BASE_MAPS.TOPO_3D.options);

    // Híbrida combina satelital + grupo de transporte/límites
    const hybridSat = L.tileLayer(BASE_MAPS.HYBRID.url, BASE_MAPS.HYBRID.options);
    const hybridLabels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18 });
    const hybridPlaces = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18 });
    this.baseLayers.hybrid = L.layerGroup([hybridSat, hybridLabels, hybridPlaces]);

    // Añadir capa base por defecto
    this.baseLayers.normal.addTo(this.map);
    this.currentBaseMode = 'normal';

    L.control.scale({ imperial: false, metric: true }).addTo(this.map);
    // Discovery is asynchronous and non-blocking; no source layer is activated by default.
    this.discoverOfficialSourceOverlays();

    return this.map;
  }


  async discoverOfficialSourceOverlays() {
    if (!this.map || typeof L.tileLayer?.wms !== 'function') return;
    const providers = [
      { id: 'idecor', label: 'IDECOR Córdoba', category: 'Territorio · Córdoba' },
      { id: 'idecorr', label: 'IDECorr Corrientes', category: 'Territorio · Corrientes' },
      { id: 'ign', label: 'IGN Argentina', category: 'Cartografía oficial · Nacional' },
      { id: 'inta', label: 'INTA-CIRN', category: 'Suelos · Cartografía' },
      { id: 'mapbiomas', label: 'MapBiomas Argentina', category: 'Territorio · Vegetación y conservación' },
      { id: 'conae_saocom', label: 'CONAE SAOCOM', category: 'Suelo · Humedad' },
      { id: 'conae_smap', label: 'CONAE SMAP', category: 'Suelo · Humedad superficial' },
      { id: 'conae_fuel', label: 'CONAE Combustibles', category: 'Incendios · Combustibles' },
      { id: 'conae_burned', label: 'CONAE Áreas quemadas', category: 'Incendios · Área afectada' }
    ];
    await Promise.all(providers.map(async provider => {
      try {
        const response = await fetch('/api/sources/ogc/' + provider.id + '/wms', {
          headers: { Accept: 'application/json' }
        });
        if (!response.ok) {
          if (provider.id === 'idecorr' && response.status === 503) {
            console.info('[MapViewer] IDECorr no se incorpora: el servidor provincial debe corregir su certificado TLS.');
          }
          return;
        }
        const metadata = await response.json();
        const relevant = (metadata.layers || []).filter(layer =>
          isRelevantOfficialLayer(provider.id, layer)
        ).slice(0, provider.id === 'idecor' ? 8 : 14);
        for (const item of relevant) {
          const key = 'official_' + provider.id + '_' + item.name.replace(/[^a-z0-9_-]/gi, '_');
          if (this.overlayLayers[key]) continue;
          const attribution = provider.id === 'idecor'
            ? 'IDECOR · Cobertura: Córdoba, Argentina'
            : provider.id === 'idecorr'
              ? 'IDECorr · Cobertura: Corrientes, Argentina'
              : provider.id === 'ign'
                ? 'IGN · Cartografía oficial de Argentina'
                : provider.id === 'inta'
                  ? 'INTA-CIRN · Cobertura y escala según capa publicada'
                  : provider.id === 'mapbiomas'
                    ? 'MapBiomas Argentina · Capas contextuales; no son la serie anual de cobertura'
                    : 'CONAE · ' + provider.label;
          const layer = L.tileLayer.wms(metadata.endpoint, {
            layers: item.name,
            format: 'image/png',
            transparent: true,
            version: '1.1.1',
            attribution,
            opacity: 0.72
          });
          this.registerOverlayLayer(
            key,
            layer,
            provider.label + ' · ' + (item.title || item.name),
            true,
            provider.category
          );
        }
        const panel = this.options.layerControlContainerId;
        if (panel) this.renderControlPanel(panel);
      } catch (error) {
        console.warn('[MapViewer] No se pudieron descubrir capas oficiales ' + provider.id + ':', error);
      }
    }));
    // MapBiomas publishes annual Collection 3 tiles through its public platform API.
    // The backend validates the Google Earth Engine host and caches each requested year.
    try {
      const response = await fetch('/api/sources/mapbiomas/tiles/2025', {
        headers: { Accept: 'application/json' }
      });
      if (response.ok) {
        const metadata = await response.json();
        if (metadata.status === 'LIVE_XYZ_TILES' && metadata.tileUrlTemplate && !this.overlayLayers.official_mapbiomas_coverage_2025) {
          const layer = L.tileLayer(metadata.tileUrlTemplate, {
            maxZoom: 18,
            attribution: metadata.attribution + ' · MapBiomas Argentina',
            opacity: 0.78
          });
          this.registerOverlayLayer(
            'official_mapbiomas_coverage_2025',
            layer,
            'MapBiomas · Cobertura y uso 2025 · Colección 3 (30 m)',
            true,
            'Cobertura y uso del suelo'
          );
          const panel = this.options.layerControlContainerId;
          if (panel) this.renderControlPanel(panel);
        }
      }
    } catch (error) {
      console.warn('[MapViewer] No se pudo cargar la tesela anual de MapBiomas:', error);
    }
  }

  setBaseMode(modeKey) {
    if (!this.map || !this.baseLayers[modeKey]) return;

    // Remover capas base existentes
    Object.keys(this.baseLayers).forEach(k => {
      if (this.map.hasLayer(this.baseLayers[k])) {
        this.map.removeLayer(this.baseLayers[k]);
      }
    });

    this.baseLayers[modeKey].addTo(this.map);
    this.currentBaseMode = modeKey;
  }

  registerOverlayLayer(layerKey, layerInstance, name, available = true, category = 'General') {
    this.overlayLayers[layerKey] = {
      key: layerKey,
      layer: layerInstance,
      name: name,
      available: available,
      category: category
    };
  }

  toggleOverlayLayer(layerKey, enable) {
    if (!this.map || !this.overlayLayers[layerKey]) return;

    const targetObj = this.overlayLayers[layerKey];
    if (!targetObj.available) {
      console.warn(`[MapViewer] Capa ${layerKey} marcada como 'Sin datos disponibles'.`);
      return false;
    }

    if (enable) {
      if (targetObj.layer && !this.map.hasLayer(targetObj.layer)) {
        this.map.addLayer(targetObj.layer);
        this.activeOverlays.add(layerKey);
      }
    } else {
      if (targetObj.layer && this.map.hasLayer(targetObj.layer)) {
        this.map.removeLayer(targetObj.layer);
        this.activeOverlays.delete(layerKey);
      }
    }
    return true;
  }

  renderControlPanel(containerElementId) {
    this.options.layerControlContainerId = containerElementId;
    const container = document.getElementById(containerElementId);
    if (!container) return;

    const baseModes = [
      { key: 'normal', name: '🗺️ Mapa normal' },
      { key: 'satellite', name: '🛰️ Satelital' },
      { key: 'relief', name: '⛰️ Relieve' }
    ];
    const overlays = Object.values(this.overlayLayers).filter(layer => layer);
    const availableOverlays = overlays.filter(layer => layer.available);
    const activeCount = availableOverlays.filter(item => this.map?.hasLayer(item.layer)).length;

    const baseHtml = baseModes.map(mode => {
      const active = mode.key === this.currentBaseMode;
      return `<button type="button" class="btn-base-map ${active ? 'active' : ''}"
        data-mode="${mode.key}" aria-pressed="${active}">
        ${mode.name}
      </button>`;
    }).join('');

    const overlayHtml = availableOverlays.length
      ? availableOverlays.map(item => {
          const checked = Boolean(this.map && item.layer && this.map.hasLayer(item.layer));
          return `<label class="map-overlay-row">
            <input type="checkbox" class="chk-overlay-layer" data-layer="${escapeHTML(item.key)}"
              ${checked ? 'checked' : ''} aria-label="${escapeHTML(item.name)}">
            <span class="map-overlay-name">
              <strong>${escapeHTML(item.name)}</strong>
              <small>${escapeHTML(item.category || 'Capa temática')}</small>
            </span>
            <span class="map-overlay-state ${checked ? 'is-active' : ''}" aria-live="polite">
              ${checked ? 'Activada' : 'Disponible'}
            </span>
          </label>`;
        }).join('')
      : '<p class="map-overlay-empty">No hay capas temáticas disponibles para esta consulta.</p>';

    container.innerHTML = `
      <section class="map-layer-control-panel" aria-label="Controles del mapa">
        <div class="map-base-section">
          <h3>🗺️ Modos de mapa base</h3>
          <div class="base-map-buttons" role="group" aria-label="Seleccionar mapa base">${baseHtml}</div>
        </div>
        <details class="map-overlay-details">
          <summary>
            <span>🗂️ Capas temáticas</span>
            <span class="map-overlay-summary-meta">${activeCount} activada${activeCount === 1 ? '' : 's'} · ${availableOverlays.length} disponible${availableOverlays.length === 1 ? '' : 's'}</span>
          </summary>
          <p class="map-overlay-help">Activá una capa para verla sobre el mapa. Volvé a tocarla para ocultarla.</p>
          <div class="overlay-layers-list">${overlayHtml}</div>
        </details>
      </section>
    `;

    container.querySelectorAll('.btn-base-map').forEach(button => {
      button.addEventListener('click', event => {
        this.setBaseMode(event.currentTarget.dataset.mode);
        this.renderControlPanel(containerElementId);
      });
    });

    container.querySelectorAll('.chk-overlay-layer').forEach(input => {
      input.addEventListener('change', event => {
        const layerKey = event.currentTarget.dataset.layer;
        const enabled = event.currentTarget.checked;
        const changed = this.toggleOverlayLayer(layerKey, enabled);
        if (changed === false) {
          event.currentTarget.checked = false;
        }
        this.renderControlPanel(containerElementId);
        const mapElement = this.map?.getContainer?.();
        if (mapElement) {
          mapElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          requestAnimationFrame(() => this.map?.invalidateSize?.({ pan: false }));
        }
      });
    });
  }
}
