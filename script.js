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
    cosecha: "Noviembre a Enero"
  },
  "soja": {
    descripcion: "Principal cultivo de exportación, leguminosa de verano.",
    siembra: "Octubre a Diciembre",
    cosecha: "Marzo a Mayo"
  },
  "maiz": {
    descripcion: "Cereal versátil con altos requerimientos nutricionales.",
    siembra: "Septiembre a Diciembre",
    cosecha: "Marzo a Agosto"
  },
  "cebada": {
    descripcion: "Cereal de invierno, muy utilizado en la industria cervecera.",
    siembra: "Junio a Julio",
    cosecha: "Noviembre a Diciembre"
  },
  "girasol": {
    descripcion: "Oleaginosa resistente a sequías moderadas.",
    siembra: "Agosto a Noviembre",
    cosecha: "Enero a Marzo"
  },
  "sorgo": {
    descripcion: "Cereal rústico ideal para zonas con menor disponibilidad hídrica.",
    siembra: "Octubre a Noviembre",
    cosecha: "Marzo a Mayo"
  },
  "mani": {
    descripcion: "Leguminosa regional de alto valor agregado.",
    siembra: "Octubre a Noviembre",
    cosecha: "Abril a Mayo"
  },
  "arroz": {
    descripcion: "Cereal cultivado en suelos anegadizos con riego controlado.",
    siembra: "Septiembre a Noviembre",
    cosecha: "Febrero a Abril"
  },
  "yerba mate": {
    descripcion: "Cultivo perenne emblemático de la región mesopotámica.",
    siembra: "Marzo a Junio (plantación)",
    cosecha: "Abril a Septiembre"
  },
  "citrus": {
    descripcion: "Frutales como limón, naranja y mandarina.",
    siembra: "Primavera",
    cosecha: "Invierno a Primavera"
  },
  "te": {
    descripcion: "Infusión cultivada principalmente en Misiones y Corrientes.",
    siembra: "Otoño",
    cosecha: "Noviembre a Abril"
  },
  "algodon": {
    descripcion: "Fibra textil adaptada a climas subtropicales.",
    siembra: "Octubre a Diciembre",
    cosecha: "Abril a Julio"
  },
  "vid": {
    descripcion: "Cultivo base de la industria vitivinícola en zonas áridas con riego.",
    siembra: "Agosto a Octubre (plantación)",
    cosecha: "Febrero a Abril"
  },
  "olivo": {
    descripcion: "Frutal adaptado a climas secos para producción de aceite y aceitunas.",
    siembra: "Marzo a Mayo (plantación)",
    cosecha: "Febrero a Mayo"
  },
  "manzana": {
    descripcion: "Fruta de pepita típica de los valles patagónicos.",
    siembra: "Agosto a Septiembre",
    cosecha: "Enero a Abril"
  },
  "pera": {
    descripcion: "Fruta de pepita de alta calidad de exportación.",
    siembra: "Agosto a Septiembre",
    cosecha: "Enero a Marzo"
  },
  "cana de azucar": {
    descripcion: "Cultivo industrial clave en el NOA.",
    siembra: "Mayo a Septiembre",
    cosecha: "Junio a Octubre"
  },
  "limon": {
    descripcion: "Líder mundial en exportación de derivados cítricos.",
    siembra: "Primavera",
    cosecha: "Abril a Septiembre"
  },
  "porotos": {
    descripcion: "Legumbre de ciclo corto producida principalmente en el NOA.",
    siembra: "Enero a Febrero",
    cosecha: "Mayo a Junio"
  },
  "papa": {
    descripcion: "Tubérculo de consumo masivo con diversas zonas de producción.",
    siembra: "Agosto a Octubre / Febrero",
    cosecha: "Diciembre a Abril / Junio"
  },
  "quinoa": {
    descripcion: "Pseudocereal andino de alto valor nutricional.",
    siembra: "Octubre a Noviembre",
    cosecha: "Marzo a Mayo"
  },
  "mandioca": {
    descripcion: "Raíz amilácea fundamental en la dieta del NEA.",
    siembra: "Agosto a Octubre",
    cosecha: "Mayo a Agosto"
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
   Lógica de Negocio
   ============================================================================ */

/**
 * Obtiene recomendaciones para una provincia
 */
function getRecomendaciones(provinciaRaw) {
  const key = normalizeKey(provinciaRaw);
  const info = agroDB[key];

  if (!info) return null;

  return info.cultivos.map(nombre => {
    const detalle = cultivosData[normalizeKey(nombre)] || defaultCropInfo;
    return {
      nombre: nombre.charAt(0).toUpperCase() + nombre.slice(1),
      descripcion: detalle.descripcion,
      siembra: detalle.siembra,
      cosecha: detalle.cosecha
    };
  });
}

/**
 * Renderiza las tarjetas de cultivo
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

  container.innerHTML = recomendaciones.map(c => `
    <article class="crop-card">
      <h3>${c.nombre}</h3>
      <p class="desc">${c.descripcion}</p>
      <div class="details">
        <div><strong>Siembra:</strong> ${c.siembra}</div>
        <div><strong>Cosecha:</strong> ${c.cosecha}</div>
      </div>
    </article>
  `).join("");
}

/* ============================================================================
   Inicialización
   ============================================================================ */

document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const ubic = params.get("ubicacion");

  if (ubic) {
    renderRecomendaciones(ubic);
  }
});
