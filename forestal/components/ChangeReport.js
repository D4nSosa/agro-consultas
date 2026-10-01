/**
 * ChangeReport.js - Generador de reporte borrador trazable y exportable de análisis forestal
 */

export class ChangeReport {
  constructor(containerId) {
    this.containerId = containerId;
  }

  renderReport(analysisData) {
    const container = document.getElementById(this.containerId);
    if (!container || !analysisData) return;

    const { lot, dates, products, ndvi, changes, aptitude } = analysisData;
    const prodA = products?.productA || null;
    const prodB = products?.productB || null;
    const statsA = ndvi?.analysisA?.stats || null;
    const statsB = ndvi?.analysisB?.stats || null;

    let statusBadgeColor = '#27ae60';
    if (changes.classification === 'DISMINUCION_SIGNIFICATIVA') statusBadgeColor = '#e74c3c';
    if (changes.classification === 'NO_DISPONIBLE') statusBadgeColor = '#757575';

    container.innerHTML = `
      <div id="printable-forest-report" class="card" style="padding: 25px; margin-top: 20px; border-top: 4px solid var(--verde-principal);">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid var(--borde-suave); padding-bottom: 15px; margin-bottom: 20px; flex-wrap: wrap; gap: 10px;">
          <div>
            <h2 style="margin: 0; color: var(--verde-principal); display: flex; align-items: center; gap: 10px;">
              <span>🌲</span> Informe Técnico de Análisis Forestal y Teledetección
            </h2>
            <div style="font-size: 0.9rem; color: var(--texto-secundario); margin-top: 5px;">
              Agro Consultas — Módulo de Seguimiento Territorial e Información Satelital
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 0.85rem; font-weight: bold;">Fecha de Emisión:</div>
            <div style="font-size: 0.85rem; color: var(--texto-secundario);">${new Date().toLocaleDateString('es-AR')}</div>
            <button id="btn-print-report" class="btn primary" style="margin-top: 8px; font-size: 0.85rem; padding: 6px 14px;">🖨️ Imprimir / Exportar Reporte</button>
          </div>
        </div>

        <!-- Metadatos del Lote -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 15px; background: rgba(0,0,0,0.02); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
          <div>
            <span style="font-size: 0.8rem; color: var(--texto-secundario); display: block;">Nombre del Lote:</span>
            <strong>${lot?.geometry?.properties?.name || 'Lote Forestal'}</strong>
            <span class="badge-origin real" style="margin-left: 5px;">REAL</span>
          </div>
          <div>
            <span style="font-size: 0.8rem; color: var(--texto-secundario); display: block;">Superficie Calculada:</span>
            <strong>${lot?.area?.hectares || 0} Hectáreas (${lot?.area?.squareMeters || 0} m²)</strong>
          </div>
          <div>
            <span style="font-size: 0.8rem; color: var(--texto-secundario); display: block;">Coordenadas Centroide:</span>
            <strong>Lat: ${lot?.centroid?.lat?.toFixed(4)}, Lng: ${lot?.centroid?.lng?.toFixed(4)}</strong>
          </div>
          <div>
            <span style="font-size: 0.8rem; color: var(--texto-secundario); display: block;">Período Comparado:</span>
            <strong>${dates?.dateA} ➔ ${dates?.dateB}</strong>
          </div>
        </div>

        <!-- Inventario de Campo si existe -->
        ${analysisData.inventory ? `
        <h3 style="color: #2980b9; border-bottom: 1px solid var(--borde-suave); padding-bottom: 5px; margin-top: 25px;">
          📋 Inventario Daseométrico de Campo
        </h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; background: rgba(41, 128, 185, 0.04); padding: 15px; border-radius: 8px; margin-bottom: 20px; border: 1px solid var(--borde-suave);">
          <div>
            <span style="font-size: 0.78rem; color: var(--texto-secundario); display: block;">Especie Dominante:</span>
            <strong>${analysisData.inventory.especie}</strong>
          </div>
          <div>
            <span style="font-size: 0.78rem; color: var(--texto-secundario); display: block;">DAP Medio / Altura:</span>
            <strong>${analysisData.inventory.dap} cm | ${analysisData.inventory.altura} m</strong>
          </div>
          <div>
            <span style="font-size: 0.78rem; color: var(--texto-secundario); display: block;">Volumen Estimado:</span>
            <strong style="color: #2980b9; font-size: 1.1rem;">${analysisData.inventory.volumenHa} m³/ha</strong>
          </div>
          <div style="grid-column: 1 / -1; margin-top: 5px; padding-top: 8px; border-top: 1px dashed var(--borde-suave);">
            <strong style="color: #2980b9; font-size: 0.85rem;">📌 Prescripción Silvícola:</strong>
            <p style="margin: 4px 0 0 0; font-size: 0.85rem;">${analysisData.inventory.prescripcion}</p>
          </div>
        </div>
        ` : ''}

        <!-- Trazabilidad Satelital Real -->
        <h3 style="color: var(--verde-principal); border-bottom: 1px solid var(--borde-suave); padding-bottom: 5px; margin-top: 25px;">
          📡 Trazabilidad de Escenas Satelitales Reales (Copernicus)
        </h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 15px; margin-bottom: 20px;">
          <div style="border: 1px solid var(--borde-suave); padding: 12px; border-radius: 8px;">
            <strong style="color: #27ae60;">🟢 Escena Fecha A</strong>
            ${prodA ? `
              <ul style="font-size: 0.85rem; margin: 8px 0 0 0; padding-left: 20px; line-height: 1.5;">
                <li><strong>Fuente:</strong> ${prodA.source || 'Copernicus Sentinel-2'}</li>
                <li><strong>Identificador:</strong> ${prodA.id}</li>
                <li><strong>Fecha Adquisición:</strong> ${prodA.date}</li>
                <li><strong>Nubosidad:</strong> ${prodA.cloudCover}%</li>
                <li><strong>Resolución:</strong> 10 metros</li>
              </ul>
            ` : `<div style="font-size: 0.85rem; color: var(--texto-secundario); margin-top: 8px;">NO DISPONIBLE: No se encontró escena con nubosidad aceptable.</div>`}
          </div>

          <div style="border: 1px solid var(--borde-suave); padding: 12px; border-radius: 8px;">
            <strong style="color: #2980b9;">🔵 Escena Fecha B</strong>
            ${prodB ? `
              <ul style="font-size: 0.85rem; margin: 8px 0 0 0; padding-left: 20px; line-height: 1.5;">
                <li><strong>Fuente:</strong> ${prodB.source || 'Copernicus Sentinel-2'}</li>
                <li><strong>Identificador:</strong> ${prodB.id}</li>
                <li><strong>Fecha Adquisición:</strong> ${prodB.date}</li>
                <li><strong>Nubosidad:</strong> ${prodB.cloudCover}%</li>
                <li><strong>Resolución:</strong> 10 metros</li>
              </ul>
            ` : `<div style="font-size: 0.85rem; color: var(--texto-secundario); margin-top: 8px;">NO DISPONIBLE: No se encontró escena con nubosidad aceptable.</div>`}
          </div>
        </div>

        <!-- Diagnóstico de Cambios -->
        <h3 style="color: var(--verde-principal); border-bottom: 1px solid var(--borde-suave); padding-bottom: 5px; margin-top: 25px;">
          📊 Evaluación de Variación Espectral y Detección de Cambios
        </h3>
        <div style="padding: 15px; border-radius: 8px; border-left: 5px solid ${statusBadgeColor}; background: rgba(0,0,0,0.02); margin-bottom: 20px;">
          <strong style="font-size: 1.05rem; color: ${statusBadgeColor};">${changes.primaryMessage || 'NO DISPONIBLE'}</strong>
          <p style="font-size: 0.9rem; margin: 8px 0 10px 0; line-height: 1.5;">${changes.description || 'No se pueden calcular variaciones sin datos ráster procesables.'}</p>
        </div>

        <!-- Aptitud Territorial -->
        <h3 style="color: var(--verde-principal); border-bottom: 1px solid var(--borde-suave); padding-bottom: 5px; margin-top: 25px;">
          🌲 Aptitud de Especies Forestales
        </h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 15px; margin-bottom: 20px;">
          ${(aptitude?.recommendations || []).map(r => `
            <div style="border: 1px solid var(--borde-suave); border-radius: 8px; padding: 12px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <strong style="font-size: 0.95rem;">🌲 ${r.nombre}</strong>
                <span class="badge" style="padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; background: ${r.compatibilidad === 'ALTA' ? '#2ecc71' : r.compatibilidad === 'MEDIA' ? '#f39c12' : '#e74c3c'}; color: #fff;">${r.compatibilidad}</span>
              </div>
              <p style="font-size: 0.8rem; color: var(--texto-secundario); margin: 6px 0;">${r.descripcion}</p>
            </div>
          `).join('')}
        </div>

        <!-- Metodología y Descargo de Responsabilidad -->
        <div style="margin-top: 30px; padding: 12px; background: rgba(0,0,0,0.03); border: 1px solid var(--borde-suave); border-radius: 6px; font-size: 0.78rem; color: var(--texto-secundario); line-height: 1.5;">
          <strong>Aviso Metodológico y Limitaciones Trazables:</strong>
          <br>
          Este reporte es un <em>Análisis preliminar de información territorial y teledetección</em> generado de forma automatizada mediante la consulta del catálogo oficial Copernicus Data Space Ecosystem. No se inventan datos cuando falta información de reflectancia.
        </div>
      </div>
    `;

    const btnPrint = document.getElementById('btn-print-report');
    if (btnPrint) {
      btnPrint.addEventListener('click', () => {
        window.print();
      });
    }
  }
}
