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
    const merged = {};
    for (const [k, v] of Object.entries(resCultivos)) {
      merged[k] = { id: k, ...v };
    }
    for (const [k, v] of Object.entries(resForestales)) {
      if (merged[k]) {
        merged[k] = { ...merged[k], ...v };
      } else {
        merged[k] = { id: k, ...v };
      }
    }
    cultivosData = merged;
  }
  return cultivosData;
}

/**
 * Retorna el catálogo normalizado completo.
 */
export async function getNormalizedCatalog() {
  return await loadCultivosData();
}

/**
 * Retorna exclusivamente el catálogo de cultivos agrícolas/hortícolas/frutícolas/regionales.
 */
export async function getCropCatalog() {
  const catalog = await loadCultivosData();
  const res = {};
  for (const [k, v] of Object.entries(catalog)) {
    if (v.categoria !== 'Forestal' && !v.pino_eucalyptus) {
      res[k] = v;
    }
  }
  return res;
}

/**
 * Retorna los nombres de los cultivos agrícolas aptos a evaluar para una ubicación/provincia.
 * Si no hay restricción provincial, retorna la totalidad de los cultivos agrícolas del catálogo.
 *
 * @param {string} [provinciaKey] - Clave opcional de la provincia.
 * @returns {Promise<Array<string>>} Lista de nombres de cultivos a evaluar.
 */
export async function getCropsToEvaluate(provinciaKey = null) {
  const cropCatalog = await getCropCatalog();
  if (provinciaKey) {
    const provKeyNorm = normalizeKey(provinciaKey);
    try {
      const resProvincias = await fetch('/data/provincias.json').then(r => r.ok ? r.json() : {}).catch(() => ({}));
      const provData = resProvincias[provKeyNorm];
      if (provData && provData.nombre && Array.isArray(provData.nombre.cultivos)) {
        const cultivosProv = provData.nombre.cultivos;
        const nombresValidos = [];
        cultivosProv.forEach(cName => {
          const cKey = normalizeKey(cName);
          if (cropCatalog[cKey]) {
            nombresValidos.push(cropCatalog[cKey].nombre || cName);
          } else {
            const foundKey = Object.keys(cropCatalog).find(k => normalizeKey(cropCatalog[k].nombre) === cKey || k === cKey);
            if (foundKey) {
              nombresValidos.push(cropCatalog[foundKey].nombre);
            }
          }
        });
        if (nombresValidos.length > 0) {
          return nombresValidos;
        }
      }
    } catch (e) {
      console.warn("Fallo al consultar provincias.json:", e);
    }
  }
  return Object.values(cropCatalog).map(item => item.nombre || item.id);
}

/**
 * Retorna exclusivamente el catálogo de especies forestales.
 */
export async function getForestCatalog() {
  const catalog = await loadCultivosData();
  const res = {};
  for (const [k, v] of Object.entries(catalog)) {
    if (v.categoria === 'Forestal' || v.pino_eucalyptus) {
      res[k] = v;
    }
  }
  return res;
}

/**
 * Genera el listado de cultivos recomendados para una provincia y coordenadas dadas.
 * Combina datos locales del suelo y clima de fuentes reales.
 *
 * @param {Array<string>} listadoNombres - Lista de cultivos recomendados por la provincia.
 * @param {Object} soilReport - Datos del suelo consolidado.
 * @param {Object} climateReport - Datos de clima consolidado.
 * @returns {Promise<Array<Object>>} Lista de objetos de cultivo enriquecidos con compatibilidad y sostenibilidad.
 */
