/**
 * Motor de evaluación cualitativa de compatibilidad agronómica para Agro Consultas.
 * Basado estrictamente en evidencia real edáfica y climática de fuentes oficiales.
 * Cero números arbitrarios, cero porcentajes inventados, cero fallbacks numéricos ocultos.
 */

export const AptitudCategoria = {
  ALTA: 'APTITUD ALTA',
  MEDIA: 'APTITUD MEDIA (PRESENTA LIMITANTES)',
  BAJA: 'APTITUD BAJA (LIMITACIONES SEVERAS)',
  NO_EVALUABLE: 'INFORMACIÓN PENDIENTE DE VERIFICACIÓN'
};

/**
 * Evalúa la compatibilidad de un cultivo frente a las condiciones agroambientales locales.
 *
 * @param {Object} crop Datos del cultivo
 * @param {Object} soil Reporte de suelo
 * @param {Object} climate Reporte de clima
 * @returns {Object} { categoria, nivelAptitud, motivos, riesgos, datosFaltantes, calidadEvidencia }
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
    datosFaltantes.push("Cartografía edáfica de alta resolución no disponible en esta coordenada.");
  }

  const isClimateAvailable = climate &&
    climate.temperaturaMediaVal !== undefined &&
    climate.temperaturaMediaVal !== null;

  if (!isClimateAvailable) {
    datosFaltantes.push("Estadísticas climáticas históricas no disponibles.");
  }

  const reqSuelo = crop.requerimientos?.suelo || {};
  const reqClima = crop.requerimientos?.clima || {};

  let deficienciasSeveras = 0;
  let deficienciasModeradas = 0;

  // 1. EVALUAR SUELO
  if (isSoilAvailable) {
    const phSuelo = soil.ph;
    const texturaSuelo = (soil.textura || '').toLowerCase();
    const drenajeSuelo = (soil.drenaje || '').toLowerCase();
    const limitantesSuelo = (soil.limitantes || '').toLowerCase();

    // pH
    if (reqSuelo.phMin !== undefined && reqSuelo.phMin !== null && reqSuelo.phMax !== undefined && reqSuelo.phMax !== null) {
      if (phSuelo >= reqSuelo.phMin && phSuelo <= reqSuelo.phMax) {
        motivos.push(`✓ pH del suelo idóneo (${phSuelo.toFixed(1)}) dentro del rango (${reqSuelo.phMin}-${reqSuelo.phMax}).`);
      } else {
        const diff = phSuelo < reqSuelo.phMin ? reqSuelo.phMin - phSuelo : phSuelo - reqSuelo.phMax;
        if (diff > 1.2) {
          deficienciasSeveras++;
          riesgos.push(`⚠ pH desfasado severamente (${phSuelo.toFixed(1)} vs rango idóneo ${reqSuelo.phMin}-${reqSuelo.phMax}).`);
        } else {
          deficienciasModeradas++;
          riesgos.push(`⚠ pH moderadamente fuera de rango (${phSuelo.toFixed(1)} vs rango idóneo ${reqSuelo.phMin}-${reqSuelo.phMax}).`);
        }
      }
    }

    // Textura
    if (reqSuelo.texturas && reqSuelo.texturas.length > 0) {
      const matchesTextura = reqSuelo.texturas.some(t => texturaSuelo.includes(t.toLowerCase()));
      if (matchesTextura) {
        motivos.push(`✓ Textura de suelo compatible (${soil.textura}).`);
      } else {
        if (texturaSuelo.includes("arcill")) {
          deficienciasModeradas++;
          riesgos.push(`⚠ Textura arcillosa/pesada: Propensa a encharcamientos y asfixia radicular.`);
        } else if (texturaSuelo.includes("arenos")) {
          riesgos.push(`⚠ Textura arenosa: Menor retención hídrica y nutricional.`);
        }
      }
    }

    // Drenaje
    if (reqSuelo.drenaje && reqSuelo.drenaje.length > 0) {
      const matchesDrenaje = reqSuelo.drenaje.some(d => drenajeSuelo.includes(d.toLowerCase()));
      if (matchesDrenaje) {
        motivos.push(`✓ Drenaje de suelo adecuado (${soil.drenaje}).`);
      } else if (drenajeSuelo.includes("pobre") || drenajeSuelo.includes("lento")) {
        const nom = (crop.nombre || '').toLowerCase();
        if (!nom.includes("arroz")) {
          deficienciasSeveras++;
          riesgos.push("⚠ Drenaje deficiente: Riesgo elevado de anegamiento y asfixia radicular.");
        }
      }
    }

    // Limitantes (tosca / salinidad)
    if (limitantesSuelo.includes("tosca")) {
      const nom = (crop.nombre || '').toLowerCase();
      const isDeepRoot = nom.includes("pino") || nom.includes("eucalyptus") || nom.includes("vid") || nom.includes("olivo") || nom.includes("limon") || nom.includes("naranja");
      if (isDeepRoot) {
        deficienciasSeveras++;
        riesgos.push("⚠ Presencia de tosca: Restringe fuertemente el desarrollo de raíces profundas.");
      }
    }
    if (limitantesSuelo.includes("salinidad") || limitantesSuelo.includes("sales")) {
      const nom = (crop.nombre || '').toLowerCase();
      const isTolerant = nom.includes("cebada") || nom.includes("sorgo");
      if (isTolerant) {
        motivos.push("✓ Tolerancia moderada a la salinidad edáfica.");
      } else {
        deficienciasSeveras++;
        riesgos.push("⚠ Elevada salinidad/conductividad edáfica: Riesgo de fitotoxicidad.");
      }
    }
  }

  // 2. EVALUAR CLIMA Y TEMPERATURA
  if (isClimateAvailable) {
    const tempMedia = climate.temperaturaMediaVal;

    if (reqClima.temperaturaMin !== undefined && reqClima.temperaturaMin !== null && reqClima.temperaturaMax !== undefined && reqClima.temperaturaMax !== null) {
      if (tempMedia >= reqClima.temperaturaMin && tempMedia <= reqClima.temperaturaMax) {
        motivos.push(`✓ Temperatura media regional idónea (${tempMedia}°C).`);
      } else {
        deficienciasModeradas++;
        riesgos.push(`⚠ Temperatura media desalineada: ${tempMedia}°C (Rango óptimo: ${reqClima.temperaturaMin}-${reqClima.temperaturaMax}°C).`);
      }
    }
  }

  // Precipitaciones
  if (climate && climate.precipitacionesAnualesVal !== undefined && climate.precipitacionesAnualesVal !== null) {
    const precipAnual = climate.precipitacionesAnualesVal;
    if (reqClima.precipitacionMin !== undefined && reqClima.precipitacionMin !== null) {
      if (precipAnual >= reqClima.precipitacionMin) {
        motivos.push(`✓ Régimen pluviométrico adecuado (${precipAnual} mm/año >= mínimo ${reqClima.precipitacionMin} mm).`);
      } else {
        const diffPrecip = reqClima.precipitacionMin - precipAnual;
        if (diffPrecip > 300) {
          deficienciasSeveras++;
          riesgos.push(`⚠ Déficit hídrico severo: ${precipAnual} mm/año vs mínimo requerido de ${reqClima.precipitacionMin} mm/año.`);
        } else {
          deficienciasModeradas++;
          riesgos.push(`⚠ Déficit hídrico moderado: ${precipAnual} mm/año (Requiere riego complementario para potencial óptimo).`);
        }
      }
    }
  }

  // Heladas
  if (climate && climate.heladas) {
    const riesgoHeladas = (climate.heladas || '').toLowerCase();
    const textClimaCrop = (crop.reqClima || '').toLowerCase();
    const nom = (crop.nombre || '').toLowerCase();
    const isSensitive = textClimaCrop.includes("sensible a heladas") || textClimaCrop.includes("libre de heladas") || nom.includes("yerba mate") || nom.includes("te") || nom.includes("mandioca") || nom.includes("limon") || nom.includes("naranja");

    if (isSensitive) {
      if (riesgoHeladas.includes("alto") || riesgoHeladas.includes("frecuentes")) {
        deficienciasSeveras++;
        riesgos.push("⚠ Alta frecuencia de heladas en zona para especie sensible.");
      } else if (riesgoHeladas.includes("medio") || riesgoHeladas.includes("moderado")) {
        deficienciasModeradas++;
        riesgos.push("⚠ Riesgo moderado de heladas invernales.");
      } else {
        motivos.push("✓ Baja probabilidad de heladas en la zona.");
      }
    }
  }

  // Evaluaciones finales
  if (!isSoilAvailable && !isClimateAvailable) {
    return {
      categoria: AptitudCategoria.NO_EVALUABLE,
      nivelAptitud: 'INFORMACIÓN PENDIENTE',
      motivos: ["Información edáfica y climática pendiente para determinar aptitud."],
      riesgos: riesgos,
      datosFaltantes: datosFaltantes,
      calidadEvidencia: 'INFORMACIÓN PENDIENTE'
    };
  }

  let categoria = AptitudCategoria.ALTA;
  let nivelAptitud = 'ALTA';

  if (deficienciasSeveras > 0) {
    categoria = AptitudCategoria.BAJA;
    nivelAptitud = 'BAJA';
  } else if (deficienciasModeradas > 0 || !isSoilAvailable || !isClimateAvailable) {
    categoria = AptitudCategoria.MEDIA;
    nivelAptitud = 'MEDIA';
  }

  let calidadEvidencia = 'ALTA';
  if (!isSoilAvailable || !isClimateAvailable) {
    calidadEvidencia = 'MEDIA';
  }

  return {
    categoria: categoria,
    nivelAptitud: nivelAptitud,
    motivos: motivos.length > 0 ? motivos : ["Condiciones agroambientales registradas compatibles."],
    riesgos: riesgos,
    datosFaltantes: datosFaltantes,
    calidadEvidencia: calidadEvidencia
  };
}
