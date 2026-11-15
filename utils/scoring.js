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
    ((soil.ph !== null && soil.ph !== undefined) ||
     (soil.tipo && soil.tipo !== 'NO DISPONIBLE' && !soil.tipo.includes('no disponible')) ||
     (soil.textura && soil.textura !== 'NO DISPONIBLE' && !soil.textura.includes('no disponible')));

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
  const hasPhRequirement = reqSuelo.phMin !== undefined && reqSuelo.phMin !== null &&
    reqSuelo.phMax !== undefined && reqSuelo.phMax !== null;
  const hasTextureRequirement = Array.isArray(reqSuelo.texturas) && reqSuelo.texturas.length > 0;
  const hasDrainageRequirement = Array.isArray(reqSuelo.drenaje) && reqSuelo.drenaje.length > 0;
  const hasTemperatureRequirement = reqClima.temperaturaMin !== undefined && reqClima.temperaturaMin !== null &&
    reqClima.temperaturaMax !== undefined && reqClima.temperaturaMax !== null;
  const hasPrecipitationRequirement = reqClima.precipitacionMin !== undefined && reqClima.precipitacionMin !== null;
  const soilRequiredComparisons = [hasPhRequirement, hasTextureRequirement, hasDrainageRequirement].filter(Boolean).length;
  const climateRequiredComparisons = [hasTemperatureRequirement, hasPrecipitationRequirement].filter(Boolean).length;

  let deficienciasSeveras = 0;
  let deficienciasModeradas = 0;
  let soilComparisons = 0;
  let climateComparisons = 0;

  // 1. EVALUAR SUELO
  if (isSoilAvailable) {
    const phSuelo = soil.ph;
    const texturaSuelo = (soil.textura || '').toLowerCase();
    const drenajeSuelo = (soil.drenaje || '').toLowerCase();
    const limitantesSuelo = (soil.limitantes || '').toLowerCase();

    // pH
    const phVal = (soil.ph !== null && soil.ph !== undefined && !isNaN(parseFloat(soil.ph))) ? parseFloat(soil.ph) : null;
    if (phVal !== null && reqSuelo.phMin !== undefined && reqSuelo.phMin !== null && reqSuelo.phMax !== undefined && reqSuelo.phMax !== null) {
      soilComparisons++;
      if (phVal >= reqSuelo.phMin && phVal <= reqSuelo.phMax) {
        motivos.push(`✓ pH del suelo idóneo (${phVal.toFixed(1)}) dentro del rango (${reqSuelo.phMin}-${reqSuelo.phMax}).`);
      } else {
        const diff = phVal < reqSuelo.phMin ? reqSuelo.phMin - phVal : phVal - reqSuelo.phMax;
        if (diff > 1.2) {
          deficienciasSeveras++;
          riesgos.push(`⚠ pH desfasado severamente (${phVal.toFixed(1)} vs rango idóneo ${reqSuelo.phMin}-${reqSuelo.phMax}).`);
        } else {
          deficienciasModeradas++;
          riesgos.push(`⚠ pH moderadamente fuera de rango (${phVal.toFixed(1)} vs rango idóneo ${reqSuelo.phMin}-${reqSuelo.phMax}).`);
        }
      }
    }

    // Textura
    if (reqSuelo.texturas && reqSuelo.texturas.length > 0 && texturaSuelo && !texturaSuelo.includes('no disponible') && !texturaSuelo.includes('no especificada')) {
      soilComparisons++;
      const matchesTextura = reqSuelo.texturas.some(t => texturaSuelo.includes(t.toLowerCase()));
      if (matchesTextura) {
        motivos.push(`✓ Textura de suelo compatible (${soil.textura}).`);
      } else {
        if (texturaSuelo.includes("arcill")) {
          deficienciasModeradas++;
          riesgos.push(`⚠ Textura arcillosa/pesada: Propensa a encharcamientos y asfixia radicular.`);
        } else if (texturaSuelo.includes("arenos")) {
          deficienciasModeradas++;
          riesgos.push(`⚠ Textura arenosa: Menor retención hídrica y nutricional; requiere manejo de cobertura y reposición de nutrientes.`);
        }
      }
    }

    // Drenaje
    if (reqSuelo.drenaje && reqSuelo.drenaje.length > 0 && drenajeSuelo && !drenajeSuelo.includes('no disponible') && !drenajeSuelo.includes('no especificado')) {
      soilComparisons++;
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
      climateComparisons++;
      if (tempMedia >= reqClima.temperaturaMin && tempMedia <= reqClima.temperaturaMax) {
        motivos.push(`✓ Temperatura media regional idónea (${tempMedia}°C).`);
      } else {
        const diffTemp = tempMedia < reqClima.temperaturaMin ? reqClima.temperaturaMin - tempMedia : tempMedia - reqClima.temperaturaMax;
        if (diffTemp > 5) {
          deficienciasSeveras++;
          riesgos.push(`⚠ Temperatura media severamente desalineada: ${tempMedia}°C (Rango óptimo: ${reqClima.temperaturaMin}-${reqClima.temperaturaMax}°C).`);
        } else {
          deficienciasModeradas++;
          riesgos.push(`⚠ Temperatura media moderadamente desalineada: ${tempMedia}°C (Rango óptimo: ${reqClima.temperaturaMin}-${reqClima.temperaturaMax}°C).`);
        }
      }
    }
  }

  // Precipitaciones
  if (climate && climate.precipitacionesAnualesVal !== undefined && climate.precipitacionesAnualesVal !== null) {
    const precipAnual = climate.precipitacionesAnualesVal;
    if (reqClima.precipitacionMin !== undefined && reqClima.precipitacionMin !== null) {
      climateComparisons++;
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

    if (isSensitive && riesgoHeladas && !riesgoHeladas.includes('no disponible')) {
      climateComparisons++;
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

  // La procedencia y la escala forman parte de la decisión: una variable meteorológica
  // actual no reemplaza una serie climática, y un perfil regional no equivale a un dato puntual.
  const soilStatus = String(soil?.status || '').toUpperCase();
  const climateStatus = String(climate?.climatologyStatus || climate?.status || '').toUpperCase();
  const hasComparableEvidence = soilStatus === 'REAL' && climateStatus === 'REAL' &&
    isSoilAvailable && isClimateAvailable &&
    soilRequiredComparisons > 0 && climateRequiredComparisons > 0 &&
    soilComparisons >= soilRequiredComparisons &&
    climateComparisons >= climateRequiredComparisons;

  const profileText = String(soil?.aptitud || '').toLowerCase();
  const cropName = String(crop?.nombre || '').toLowerCase();
  const cropAliases = {
    naranja: ['naranja', 'citrus', 'citricos'],
    mandarina: ['mandarina', 'citrus', 'citricos'],
    limon: ['limon', 'citrus', 'citricos'],
    'yerba mate': ['yerba mate'],
    te: ['te', 'camellia'],
    'pino elliottii': ['pino elliottii'],
    'pino taeda': ['pino taeda'],
    'eucalyptus grandis': ['eucalyptus grandis', 'eucalipto grandis']
  };
  const aliases = cropAliases[cropName] || [cropName];
  const normalizedProfile = profileText.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const namedInZoneProfile = aliases.some(alias => {
    const normalizedAlias = alias.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    return normalizedAlias && ((' ' + normalizedProfile + ' ').includes(' ' + normalizedAlias + ' '));
  });
  if (namedInZoneProfile) {
    motivos.unshift('El perfil agroambiental de referencia menciona este cultivo; esta mención no se utiliza como prueba de aptitud del lote.');
  }

  let categoria = AptitudCategoria.NO_EVALUABLE;
  let nivelAptitud = 'PENDIENTE';

  // Solo se clasifica aptitud cuando el suelo puntual y la climatología de referencia
  // tienen procedencia REAL y hay comparaciones efectivas para ambos grupos.
  // Los perfiles regionales sirven para orientar candidatos, nunca para certificar aptitud.
  if (hasComparableEvidence) {
    categoria = AptitudCategoria.ALTA;
    nivelAptitud = 'ALTA';
    if (deficienciasSeveras > 0) {
      categoria = AptitudCategoria.BAJA;
      nivelAptitud = 'BAJA';
    } else if (deficienciasModeradas > 0) {
      categoria = AptitudCategoria.MEDIA;
      nivelAptitud = 'MEDIA';
    }
  } else {
    if (soilStatus !== 'REAL') datosFaltantes.push('Dato edáfico puntual de fuente identificada; el perfil regional no alcanza para clasificar aptitud.');
    if (climateStatus !== 'REAL') datosFaltantes.push('Climatología histórica puntual de fuente identificada.');
    if (soilComparisons < soilRequiredComparisons) datosFaltantes.push('Faltan una o más variables edáficas requeridas por la ficha del cultivo.');
    if (climateComparisons < climateRequiredComparisons) datosFaltantes.push('Faltan una o más variables climatológicas requeridas por la ficha del cultivo.');
    if (soilRequiredComparisons === 0) datosFaltantes.push('La ficha del cultivo no declara requerimientos edáficos estructurados para comparar.');
    if (climateRequiredComparisons === 0) datosFaltantes.push('La ficha del cultivo no declara requerimientos climatológicos estructurados para comparar.');
  }

  let calidadEvidencia = 'DATOS PARCIALES';
  if (!hasComparableEvidence) {
    calidadEvidencia = 'EVIDENCIA INSUFICIENTE PARA CLASIFICAR';
  } else if (soilStatus === 'REAL' && climateStatus === 'REAL') {
    calidadEvidencia = 'DATOS PUNTUALES E HISTÓRICOS';
  } else {
    calidadEvidencia = 'PERFIL AGROAMBIENTAL Y CLIMA DE REFERENCIA';
  }

  return {
    categoria: categoria,
    nivelAptitud: nivelAptitud,
    motivos: motivos.length > 0 ? motivos : ["No hay variables comparables suficientes para clasificar este cultivo."],
    riesgos: riesgos,
    datosFaltantes: datosFaltantes,
    calidadEvidencia: calidadEvidencia
  };
}
