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
          <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
            <div style="font-size: 0.85rem; font-weight: bold;">Fecha de Emisión:</div>
            <div style="font-size: 0.85rem; color: var(--texto-secundario);">${new Date().toLocaleDateString('es-AR')}</div>
            <div style="display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; justify-content: flex-end;">
              <button id="btn-print-report" class="btn primary" style="font-size: 0.85rem; padding: 6px 14px;">🖨️ Reporte / PDF</button>
              <button id="btn-share-forest-report" class="btn primary" style="font-size: 0.85rem; padding: 6px 14px; background: #2980b9; border-color: #2980b9;">📲 Compartir</button>
            </div>
          </div>
        </div>

        <!-- Metadatos del Lote y Clasificación de Datos -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 15px; background: rgba(0,0,0,0.02); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
          <div>
            <span style="font-size: 0.8rem; color: var(--texto-secundario); display: block;">Identificación (Ingresado por usuario):</span>
            <strong>${lot?.geometry?.properties?.name || 'Lote Forestal'}</strong>
          </div>
          <div>
            <span style="font-size: 0.8rem; color: var(--texto-secundario); display: block;">Superficie (Calculada desde geometría):</span>
            <strong>${lot?.area?.isPoint ? '0 ha (Geometría PUNTO GPS / Consulta puntual)' : `${lot?.area?.hectares || 0} Hectáreas (${lot?.area?.squareMeters || 0} m²)`}</strong>
          </div>
          <div>
            <span style="font-size: 0.8rem; color: var(--texto-secundario); display: block;">Ubicación Centroide (Calculada WGS84):</span>
            <strong>Lat: ${lot?.centroid?.lat?.toFixed(4)}, Lng: ${lot?.centroid?.lng?.toFixed(4)}</strong>
          </div>
          <div>
            <span style="font-size: 0.8rem; color: var(--texto-secundario); display: block;">Período Objetivo Consulta:</span>
            <strong>${dates?.dateA} ➔ ${dates?.dateB}</strong>
          </div>
        </div>

        <!-- Inventario Dasométrico de Campo -->
        <h3 style="color: #2980b9; border-bottom: 1px solid var(--borde-suave); padding-bottom: 5px; margin-top: 25px;">
          📋 Indicadores Dasométricos de Campo
        </h3>
        ${analysisData.inventory ? `
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
            <span style="font-size: 0.78rem; color: var(--texto-secundario); display: block;">Área Basal / Densidad:</span>
            <strong>${analysisData.inventory.areaBasalHa ? `${analysisData.inventory.areaBasalHa} m²/ha` : 'N/D'} | ${analysisData.inventory.densidad} pies/ha</strong>
          </div>
          <div>
            <span style="font-size: 0.78rem; color: var(--texto-secundario); display: block;">Volumen Estimado:</span>
            <strong style="color: #2980b9; font-size: 1.1rem;">${analysisData.inventory.volumenHa} m³/ha</strong>
          </div>
          <div style="grid-column: 1 / -1; margin-top: 5px; padding-top: 8px; border-top: 1px dashed var(--borde-suave);">
            <strong style="color: #2980b9; font-size: 0.85rem;">📌 Estimación dasométrica y evaluación silvícola preliminar:</strong>
            <p style="margin: 4px 0 0 0; font-size: 0.85rem;">${analysisData.inventory.evalSilvicola || analysisData.inventory.prescripcion || 'NO DISPONIBLE'}</p>
          </div>
        </div>
        ` : `
        <div style="background: rgba(0,0,0,0.02); border: 1px dashed var(--borde-suave); border-radius: 8px; padding: 12px; font-size: 0.85rem; color: var(--texto-secundario); margin-bottom: 20px;">
          ⚪ <strong>Información dasométrica no ingresada por el usuario</strong> (DAP, altura y densidad pendientes de medición en terreno).
        </div>
        `}

        <!-- Ordenamiento Territorial de Bosques Nativos (OTBN Ley 26.331) -->
        <h3 style="color: var(--verde-principal); border-bottom: 1px solid var(--borde-suave); padding-bottom: 5px; margin-top: 25px;">
          🌳 Ordenamiento Territorial de Bosques Nativos (OTBN - Ley 26.331)
        </h3>
        <div style="background: rgba(39, 174, 96, 0.04); border: 1px solid var(--borde-suave); border-radius: 8px; padding: 15px; margin-bottom: 20px;">
          <div style="display: flex; gap: 15px; flex-wrap: wrap; font-size: 0.88rem;">
            <div>🔴 <strong>Categoría I (Roja):</strong> Muy alto valor de conservación (No transformable)</div>
            <div>🟡 <strong>Categoría II (Amarilla):</strong> Mediano valor de conservación (Sostenible)</div>
            <div>🟢 <strong>Categoría III (Verde):</strong> Bajo valor de conservación (Aptitud de transformación)</div>
          </div>
          <div style="margin-top: 8px; font-size: 0.82rem; color: var(--texto-secundario);">
            Fuente Oficial: Cartografía de Bosques Nativos WMS INTA / Secretaría de Ambiente y Desarrollo Sustentable.
          </div>
        </div>

        <!-- Trazabilidad Satelital -->
        <h3 style="color: var(--verde-principal); border-bottom: 1px solid var(--borde-suave); padding-bottom: 5px; margin-top: 25px;">
          📡 Trazabilidad de Escenas Satelitales (AWS Earth Search STAC)
        </h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 15px; margin-bottom: 20px;">
          <div style="border: 1px solid var(--borde-suave); padding: 12px; border-radius: 8px;">
            <strong style="color: #27ae60;">🟢 Escena Fecha A</strong>
            ${prodA ? `
              <ul style="font-size: 0.85rem; margin: 8px 0 0 0; padding-left: 20px; line-height: 1.5;">
                <li><strong>Fuente:</strong> ${prodA.source || 'Sentinel-2 L2A'}</li>
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
                <li><strong>Fuente:</strong> ${prodB.source || 'Sentinel-2 L2A'}</li>
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
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <strong style="font-size: 1.05rem; color: ${statusBadgeColor};">${changes.primaryMessage || 'NO DISPONIBLE'}</strong>
            <span style="font-size: 0.78rem; font-weight: bold; background: rgba(0,0,0,0.05); padding: 4px 8px; border-radius: 4px;">
              Estado: ${changes.status === 'REAL' ? '🟢 Cálculo Ráster Completado' : (changes.status === 'SCENE_IDENTIFIED' ? '🟡 Escenas Identificadas (Matriz Ráster Pendiente)' : '🔴 Información No Disponible')}
            </span>
          </div>
          <p style="font-size: 0.9rem; margin: 8px 0 10px 0; line-height: 1.5;">${changes.description || 'No se pueden calcular variaciones sin datos ráster procesables.'}</p>
        </div>


        <!-- Metodología y Descargo de Responsabilidad -->
        <div style="margin-top: 30px; padding: 12px; background: rgba(0,0,0,0.03); border: 1px solid var(--borde-suave); border-radius: 6px; font-size: 0.78rem; color: var(--texto-secundario); line-height: 1.5;">
          <strong>Aviso Metodológico y Limitaciones Trazables:</strong>
          <br>
          Este reporte es un <em>Análisis preliminar de información territorial y teledetección</em> generado de forma automatizada mediante la consulta del catálogo público AWS Earth Search STAC (Sentinel-2 L2A COGs). No se inventan datos cuando falta información de reflectancia.
        </div>
      </div>
    `;

    const btnPrint = document.getElementById('btn-print-report');
    if (btnPrint) {
      btnPrint.addEventListener('click', () => {
        window.print();
      });
    }

    const btnShare = document.getElementById('btn-share-forest-report');
    if (btnShare) {
      btnShare.addEventListener('click', async () => {
        const lotName = lot?.geometry?.properties?.name || 'Lote Forestal';
        const lat = lot?.centroid?.lat || -38.4161;
        const lng = lot?.centroid?.lng || -63.6167;
        const ha = lot?.area?.hectares || '0.00';
        const geom = lot?.geometry ? JSON.stringify(lot.geometry) : '';

        const baseUrl = window.location.origin + window.location.pathname.replace(/forestal(\.html)?/, 'reporte.html');
        const shareUrl = `${baseUrl}?lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}&nombre=${encodeURIComponent(lotName)}&ha=${ha}&type=forestal${geom ? '&geom=' + encodeURIComponent(geom) : ''}`;

        const shareData = {
          title: `Informe Técnico Forestal — ${lotName}`,
          text: `Informe de Análisis Forestal y Teledetección para ${lotName} en Agro Consultas:`,
          url: shareUrl
        };

        if (navigator.share) {
          try {
            await navigator.share(shareData);
          } catch (e) {}
        } else {
          navigator.clipboard.writeText(shareUrl).then(() => {
            alert("Enlace único del reporte forestal copiado al portapapeles:\n" + shareUrl);
          }).catch(() => {
            alert("Enlace único del reporte forestal:\n" + shareUrl);
          });
        }
      });
    }
  }
}
