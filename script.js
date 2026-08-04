/* ============================================================================
   script.js — Motor de recomendaciones + UI — Agro Consultas v1.0
   ============================================================================ */

/**
 * Normaliza una cadena para búsqueda (quita acentos, múltiples espacios, pasa a minúsculas)
 */
function normalizeKey(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Convierte índice de mes a nombre
 */
function monthIndexToName(i) {
  const months = [
    "Enero","Febrero","Marzo","Abril","Mayo","Junio",
    "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"
  ];
  return months[i - 1] || "";
}

/* ============================================================================
   Base de Datos de Cultivos — Información detallada
   ============================================================================ */

const cultivosData = {
  "trigo": {
    descripcion: "Cereal de invierno fundamental para la rotación de cultivos.",
    siembra: "Mayo a Julio",
    cosecha: "Noviembre a Enero",
    reqSuelo: "Suelos profundos, texturas francas, buena fertilidad y drenaje sin encharcamientos.",
    reqClima: "Templado, precipitaciones moderadas durante macollaje y llenado.",
    pino_eucalyptus: false
  },
  "soja": {
    descripcion: "Principal cultivo de exportación, leguminosa de verano.",
    siembra: "Octubre a Diciembre",
    cosecha: "Marzo a Mayo",
    reqSuelo: "Suelos fértiles, pH neutro, buena capacidad de retención de agua.",
    reqClima: "Templado-cálido, lluvias estivales abundantes.",
    pino_eucalyptus: false
  },
  "maiz": {
    descripcion: "Cereal versátil con altos requerimientos nutricionales.",
    siembra: "Septiembre a Diciembre",
    cosecha: "Marzo a Agosto",
    reqSuelo: "Suelos profundos, ricos en materia orgánica y nitrógeno, buen drenaje.",
    reqClima: "Templado-cálido, alta radiación, lluvias suficientes en floración.",
    pino_eucalyptus: false
  },
  "cebada": {
    descripcion: "Cereal de invierno, muy utilizado en la industria cervecera.",
    siembra: "Junio a Julio",
    cosecha: "Noviembre a Diciembre",
    reqSuelo: "Suelos fértiles y bien drenados, tolera salinidad moderada.",
    reqClima: "Templado-frío, moderada humedad.",
    pino_eucalyptus: false
  },
  "girasol": {
    descripcion: "Oleaginosa resistente a sequías moderadas.",
    siembra: "Agosto a Noviembre",
    cosecha: "Enero a Marzo",
    reqSuelo: "Suelos profundos, tolera texturas más arenosas pero requiere buen drenaje.",
    reqClima: "Templado-cálido, alta heliofania (sol). Resiste sequías moderadas.",
    pino_eucalyptus: false
  },
  "sorgo": {
    descripcion: "Cereal rústico ideal para zonas con menor disponibilidad hídrica.",
    siembra: "Octubre a Noviembre",
    cosecha: "Marzo a Mayo",
    reqSuelo: "Suelos arcillosos a francos, tolera salinidad y anegamiento temporario.",
    reqClima: "Cálido, alta resistencia al estrés hídrico y temperaturas extremas.",
    pino_eucalyptus: false
  },
  "mani": {
    descripcion: "Leguminosa regional de alto valor agregado.",
    siembra: "Octubre a Noviembre",
    cosecha: "Abril a Mayo",
    reqSuelo: "Suelos sueltos, arenosos, sin piedras para permitir el 'clavado' del fruto.",
    reqClima: "Templado-cálido, libre de heladas en ciclo de cultivo.",
    pino_eucalyptus: false
  },
  "arroz": {
    descripcion: "Cereal cultivado en suelos anegadizos con riego controlado.",
    siembra: "Septiembre a Noviembre",
    cosecha: "Febrero a Abril",
    reqSuelo: "Suelos pesados (arcillosos), impermeables para retener la lámina de agua.",
    reqClima: "Subtropical o templado cálido, alta radiación solar.",
    pino_eucalyptus: false
  },
  "yerba mate": {
    descripcion: "Cultivo perenne emblemático de la región mesopotámica.",
    siembra: "Marzo a Junio (plantación)",
    cosecha: "Abril a Septiembre",
    reqSuelo: "Suelos rojos lateríticos profundos, excelente drenaje, ácidos (pH 4.5 - 6.0).",
    reqClima: "Subtropical húmedo, lluvias abundantes (>1500mm), tolerante a heladas muy suaves.",
    pino_eucalyptus: false
  },
  "citrus": {
    descripcion: "Frutales como limón, naranja y mandarina.",
    siembra: "Primavera",
    cosecha: "Invierno a Primavera",
    reqSuelo: "Suelos permeables, profundos, sin capas impermeables cerca de superficie.",
    reqClima: "Cálido y húmedo, muy sensible a heladas fuertes.",
    pino_eucalyptus: false
  },
  "te": {
    descripcion: "Infusión cultivada principalmente en Misiones y Corrientes.",
    siembra: "Otoño",
    cosecha: "Noviembre a Abril",
    reqSuelo: "Suelos muy ácidos, profundos, ricos en materia orgánica, excelente drenaje.",
    reqClima: "Cálido-templado, alta humedad ambiente y lluvias copiosas durante brotación.",
    pino_eucalyptus: false
  },
  "algodon": {
    descripcion: "Fibra textil adaptada a climas subtropicales.",
    siembra: "Octubre a Diciembre",
    cosecha: "Abril a Julio",
    reqSuelo: "Suelos profundos, fértiles, texturas francas a arcillo-limosas.",
    reqClima: "Subtropical cálido, largo período libre de heladas, lluvias estivales.",
    pino_eucalyptus: false
  },
  "vid": {
    descripcion: "Cultivo base de la industria vitivinícola en zonas áridas con riego.",
    siembra: "Agosto a Octubre (plantación)",
    cosecha: "Febrero a Abril",
    reqSuelo: "Suelos pedregosos o arenosos, baja fertilidad, drenaje perfecto.",
    reqClima: "Árido a semiárido con alta amplitud térmica diurna/nocturna.",
    pino_eucalyptus: false
  },
  "olivo": {
    descripcion: "Frutal adaptado a climas secos para producción de aceite y aceitunas.",
    siembra: "Marzo a Mayo (plantación)",
    cosecha: "Febrero a Mayo",
    reqSuelo: "Suelos permeables, calizos o arenosos, tolera cierta salinidad.",
    reqClima: "Seco, inviernos frescos (horas de frío) y veranos cálidos y secos.",
    pino_eucalyptus: false
  },
  "manzana": {
    descripcion: "Fruta de pepita típica de los valles patagónicos.",
    siembra: "Agosto a Septiembre",
    cosecha: "Enero a Abril",
    reqSuelo: "Suelos aluviales profundos, bien drenados, buen contenido de materia orgánica.",
    reqClima: "Templado-frío, requiere acumulación de horas de frío en invierno.",
    pino_eucalyptus: false
  },
  "pera": {
    descripcion: "Fruta de pepita de alta calidad de exportación.",
    siembra: "Agosto a Septiembre",
    cosecha: "Enero a Marzo",
    reqSuelo: "Suelos aluviales profundos, tolera arcilla moderada si hay buen manejo.",
    reqClima: "Templado-frío, alta heliofania para calidad de fruta.",
    pino_eucalyptus: false
  },
  "cana de azucar": {
    descripcion: "Cultivo industrial clave en el NOA.",
    siembra: "Mayo a Septiembre",
    cosecha: "Junio a Octubre",
    reqSuelo: "Suelos fértiles, profundos, buena capacidad de retención de humedad.",
    reqClima: "Subtropical húmedo, alta radiación solar, libre de heladas fuertes.",
    pino_eucalyptus: false
  },
  "limon": {
    descripcion: "Líder mundial en exportación de derivados cítricos.",
    siembra: "Primavera",
    cosecha: "Abril a Septiembre",
    reqSuelo: "Suelos francos a franco-arenosos, bien aireados y profundos.",
    reqClima: "Templado cálido a subtropical, muy susceptible a heladas invernales.",
    pino_eucalyptus: false
  },
  "porotos": {
    descripcion: "Legumbre de ciclo corto producida principalmente en el NOA.",
    siembra: "Enero a Febrero",
    cosecha: "Mayo a Junio",
    reqSuelo: "Suelos francos, livianos, bien aireados, pH neutro.",
    reqClima: "Templado cálido, sensible a exceso de lluvias en maduración.",
    pino_eucalyptus: false
  },
  "papa": {
    descripcion: "Tubérculo de consumo masivo con diversas zonas de producción.",
    siembra: "Agosto a Octubre / Febrero",
    cosecha: "Diciembre a Abril / Junio",
    reqSuelo: "Suelos sueltos, francos, sin piedras, bien drenados y con buen aporte orgánico.",
    reqClima: "Templado a templado-frío, amplitudes térmicas óptimas.",
    pino_eucalyptus: false
  },
  "quinoa": {
    descripcion: "Pseudocereal andino de alto valor nutricional.",
    siembra: "Octubre a Noviembre",
    cosecha: "Marzo a Mayo",
    reqSuelo: "Suelos arenosos o francos, rústico, tolera suelos pobres y sequía.",
    reqClima: "Frío continental árido de montaña.",
    pino_eucalyptus: false
  },
  "mandioca": {
    descripcion: "Raíz amilácea fundamental en la dieta del NEA.",
    siembra: "Agosto a Octubre",
    cosecha: "Mayo a Agosto",
    reqSuelo: "Suelos sueltos, arenosos, profundos, con buen drenaje para evitar pudriciones.",
    reqClima: "Subtropical a tropical, muy sensible al frío y heladas tempranas.",
    pino_eucalyptus: false
  },
  "pino": {
    descripcion: "Especie forestal clave (Pinus taeda o Pinus elliottii).",
    siembra: "Otoño a Invierno (plantación)",
    cosecha: "Turnos de corte a los 15-20 años",
    reqSuelo: "Suelos profundos, ácidos, tolera texturas arenosas o arcillosas bien drenadas.",
    reqClima: "Subtropical húmedo a templado, alta disponibilidad de agua.",
    pino_eucalyptus: true
  },
  "eucalyptus": {
    descripcion: "Especie forestal de rápido crecimiento (Eucalyptus grandis / dunnii).",
    siembra: "Otoño o Primavera (plantación)",
    cosecha: "Turnos de corte a los 8-12 años",
    reqSuelo: "Suelos profundos, permeables, buena capacidad de enraizamiento.",
    reqClima: "Subtropical húmedo, alta heliofania, sensible a heladas severas continuas.",
    pino_eucalyptus: true
  },
  "forestacion": {
    descripcion: "Especies nativas y exóticas para protección y producción maderera.",
    siembra: "Primavera u Otoño",
    cosecha: "Variable según especie (20-40 años)",
    reqSuelo: "Suelos de aptitud forestal de variada profundidad.",
    reqClima: "Adaptado a las condiciones climáticas del NEA pampeano.",
    pino_eucalyptus: true
  }
};

const defaultCropInfo = {
  descripcion: "Información técnica en proceso de actualización.",
  siembra: "Consultar calendario regional",
  cosecha: "Sujeta a condiciones climáticas"
};

/* ============================================================================
   AgroDB — Provincias
   ============================================================================ */

const agroDB = {
  "buenos aires": { cultivos: ["trigo","soja","maiz","cebada","girasol","sorgo"], suelo: "Molisoles; alta fertilidad", clima: "Templado húmedo" },
  "ciudad autonoma de buenos aires": { cultivos: ["lechuga","tomate","espinaca"], suelo: "Urbano/Hidroponia", clima: "Templado" },
  "catamarca": { cultivos:["olivo","nogal","maiz"], suelo:"Aridisoles", clima:"Árido/semiárido" },
  "chaco": { cultivos:["algodon","soja","maiz","girasol"], suelo:"Vertisoles", clima:"Subtropical" },
  "chubut": { cultivos:["papa","frutilla","manzana"], suelo:"Aluviales", clima:"Frío templado" },
  "cordoba": { cultivos:["soja","maiz","trigo","mani"], suelo:"Molisoles", clima:"Templado subhúmedo" },
  "corrientes": { cultivos:["arroz","yerba mate","citrus","te"], suelo:"Hidromorfos", clima:"Subtropical húmedo" },
  "entre rios": { cultivos:["arroz","soja","maiz","trigo"], suelo:"Vertisoles", clima:"Templado húmedo" },
  "formosa": { cultivos:["soja","maiz","mandioca"], suelo:"Arcillosos", clima:"Subtropical" },
  "jujuy": { cultivos:["maiz","quinoa","papa","cana de azucar"], suelo:"Aluviales", clima:"Andino/subtropical" },
  "la pampa": { cultivos:["trigo","maiz","soja","girasol"], suelo:"Molisoles", clima:"Semiárido" },
  "la rioja": { cultivos:["vid","olivo"], suelo:"Aridisoles", clima:"Seco continental" },
  "mendoza": { cultivos:["vid","olivo","ajo","pera","manzana"], suelo:"Aridisoles", clima:"Desértico continental" },
  "misiones":{ cultivos:["yerba mate","te","citrus","mandioca"], suelo:"Lateríticos (rojos)", clima:"Tropical húmedo" },
  "neuquen":{ cultivos:["manzana","pera","vid"], suelo:"Aluviales", clima:"Semiárido frío" },
  "rio negro":{ cultivos:["manzana","pera","frutilla"], suelo:"Aluviales", clima:"Árido-frío" },
  "salta":{ cultivos:["soja","maiz","porotos","citrus","tabaco"], suelo:"Aluviales", clima:"Subtropical" },
  "san juan":{ cultivos:["vid","olivo","cebolla"], suelo:"Aridisoles", clima:"Desértico" },
  "san luis":{ cultivos:["trigo","maiz","soja","girasol"], suelo:"Arenosos", clima:"Semiárido" },
  "santa cruz":{ cultivos:["forrajeras","hortalizas en invernadero"], suelo:"Patagónico", clima:"Frío extremo" },
  "santa fe":{ cultivos:["soja","maiz","trigo","arroz","girasol"], suelo:"Argiudoles", clima:"Templado húmedo" },
  "santiago del estero":{ cultivos:["soja","maiz","girasol","algodon"], suelo:"Arenosos", clima:"Muy seco" },
  "tierra del fuego":{ cultivos:["lechuga","espinaca","frutilla"], suelo:"Turba/Fríos", clima:"Frío húmedo" },
  "tucuman":{ cultivos:["cana de azucar","limon","arandano"], suelo:"Aluviales", clima:"Subtropical húmedo" }
};

/* ============================================================================
   Datos Geográficos Adicionales (Centros de Provincias para el mapa)
   ============================================================================ */

const provinciaCoordenadas = {
  "buenos aires": { lat: -36.6769, lng: -60.5588, zoom: 6 },
  "ciudad autonoma de buenos aires": { lat: -34.6037, lng: -58.3816, zoom: 11 },
  "catamarca": { lat: -27.2682, lng: -66.9747, zoom: 6 },
  "chaco": { lat: -26.3860, lng: -60.7653, zoom: 7 },
  "chubut": { lat: -43.7886, lng: -68.5247, zoom: 6 },
  "cordoba": { lat: -32.1300, lng: -63.7000, zoom: 7 },
  "corrientes": { lat: -28.7745, lng: -57.8016, zoom: 7 },
  "entre rios": { lat: -32.0589, lng: -59.2014, zoom: 7 },
  "formosa": { lat: -24.8949, lng: -59.9324, zoom: 7 },
  "jujuy": { lat: -23.3200, lng: -65.7644, zoom: 7 },
  "la pampa": { lat: -37.1315, lng: -65.4384, zoom: 6 },
  "la rioja": { lat: -29.6850, lng: -67.1817, zoom: 6 },
  "mendoza": { lat: -34.6297, lng: -68.5831, zoom: 6 },
  "misiones": { lat: -26.8756, lng: -54.6543, zoom: 8 },
  "neuquen": { lat: -38.6417, lng: -70.1186, zoom: 6 },
  "rio negro": { lat: -40.3268, lng: -67.4891, zoom: 6 },
  "salta": { lat: -24.8500, lng: -64.4200, zoom: 6 },
  "san juan": { lat: -30.8653, lng: -68.8897, zoom: 6 },
  "san luis": { lat: -33.7577, lng: -66.0281, zoom: 6 },
  "santa cruz": { lat: -48.8154, lng: -69.9559, zoom: 5 },
  "santa fe": { lat: -30.7069, lng: -60.9461, zoom: 6 },
  "santiago del estero": { lat: -27.7824, lng: -63.2523, zoom: 6 },
  "tierra del fuego": { lat: -54.2115, lng: -67.8772, zoom: 5 },
  "tucuman": { lat: -26.9470, lng: -65.3647, zoom: 8 }
};

/* ============================================================================
   Base de Datos de Capas Agroambientales (Fase 2)
   Con foco especial en la región del NEA (Misiones, Corrientes, Chaco, Formosa)
   ============================================================================ */

const agroambientalesDB = {
  "misiones": {
    suelo: {
      tipo: "Lateríticos (Suelos Rojos - Ultisoles / Oxisoles)",
      textura: "Arcillo-limosa, rica en óxidos de hierro y aluminio",
      drenaje: "Excelente en lomadas, susceptible a erosión hídrica en pendientes",
      limitantes: "Alta acidez (pH bajo), fijación de fósforo, profundidad variable",
      aptitud: "Alta para Yerba Mate, Té, Pino (Taeda y Elliotis), Eucalyptus y Selva Nativa"
    },
    clima: {
      precipitaciones: "1800 - 2200 mm anuales (Distribución uniforme, sin estación seca definida)",
      temperatura: "Media anual de 20°C - 21°C",
      heladas: "Riesgo bajo a moderado en valles bajos (vórtices de aire frío)",
      deficit_hidrico: "Muy bajo o inexistente en años normales",
      estacionalidad: "Tropical/Subtropical húmedo"
    },
    geografia: {
      relieve: "Meseta ondulada, sierras de baja altura (hasta 800m), pendientes pronunciadas",
      hidrografia: "Rodeada por ríos Paraná, Uruguay e Iguazú. Red densa de arroyos internos",
      cobertura: "Selva Paranaense y plantaciones forestales masivas"
    }
  },
  "corrientes": {
    suelo: {
      tipo: "Aluviales e Hidromórficos (Spodosoles / Alfisoles)",
      textura: "Arenosa a franco-arenosa, con horizontes arcillosos impermeables en profundidad",
      drenaje: "Deficiente a moderado (zonas anegables, esteros y lagunas)",
      limitantes: "Saturación hídrica temporal, baja fertilidad natural en lomas arenosas",
      aptitud: "Excelente para Arroz (con riego controlado), Citrus, Pino y Eucalyptus en lomas"
    },
    clima: {
      precipitaciones: "1200 - 1600 mm anuales (Mayor concentración en primavera-otoño)",
      temperatura: "Media anual de 21°C - 22°C",
      heladas: "Riesgo muy bajo en el norte, moderado hacia el sur",
      deficit_hidrico: "Moderado durante el verano (Diciembre-Febrero)",
      estacionalidad: "Subtropical húmedo con veranos calurosos"
    },
    geografia: {
      relieve: "Planicie suavemente ondulada, lomas arenosas, macrosistema de Esteros del Iberá",
      hidrografia: "Límites por ríos Paraná y Uruguay, cuenca interna del Iberá y río Corriente",
      cobertura: "Pastizales naturales, humedales, forestación de pino y cultivos cítricos"
    }
  },
  "chaco": {
    suelo: {
      tipo: "Vertisoles y Molisoles (Suelos arcillosos pesados)",
      textura: "Franca a arcillosa, con arcillas expandibles (grietas en sequía)",
      drenaje: "Lento a deficiente (propensión a inundaciones superficiales breves)",
      limitantes: "Compactación, salinidad potencial, dificultad de labranza en húmedo",
      aptitud: "Alta para Algodón, Soja, Girasol, Sorgo y Ganadería silvopastoril"
    },
    clima: {
      precipitaciones: "800 - 1100 mm anuales (Marcado gradiente decreciente de este a oeste)",
      temperatura: "Media anual de 22°C - 23°C (Máximas extremas superiores a 45°C)",
      heladas: "Riesgo bajo (pocas heladas suaves en invierno)",
      deficit_hidrico: "Fuerte déficit hídrico invernal y estival",
      estacionalidad: "Subtropical con estación seca invernal marcada"
    },
    geografia: {
      relieve: "Llanura aluvial con pendiente mínima hacia el sudeste",
      hidrografia: "Ríos Paraná, Paraguay, Bermejo y Tapenagá. Cañadas temporales",
      cobertura: "Bosque nativo chaqueño (Quebracho, Algarrobo), cultivos anuales y pasturas"
    }
  },
  "formosa": {
    suelo: {
      tipo: "Entisoles y Alfisoles (Asociados a albardones de ríos)",
      textura: "Franco-arenosa en lomas y albardones, arcillosa pesada en esteros",
      drenaje: "Moderado en zonas altas, deficiente en bajos e interfluvios",
      limitantes: "Susceptibilidad a desbordes de ríos, baja retención de agua en lomas",
      aptitud: "Buena para Mandioca, Maíz, Banana, Pasturas megatérmicas y Forestal"
    },
    clima: {
      precipitaciones: "700 - 1200 mm anuales (Gradiente decreciente de este a oeste)",
      temperatura: "Media anual de 23°C",
      heladas: "Ocurrencia muy rara y leve",
      deficit_hidrico: "Elevado en invierno-primavera en el oeste provincial",
      estacionalidad: "Subtropical con estación seca"
    },
    geografia: {
      relieve: "Llanura sedimentaria muy plana, albardones y esteros paralelos",
      hidrografia: "Ríos Pilcomayo, Bermejo y Paraguay. Bañado La Estrella",
      cobertura: "Selva en galería, sabanas de palmeras (Caranday), monte chaqueño"
    }
  },
  // Fallback para provincias fuera del foco NEA
  "default": {
    suelo: {
      tipo: "Suelos regionales típicos (Molisoles / Aridisoles según zona)",
      textura: "Franca a franco-limosa en zonas agrícolas principales",
      drenaje: "Generalmente bueno a moderado",
      limitantes: "Erosión hídrica/eólica local, compactación por labranza",
      aptitud: "Cultivos anuales tradicionales (Trigo, Soja, Maíz, Girasol) o pasturas"
    },
    clima: {
      precipitaciones: "600 - 1000 mm anuales según la región",
      temperatura: "Media anual de 14°C - 18°C",
      heladas: "Riesgo moderado a alto según latitud",
      deficit_hidrico: "Estacional durante los meses de verano",
      estacionalidad: "Templado pampeano / Semiárido"
    },
    geografia: {
      relieve: "Llanuras o valles de producción agrícola",
      hidrografia: "Cuencas hídricas locales y sistemas de riego artificial en zonas áridas",
      cobertura: "Praderas, pasturas cultivadas y áreas agrícolas extensivas"
    }
  }
};

/* ============================================================================
   Lógica del Mapa Base (Fase 1)
   ============================================================================ */

let mapInstance = null;
let currentMarker = null;

/**
 * Inicializa el mapa interactivo de Leaflet
 */
function inicializarMapa(provinciaRaw) {
  const mapElement = document.getElementById("map");
  if (!mapElement) return;

  // Centro por defecto: Argentina (Rosario/Córdoba aprox)
  let defaultLat = -38.4161;
  let defaultLng = -63.6167;
  let defaultZoom = 4;

  const key = normalizeKey(provinciaRaw);
  if (provinciaCoordenadas[key]) {
    defaultLat = provinciaCoordenadas[key].lat;
    defaultLng = provinciaCoordenadas[key].lng;
    defaultZoom = provinciaCoordenadas[key].zoom;
  }

  // Crear la instancia de mapa
  mapInstance = L.map('map').setView([defaultLat, defaultLng], defaultZoom);

  // Agregar capa base de OpenStreetMap
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
  }).addTo(mapInstance);

  // Si hay una provincia seleccionada, colocar un marcador inicial
  if (provinciaCoordenadas[key]) {
    colocarMarcador(defaultLat, defaultLng, provinciaRaw);
  }

  // Evento de Click en el mapa
  mapInstance.on('click', (e) => {
    const { lat, lng } = e.latlng;
    procesarSeleccionCoordenadas(lat, lng);
  });

  // Inicializar geolocalización
  const btnGeo = document.getElementById("btn-geolocalizar");
  if (btnGeo) {
    btnGeo.addEventListener("click", usarGeolocalizacion);
  }
}

