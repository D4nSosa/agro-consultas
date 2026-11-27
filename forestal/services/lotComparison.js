import { getWorkspaceState } from '../../services/lotContext.js';

const API_URL = '/api/engine/compare';
const DEFAULT_PROCESSORS = ['hansen', 'gfw-drivers', 'jrc'];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function currentLots() {
  const state = getWorkspaceState();
  const project = state.projects.find(item => item.id === state.activeProjectId);
  return { project, lots: project?.lots || [] };
}

function metricLabel(path) {
  return path.split('.').slice(-1)[0].replaceAll('_', ' ');
}

function formatValue(value) {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(value);
}

function renderMetric(row) {
  const values = row.values || [];
  const maxAbs = Math.max(1, ...values.map(item => Math.abs(item.value)));
  const colors = ['#238b57', '#3478b8', '#d28b32', '#8a63b5', '#bd5a5a'];
  return `
    <article class="ac-compare-metric">
      <h4>${escapeHtml(metricLabel(row.metric))}</h4>
      <div class="ac-compare-bars">
        ${values.map((item, index) => `
          <div class="ac-compare-bar-row">
            <span>${escapeHtml(item.lotName)}</span>
            <div class="ac-compare-bar-track"><i style="width:${Math.max(1, Math.abs(item.value) / maxAbs * 100)}%;background:${colors[index % colors.length]}"></i></div>
            <strong>${formatValue(item.value)}</strong>
          </div>`).join('')}
      </div>
      <small>${values.length > 1 ? `Diferencia respecto de ${escapeHtml(values[0].lotName)}: ${values.slice(1).map(item => `${escapeHtml(item.lotName)} ${formatValue(item.differenceFromFirst)} (${item.differencePercentFromFirst == null ? '—' : formatValue(item.differencePercentFromFirst) + '%'})`).join(' · ')}` : 'Sin comparación completa entre lotes'}</small>
    </article>`;
}

function renderResults(container, data) {
  const lotStatuses = data.lots.map(lot => {
    const statuses = Object.entries(lot.datasets || {}).map(([source, item]) =>
      `<li><strong>${escapeHtml(source)}:</strong> ${escapeHtml(item.status === 'PROCESSED' ? 'Procesado' : item.error || 'No disponible')}</li>`
    ).join('');
    return `<div class="ac-compare-lot-status"><strong>${escapeHtml(lot.name)}</strong><ul>${statuses}</ul></div>`;
  }).join('');
  const sections = Object.entries(data.comparisons || {}).map(([source, rows]) => `
    <section class="ac-compare-source">
      <h3>${escapeHtml(source)}</h3>
      ${rows.length ? rows.map(renderMetric).join('') : '<p class="ac-compare-empty">No hay métricas comunes disponibles para comparar en esta fuente.</p>'}
      ${data.comparisonNotes?.[source] ? `<p class="ac-compare-empty">${escapeHtml(data.comparisonNotes[source])}</p>` : ''}
    </section>`).join('');
  container.innerHTML = `
    <div class="ac-compare-summary"><strong>Estado: ${escapeHtml(data.status)}</strong><p>${escapeHtml(data.comparisonMethod)}</p></div>
    <div class="ac-compare-status-grid">${lotStatuses}</div>
    <div class="ac-compare-results">${sections}</div>
    <ul class="ac-compare-limitations">${(data.limitations || []).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

export function initializeLotComparison() {
  const root = document.getElementById('lot-comparison');
  if (!root) return;
  const lotOptions = root.querySelector('#ac-compare-lot-options');
  const status = root.querySelector('#ac-compare-status');
  const results = root.querySelector('#ac-compare-output');
  const runButton = root.querySelector('#ac-run-comparison');

  function refreshLots() {
    const { project, lots } = currentLots();
    const previous = new Set(Array.from(lotOptions.querySelectorAll('input:checked'), input => input.value));
    lotOptions.replaceChildren();
    for (const lot of lots) {
      const label = document.createElement('label');
      label.className = 'ac-compare-lot-option';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = lot.id;
      checkbox.checked = previous.has(lot.id);
      const name = document.createElement('span');
      name.textContent = lot.name;
      label.append(checkbox, name);
      lotOptions.appendChild(label);
    }
    root.querySelector('#ac-compare-project').textContent = project
      ? `Proyecto: ${project.name} · ${lots.length} lotes guardados`
      : 'No hay proyecto activo';
    if (lots.length < 2) status.textContent = 'Guardá al menos dos lotes en el mismo proyecto para compararlos.';
  }

  const spectralDate = root.querySelector('#ac-compare-spectral-date');
  if (spectralDate && !spectralDate.value) spectralDate.value = new Date().toISOString().slice(0, 10);

  refreshLots();
  window.addEventListener('agro:workspace-changed', refreshLots);
  window.addEventListener('agro:lot-context-changed', refreshLots);

  runButton.addEventListener('click', async () => {
    const { lots } = currentLots();
    const selectedIds = Array.from(lotOptions.querySelectorAll('input:checked'), input => input.value);
    if (selectedIds.length < 2 || selectedIds.length > 5) {
      status.textContent = 'Seleccioná entre 2 y 5 lotes del proyecto activo.';
      return;
    }
    const selected = selectedIds.map(id => lots.find(lot => lot.id === id)).filter(Boolean);
    if (selected.length !== selectedIds.length || selected.some(lot => !lot.feature?.geometry)) {
      status.textContent = 'Uno o más lotes no tienen una geometría guardada válida.';
      return;
    }
    runButton.disabled = true;
    status.textContent = 'Procesando las mismas fuentes para todos los lotes. Puede demorar según la disponibilidad de los datos.';
    results.replaceChildren();
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          lots: selected.map(lot => ({
            id: lot.id,
            name: lot.name,
            geometry: lot.feature.geometry
          })),
          processors: [
            ...DEFAULT_PROCESSORS,
            ...(root.querySelector('#ac-compare-spectral')?.checked ? ['spectral'] : []),
            ...(root.querySelector('#ac-compare-terrain')?.checked ? ['terrain'] : [])
          ],
          spectral_date: spectralDate?.value || null,
          spectral_collection: 'auto',
          spectral_indices: ['ndvi', 'evi', 'ndmi', 'gndvi', 'ndre']
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail?.message || payload.detail || `Error HTTP ${response.status}`);
      renderResults(results, payload);
      status.textContent = payload.status === 'PROCESSED'
        ? 'Comparación procesada.'
        : payload.status === 'PARTIAL'
          ? 'Comparación parcial: revisá las fuentes no disponibles.'
          : 'No se pudo procesar ninguna de las fuentes seleccionadas.';
    } catch (error) {
      status.textContent = `No se pudo completar la comparación: ${error.message}`;
    } finally {
      runButton.disabled = false;
    }
  });
}
