/* Shared navigation and active lot context for Agro-Consultas. */
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
  const storageKey = 'agro_lot_context_v1';

  function readLot() {
    const candidates = [];
    for (const storeName of ['localStorage', 'sessionStorage']) {
      try {
        const raw = window[storeName]?.getItem(storageKey);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        const feature = parsed?.feature;
        if (feature?.type !== 'Feature' || !feature.geometry ||
            !['Polygon', 'MultiPolygon'].includes(feature.geometry.type)) continue;
        const timestamp = Date.parse(feature.properties?.updatedAt || '') || 0;
        candidates.push({ feature, timestamp });
      } catch (_) { /* Keep the rest of the workspace usable if storage is blocked. */ }
    }
    candidates.sort((a, b) => b.timestamp - a.timestamp);
    return candidates[0]?.feature || null;
  }

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

    bar.append(brand, desktop);
    document.body.insertBefore(bar, document.body.firstChild);

    const mobile = document.createElement('nav');
    mobile.className = 'ac-mobile-nav';
    mobile.setAttribute('aria-label', 'Navegación principal');
    pages.forEach(item => mobile.appendChild(makeLink(item, true)));
    document.body.appendChild(mobile);
  }

  function renderContext() {
    const feature = readLot();
    let context = document.querySelector('.ac-project-chip');
    if (!context) {
      context = document.createElement('span');
      context.className = 'ac-project-chip';
      context.setAttribute('role', 'status');
      context.setAttribute('aria-live', 'polite');
      const bar = document.querySelector('.ac-workspace-bar');
      if (bar) bar.appendChild(context);
    }
    context.textContent = '⌖ ' + activeLotLabel(feature);
    context.title = feature ? 'Lote activo en este navegador' : 'Seleccioná o importá un lote desde Mapa';
  }

  renderNavigation();
  renderContext();
  window.addEventListener('storage', event => {
    if (event.key === storageKey) renderContext();
  });
  window.addEventListener('agro:lot-context-changed', renderContext);
})();