/**
 * Coloca o mueve el marcador en el mapa
 */
function colocarMarcador(lat, lng, titulo) {
  if (!mapInstance) return;

  if (currentMarker) {
    currentMarker.setLatLng([lat, lng]);
  } else {
    currentMarker = L.marker([lat, lng], { draggable: false }).addTo(mapInstance);
  }

  if (titulo) {
    currentMarker.bindPopup(`<b>${titulo}</b><br>Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`).openPopup();
  }
}

/**
 * Busca a qué provincia corresponde un par de coordenadas (geocodificación inversa local robusta)
 */
function buscarProvinciaPorCoordenadas(lat, lng) {
  // Encontramos la provincia cuya coordenada de referencia sea la más cercana usando distancia euclidiana simplificada
  let provinciaCercana = null;
  let distanciaMinima = Infinity;

  for (const [prov, coord] of Object.entries(provinciaCoordenadas)) {
    const d = Math.pow(lat - coord.lat, 2) + Math.pow(lng - coord.lng, 2);
    if (d < distanciaMinima) {
      distanciaMinima = d;
      provinciaCercana = prov;
    }
  }

  // Si la distancia mínima es ridículamente grande, podría ser fuera de Argentina, pero para propósitos locales asumimos la más cercana
  return provinciaCercana;
}

