/* Shared navigation and project/lot workspace for Agro-Consultas. */
import {
  getLotContext, getWorkspaceState, setLotContext, createWorkspaceProject,
  selectWorkspaceProject, selectWorkspaceLot, WORKSPACE_STORAGE_KEY
} from './services/lotContext.js';

(function () {
  'use strict';
  const pages = [
    ['index.html', 'Inicio', '⌂'], ['mapa.html', 'Mapa', '⌖'],
    ['resultados.html', 'Agro', '♧'], ['forestal.html', 'Forestal', '♣'],
    ['incendios.html', 'Incendios', '♨'], ['tracking.html', 'Campo', '⌁'],
    ['reporte.html', 'Informes', '▤']
  ];
  const path = location.pathname.split('/').pop() || 'index.html';
  const activeLotLabel = feature => feature?.properties?.name || feature?.properties?.nombre ||
    feature?.properties?.lotName || 'Sin lote activo';

  function makeLink([href, label, icon]) {
    const link = document.createElement('a');
    link.href = href;
    if (href === path) link.setAttribute('aria-current', 'page');
    const symbol = document.createElement('span');
    symbol.setAttribute('aria-hidden', 'true');
    symbol.textContent = icon;
    const text = document.createElement('span');
    text.textContent = label;
    link.append(symbol, text);
    return link;
  }

  function makeSelect(className, label) {
    const select = document.createElement('select');
    select.className = className;
    select.setAttribute('aria-label', label);
    return select;
  }

  function renderNavigation() {
    if (document.querySelector('.ac-mobile-nav')) return;
    const header = document.querySelector('.app-header');
    const actions = header?.querySelector('.right');
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'ac-workspace-trigger';
    trigger.id = 'ac-open-workspace';
    trigger.textContent = '⌖ Espacio';
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-controls', 'ac-workspace-dialog');

    const dialog = document.createElement('dialog');
    dialog.className = 'ac-workspace-dialog';
    dialog.id = 'ac-workspace-dialog';
    dialog.setAttribute('aria-labelledby', 'ac-workspace-title');
    dialog.innerHTML = '<form method="dialog" class="ac-workspace-dialog-head"><strong id="ac-workspace-title">Espacio de trabajo</strong><button class="ac-dialog-close" aria-label="Cerrar">×</button></form><p class="ac-workspace-description">El proyecto y el lote activos se comparten entre los módulos en este dispositivo.</p><label>Proyecto<select id="ac-project-select" class="ac-project-select" aria-label="Proyecto activo"></select></label><label>Lote<select id="ac-lot-select" class="ac-lot-select" aria-label="Lote activo"></select></label><div class="ac-workspace-dialog-actions"><button type="button" id="ac-new-project" class="ac-new-project">＋ Crear proyecto</button><span id="ac-project-chip" role="status" aria-live="polite"></span></div>';
    document.body.appendChild(dialog);
    if (actions) actions.insertBefore(trigger, actions.querySelector('#themeToggle'));
    else document.body.insertBefore(trigger, document.querySelector('main'));

    const mobile = document.createElement('nav');
    mobile.className = 'ac-mobile-nav';
    mobile.setAttribute('aria-label', 'Navegación principal');
    pages.forEach(item => mobile.appendChild(makeLink(item)));
    document.body.appendChild(mobile);

    trigger.addEventListener('click', () => {
      renderContext();
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    });
    dialog.addEventListener('click', event => {
      if (event.target === dialog) dialog.close();
    });
    dialog.querySelector('#ac-project-select').addEventListener('change', event => {
      try { selectWorkspaceProject(event.target.value); renderContext(); }
      catch (error) { window.alert(error.message); renderContext(); }
    });
    dialog.querySelector('#ac-lot-select').addEventListener('change', event => {
      if (!event.target.value) return;
      try { selectWorkspaceLot(event.target.value); renderContext(); }
      catch (error) { window.alert(error.message); renderContext(); }
    });
    dialog.querySelector('#ac-new-project').addEventListener('click', () => {
      const name = window.prompt('Nombre del nuevo proyecto:');
      if (!name?.trim()) return;
      try { createWorkspaceProject(name); renderContext(); }
      catch (error) { window.alert(error.message); }
    });
  }

  function migrateLegacyLot(state, feature) {
    if (!feature) return;
    const saved = state.projects.some(project =>
      project.lots.some(lot => lot.id === feature.properties?.workspaceLotId));
    if (!saved) {
      try { setLotContext(feature, { source: feature.properties?.source || 'workspace-migration' }); }
      catch (error) { console.warn('[Agro-Consultas] No se pudo migrar el lote:', error); }
    }
  }

  function renderContext() {
    const state = getWorkspaceState();
    const feature = getLotContext();
    migrateLegacyLot(state, feature);
    const refreshed = getWorkspaceState();
    const projectSelect = document.getElementById('ac-project-select');
    const lotSelect = document.getElementById('ac-lot-select');
    const chip = document.getElementById('ac-project-chip');
    if (projectSelect) {
      projectSelect.replaceChildren();
      refreshed.projects.forEach(project => {
        const option = document.createElement('option');
        option.value = project.id; option.textContent = project.name;
        option.selected = project.id === refreshed.activeProjectId;
        projectSelect.appendChild(option);
      });
    }
    if (lotSelect) {
      const active = refreshed.projects.find(project => project.id === refreshed.activeProjectId);
      const lots = active?.lots || [];
      lotSelect.replaceChildren();
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = lots.length ? 'Elegir lote…' : 'No hay lotes guardados';
      placeholder.selected = !refreshed.activeLotId;
      lotSelect.appendChild(placeholder);
      lots.forEach(lot => {
        const option = document.createElement('option');
        option.value = lot.id; option.textContent = lot.name;
        option.selected = lot.id === refreshed.activeLotId;
        lotSelect.appendChild(option);
      });
    }
    if (chip) {
      const active = refreshed.projects.find(project => project.id === refreshed.activeProjectId);
      chip.textContent = activeLotLabel(feature);
      chip.title = active ? 'Proyecto: ' + active.name : 'Seleccioná un proyecto';
    }
    const trigger = document.getElementById('ac-open-workspace');
    if (trigger) trigger.setAttribute('aria-label', 'Espacio de trabajo. Lote activo: ' + activeLotLabel(feature));
  }

  renderNavigation();
  renderContext();
  window.addEventListener('storage', event => {
    if (event.key === WORKSPACE_STORAGE_KEY || event.key === 'agro_lot_context_v1') renderContext();
  });
  window.addEventListener('agro:lot-context-changed', renderContext);
  window.addEventListener('agro:workspace-changed', renderContext);
})();
