/**
 * Motor de recomendación territorial de Agro Consultas
 */

import { calcularCompatibilidad } from '../utils/scoring.js';
import { normalizeKey } from '../utils/normalization.js';

let cultivosData = null;

/**
 * Carga la base de datos de cultivos de manera asíncrona.
 */
export async function loadCultivosData() {
  if (!cultivosData) {
    const [resCultivos, resForestales] = await Promise.all([
      fetch('/data/cultivos.json').then(r => r.ok ? r.json() : {}),
      fetch('/data/forestales.json').then(r => r.ok ? r.json() : {})
    ]);
    cultivosData = { ...resCultivos, ...resForestales };
  }
}

/**
 * Genera el listado de cultivos recomendados para una provincia y coordenadas dadas.
 * Combina datos locales del suelo, clima y simulación.
 *
 * @param {Array<string>} listadoNombres - Lista de cultivos recomendados por la provincia.
 * @param {Object} soilReport - Datos del suelo consolidado.
 * @param {Object} climateReport - Datos de clima consolidado.
 * @returns {Promise<Array<Object>>} Lista de objetos de cultivo enriquecidos con compatibilidad y sostenibilidad.
 */
export async function generateRecommendations(listadoNombres, soilReport, climateReport) {
  await loadCultivosData();

  return listadoNombres.map(nombre => {
    const key = normalizeKey(nombre);
    const cropData = cultivosData[key] || {
      nombre: nombre,
      descripcion: "Información técnica en proceso de actualización.",
      siembra: "Consultar calendario regional",
      cosecha: "Sujeta a condiciones climáticas",
      reqSuelo: "Suelos fértiles estándar.",
      reqClima: "Climas templados a cálidos estándar.",
      requerimientos: {}
    };

    // Calcular compatibilidad
    const compat = calcularCompatibilidad(
      { nombre, ...cropData },
      soilReport,
      climateReport
    );

    // Obtener recomendaciones de manejo y rotación sostenible
    const sostenibilidad = obtenerPracticasSostenibles(key);

    return {
      nombre: nombre.charAt(0).toUpperCase() + nombre.slice(1),
      descripcion: cropData.descripcion,
      siembra: cropData.siembra,
      cosecha: cropData.cosecha,
      reqSuelo: cropData.reqSuelo || "Suelos fértiles estándar.",
      reqClima: cropData.reqClima || "Climas templados a cálidos estándar.",
      compatibilidad: compat.categoria,
      score: compat.score,
      motivos: compat.motivos,
      riesgos: compat.riesgos,
      sostenibilidad: sostenibilidad
    };
  });
}

/**
 * Obtiene recomendaciones de rotación y manejo sostenible para un cultivo.
 */
export function obtenerPracticasSostenibles(cultivoKey) {
  const rotaciones = {
    "soja": {
      rotacion: "Rotar con Maíz o Trigo/Soja de segunda para evitar el monocultivo y fijar nitrógeno.",
      manejo: "Siembra Directa estricta para mitigar erosión hídrica, y cultivos de cobertura invernales (como Vicia)."
    },
    "maiz": {
      rotacion: "Rotar con Soja o Leguminosas. El rastrojo de maíz aporta alta relación C/N protegiendo el suelo.",
      manejo: "Fertilización nitrogenada fraccionada y siembra directa para captar humedad."
    },
    "trigo": {
      rotacion: "Secuencia Trigo/Soja de segunda o rotación con pasturas plurianuales en suelos pampeanos.",
      manejo: "Monitoreo temprano de roya y fertilización con fósforo al inicio de la siembra."
    },
    "yerba mate": {
      rotacion: "Consorciar con cubiertas verdes perennes (ej. leguminosas rastreras) para no dejar el suelo rojo expuesto.",
      manejo: "Sistematización de suelos en curvas de nivel para frenar la fuerte erosión hídrica de laderas misiones."
    },
    "te": {
      rotacion: "Consociar con árboles de sombra leguminosos en bordes.",
      manejo: "Mantener mulching de rastrojo para conservar acidez, humedad y evitar erosión."
    },
    "pino taeda": {
      rotacion: "Sistemas silvopastoriles intercalados con pasturas megatérmicas.",
      manejo: "Podas tempranas a partir del año 3 para maximizar madera libre de nudos."
    },
    "pino elliottii": {
      rotacion: "Sistemas silvopastoriles con hacienda vacuna en lomas bajas.",
      manejo: "Raleo sistemático y control del sotobosque para prevenir incendios forestales."
    },
    "eucalyptus grandis": {
      rotacion: "Sistemas silvopastoriles con pastoreo rotativo intensivo en los callejones.",
      manejo: "Tratamiento de hormigas cortadoras de forma estricta los primeros 2 años."
    },
    "eucalyptus globulus": {
      rotacion: "Rotaciones madereras largas con intercalado de verdeos invernales.",
      manejo: "Control del escarabajo del eucalipto y fajas amortiguadoras de erosión."
    },
    "mani": {
      rotacion: "Rotar obligatoriamente 1 año de Maní cada 4-5 años con Gramíneas (Maíz/Sorgo) para evitar degradación física.",
      manejo: "Siembra inmediata de cultivos de cobertura (Centeno) tras el arrancado para frenar la erosión eólica."
    },
    "vid": {
      rotacion: "Mantener cubiertas verdes espontáneas o sembradas entre hileras (Cereales/Leguminosas).",
      manejo: "Riego presurizado por goteo de alta eficiencia para mitigar el déficit crónico."
    },
    "olivo": {
      rotacion: "Cubiertas vegetales de gramíneas para proteger el suelo de escorrentías en laderas.",
      manejo: "Poda de rejuvenecimiento bien planificada y riego localizado."
    },
    "citrus": {
      rotacion: "Manejo integrado de malezas interfilares sin labranza intensiva.",
      manejo: "Monitoreo estricto de HLB y protección contra heladas con riego por aspersión."
    },
    "limon": {
      rotacion: "Suelos cubiertos en entre líneas para mitigar erosión en laderas tucumanas.",
      manejo: "Podas sanitarias preventivas post-cosecha."
    }
  };

  return rotaciones[cultivoKey] || {
    rotacion: "Rotar con gramíneas locales y leguminosas para sostener la fertilidad biológica.",
    manejo: "Asegurar cobertura permanente del suelo y rotación de principios activos agrícolas."
  };
}