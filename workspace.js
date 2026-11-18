/* Shared navigation, projects and active lot context for Agro-Consultas. */
import {
  getLotContext,
  getWorkspaceState,
  setLotContext,
  createWorkspaceProject,
  selectWorkspaceProject,
  selectWorkspaceLot,
  WORKSPACE_STORAGE_KEY
} from './services/lotContext.js';

(function () {
  'use strict';

  const pages = [
    ['index.html', 'Inicio', '⌂'],
    ['mapa.html', 'Mapa', '⌖'],
    ['resultados.html', 'Agro', '♧'],
    ['forestal.html', 'Forestal', '♣'],
    ['incendios.html', 'Incendios', '♨'],
    ['tracking.html', 'Campo', '⌁'],
    ['reporte.html', 'Informes', '▤']
  ];
  const path = location.pathname.split('/').pop() || 'index.html';

  function activeLotLabel(feature) {
    return feature?.properties?.name || feature?.properties?.nombre ||
      feature?.properties?.lotName || 'Sin lote activo';
  }

  function makeLink([href, label, icon], mobile = false) {
    const link = document.createElement('a');
    link.href = href;
    if (href === path) link.setAttribute('aria-current', 'page');
    if (mobile) {
      const symbol = document.createElement('span');
      symbol.setAttribute('aria-hidden', 'true');
      symbol.textContent = icon;
      const text = document.createElement('span');
      text.textContent = label;
      link.append(symbol, text);
    } else {
      link.textContent = label;
    }
    return link;
  }

  function makeSelect(className, label) {
    const select = document.createElement('select');
    select.className = className;
    select.setAttribute('aria-label', label);
    return select;
  }

  function renderNavigation() {
    if (document.querySelector('.ac-workspace-bar')) return;
    const bar = document.createElement('div');
    bar.className = 'ac-workspace-bar';

    const brand = document.createElement('a');
    brand.className = 'ac-brand';
    brand.href = 'index.html';
    const mark = document.createElement('span');
    mark.className = 'ac-brand-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = 'AC';
    const name = document.createElement('span');
    name.textContent = 'Agro-Consultas';
    brand.append(mark, name);

    const desktop = document.createElement('nav');
    desktop.className = 'ac-workspace-links';
    desktop.setAttribute('aria-label', 'Navegación principal');
    pages.forEach(item => desktop.appendChild(makeLink(item)));

    const controls = document.createElement('div');
    controls.className = 'ac-workspace-controls';
    const projectSelect = makeSelect('ac-project-select', 'Proyecto activo');
    projectSelect.id = 'ac-project-select';
    const lotSelect = makeSelect('ac-lot-select', 'Lote activo');
    lotSelect.id = 'ac-lot-select';
    const createButton = document.createElement('button');
    createButton.type = 'button';
    createButton.className = 'ac-new-project';
    createButton.textContent = '+ Proyecto';
    createButton.title = 'Crear un proyecto nuevo';
    controls.append(projectSelect, lotSelect, createButton);

    const context = document.createElement('span');
    context.className = 'ac-project-chip';
    context.setAttribute('role', 'status');
    context.setAttribute('aria-live', 'polite');

    bar.append(brand, desktop, controls, context);
    document.body.insertBefore(bar, document.body.firstChild);

    const mobile = document.createElement('nav');
    mobile.className = 'ac-mobile-nav';
    mobile.setAttribute('aria-label', 'Navegación principal');
    pages.forEach(item => mobile.appendChild(makeLink(item, true)));
    document.body.appendChild(mobile);

    projectSelect.addEventListener('change', () => {
      try {
        selectWorkspaceProject(projectSelect.value);
        renderContext();
        if (path === 'reporte.html') window.location.replace('reporte.html');
      } catch (error) {
        window.alert(error.message);
        renderContext();
      }
    });
    lotSelect.addEventListener('change', () => {
      if (!lotSelect.value) return;
      try {
        selectWorkspaceLot(lotSelect.value);
        renderContext();
        if (path === 'reporte.html') window.location.replace('reporte.html');
      } catch (error) {
        window.alert(error.message);
        renderContext();
      }
    });
    createButton.addEventListener('click', () => {
      const name = window.prompt('Nombre del nuevo proyecto:');
      if (!name?.trim()) return;
      try {
        createWorkspaceProject(name);
        renderContext();
        if (path === 'reporte.html') window.location.replace('reporte.html');
      } catch (error) {
        window.alert(error.message);
      }
    });
  }

  function migrateLegacyLot(state, feature) {
    if (!feature) return;
    const saved = state.projects.some(project =>
      project.lots.some(lot => lot.id === feature.properties?.workspaceLotId)
    );
    if (!saved) {
      try { setLotContext(feature, { source: feature.properties?.source || 'workspace-migration' }); }
      catch (error) { console.warn('[Agro-Consultas] No se pudo migrar el lote al espacio de trabajo:', error); }
    }
  }

  function renderContext() {
    const state = getWorkspaceState();
    const feature = getLotContext();
    migrateLegacyLot(state, feature);
    const refreshedState = getWorkspaceState();
    const projectSelect = document.getElementById('ac-project-select');
    const lotSelect = document.getElementById('ac-lot-select');
    const context = document.querySelector('.ac-project-chip');

    if (projectSelect) {
      const activeProjectId = refreshedState.activeProjectId;
      projectSelect.replaceChildren();
      refreshedState.projects.forEach(project => {
        const option = document.createElement('option');
        option.value = project.id;
        option.textContent = project.name;
        option.selected = project.id === activeProjectId;
        projectSelect.appendChild(option);
      });
    }

    if (lotSelect) {
      const activeProject = refreshedState.projects.find(project => project.id === refreshedState.activeProjectId);
      const lots = activeProject?.lots || [];
      lotSelect.replaceChildren();
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = lots.length ? 'Seleccionar lote…' : 'Sin lotes guardados';
      placeholder.selected = !refreshedState.activeLotId;
      lotSelect.appendChild(placeholder);
      lots.forEach(lot => {
        const option = document.createElement('option');
        option.value = lot.id;
        option.textContent = lot.name;
        option.selected = lot.id === refreshedState.activeLotId;
        lotSelect.appendChild(option);
      });
    }

    if (context) {
      const activeProject = refreshedState.projects.find(project => project.id === refreshedState.activeProjectId);
      context.textContent = '⌖ ' + activeLotLabel(feature);
      context.title = activeProject
        ? 'Proyecto: ' + activeProject.name + (feature ? ' · Lote activo en este navegador' : ' · Sin lote activo')
        : 'Seleccioná un proyecto y un lote';
    }
  }

  renderNavigation();
  renderContext();
  window.addEventListener('storage', event => {
    if (event.key === WORKSPACE_STORAGE_KEY || event.key === 'agro_lot_context_v1') renderContext();
  });
  window.addEventListener('agro:lot-context-changed', renderContext);
  window.addEventListener('agro:workspace-changed', renderContext);
})();