/**
 * Procesa la selección de coordenadas (ya sea por click o geolocalización)
 */
function procesarSeleccionCoordenadas(lat, lng) {
  const provinciaKey = buscarProvinciaPorCoordenadas(lat, lng);
  if (!provinciaKey) return;

  // Encontrar el nombre de provincia bonito
  const nombreProvinciaBonito = provinciaKey.split(" ")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  colocarMarcador(lat, lng, nombreProvinciaBonito);

  // Actualizar la vista de recomendaciones de cultivos
  renderRecomendaciones(nombreProvinciaBonito);

  // Mostrar información territorial básica en el panel lateral (Fase 1)
  actualizarPanelTerritorialBasico(nombreProvinciaBonito, lat, lng);
}

/**
 * Actualiza el panel lateral con datos básicos de coordenadas y datos agroambientales integrados (Fase 2)
 */
function actualizarPanelTerritorialBasico(provincia, lat, lng) {
  const detailsContainer = document.getElementById("territory-details");
  if (!detailsContainer) return;

  const key = normalizeKey(provincia);
  const agroInfo = agroambientalesDB[key] || agroambientalesDB["default"];
  const generalInfo = agroDB[key] || {};

  detailsContainer.innerHTML = `
    <div class="info-item">
      <strong>📍 Ubicación Seleccionada</strong>
      <span>${provincia} (Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)})</span>
    </div>

    <div class="info-section-title" style="margin: 15px 0 5px 0; font-weight: bold; border-bottom: 1px solid var(--borde-suave); padding-bottom: 3px; color: var(--verde-principal); font-size: 0.95rem;">
      🌱 Propiedades del Suelo (INTA)
    </div>
    <div class="info-item">
      <strong>Tipo y Clasificación:</strong>
      <span>${agroInfo.suelo.tipo}</span>
    </div>
    <div class="info-item">
      <strong>Textura Predominante:</strong>
      <span>${agroInfo.suelo.textura}</span>
    </div>
    <div class="info-item">
      <strong>Drenaje / Escurrimiento:</strong>
      <span>${agroInfo.suelo.drenaje}</span>
    </div>
    <div class="info-item">
      <strong>Limitantes Edáficas:</strong>
      <span>${agroInfo.suelo.limitantes}</span>
    </div>
    <div class="info-item">
      <strong>Aptitud Productiva:</strong>
      <span>${agroInfo.suelo.aptitud}</span>
    </div>

    <div class="info-section-title" style="margin: 15px 0 5px 0; font-weight: bold; border-bottom: 1px solid var(--borde-suave); padding-bottom: 3px; color: var(--verde-principal); font-size: 0.95rem;">
      🌦️ Datos Climáticos (SMN / Regional)
    </div>
    <div class="info-item">
      <strong>Precipitaciones Medias:</strong>
      <span>${agroInfo.clima.precipitaciones}</span>
    </div>
    <div class="info-item">
      <strong>Temperatura Media:</strong>
      <span>${agroInfo.clima.temperatura}</span>
    </div>
    <div class="info-item">
      <strong>Riesgo de Heladas:</strong>
      <span>${agroInfo.clima.heladas}</span>
    </div>
    <div class="info-item">
      <strong>Déficit Hídrico:</strong>
      <span>${agroInfo.clima.deficit_hidrico}</span>
    </div>

    <div class="info-section-title" style="margin: 15px 0 5px 0; font-weight: bold; border-bottom: 1px solid var(--borde-suave); padding-bottom: 3px; color: var(--verde-principal); font-size: 0.95rem;">
      🗺️ Geografía y Relieve (IGN)
    </div>
    <div class="info-item">
      <strong>Relieve y Topografía:</strong>
      <span>${agroInfo.geografia?.relieve || "Ondulado suave"}</span>
    </div>
    <div class="info-item">
      <strong>Hidrografía y Cuencas:</strong>
      <span>${agroInfo.geografia?.hidrografia || "Arroyos y ríos locales"}</span>
    </div>
  `;
}