export async function generateRecommendations(listadoNombres, soilReport, climateReport) {
  await loadCultivosData();

  // Garantizar que fallas o demoras en reportes de suelo o clima no detengan la evaluación de cultivos
  const safeSoil = soilReport || { status: 'UNAVAILABLE', message: 'Datos de suelo pendientes de verificación' };
  const safeClimate = climateReport || { status: 'UNAVAILABLE', message: 'Datos climáticos pendientes de verificación' };

  return listadoNombres.map(nombre => {
    try {
      const key = normalizeKey(nombre);
      const hasFicha = Boolean(cultivosData && cultivosData[key]);
      const cropData = (cultivosData && cultivosData[key]) ? cultivosData[key] : {
        nombre: nombre,
        descripcion: "Información técnica en proceso de verificación.",
        siembra: "Información técnica no disponible",
        cosecha: "Información técnica no disponible",
        reqSuelo: "Información técnica no disponible",
        reqClima: "Información técnica no disponible",
        requerimientos: null
      };

      // Calcular compatibilidad cualitativa atrapando excepciones locales
      let compat;
      try {
        compat = hasFicha
          ? calcularCompatibilidad({ nombre, ...cropData }, safeSoil, safeClimate)
          : {
              categoria: "INFORMACIÓN PENDIENTE DE VERIFICACIÓN",
              motivos: ["Información técnica del cultivo en proceso de verificación."],
              riesgos: ["Falta de ficha agronómica de referencia."],
              datosFaltantes: ["Ficha técnica agronómica"]
            };
      } catch (errEval) {
        console.warn(`[recommendationEngine] Excepción al evaluar ${nombre}:`, errEval);
        compat = {
          categoria: "INFORMACIÓN PENDIENTE DE VERIFICACIÓN",
          motivos: ["Faltan variables edáficas o climáticas para completar el cálculo."],
          riesgos: ["Evaluación sujeta a verificación de campo."],
          datosFaltantes: ["Datos ambientales locales"]
        };
      }

      // Obtener recomendaciones de manejo y rotación sostenible
      const sostenibilidad = obtenerPracticasSostenibles(key);

      const isReal = safeSoil && (safeSoil.status === 'REAL' || safeSoil.status === 'real');
      const isUnavailable = safeSoil && (safeSoil.status === 'UNAVAILABLE' || safeSoil.status === 'unavailable');
      const labelConfianza = isUnavailable ? 'Información pendiente de verificación' : (isReal ? 'Datos locales verificados' : 'Contexto regional');
      const classConfianza = isUnavailable ? 'none' : (isReal ? 'high' : 'medium');

      return {
        nombre: nombre.charAt(0).toUpperCase() + nombre.slice(1),
        descripcion: cropData.descripcion || "Descripción técnica no disponible.",
        siembra: cropData.siembra || "Información pendiente",
        cosecha: cropData.cosecha || "Información pendiente",
        reqSuelo: cropData.reqSuelo || "Información técnica no disponible.",
        reqClima: cropData.reqClima || "Información técnica no disponible.",
        compatibilidad: compat.categoria || "INFORMACIÓN PENDIENTE DE VERIFICACIÓN",
        motivos: compat.motivos || ["Factor de desarrollo bajo análisis"],
        riesgos: compat.riesgos || [],
        datosFaltantes: compat.datosFaltantes || [],
        variedades: cropData.variedades || [],
        fuenteVariedades: cropData.fuenteVariedades || null,
        rendimientoEstimado: cropData.rendimientoEstimado || null,
        confianza: labelConfianza,
        nivelConfianza: classConfianza,
        sostenibilidad: sostenibilidad
      };
    } catch (e) {
      console.error(`[recommendationEngine] Fallo al procesar cultivo ${nombre}:`, e);
      return {
        nombre: nombre,
        descripcion: "Análisis de aptitud no disponible.",
        siembra: "Información pendiente",
        cosecha: "Información pendiente",
        reqSuelo: "Información técnica no disponible.",
        reqClima: "Información técnica no disponible.",
        compatibilidad: "INFORMACIÓN PENDIENTE DE VERIFICACIÓN",
        motivos: ["Información ambiental pendiente de verificación"],
        riesgos: [],
        datosFaltantes: [],
        confianza: "Información pendiente de verificación",
        nivelConfianza: "none",
        sostenibilidad: { rotacion: "Manejo estándar", manejo: "Alineado a buenas prácticas agronómicas." }
      };
    }
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
