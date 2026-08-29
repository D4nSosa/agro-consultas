/**
 * ForestTimeline.js - Componente para la línea temporal de adquisiciones y selección de fechas
 */

export class ForestTimeline {
  constructor(containerId, onDatesSelectedCallback) {
    this.containerId = containerId;
    this.onDatesSelected = onDatesSelectedCallback;
    this.timelineData = [];
    this.dateA = '2025-08-15';
    this.dateB = '2026-08-15';
  }

  setTimelineData(items, defaultDateA, defaultDateB) {
    this.timelineData = items || [];
    if (defaultDateA) this.dateA = defaultDateA;
    if (defaultDateB) this.dateB = defaultDateB;
    this.render();
  }

  render() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    if (!this.timelineData.length) {
      container.innerHTML = `<p class="text-muted">Cargando serie temporal de adquisiciones satelitales...</p>`;
      return;
    }

    container.innerHTML = `
      <div class="timeline-header" style="margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
        <div>
          <h4 style="margin: 0; color: var(--verde-principal); font-size: 1.1rem;">📅 Serie Temporal de Adquisiciones Sentinel-2</h4>
          <small class="text-muted">Seleccioná dos fechas para calcular el análisis multitemporal y deltaNDVI</small>
        </div>
        <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
          <label style="font-size: 0.85rem; font-weight: bold; display: flex; align-items: center;">
            🟢 Fecha A (Base):
            <select id="select-date-a" style="padding: 5px 8px; border-radius: 6px; border: 1px solid var(--borde-suave); margin-left: 5px; background: var(--bg-principal); color: var(--texto-principal);">
              ${this.timelineData.map(item => `<option value="${item.date}" ${item.date === this.dateA ? 'selected' : ''}>${item.date} (${item.year})</option>`).join('')}
            </select>
          </label>

          <label style="font-size: 0.85rem; font-weight: bold; display: flex; align-items: center;">
            🔵 Fecha B (Comparación):
            <select id="select-date-b" style="padding: 5px 8px; border-radius: 6px; border: 1px solid var(--borde-suave); margin-left: 5px; background: var(--bg-principal); color: var(--texto-principal);">
              ${this.timelineData.map(item => `<option value="${item.date}" ${item.date === this.dateB ? 'selected' : ''}>${item.date} (${item.year})</option>`).join('')}
            </select>
          </label>
        </div>
      </div>

      <div class="timeline-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 15px; width: 100%; box-sizing: border-box;">
        ${this.timelineData.map(item => {
          const isA = item.date === this.dateA;
          const isB = item.date === this.dateB;
          let activeClass = '';
          let badge = '';

          if (isA) {
            activeClass = 'border-left: 4px solid #27ae60; background: rgba(39, 174, 96, 0.08);';
            badge = '<span class="badge" style="background:#27ae60; color:#fff; font-size:0.7rem; padding:2px 6px; border-radius:4px;">Fecha A</span>';
          } else if (isB) {
            activeClass = 'border-left: 4px solid #2980b9; background: rgba(41, 128, 185, 0.08);';
            badge = '<span class="badge" style="background:#2980b9; color:#fff; font-size:0.7rem; padding:2px 6px; border-radius:4px;">Fecha B</span>';
          }

          return `
            <div class="card timeline-card" style="padding: 12px; border-radius: 8px; ${activeClass} box-sizing: border-box; min-width: 0; overflow: hidden; word-wrap: break-word;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <strong style="font-size: 1rem;">${item.year}</strong>
                <span>${badge}</span>
              </div>
              <div style="font-size: 0.85rem; color: var(--texto-secundario);">📅 ${item.date}</div>
              <div style="font-size: 0.85rem; margin-top: 6px;">☁️ Nubosidad: <strong>${item.cloudCover}%</strong></div>
              <div style="font-size: 0.85rem; margin-top: 4px; color: var(--verde-principal); font-weight: bold;">🌱 NDVI Prom: ${item.ndviMean}</div>
              <div style="font-size: 0.72rem; color: var(--texto-secundario); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;" title="${item.product}">🆔 ${item.product}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    // Event listeners para selectores de fecha
    const selA = document.getElementById('select-date-a');
    const selB = document.getElementById('select-date-b');

    if (selA) {
      selA.addEventListener('change', (e) => {
        this.dateA = e.target.value;
        if (this.onDatesSelected) this.onDatesSelected(this.dateA, this.dateB);
      });
    }

    if (selB) {
      selB.addEventListener('change', (e) => {
        this.dateB = e.target.value;
        if (this.onDatesSelected) this.onDatesSelected(this.dateA, this.dateB);
      });
    }
  }
}