/**
 * Usa el API de Geolocalización del Navegador
 */
function usarGeolocalizacion() {
  if (!navigator.geolocation) {
    alert("La geolocalización no está soportada por tu navegador.");
    return;
  }

  const btnGeo = document.getElementById("btn-geolocalizar");
  if (btnGeo) {
    btnGeo.disabled = true;
    btnGeo.innerText = "📍 Buscando ubicación...";
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;

      if (mapInstance) {
        mapInstance.setView([latitude, longitude], 9);
      }
      procesarSeleccionCoordenadas(latitude, longitude);

      if (btnGeo) {
        btnGeo.disabled = false;
        btnGeo.innerText = "📍 Usar mi Geolocalización";
      }
    },
    (error) => {
      alert("No se pudo obtener la geolocalización. Asegúrate de otorgar permisos.");
      if (btnGeo) {
        btnGeo.disabled = false;
        btnGeo.innerText = "📍 Usar mi Geolocalización";
      }
    },
    { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
  );
}

/* ============================================================================
   Lógica de Negocio & Motor de Recomendación Territorial (Fase 3)
   ============================================================================ */

/**
 * Evalúa la compatibilidad de un cultivo dadas las características agroambientales
 * @param {string} cultivoKey
 * @param {object} agroInfo
 * @returns {object} { score: 'ALTA'|'MEDIA'|'BAJA', motivos: string[], riesgos: string[] }
 */
