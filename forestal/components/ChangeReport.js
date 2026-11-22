/**
 * ChangeReport.js - Panel de resultados de análisis forestal
 */

export class ChangeReport {
  constructor(containerId) {
    this.containerId = containerId;
  }

  renderReport(analysisData) {
    const container = document.getElementById(this.containerId);
    if (!container || !analysisData) return;

    const { lot, dates, products, ndvi, changes, aptitude } = analysisData;
    const search = analysisData.search || {};
    const prodA = products?.productA || null;
    const prodB = products?.productB || null;
    const previewA = [prodA?.assets?.thumbnail, prodA?.assets?.visual].find(url => typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) || null;
    const previewB = [prodB?.assets?.thumbnail, prodB?.assets?.visual].find(url => typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) || null;
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
              <span>🌲</span> Resultados del análisis forestal y teledetección
            </h2>
            <div style="font-size: 0.9rem; color: var(--texto-secundario); margin-top: 5px;">
              Agro Consultas — Módulo Forestal
            </div>
          </div>
          <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
            <div style="font-size: 0.85rem; font-weight: bold;">Fecha de Emisión:</div>
            <div style="font-size: 0.85rem; color: var(--texto-secundario);">${new Date().toLocaleDateString('es-AR')}</div>
            <div style="display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; justify-content: flex-end;">

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
            <span style="font-size: 0.8rem; color: var(--texto-secundario); display: block;">Superficie geométrica estimada:</span>
            <strong>${lot?.area?.isPoint ? 'Sin superficie (punto de consulta)' : `${lot?.area?.hectares || 0} ha (${lot?.area?.squareMeters || 0} m²)`}</strong>
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

        <div style="margin:12px 0;padding:12px;border:1px solid var(--borde-suave);border-radius:8px;background:var(--gris-fondo);font-size:.82rem;line-height:1.5">
          <strong>Estado de consulta STAC:</strong>
          <div>Fecha A: ${search.dateA?.message || (prodA ? 'Escena identificada.' : 'No se obtuvo escena para la fecha A.')}</div>
          <div>Fecha B: ${search.dateB?.message || (prodB ? 'Escena identificada.' : 'No se obtuvo escena para la fecha B.')}</div>
          <small style="color:var(--texto-secundario)">La búsqueda se realiza por intersección con la geometría del lote. La miniatura es una vista previa del catálogo; el NDVI requiere procesamiento ráster válido.</small>
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
                <li><strong>Nubosidad:</strong> ${prodA.cloudCoverDisplay || (Number.isFinite(prodA.cloudCover) ? `${prodA.cloudCover}%` : 'No informada')}</li>
                <li><strong>Resolución:</strong> 10 metros</li>
              </ul>
              ${previewA ? `<img loading="lazy" src="${previewA}" alt="Vista previa Sentinel-2 Fecha A" style="display:block;width:100%;max-height:220px;object-fit:contain;margin-top:10px;border-radius:6px">` : `<div style="font-size:.78rem;color:var(--texto-secundario);margin-top:8px">Escena identificada, pero el catálogo no entregó una miniatura o visualización.</div>`}
            ` : `<div style="font-size: 0.85rem; color: var(--texto-secundario); margin-top: 8px;">NO DISPONIBLE: ${search.dateA?.message || 'No se encontró escena en la ventana temporal consultada.'}</div>`}
          </div>

          <div style="border: 1px solid var(--borde-suave); padding: 12px; border-radius: 8px;">
            <strong style="color: #2980b9;">🔵 Escena Fecha B</strong>
            ${prodB ? `
              <ul style="font-size: 0.85rem; margin: 8px 0 0 0; padding-left: 20px; line-height: 1.5;">
                <li><strong>Fuente:</strong> ${prodB.source || 'Sentinel-2 L2A'}</li>
                <li><strong>Identificador:</strong> ${prodB.id}</li>
                <li><strong>Fecha Adquisición:</strong> ${prodB.date}</li>
                <li><strong>Nubosidad:</strong> ${prodB.cloudCoverDisplay || (Number.isFinite(prodB.cloudCover) ? `${prodB.cloudCover}%` : 'No informada')}</li>
                <li><strong>Resolución:</strong> 10 metros</li>
              </ul>
              ${previewB ? `<img loading="lazy" src="${previewB}" alt="Vista previa Sentinel-2 Fecha B" style="display:block;width:100%;max-height:220px;object-fit:contain;margin-top:10px;border-radius:6px">` : `<div style="font-size:.78rem;color:var(--texto-secundario);margin-top:8px">Escena identificada, pero el catálogo no entregó una miniatura o visualización.</div>`}
            ` : `<div style="font-size: 0.85rem; color: var(--texto-secundario); margin-top: 8px;">NO DISPONIBLE: ${search.dateB?.message || 'No se encontró escena en la ventana temporal consultada.'}</div>`}
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
          Este panel presenta los resultados del análisis ejecutado desde el módulo Forestal. Para consultar, descargar o compartir el documento consolidado de todos los módulos, utilizá Informes.
        </div>
      </div>
    `;


  }
}
