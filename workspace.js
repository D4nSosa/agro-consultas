/* Shared navigation and project context for Agro-Consultas. No data is fabricated. */
(function(){
  'use strict';
  const pages=[
    ['mapa.html','Mapa','⌖'],['resultados.html','Agro','♧'],['forestal.html','Forestal','♣'],['incendios.html','Incendios','♨'],['tracking.html','Campo','⌁'],['reporte.html','Informes','▤']
  ];
  const path=location.pathname.split('/').pop()||'index.html';
  const current=pages.find(p=>p[0]===path);
  const saved=(()=>{try{return JSON.parse(localStorage.getItem('agro_lot_context_v1')||'null')}catch(_){return null}})();
  const label=saved?.name||saved?.properties?.name||saved?.properties?.nombre||'Espacio territorial';
  const bar=document.createElement('header');bar.className='ac-workspace-bar';
  bar.innerHTML='<a class="ac-brand" href="index.html"><span class="ac-brand-mark">A</span><span>Agro-Consultas</span></a><span class="ac-project-chip" title="Contexto territorial activo">⌖ '+escapeHtml(String(label))+'</span><nav class="ac-workspace-links" aria-label="Módulos">'+pages.map(p=>'<a href="'+p[0]+'" '+(p[0]===path?'aria-current="page"':'')+'>'+p[1]+'</a>').join('')+'</nav>';
  document.body.insertBefore(bar,document.body.firstChild);
  const nav=document.createElement('nav');nav.className='ac-mobile-nav';nav.setAttribute('aria-label','Navegación principal');
  const items=[['index.html','Inicio','⌂'],...pages.slice(0,4),['reporte.html','Más','⋯']];
  nav.innerHTML=items.map(p=>'<a href="'+p[0]+'" '+(p[0]===path?'aria-current="page"':'')+'><span aria-hidden="true">'+p[2]+'</span><span>'+p[1]+'</span></a>').join('');
  document.body.appendChild(nav);
  function escapeHtml(v){return v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
})();