function evaluarCompatibilidadCultivo(cultivoKey, agroInfo, provinciaKey) {
  const cData = cultivosData[cultivoKey];
  if (!cData) return { score: 'MEDIA', motivos: ['Datos técnicos generales.'], riesgos: ['Sin datos específicos.'] };

  const motivos = [];
  const riesgos = [];
  let score = 'ALTA'; // Por defecto empezamos en Alta y aplicamos penalizaciones/validaciones

  // Análisis de Suelo
  const sueloTexto = (agroInfo.suelo.tipo + " " + agroInfo.suelo.aptitud).toLowerCase();
  const limitantesTexto = agroInfo.suelo.limitantes.toLowerCase();

  if (cultivoKey === "yerba mate" || cultivoKey === "te") {
    if (sueloTexto.includes("rojos") || sueloTexto.includes("lateriticos")) {
      motivos.push("Suelos rojos lateríticos ideales con pH ácido óptimo.");
    } else {
      score = 'MEDIA';
      riesgos.push("Suelo no laterítico: requiere enmiendas y control estricto de pH.");
      motivos.push("Se adapta con manejo especial de acidez.");
    }

    if (limitantesTexto.includes("acidez")) {
      motivos.push("Tolera perfectamente la acidez característica de la región.");
    }
  }

  if (cultivoKey === "arroz") {
    if (sueloTexto.includes("hidromorficos") || sueloTexto.includes("arcillosos") || limitantesTexto.includes("saturacion hídrica")) {
      motivos.push("Suelos pesados o inundables con excelente retención de agua para riego.");
    } else {
      score = 'MEDIA';
      riesgos.push("Suelo permeable: alto consumo de agua para mantener inundación.");
    }
  }

  if (cultivoKey === "pino" || cultivoKey === "eucalyptus" || cultivoKey === "forestacion") {
    if (sueloTexto.includes("profundos") || sueloTexto.includes("lateriticos") || sueloTexto.includes("arenosas")) {
      motivos.push("Excelente profundidad y textura para el desarrollo radicular.");
    }
    if (provinciaKey === "misiones" || provinciaKey === "corrientes") {
      motivos.push("Condiciones climáticas de alta radiación y humedad aceleran turnos de corte.");
    }
  }

  // Análisis de Clima (Precipitaciones y Heladas)
  const lluviasTexto = agroInfo.clima.precipitaciones.toLowerCase();
  const heladasTexto = agroInfo.clima.heladas.toLowerCase();

  // Requerimientos hídricos
  if (cultivoKey === "yerba mate" || cultivoKey === "te" || cultivoKey === "eucalyptus") {
    if (lluviasTexto.includes("1800") || lluviasTexto.includes("2200") || lluviasTexto.includes("1500") || lluviasTexto.includes("1200")) {
      motivos.push("Régimen de lluvias abundante superior a 1200mm anuales.");
    } else {
      score = 'MEDIA';
      riesgos.push("Déficit hídrico potencial: requiere riego complementario en fases secas.");
    }
  }

  // Sensibilidad al frío / heladas
  if (cultivoKey === "citrus" || cultivoKey === "limon" || cultivoKey === "mandioca" || cultivoKey === "cana de azucar") {
    if (heladasTexto.includes("riesgo muy bajo") || heladasTexto.includes("ocurrencia muy rara") || heladasTexto.includes("bajo")) {
      motivos.push("Bajo o nulo riesgo de heladas protege la brotación y frutos.");
    } else if (heladasTexto.includes("moderado") || heladasTexto.includes("alto")) {
      score = 'MEDIA';
      riesgos.push("Sensible a heladas tardías: peligro de daño en yemas de brotación.");
    }
  }

  // Consolidación final de motivos generales si quedaron vacíos
  if (motivos.length === 0) {
    motivos.push("Las condiciones generales del territorio son aptas para el cultivo.");
  }

  return {
    score: score,
    motivos: motivos,
    riesgos: riesgos.length > 0 ? riesgos : ["Ninguno identificado bajo condiciones estándar."]
  };
}

