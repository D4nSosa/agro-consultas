/**
 * ForestTimeline.js - Componente para la línea temporal de adquisiciones y selección de fechas
 * Basado exclusivamente en registros reales.
 */

export class ForestTimeline {
  constructor(containerId, onDatesSelectedCallback) {
    this.containerId = containerId;
    this.onDatesSelected = onDatesSelectedCallback;
    this.timelineData = [];
    this.dateA = null;
    this.dateB = null;
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
      container.innerHTML = `
        <div class="empty-state" style="text-align: center; padding: 25px;">
          <span style="font-size: 2rem; display: block; margin-bottom: 8px;">🛰️</span>
          <p><strong>LOTE NO DEFINIDO</strong></p>
          <p class="text-muted" style="font-size: 0.85rem; margin: 0;">Delimitá un lote en el mapa o usá tu GPS para consultar escenas de Sentinel-2 L2A.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="timeline-header" style="margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
        <div>
          <h4 style="margin: 0; color: var(--verde-principal);">📅 Serie Temporal de Adquisiciones (Sentinel-2)</h4>
          <small class="text-muted">Escenas Sentinel-2 recuperadas</small>
        </div>
      </div>

      <div class="timeline-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 15px;">
        ${this.timelineData.map(item => {
          const preview = typeof item.thumbnail === 'string' && /^https?:\\/\\//i.test(item.thumbnail) ? item.thumbnail : null;
          return `
            <div class="card timeline-card" style="padding: 12px; border-radius: 8px; min-width:0; overflow-wrap:anywhere;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <strong style="font-size: 0.9rem;">📅 ${item.date}</strong>
              </div>
              ${preview ? `<img loading="lazy" src="${preview}" alt="Vista previa de escena Sentinel-2 ${item.date}" style="display:block;width:100%;max-height:170px;object-fit:contain;border-radius:6px;margin:6px 0">` : `<div style="font-size:.75rem;color:var(--texto-secundario);padding:12px 0">El catálogo no entregó una miniatura para esta escena.</div>`}
              <div style="font-size: 0.82rem; margin-top: 4px;">☁️ Nubosidad: <strong>${typeof item.cloudCover === 'number' ? item.cloudCover + '%' : 'No informada'}</strong></div>
              <div style="font-size: 0.75rem; color: var(--texto-secundario); margin-top: 4px; word-break: break-all;">🆔 ${item.product}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }
}
