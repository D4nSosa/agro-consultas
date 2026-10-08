/**
 * mapViewer.js — Visor Territorial Reutilizable y Control de Capas Extensible
 * Agro Consultas - Plataforma de Inteligencia Territorial
 */

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

    return this.map;
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
    const container = document.getElementById(containerElementId);
    if (!container) return;

    const baseModes = [
      { key: 'normal', name: '🗺️ Mapa Normal' },
      { key: 'satellite', name: '🛰️ Satelital' },
      { key: 'relief', name: '⛰️ Relieve' }
    ];

    const activeOrAvailableOverlays = Object.values(this.overlayLayers).filter(l => l && l.available);

    let overlaysHtml = '';
    if (activeOrAvailableOverlays.length === 0) {
      overlaysHtml = `
        <div style="font-size: 0.8rem; color: var(--texto-secundario, #666); padding: 4px 0;">
          Las capas temáticas (ej. Aptitud del cultivo) se activan automáticamente al seleccionar una ubicación y ejecutar una consulta.
        </div>
      `;
    } else {
      overlaysHtml = activeOrAvailableOverlays.map(o => {
        const isChecked = this.map && o.layer && this.map.hasLayer(o.layer);
        return `
          <label style="display: flex; align-items: center; justify-content: space-between; font-size: 0.8rem; padding: 4px 0; border-bottom: 1px dashed #eee; cursor: pointer;">
            <span style="display: flex; align-items: center; gap: 6px;">
              <input type="checkbox" class="chk-overlay-layer" data-layer="${o.key}" ${isChecked ? 'checked' : ''} />
              <span>${o.name}</span>
            </span>
            <span style="font-size: 0.72rem; color: #27ae60; font-weight: 600;">ACTIVA</span>
          </label>
        `;
      }).join('');
    }

    let html = `
      <div class="map-layer-control-panel" style="background: var(--color-tarjeta, #ffffff); border: 1px solid var(--borde-suave, #e0e0e0); border-radius: 8px; padding: 12px; font-size: 0.85rem;">
        <div style="font-weight: bold; margin-bottom: 8px; color: var(--verde-principal, #2c3e50); border-bottom: 1px solid var(--borde-suave); padding-bottom: 4px;">
          🗺️ Modos de Mapa Base
        </div>
        <div class="base-map-buttons" style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px;">
          ${baseModes.map(m => `
            <button type="button" class="btn-base-map ${m.key === this.currentBaseMode ? 'active' : ''}" data-mode="${m.key}"
              style="padding: 4px 10px; font-size: 0.78rem; border-radius: 4px; border: 1px solid #ccc; cursor: pointer; background: ${m.key === this.currentBaseMode ? 'var(--verde-principal, #27ae60)' : '#f8f9fa'}; color: ${m.key === this.currentBaseMode ? '#fff' : '#333'};">
              ${m.name}
            </button>
          `).join('')}
        </div>

        <div style="font-weight: bold; margin-bottom: 6px; color: var(--verde-principal, #2c3e50); border-bottom: 1px solid var(--borde-suave); padding-bottom: 4px;">
          🥞 Capas Temáticas de la Consulta Actual
        </div>
        <div class="overlay-layers-list" style="display: flex; flex-direction: column; gap: 4px;">
          ${overlaysHtml}
        </div>
      </div>
    `;

    container.innerHTML = html;

    // Listeners Capa Base
    container.querySelectorAll('.btn-base-map').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const mode = e.currentTarget.getAttribute('data-mode');
        this.setBaseMode(mode);
        this.renderControlPanel(containerElementId);
      });
    });

    // Listeners Capas Superpuestas
    container.querySelectorAll('.chk-overlay-layer').forEach(chk => {
      chk.addEventListener('change', (e) => {
        const layerKey = e.target.getAttribute('data-layer');
        const checked = e.target.checked;
        this.toggleOverlayLayer(layerKey, checked);
        this.renderControlPanel(containerElementId);
      });
    });
  }
}