/**
 * Obtiene recomendaciones completas y detalladas de un territorio (Fase 3)
 */
function getRecomendaciones(provinciaRaw) {
  const key = normalizeKey(provinciaRaw);
  const info = agroDB[key];

  if (!info) return null;

  const agroInfo = agroambientalesDB[key] || agroambientalesDB["default"];

  return info.cultivos.map(nombre => {
    const cultivoKey = normalizeKey(nombre);
    const detalle = cultivosData[cultivoKey] || defaultCropInfo;
    const compatibilidad = evaluarCompatibilidadCultivo(cultivoKey, agroInfo, key);

    return {
      nombre: nombre.charAt(0).toUpperCase() + nombre.slice(1),
      descripcion: detalle.descripcion,
      siembra: detalle.siembra,
      cosecha: detalle.cosecha,
      reqSuelo: detalle.reqSuelo || "Suelos fértiles estándar.",
      reqClima: detalle.reqClima || "Climas templados a cálidos estándar.",
      compatibilidad: compatibilidad.score,
      motivos: compatibilidad.motivos,
      riesgos: compatibilidad.riesgos
    };
  });
}

/**
 * Renderiza las tarjetas de cultivo inteligentes con compatibilidad territorial (Fase 3)
 */
function renderRecomendaciones(provinciaRaw) {
  const container = document.getElementById("crop-results");
  const tituloUbicacion = document.getElementById("resultado_ubicacion");

  if (!container) return;

  const recomendaciones = getRecomendaciones(provinciaRaw);

  if (tituloUbicacion) tituloUbicacion.innerText = provinciaRaw;

  if (!recomendaciones) {
    container.innerHTML = `
      <div class="error-msg">
        <p>Lo sentimos, no tenemos datos registrados para la provincia: <strong>${provinciaRaw}</strong>.</p>
        <p>Asegúrate de escribir correctamente el nombre (ej. Córdoba, Buenos Aires, Santa Fe).</p>
      </div>`;
    return;
  }

  container.innerHTML = recomendaciones.map(c => {
    let badgeClass = "badge-alta";
    if (c.compatibilidad === "MEDIA") badgeClass = "badge-media";
    if (c.compatibilidad === "BAJA") badgeClass = "badge-baja";

    return `
      <article class="crop-card">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
          <h3 style="margin: 0;">${c.nombre}</h3>
          <span class="compatibility-badge ${badgeClass}">${c.compatibilidad}</span>
        </div>

        <p class="desc">${c.descripcion}</p>

        <div class="details" style="margin-bottom: 15px;">
          <div><strong>📅 Siembra:</strong> ${c.siembra}</div>
          <div><strong>🧺 Cosecha:</strong> ${c.cosecha}</div>
        </div>

        <div class="agro-requirements" style="font-size: 0.85rem; border-top: 1px dashed var(--borde-suave); padding-top: 10px; margin-bottom: 10px;">
          <div style="margin-bottom: 5px;"><strong>🌱 Requerimiento Suelo:</strong> ${c.reqSuelo}</div>
          <div><strong>🌦️ Requerimiento Clima:</strong> ${c.reqClima}</div>
        </div>

        <div class="compatibility-report" style="font-size: 0.85rem; background: rgba(0,0,0,0.02); border-radius: 8px; padding: 10px; border: 1px solid var(--borde-suave);">
          <div style="font-weight: bold; color: var(--verde-principal); margin-bottom: 5px;">📍 Reporte de Compatibilidad:</div>
          <div style="margin-bottom: 5px;"><strong>💡 Motivos:</strong>
            <ul style="margin: 2px 0; padding-left: 15px;">
              ${c.motivos.map(m => `<li>${m}</li>`).join("")}
            </ul>
          </div>
          <div><strong>⚠️ Riesgos / Limitaciones:</strong>
            <ul style="margin: 2px 0; padding-left: 15px; color: var(--texto-secundario);">
              ${c.riesgos.map(r => `<li>${r}</li>`).join("")}
            </ul>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

/* ============================================================================
   Inicialización
   ============================================================================ */

document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const ubic = params.get("ubicacion");

  // Si se buscó una ubicación, renderizarla tradicionalmente
  if (ubic) {
    renderRecomendaciones(ubic);
  }

  // Inicializar mapa de forma segura
  setTimeout(() => {
    inicializarMapa(ubic || "Argentina");

    // Si hay una provincia en la URL, cargar sus datos básicos en el panel lateral también
    if (ubic) {
      const key = normalizeKey(ubic);
      if (provinciaCoordenadas[key]) {
        actualizarPanelTerritorialBasico(ubic, provinciaCoordenadas[key].lat, provinciaCoordenadas[key].lng);
      }
    }
  }, 100);
});
