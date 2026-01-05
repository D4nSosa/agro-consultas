/* ============================================================================
   resultados.js — Lógica de mapa y dashboard para la página de resultados
   ============================================================================ */

/* Normalización unificada */
function normalizeKey(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Inicialización global del gráfico para poder destruirlo después
let seasonalityChart = null;

// Ejecutamos todo dentro de un inicializador
document.addEventListener('DOMContentLoaded', () => {

  /* ------------------- ELEMENTOS DEL DOM Y ESTADO ------------------- */
  const resultadoUbicacion = document.getElementById('resultado_ubicacion');
  const mapaContainer = document.getElementById('mapaContainer');
  const kpisContainer = document.getElementById('kpis');
  const recomendacionesPanel = document.getElementById('recomendaciones');
  const mapaLoader = document.getElementById('mapaLoader');
  const mapaError = document.getElementById('mapaError');

  /* ------------------- LECTURA DE PARÁMETROS ------------------- */
  const params = new URLSearchParams(window.location.search);
  let ubicRaw = params.get('ubicacion') || '';

  resultadoUbicacion.innerText = ubicRaw || '(Seleccione una provincia)';

  function safeRender(ubic) {
    resultadoUbicacion.innerText = ubic;
    if (typeof renderForLocation === 'function') renderForLocation(ubic);
    populateKPIsAndCharts(ubic);
  }

  /* ------------------- MAPA ------------------- */
  const map = L.map(mapaContainer, { zoomControl: true })
    .setView([-38.4, -63.6], 4);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '© OpenStreetMap'
  }).addTo(map);

  function getProvinceName(props) {
    return props.provincia || props.NAME || props.name || "";
  }

  const provinciaLayer = L.geoJSON(null, {
    style: () => ({ color: '#2b6e2b', weight: 1.2, fillOpacity: 0.06 }),
    onEachFeature: function (feature, layer) {
      const name = getProvinceName(feature.properties);
      layer.bindTooltip(name, { permanent: false, direction: 'center', className: 'leaflet-tooltip-lite' });
      layer.on('click', () => {
        window.location.href = `?ubicacion=${encodeURIComponent(name)}`;
      });
      layer.on('mouseover', () => layer.setStyle({ fillOpacity: 0.18 }));
      layer.on('mouseout', () => layer.setStyle({ fillOpacity: 0.06 }));
    }
  }).addTo(map);

  const climaLayer = L.geoJSON(null, { style: f => ({ color: '#444', weight: 1, fillColor: f.properties.color || '#999', fillOpacity: 0.28 }) });
  const agroLayer = L.geoJSON(null, { style: f => ({ color: '#333', weight: 1, fillColor: f.properties.color || '#bbb', fillOpacity: 0.22 }) });

  /* ------------------- CARGA DE GEOJSON ------------------- */
  Promise.all([
    fetch('data/provincias.geojson').then(r => r.json()),
    fetch('data/climas.json').then(r => r.json()),
    fetch('data/regiones_productivas.json').then(r => r.json())
  ])
  .then(([provJson, climaJson, agroJson]) => {
    mapaLoader.style.display = 'none'; // Ocultar loader en éxito

    provinciaLayer.addData(provJson);
    climaLayer.addData(climaJson);
    agroLayer.addData(agroJson);

    // Leyenda
    const legend = L.control({position: 'bottomright'});
    legend.onAdd = function (map) {
      const div = L.DomUtil.create('div', 'info legend');
      function generateHtml(title, features) {
        let html = `<h4>${title}</h4>`;
        const added = new Set();
        features.forEach(f => {
          const name = f.properties.nombre;
          const color = f.properties.color;
          if (name && color && !added.has(name)) {
            html += `<i style="background:${color}"></i> ${name}<br>`;
            added.add(name);
          }
        });
        return html;
      }
      div.innerHTML = generateHtml('Climas', climaJson.features) + '<br>' + generateHtml('Reg. Productivas', agroJson.features);
      return div;
    };
    legend.addTo(map);

    // Controles de capas
    document.getElementById('toggleClima').addEventListener('change', e => e.target.checked ? map.addLayer(climaLayer) : map.removeLayer(climaLayer));
    document.getElementById('toggleRegiones').addEventListener('change', e => e.target.checked ? map.addLayer(agroLayer) : map.removeLayer(agroLayer));
    document.getElementById('toggleProvincias').addEventListener('change', e => e.target.checked ? map.addLayer(provinciaLayer) : map.removeLayer(provinciaLayer));

    // Resaltado y zoom de provincia
    if (ubicRaw) {
      const normalized = normalizeKey(ubicRaw);
      let foundLayer = null;
      provinciaLayer.eachLayer(layer => {
        const name = getProvinceName(layer.feature.properties);
        if (normalizeKey(name) === normalized) foundLayer = layer;
      });

      if (foundLayer) {
        foundLayer.setStyle({ color: '#28a745', weight: 3, fillOpacity: 0.25 });
        foundLayer.bringToFront();
        map.fitBounds(foundLayer.getBounds(), { maxZoom: 8, padding: [20, 20] });
        safeRender(ubicRaw);
      }
    }
  })
  .catch(err => {
    console.error("Error cargando datos geográficos:", err);
    mapaLoader.style.display = 'none';
    mapaError.innerHTML = `<strong>Error:</strong> No se pudieron cargar los datos del mapa.<br><small>${err.message}</small>`;
    mapaError.style.display = 'flex';
  });

  /* ------------------- Dashboard KPIs y Gráficos ------------------- */
  function populateKPIsAndCharts(provName) {
    const key = normalizeKey(provName);
    const info = agroDB[key];
    kpisContainer.innerHTML = '';

    if (!info) {
      kpisContainer.innerHTML = '<div class="kpi">Sin datos</div>';
      if (seasonalityChart) seasonalityChart.destroy();
      return;
    }

    const kpis = [
      { title: 'Cultivos', value: info.cultivos.join(', ') },
      { title: 'Suelos', value: info.suelo },
      { title: 'Clima', value: info.clima },
      { title: 'Riego', value: info.riego }
    ];

    kpis.forEach(k => {
      const el = document.createElement('div');
      el.className = 'kpi';
      el.innerHTML = `<h5>${k.title}</h5><strong>${k.value}</strong>`;
      kpisContainer.appendChild(el);
    });

    recomendacionesPanel.innerText = `Cultivos: ${info.cultivos.join(', ')}\n\nSuelo: ${info.suelo}\n\nClima: ${info.clima}\n\nRiego: ${info.riego}`;

    /* Gráfico de Estacionalidad */
    const chartCanvas = document.getElementById('seasonalityChart');
    if (seasonalityChart) seasonalityChart.destroy();

    const ventanaData = info.ventanaSiembra || {};
    const crops = Object.keys(ventanaData);

    if (crops.length === 0) {
      chartCanvas.style.display = 'none';
      return;
    } else {
      chartCanvas.style.display = 'block';
    }

    const datasets = [];
    const colors = ['rgba(255, 99, 132, 0.6)', 'rgba(54, 162, 235, 0.6)', 'rgba(255, 206, 86, 0.6)', 'rgba(75, 192, 192, 0.6)', 'rgba(153, 102, 255, 0.6)', 'rgba(255, 159, 64, 0.6)'];
    let colorIndex = 0;

    const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

    crops.forEach(crop => {
      const [start, end] = ventanaData[crop];
      const color = colors[colorIndex % colors.length];
      colorIndex++;
      if (start <= end) {
        datasets.push({ label: crop, data: [{ x: [start, end], y: crop }], backgroundColor: color, barPercentage: 0.7 });
      } else {
        datasets.push({ label: crop, data: [{ x: [start, 12.5], y: crop }], backgroundColor: color, barPercentage: 0.7 });
        datasets.push({ label: crop, data: [{ x: [0.5, end], y: crop }], backgroundColor: color, barPercentage: 0.7, C: false });
      }
    });

    seasonalityChart = new Chart(chartCanvas, {
      type: 'bar',
      data: { labels: crops, datasets: datasets },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { min: 1, max: 12, title: { display: true, text: 'Mes del Año' }, ticks: { stepSize: 1, callback: (value) => months[value - 1] || '' } },
          y: { grid: { display: false } }
        },
        plugins: {
          legend: { display: false },
          title: { display: true, text: 'Ventanas de Siembra' },
          tooltip: {
            callbacks: {
              label: function(context) {
                const [start, end] = context.raw.x;
                const startMonth = months[Math.ceil(start) - 1];
                const endMonth = months[Math.floor(end) - 1] || months[11];
                return `${context.dataset.label}: ${startMonth} a ${endMonth}`;
              }
            }
          }
        }
      }
    });
  }

  // Carga inicial si hay ubicación
  if (ubicRaw) {
    safeRender(ubicRaw);
  }
});
