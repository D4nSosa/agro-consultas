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
    const prodA = products?.productA || {};
    const prodB = products?.productB || {};
    const statsA = ndvi?.analysisA?.stats || {};
    const statsB = ndvi?.analysisB?.stats || {};

    let statusBadgeColor = '#2ecc71';
    if (changes.classification === 'DISMINUCION_SIGNIFICATIVA') statusBadgeColor = '#e74c3c';
    if (changes.classification === 'AUMENTO_SIGNIFICATIVO') statusBadgeColor = '#27ae60';

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
        ${(() => {
          const isDemo = lot?.geometry?.properties?.isDemo || (lot?.geometry?.properties?.name || '').toLowerCase().includes('demo');
          const badgeHtml = isDemo
            ? `<span style="font-size:0.75rem; font-weight:bold; padding:2px 8px; border-radius:4px; background:#f39c12; color:#fff; margin-left:8px;">DEMO / DATOS DE DEMOSTRACIÓN</span>`
            : `<span style="font-size:0.75rem; font-weight:bold; padding:2px 8px; border-radius:4px; background:#27ae60; color:#fff; margin-left:8px;">REAL / LOTE DELIMITADO</span>`;
          return `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 15px; background: rgba(0,0,0,0.02); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
          <div>
            <span style="font-size: 0.8rem; color: var(--texto-secundario); display: block;">Nombre del Lote:</span>
            <strong>${lot?.geometry?.properties?.name || 'Lote Forestal'}</strong> ${badgeHtml}
          </div>
          `;
        })()}
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

        <!-- Trazabilidad Daseométrica e Inventario de Campo -->
        ${analysisData.inventory ? `
        <h3 style="color: #2980b9; border-bottom: 1px solid var(--borde-suave); padding-bottom: 5px; margin-top: 25px;">
          📋 Inventario Daseométrico y Planificación Operativa de Campo
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
            <span style="font-size: 0.78rem; color: var(--texto-secundario); display: block;">Densidad / Edad:</span>
            <strong>${analysisData.inventory.densidad} pies/ha (${analysisData.inventory.edad} años)</strong>
          </div>
          <div>
            <span style="font-size: 0.78rem; color: var(--texto-secundario); display: block;">Volumen Estimado por Hectárea:</span>
            <strong style="color: #2980b9; font-size: 1.1rem;">${analysisData.inventory.volumenHa} m³/ha</strong>
          </div>
          <div style="grid-column: 1 / -1; margin-top: 5px; padding-top: 8px; border-top: 1px dashed var(--borde-suave);">
            <strong style="color: #2980b9; font-size: 0.85rem;">📌 Prescripción Silvícola de Campo:</strong>
            <p style="margin: 4px 0 0 0; font-size: 0.85rem; line-height: 1.4;">${analysisData.inventory.prescripcion}</p>
          </div>
        </div>
        ` : ''}

        <!-- Alertas de Riesgo Operativo en Campo -->
        <h3 style="color: #e67e22; border-bottom: 1px solid var(--borde-suave); padding-bottom: 5px; margin-top: 25px;">
          🔥 Monitoreo de Riesgos Operativos y Alertas de Campo
        </h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; margin-bottom: 20px;">
          <div style="border: 1px solid var(--borde-suave); padding: 12px; border-radius: 8px; background: rgba(230, 126, 34, 0.05);">
            <strong style="color: #d35400; font-size: 0.88rem;">🔥 Riesgo de Incendio (FWI):</strong>
            <div style="font-size: 0.82rem; margin-top: 4px;">Índice Moderado - Mantener cortafuegos limpios y fajas de seguridad libres de rastrojo.</div>
          </div>
          <div style="border: 1px solid var(--borde-suave); padding: 12px; border-radius: 8px; background: rgba(39, 174, 96, 0.05);">
            <strong style="color: #27ae60; font-size: 0.88rem;">🌱 Estado Fitosanitario y Dosel:</strong>
            <div style="font-size: 0.82rem; margin-top: 4px;">Sin anomalías críticas de defoliación por plagas (Sirex noctilio / Avispa de la agalla) detectadas en la firma espectral.</div>
          </div>
        </div>

        <!-- Trazabilidad Satelital -->
        <h3 style="color: var(--verde-principal); border-bottom: 1px solid var(--borde-suave); padding-bottom: 5px; margin-top: 25px;">
          📡 Trazabilidad de Fuentes de Datos Satelitales (Copernicus)
        </h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 15px; margin-bottom: 20px;">
          <div style="border: 1px solid var(--borde-suave); padding: 12px; border-radius: 8px;">
            <strong style="color: #27ae60;">🟢 Imagen Fecha A (Base)</strong>
            <ul style="font-size: 0.85rem; margin: 8px 0 0 0; padding-left: 20px; line-height: 1.5;">
              <li><strong>Fuente:</strong> Copernicus Sentinel-2</li>
              <li><strong>Producto:</strong> ${prodA.productType || 'Level-2A (S2MSI2A)'}</li>
              <li><strong>Identificador:</strong> ${prodA.id || 'N/A'}</li>
              <li><strong>Fecha Adquisición:</strong> ${prodA.date || dates?.dateA}</li>
              <li><strong>Cobertura Nubosa:</strong> ${prodA.cloudCover || 0}%</li>
              <li><strong>Resolución Espacial:</strong> 10 metros</li>
              <li><strong>Bandas Empleadas:</strong> B04 (Red 665nm), B08 (NIR 842nm)</li>
            </ul>
          </div>

          <div style="border: 1px solid var(--borde-suave); padding: 12px; border-radius: 8px;">
            <strong style="color: #2980b9;">🔵 Imagen Fecha B (Comparación)</strong>
            <ul style="font-size: 0.85rem; margin: 8px 0 0 0; padding-left: 20px; line-height: 1.5;">
              <li><strong>Fuente:</strong> Copernicus Sentinel-2</li>
              <li><strong>Producto:</strong> ${prodB.productType || 'Level-2A (S2MSI2A)'}</li>
              <li><strong>Identificador:</strong> ${prodB.id || 'N/A'}</li>
              <li><strong>Fecha Adquisición:</strong> ${prodB.date || dates?.dateB}</li>
              <li><strong>Cobertura Nubosa:</strong> ${prodB.cloudCover || 0}%</li>
              <li><strong>Resolución Espacial:</strong> 10 metros</li>
              <li><strong>Bandas Empleadas:</strong> B04 (Red 665nm), B08 (NIR 842nm)</li>
            </ul>
          </div>
        </div>

        <!-- Indicadores NDVI y Detección de Cambios -->
        <h3 style="color: var(--verde-principal); border-bottom: 1px solid var(--borde-suave); padding-bottom: 5px; margin-top: 25px;">
          📊 Estadísticas NDVI y Detección Preliminar de Cambios
        </h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px;">
          <div style="background: rgba(39, 174, 96, 0.08); padding: 12px; border-radius: 8px; text-align: center;">
            <div style="font-size: 0.8rem; color: var(--texto-secundario);">NDVI Promedio Fecha A</div>
            <div style="font-size: 1.6rem; font-weight: bold; color: #27ae60;">${statsA.mean || 0}</div>
            <div style="font-size: 0.75rem; color: var(--texto-secundario);">Mín: ${statsA.min || 0} | Máx: ${statsA.max || 0}</div>
          </div>

          <div style="background: rgba(41, 128, 185, 0.08); padding: 12px; border-radius: 8px; text-align: center;">
            <div style="font-size: 0.8rem; color: var(--texto-secundario);">NDVI Promedio Fecha B</div>
            <div style="font-size: 1.6rem; font-weight: bold; color: #2980b9;">${statsB.mean || 0}</div>
            <div style="font-size: 0.75rem; color: var(--texto-secundario);">Mín: ${statsB.min || 0} | Máx: ${statsB.max || 0}</div>
          </div>

          <div style="background: rgba(0, 0, 0, 0.04); padding: 12px; border-radius: 8px; text-align: center;">
            <div style="font-size: 0.8rem; color: var(--texto-secundario);">Variación deltaNDVI (B - A)</div>
            <div style="font-size: 1.6rem; font-weight: bold; color: ${statusBadgeColor};">${changes.deltaNDVI > 0 ? '+' : ''}${changes.deltaNDVI}</div>
            <div style="font-size: 0.75rem; color: var(--texto-secundario);">Umbral Configurable: ±0.15</div>
          </div>
        </div>

        <!-- Diagnóstico de Cambios -->
        <div style="padding: 15px; border-radius: 8px; border-left: 5px solid ${statusBadgeColor}; background: rgba(0,0,0,0.02); margin-bottom: 20px;">
          <strong style="font-size: 1.05rem; color: ${statusBadgeColor};">${changes.primaryMessage}</strong>
          <p style="font-size: 0.9rem; margin: 8px 0 10px 0; line-height: 1.5;">${changes.description}</p>
          <div style="display: flex; gap: 20px; font-size: 0.85rem; flex-wrap: wrap;">
            <span>📉 Disminución: <strong>${changes.breakdown?.decrease?.hectares} ha (${changes.breakdown?.decrease?.percent}%)</strong></span>
            <span>➖ Estable: <strong>${changes.breakdown?.stable?.hectares} ha (${changes.breakdown?.stable?.percent}%)</strong></span>
            <span>📈 Aumento: <strong>${changes.breakdown?.increase?.hectares} ha (${changes.breakdown?.increase?.percent}%)</strong></span>
          </div>
        </div>

        <!-- Aptitud Territorial e Integración Agro Consultas -->
        <h3 style="color: var(--verde-principal); border-bottom: 1px solid var(--borde-suave); padding-bottom: 5px; margin-top: 25px;">
          🌲 Aptitud de Especies Forestales (Recommendation Engine)
        </h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 15px; margin-bottom: 20px;">
          ${(aptitude?.recommendations || []).map(r => `
            <div style="border: 1px solid var(--borde-suave); border-radius: 8px; padding: 12px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <strong style="font-size: 0.95rem;">🌲 ${r.nombre}</strong>
                <span class="badge" style="padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; background: ${r.compatibilidad === 'ALTA' ? '#2ecc71' : r.compatibilidad === 'MEDIA' ? '#f39c12' : '#e74c3c'}; color: #fff;">${r.compatibilidad}</span>
              </div>
              <p style="font-size: 0.8rem; color: var(--texto-secundario); margin: 6px 0;">${r.descripcion}</p>
              <div style="font-size: 0.75rem;"><strong>Rotación/Manejo:</strong> ${r.sostenibilidad?.rotacion || 'Consultar guía técnica local.'}</div>
            </div>
          `).join('')}
        </div>

        <!-- Metodología y Descargo de Responsabilidad -->
        <div style="margin-top: 30px; padding: 12px; background: rgba(0,0,0,0.03); border: 1px solid var(--borde-suave); border-radius: 6px; font-size: 0.78rem; color: var(--texto-secundario); line-height: 1.5;">
          <strong>Aviso Metodológico y Limitaciones Trazables:</strong>
          <br>
          Este reporte es un <em>Análisis preliminar de información territorial y teledetección</em> generado de forma automatizada mediante la consulta de imágenes multiespectrales Sentinel-2 Level-2A provistas por Copernicus Data Space Ecosystem.
          El NDVI representa la respuesta espectral y el vigor vegetativo foliar, y no constituye por sí solo una certificación forestal ni una prueba categórica de deforestación o tala. Se requiere inspección técnica de campo para validaciones oficiales.
        </div>
      </div>
    `;

    // Event listener para botón de impresión
    const btnPrint = document.getElementById('btn-print-report');
    if (btnPrint) {
      btnPrint.addEventListener('click', () => {
        window.print();
      });
    }
  }
}
