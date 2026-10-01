/**
 * Motor de evaluación cualitativa de compatibilidad agronómica para Agro Consultas.
 * Basado estrictamente en evidencia real edáfica y climática de fuentes oficiales.
 * Cero números arbitrarios, cero porcentajes inventados, cero fallbacks numéricos ocultos.
 */

/**
 * Evalúa la compatibilidad de un cultivo frente a las condiciones agroambientales locales.
 *
 * @param {Object} crop Datos del cultivo
 * @param {Object} soil Reporte de suelo
 * @param {Object} climate Reporte de clima
 * @returns {Object} { categoria, motivos, riesgos, datosFaltantes }
 */
export function calcularCompatibilidad(crop, soil, climate) {
  const motivos = [];
  const riesgos = [];
  const datosFaltantes = [];

  const isSoilAvailable = soil &&
    soil.status !== 'UNAVAILABLE' &&
    soil.status !== 'unavailable' &&
    soil.ph !== null &&
    soil.ph !== undefined;

  if (!isSoilAvailable) {
    datosFaltantes.push("Cartografía de suelos en alta resolución no disponible para las coordenadas seleccionadas.");
  }

  const isClimateAvailable = climate &&
    climate.temperaturaMediaVal !== undefined &&
    climate.temperaturaMediaVal !== null;

  if (!isClimateAvailable) {
    datosFaltantes.push("Estadísticas de temperatura media histórica no disponibles.");
  }

  const reqSuelo = crop.requerimientos?.suelo || {};
  const reqClima = crop.requerimientos?.clima || {};

  let tieneEvaluacionNegativa = false;
  let tieneEvaluacionPositiva = false;

  // 1. EVALUAR SUELO
  if (isSoilAvailable) {
    const phSuelo = soil.ph;
    const texturaSuelo = (soil.textura || '').toLowerCase();
    const drenajeSuelo = (soil.drenaje || '').toLowerCase();
    const limitantesSuelo = (soil.limitantes || '').toLowerCase();

    // pH
    if (reqSuelo.phMin !== undefined && reqSuelo.phMin !== null && reqSuelo.phMax !== undefined && reqSuelo.phMax !== null) {
      if (phSuelo >= reqSuelo.phMin && phSuelo <= reqSuelo.phMax) {
        motivos.push(`✓ pH del suelo adecuado (${phSuelo.toFixed(1)}) dentro del rango idóneo (${reqSuelo.phMin}-${reqSuelo.phMax}).`);
        tieneEvaluacionPositiva = true;
      } else {
        tieneEvaluacionNegativa = true;
        if (phSuelo < reqSuelo.phMin) {
          riesgos.push(`⚠ Suelo ácido (pH ${phSuelo.toFixed(1)}): El cultivo requiere un pH mínimo de ${reqSuelo.phMin}.`);
        } else {
          riesgos.push(`⚠ Suelo alcalino (pH ${phSuelo.toFixed(1)}): El cultivo requiere un pH máximo de ${reqSuelo.phMax}.`);
        }
      }
    }

    // Textura
    if (reqSuelo.texturas && reqSuelo.texturas.length > 0) {
      const matchesTextura = reqSuelo.texturas.some(t => texturaSuelo.includes(t.toLowerCase()));
      if (matchesTextura) {
        motivos.push(`✓ Textura de suelo compatible (${soil.textura}).`);
        tieneEvaluacionPositiva = true;
      } else {
        if (texturaSuelo.includes("arcill")) {
          riesgos.push(`⚠ Textura arcillosa/pesada: Propensa a encharcamientos y asfixia radicular.`);
          tieneEvaluacionNegativa = true;
        } else if (texturaSuelo.includes("arenos")) {
          riesgos.push(`⚠ Textura arenosa: Menor retención de agua y nutrientes.`);
        }
      }
    }

    // Drenaje
    if (reqSuelo.drenaje && reqSuelo.drenaje.length > 0) {
      const matchesDrenaje = reqSuelo.drenaje.some(d => drenajeSuelo.includes(d.toLowerCase()));
      if (matchesDrenaje) {
        motivos.push(`✓ Drenaje de suelo adecuado (${soil.drenaje}).`);
        tieneEvaluacionPositiva = true;
      } else if (drenajeSuelo.includes("pobre") || drenajeSuelo.includes("lento")) {
        const nom = (crop.nombre || '').toLowerCase();
        if (!nom.includes("arroz")) {
          riesgos.push("⚠ Drenaje deficiente: Riesgo de anegamiento y asfixia de raíces en periodos húmedos.");
          tieneEvaluacionNegativa = true;
        }
      }
    }

    // Limitantes (tosca / salinidad)
    if (limitantesSuelo.includes("tosca")) {
      const nom = (crop.nombre || '').toLowerCase();
      const isDeepRoot = nom.includes("pino") || nom.includes("eucalyptus") || nom.includes("forestacion") || nom.includes("vid") || nom.includes("olivo") || nom.includes("arbol");
      if (isDeepRoot) {
        riesgos.push("⚠ Presencia de tosca: Limita la profundidad efectiva para especies de raíz profunda.");
        tieneEvaluacionNegativa = true;
      }
    }
    if (limitantesSuelo.includes("salinidad") || limitantesSuelo.includes("sales")) {
      const nom = (crop.nombre || '').toLowerCase();
      const isTolerant = nom.includes("cebada") || nom.includes("olivo") || nom.includes("sorgo");
      if (isTolerant) {
        motivos.push("✓ Tolerancia moderada a la salinidad o conductividad del suelo.");
      } else {
        riesgos.push("⚠ Elevada salinidad/conductividad edáfica: Riesgo de fitotoxicidad.");
        tieneEvaluacionNegativa = true;
      }
    }
  }

  // 2. EVALUAR CLIMA Y TEMPERATURA
  if (isClimateAvailable) {
    const tempMedia = climate.temperaturaMediaVal;

    if (reqClima.temperaturaMin !== undefined && reqClima.temperaturaMin !== null && reqClima.temperaturaMax !== undefined && reqClima.temperaturaMax !== null) {
      if (tempMedia >= reqClima.temperaturaMin && tempMedia <= reqClima.temperaturaMax) {
        motivos.push(`✓ Temperatura media regional compatible (${tempMedia}°C).`);
        tieneEvaluacionPositiva = true;
      } else {
        riesgos.push(`⚠ Temperatura desalineada: La media regional es de ${tempMedia}°C (Rango idóneo: ${reqClima.temperaturaMin}-${reqClima.temperaturaMax}°C).`);
        tieneEvaluacionNegativa = true;
      }
    }
  }

  // Precipitaciones
  if (climate && climate.precipitacionesAnualesVal !== undefined && climate.precipitacionesAnualesVal !== null) {
    const precipAnual = climate.precipitacionesAnualesVal;
    if (reqClima.precipitacionMin !== undefined && reqClima.precipitacionMin !== null) {
      if (precipAnual >= reqClima.precipitacionMin) {
        motivos.push(`✓ Régimen de precipitación regional adecuado (${precipAnual} mm/año >= mínimo ${reqClima.precipitacionMin} mm).`);
        tieneEvaluacionPositiva = true;
      } else {
        riesgos.push(`⚠ Déficit hídrico regional: Precipitación de ${precipAnual} mm/año por debajo del mínimo de ${reqClima.precipitacionMin} mm.`);
        tieneEvaluacionNegativa = true;
      }
    }
  }

  // Riesgo de heladas
  if (climate && climate.heladas) {
    const riesgoHeladas = (climate.heladas || '').toLowerCase();
    const textClimaCrop = (crop.reqClima || '').toLowerCase();
    const nom = (crop.nombre || '').toLowerCase();
    const isSensitive = textClimaCrop.includes("sensible a heladas") || textClimaCrop.includes("libre de heladas") || nom.includes("yerba mate") || nom.includes("te") || nom.includes("banana") || nom.includes("mandioca");

    if (isSensitive) {
      if (riesgoHeladas.includes("alto") || riesgoHeladas.includes("frecuentes")) {
        riesgos.push("⚠ Alerta de Heladas: Cultivo sensible y zona con alta frecuencia de heladas.");
        tieneEvaluacionNegativa = true;
      } else if (riesgoHeladas.includes("medio") || riesgoHeladas.includes("moderado")) {
        riesgos.push("⚠ Riesgo moderado de heladas en la zona.");
      } else {
        motivos.push("✓ Zona con baja probabilidad de heladas, idónea para especies sensibles.");
        tieneEvaluacionPositiva = true;
      }
    }
  }

  // Determinación de Categoría Cualitativa
  if (!isSoilAvailable && !isClimateAvailable) {
    return {
      categoria: "EVIDENCIA INSUFFICIENTE",
      motivos: ["No hay datos edáficos o climáticos suficientes para emitir un veredicto."],
      riesgos: riesgos,
      datosFaltantes: datosFaltantes
    };
  }

  let categoria = "COMPATIBLE CON LAS CONDICIONES EVALUADAS";
  if (tieneEvaluacionNegativa) {
    categoria = "PRESENTA LIMITANTES EN LA ZONA";
  } else if (!isSoilAvailable) {
    categoria = "EVIDENCIA INSUFFICIENTE (SUELO NO DISPONIBLE)";
  }

  return {
    categoria: categoria,
    motivos: motivos.length > 0 ? motivos : ["Alineado con el contexto regional general."],
    riesgos: riesgos,
    datosFaltantes: datosFaltantes
  };
}
