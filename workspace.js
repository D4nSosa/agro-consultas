/* Shared navigation and active lot context for Agro-Consultas. */
(function () {
  'use strict';

  const pages = [
    ['mapa.html', 'Mapa', '⌖'],
    ['resultados.html', 'Agro', '♧'],
    ['forestal.html', 'Forestal', '♣'],
    ['incendios.html', 'Incendios', '♨'],
    ['tracking.html', 'Campo', '⌁'],
    ['reporte.html', 'Informes', '▤']
  ];
  const path = location.pathname.split('/').pop() || 'index.html';
  const storageKey = 'agro_lot_context_v1';

  function readLot() {
    for (const storeName of ['localStorage', 'sessionStorage']) {
      try {
        const raw = window[storeName]?.getItem(storageKey);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        const feature = parsed?.feature;
        if (feature?.type === 'Feature' && feature.geometry &&
            ['Polygon', 'MultiPolygon'].includes(feature.geometry.type)) return feature;
      } catch (_) { /* Keep the rest of the workspace usable if storage is blocked. */ }
    }
    return null;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function activeLotLabel(feature) {
    return feature?.properties?.name || feature?.properties?.nombre ||
      feature?.properties?.lotName || 'Sin lote activo';
  }

  function renderContext() {
    const feature = readLot();
    const label = activeLotLabel(feature);
    let context = document.querySelector('.ac-project-chip');
    if (!context) {
      context = document.createElement('span');
      context.className = 'ac-project-chip';
      context.setAttribute('role', 'status');
      context.setAttribute('aria-live', 'polite');
      const header = document.querySelector('.app-header');
      if (header) {
        const target = header.querySelector('.right') || header;
        target.appendChild(context);
      } else {
        const main = document.querySelector('main');
        (main || document.body).insertBefore(context, (main || document.body).firstChild);
      }
    }
    context.textContent = '⌖ ' + label;
    context.title = feature ? 'Lote activo en este navegador' : 'Seleccioná o importá un lote desde Mapa';
  }

  function renderNavigation() {
    const nav = document.createElement('nav');
    nav.className = 'ac-mobile-nav';
    nav.setAttribute('aria-label', 'Navegación principal');
    const items = [['index.html', 'Inicio', '⌂'], ...pages];
    nav.innerHTML = items.map(([href, label, icon]) =>
      '<a href="' + href + '" ' + (href === path ? 'aria-current="page"' : '') +
      '><span aria-hidden="true">' + icon + '</span><span>' + label + '</span></a>'
    ).join('');
    document.body.appendChild(nav);
  }

  renderContext();
  renderNavigation();
  window.addEventListener('storage', event => {
    if (event.key === storageKey) renderContext();
  });
  window.addEventListener('agro:lot-context-changed', renderContext);
})();
