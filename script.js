/* ============================================================================
   script.js — Motor de recomendaciones + UI — Versión FINAL
   NO USA mapa.js — El mapa avanzado está dentro de resultados.html
   ============================================================================ */

/* ---------- Utilidades ---------- */
function normalizeKey(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function monthIndexToName(i) {
  const months = [
    "Enero","Febrero","Marzo","Abril","Mayo","Junio",
    "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"
  ];
  return months[i - 1] || "";
}

/* ============================================================================
   AgroDB — Datos técnicos realistas por provincia (24 jurisdicciones)
   ============================================================================ */

const agroDB = {
  "buenos aires": {
    cultivos: ["trigo","soja","maiz","cebada","girasol","sorgo"],
    suelo: "Molisoles (Pampa Húmeda); alta fertilidad",
    clima: "Templado húmedo; riesgo: anegamientos",
    riego: "Secano mayormente; pivots en zonas",
    plagas: ["roya del trigo","arañuela","picudo del trigo"],
    ventanaSiembra: { trigo:[5,7], soja:[10,12], maiz:[9,12], cebada:[6,7] }
  },

  "ciudad autonoma de buenos aires": {
    cultivos: ["hortalizas urbanas","invernaderos","huertas"],
    suelo: "Antropizado; hidroponia",
    clima: "Templado urbano",
    riego: "Local (invernaderos)",
    plagas: ["pulgones","mosca blanca"],
    ventanaSiembra: { lechuga:[1,12], tomate:[9,3] }
  },

  /* --- Resto de provincias (sin cambios) --- */

  "catamarca": { cultivos:["olivo","nogal","forrajes","maiz en valles"], suelo:"Aridisoles y aluviales", clima:"Árido/semiárido", riego:"Acequias y goteo", plagas:["picudo"], ventanaSiembra:{ olivo:[3,5], maiz:[10,12] } },
  "chaco": { cultivos:["algodon","soja","maiz","girasol"], suelo:"Vertisoles pesados", clima:"Subtropical", riego:"Limitado", plagas:["picudo del algodon","mosca blanca"], ventanaSiembra:{ algodon:[10,12], soja:[10,12], maiz:[10,12] } },
  "chubut": { cultivos:["papa","hortalizas","frutales valles"], suelo:"Aridisoles y aluviales", clima:"Frío templado en valles", riego:"Canales en valles", plagas:["nematodos de la papa","tuta absoluta"], ventanaSiembra:{ papa:[9,10], tomate:[9,11] } },

  "cordoba": { cultivos:["soja","maiz","trigo","mani"], suelo:"Molisoles / Aridisoles", clima:"Templado subhúmedo", riego:"Pivots en zonas", plagas:["oruga bolillera","chinche","picudo"], ventanaSiembra:{ soja:[10,12], maiz:[9,12], mani:[10,11], trigo:[5,7] } },
  "corrientes": { cultivos:["arroz","yerba mate","citrus","te"], suelo:"Hidromorfos y aluviales", clima:"Subtropical húmedo", riego:"Arroz y drenaje", plagas:["hongos foliares"], ventanaSiembra:{ arroz:[11,12], citrus:[3,6] } },

  "entre rios": { cultivos:["arroz","soja","maiz"], suelo:"Vertisoles", clima:"Templado húmedo", riego:"Sistemas para arroz", plagas:["isoca","gusanos cortadores"], ventanaSiembra:{ arroz:[11,12], trigo:[5,7], soja:[10,12] } },
  "formosa": { cultivos:["soja","maiz","mandioca"], suelo:"Arcillosos", clima:"Subtropical", riego:"Bombeo local", plagas:["orugas"], ventanaSiembra:{ soja:[10,12], maiz:[10,12] } },
  "jujuy": { cultivos:["maiz andino","quinoa","papa"], suelo:"Aluviales en valles", clima:"Andino/subtropical", riego:"Acequias", plagas:["pulgones"], ventanaSiembra:{ quinoa:[10,11], maiz:[10,12], papa:[9,10] } },

  "la pampa": { cultivos:["trigo","maiz","soja"], suelo:"Molisoles y cambisoles", clima:"Semiárido", riego:"Escaso", plagas:["picudo"], ventanaSiembra:{ trigo:[5,7], soja:[10,12], maiz:[9,12] } },
  "la rioja": { cultivos:["vid","olivo"], suelo:"Aridisoles", clima:"Seco continental", riego:"Oasis por acequias", plagas:["mosca de la fruta"], ventanaSiembra:{ vid:[8,10], olivo:[3,5] } },
  "mendoza": { cultivos:["vid","frutales","hortalizas"], suelo:"Aridisoles aluviales", clima:"Desértico continental", riego:"Goteo/acequias", plagas:["mosca de la fruta"], ventanaSiembra:{ vid:[8,10], ajo:[2,4] } },

  "misiones":{ cultivos:["yerba mate","te","citrus"], suelo:"Lateríticos", clima:"Tropical húmedo", riego:"Bajo", plagas:["hongos foliares"], ventanaSiembra:{ yerba:[3,6], citrus:[3,6] } },
  "neuquen":{ cultivos:["manzana","pera","hortalizas"], suelo:"Aluviales", clima:"Semiárido frío", riego:"Canales", plagas:["carpocapsa"], ventanaSiembra:{ manzana:[8,10], pera:[8,10] } },

  "rio negro":{ cultivos:["manzana","pera","frutilla"], suelo:"Aluviales", clima:"Árido-frío", riego:"Indispensable", plagas:["carpocapsa"], ventanaSiembra:{ frutilla:[8,10], manzana:[8,10] } },

  "salta":{ cultivos:["soja","maiz","porotos","citricos"], suelo:"Aluviales", clima:"Subtropical", riego:"Acequias", plagas:["picudo"], ventanaSiembra:{ soja:[10,12], maiz:[10,12], poroto:[11,1] } },
  "san juan":{ cultivos:["vid","olivo","hortalizas de valle"], suelo:"Aridisoles aluviales", clima:"Desértico", riego:"Goteo/acequias", plagas:["mosca de la fruta"], ventanaSiembra:{ vid:[8,10], olivo:[3,5] } },

  "san luis":{ cultivos:["trigo","maiz","soja"], suelo:"Arenosos", clima:"Semiárido", riego:"Puntual", plagas:["orugas"], ventanaSiembra:{ trigo:[5,7], soja:[10,12] } },
  "santa cruz":{ cultivos:["forrajeras","hortalizas invernadero"], suelo:"Patagónico", clima:"Frío extremo", riego:"Local", plagas:["hongos foliares"], ventanaSiembra:{ hortalizas:[9,3] } },

  "santa fe":{ cultivos:["soja","maiz","trigo","arroz"], suelo:"Argiudoles", clima:"Templado húmedo", riego:"Arroz con manejo de inundación", plagas:["roya","picudo"], ventanaSiembra:{ soja:[10,12], maiz:[9,12], arroz:[11,12], trigo:[5,7] } },

  "santiago del estero":{ cultivos:["soja","maiz","girasol","algodon"], suelo:"Arenosos", clima:"Muy seco", riego:"Pivots", plagas:["picudo"], ventanaSiembra:{ soja:[10,12], algodon:[10,12], maiz:[10,12] } },

  "tierra del fuego":{ cultivos:["hortalizas","invernaderos"], suelo:"Fríos/turba", clima:"Frío húmedo", riego:"Local/invernadero", plagas:["pulgon"], ventanaSiembra:{ lechuga:[1,12], espinaca:[1,12] } },

  "tucuman":{ cultivos:["cana de azucar","limon","hortalizas"], suelo:"Aluviales", clima:"Subtropical húmedo", riego:"Intensivo", plagas:["picudo de la caña"], ventanaSiembra:{ cana:[5,9], limon:[3,5] } }
};


/* ============================================================================
   Motor de recomendación
   ============================================================================ */

function recomendarCultivos(provKey, mesIndex, tieneRiego, opciones={}) {
  const info = agroDB[provKey];
  if (!info) return [];

  const results = [];

  (info.cultivos||[]).forEach(cultivo => {
    let score = 50;
    const motivos = [];

    const ventana = info.ventanaSiembra && info.ventanaSiembra[cultivo];
    if (ventana) {
      const [ini, fin] = ventana;
      const inWindow = (ini <= fin)
        ? (mesIndex >= ini && mesIndex <= fin)
        : (mesIndex >= ini || mesIndex <= fin);

      if (inWindow) { score += 30; motivos.push("dentro de ventana de siembra"); }
      else { score -= 10; motivos.push("fuera de ventana"); }
    }

    if (tieneRiego && info.riego && /riego|goteo|pivot|irrig/i.test(info.riego)) {
      score += 15;
      motivos.push("ventaja por riego");
    }

    if (/subtropical|tropical/i.test(info.clima) &&
        /soja|cana|citrus|tabaco/i.test(cultivo)) {
      score += 8;
      motivos.push("ajuste climático");
    }

    results.push({ cultivo, score, motivos });
  });

  results.sort((a,b)=>b.score - a.score);
  return results;
}


/* ============================================================================
   Render principal (sin mapa.js)
   ============================================================================ */

function createCard(title, content) {
  const card = document.createElement("div");
  card.className = "agro-card";

  const h = document.createElement("h4");
  h.innerText = title;

  const p = document.createElement("pre");
  p.innerText = content;

  card.appendChild(h);
  card.appendChild(p);

  return card;
}

function renderForLocation(ubicacionRaw) {
  if (!ubicacionRaw) return;

  const key = normalizeKey(ubicacionRaw);
  const info = agroDB[key];

  document.getElementById("resultado_ubicacion").innerText = ubicacionRaw;

  if (!info) {
    document.getElementById("recomendaciones").innerText =
      "No hay datos disponibles para esta provincia.";
    return;
  }

  const resumen =
    `Cultivos: ${info.cultivos.join(", ")}\n\n` +
    `Suelos: ${info.suelo}\n\n` +
    `Clima: ${info.clima}\n\n` +
    `Riego: ${info.riego}\n\n` +
    `Plagas: ${(info.plagas||[]).join(", ")}`;

  document.getElementById("recomendaciones").innerText = resumen;

  const detalles = document.getElementById("detalles_card");
  if (detalles) {
    detalles.innerHTML = "";
    detalles.appendChild(createCard("Cultivos", info.cultivos.join(", ")));
    detalles.appendChild(createCard("Suelos", info.suelo));
    detalles.appendChild(createCard(
      "Ventanas de siembra",
      Object.keys(info.ventanaSiembra).map(c=>{
        const [s,e] = info.ventanaSiembra[c];
        return `${c}: ${monthIndexToName(s)} – ${monthIndexToName(e)}`
      }).join("\n")
    ));
  }
}


/* ============================================================================
   Inicialización automática resultados.html
   ============================================================================ */

document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const ubic = params.get("ubicacion");

  if (ubic) {
    renderForLocation(ubic);
  }
});
