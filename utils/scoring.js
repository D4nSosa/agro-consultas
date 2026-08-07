/**
 * Motor de puntaje de compatibilidad configurable para Agro Consultas
 */

const DEFAULT_WEIGHTS = {
  suelo: 30,         // Ponderación de pH, textura y drenaje (30%)
  clima: 30,         // Ponderación de temperatura (30%)
  agua: 20,          // Ponderación de precipitación (20%)
  temperatura: 10,   // Ponderación de riesgo de heladas (10%)
  limitantes: 10     // Ponderación de limitaciones edáficas (salinidad, tosca) (10%)
};

/**
 * Evalúa la compatibilidad de un cultivo frente a las condiciones agroambientales locales.
 * Devuelve un puntaje de 0 a 100, la categoría cualitativa, factores de éxito y limitantes.
 *
 * @param {Object} crop Datos del cultivo
 * @param {Object} soil Datos del suelo local
 * @param {Object} climate Datos del clima local
 * @param {Object} customWeights Pesos personalizados opcionales
 * @returns {Object} { score, categoria, motivos, riesgos }
 */
export function calcularCompatibilidad(crop, soil, climate, customWeights = {}) {
  const weights = { ...DEFAULT_WEIGHTS, ...customWeights };

  const motivos = [];
  const riesgos = [];

  // Variables de control del suelo
  let phSuelo = soil.ph || 6.5; // default neutro
  const texturaSuelo = (soil.textura || '').toLowerCase();
  const drenajeSuelo = (soil.drenaje || '').toLowerCase();
  const limitantesSuelo = (soil.limitantes || '').toLowerCase();
  const aptitudSueloText = (soil.aptitud || '').toLowerCase();

  // Variables de control del clima
  const tempMedia = climate.temperaturaMedia || 18;
  const precipAnual = climate.precipitaciones || 800;
  const riesgoHeladas = climate.heladas || 'bajo';

  // 1. EVALUAR SUELO (Peso: 30% por defecto)
  let soilPoints = 100;
  let hasSoilData = false;

  const reqSuelo = crop.requerimientos?.suelo || {};

  // Evaluación de pH
  if (reqSuelo.phMin !== undefined && reqSuelo.phMin !== null) {
    hasSoilData = true;
    if (phSuelo >= reqSuelo.phMin && phSuelo <= reqSuelo.phMax) {
      motivos.push(`✓ pH del suelo adecuado (${phSuelo.toFixed(1)}) para los requerimientos del cultivo (${reqSuelo.phMin}-${reqSuelo.phMax}).`);
    } else {
      const diff = phSuelo < reqSuelo.phMin ? reqSuelo.phMin - phSuelo : phSuelo - reqSuelo.phMax;
      const penalty = Math.min(diff * 35, 70); // penalización máxima de 70 puntos
      soilPoints -= penalty;

      if (phSuelo < reqSuelo.phMin) {
        riesgos.push(`⚠ Suelo demasiado ácido (pH ${phSuelo.toFixed(1)}): El cultivo requiere un pH mínimo de ${reqSuelo.phMin}.`);
      } else {
        riesgos.push(`⚠ Suelo demasiado alcalino (pH ${phSuelo.toFixed(1)}): El cultivo requiere un pH máximo de ${reqSuelo.phMax}.`);
      }
    }
  } else {
    // Fallback basado en reglas de compatibilidad de texto anteriores
    const nom = crop.nombre ? crop.nombre.toLowerCase() : "";
    if (nom.includes("yerba mate") || nom.includes("te") || nom.includes("pino taeda")) {
      if (phSuelo >= 4.5 && phSuelo <= 6.0) {
        motivos.push(`✓ pH óptimo de suelo ácido (${phSuelo.toFixed(1)}) idóneo para especies acidófilas.`);
      } else if (phSuelo > 6.5) {
        soilPoints -= 40;
        riesgos.push(`⚠ pH alto (${phSuelo.toFixed(1)}): Riesgo de clorosis férrica en especies de suelos ácidos.`);
      }
    } else if (nom.includes("alfalfa") || nom.includes("soja") || nom.includes("trigo") || nom.includes("maiz")) {
      if (phSuelo >= 6.0 && phSuelo <= 7.5) {
        motivos.push(`✓ pH equilibrado (${phSuelo.toFixed(1)}) ideal para asimilación de nitrógeno y fósforo.`);
      } else if (phSuelo < 5.5) {
        soilPoints -= 40;
        riesgos.push(`⚠ Acidez de suelo perjudicial (pH ${phSuelo.toFixed(1)}): Limita la nodulación bacteriana.`);
        if (phSuelo < 5.0) soilPoints -= 30;
      }
    }
  }

  // Evaluación de Textura
  if (reqSuelo.texturas && reqSuelo.texturas.length > 0) {
    hasSoilData = true;
    const matchesTextura = reqSuelo.texturas.some(t => texturaSuelo.includes(t));
    if (matchesTextura) {
      motivos.push(`✓ Textura de suelo compatible (${texturaSuelo}).`);
    } else {
      // Si el suelo es arcilloso pesado y el cultivo es sensible
      if (texturaSuelo.includes("arcillo") || texturaSuelo.includes("arcillosa")) {
        soilPoints -= 40;
        riesgos.push(`⚠ Textura muy arcillosa/pesada: Propensa a encharcamientos y asfixia radicular.`);
      } else if (texturaSuelo.includes("arenos") || texturaSuelo.includes("arenosa")) {
        soilPoints -= 25;
        riesgos.push(`⚠ Textura muy arenosa: Baja capacidad de retención de agua y nutrientes.`);
      } else {
        soilPoints -= 15;
      }
    }
  } else {
    // Fallback de texto anterior para texturas
    const nom = crop.nombre ? crop.nombre.toLowerCase() : "";
    if (texturaSuelo.includes("arcillo") || texturaSuelo.includes("arcillosa")) {
      if (nom.includes("arroz")) {
        motivos.push("✓ Textura arcillosa pesada ideal para retener la lámina de agua.");
      } else if (nom.includes("mani") || nom.includes("papa")) {
        soilPoints -= 50;
        riesgos.push("⚠ Suelo arcilloso y pesado: Dificulta severamente la cosecha y clavado de frutos subterráneos.");
      }
    } else if (texturaSuelo.includes("arenos") || texturaSuelo.includes("arenosa")) {
      if (nom.includes("mani")) {
        motivos.push("✓ Textura arenosa suelta perfecta para el enterramiento del fruto del maní.");
      }
    }
  }

  // Evaluación de Drenaje
  if (reqSuelo.drenaje && reqSuelo.drenaje.length > 0) {
    hasSoilData = true;
    const matchesDrenaje = reqSuelo.drenaje.some(d => drenajeSuelo.includes(d));
    if (matchesDrenaje) {
      motivos.push(`✓ Nivel de drenaje adecuado (${drenajeSuelo}).`);
    } else if (drenajeSuelo.includes("pobre") || drenajeSuelo.includes("lento")) {
      const nom = crop.nombre ? crop.nombre.toLowerCase() : "";
      if (!nom.includes("arroz")) {
        soilPoints -= 35;
        riesgos.push("⚠ Drenaje deficiente: Riesgo elevado de pudrición de raíces en periodos húmedos.");
      }
    }
  } else {
    // Fallback de drenaje anterior
    const nom = crop.nombre ? crop.nombre.toLowerCase() : "";
    if ((drenajeSuelo.includes("pobre") || drenajeSuelo.includes("lento")) && !nom.includes("arroz")) {
      soilPoints -= 30;
      riesgos.push("⚠ Drenaje deficiente: Alto riesgo de anegamiento y asfixia radicular.");
    }
  }

  // Si no había datos estructurados de suelo específicos, asegurar puntuación base neutra de 90
  if (!hasSoilData && soilPoints === 100) {
    soilPoints = 90;
  }

  // 2. EVALUAR CLIMA/TEMPERATURA (Peso: 30% por defecto)
  let climatePoints = 100;
  let hasClimateData = false;

  const reqClima = crop.requerimientos?.clima || {};

  if (reqClima.temperaturaMin !== undefined && reqClima.temperaturaMin !== null) {
    hasClimateData = true;
    if (tempMedia >= reqClima.temperaturaMin && tempMedia <= reqClima.temperaturaMax) {
      motivos.push(`✓ Temperatura media regional compatible (${tempMedia}°C).`);
    } else {
      const diff = tempMedia < reqClima.temperaturaMin ? reqClima.temperaturaMin - tempMedia : tempMedia - reqClima.temperaturaMax;
      const penalty = Math.min(diff * 12, 60);
      climatePoints -= penalty;
      riesgos.push(`⚠ Temperatura desalineada: La media local es de ${tempMedia}°C pero el rango ideal es de ${reqClima.temperaturaMin}-${reqClima.temperaturaMax}°C.`);
    }
  } else {
    // Puntuación climática neutra por defecto si no está estructurado
    climatePoints = 90;
  }

  // 3. EVALUAR AGUA/PRECIPITACIONES (Peso: 20% por defecto)
  let waterPoints = 100;
  if (reqClima.precipitacionMin !== undefined && reqClima.precipitacionMin !== null) {
    if (precipAnual >= reqClima.precipitacionMin) {
      motivos.push(`✓ Régimen hídrico compatible (precipitación anual local ${precipAnual}mm >= requerimiento ${reqClima.precipitacionMin}mm).`);
    } else {
      const diff = reqClima.precipitacionMin - precipAnual;
      const penalty = Math.min((diff / reqClima.precipitacionMin) * 80, 70);
      waterPoints -= penalty;
      riesgos.push(`⚠ Déficit hídrico: Precipitación de ${precipAnual}mm/año por debajo del óptimo de ${reqClima.precipitacionMin}mm.`);
    }
  } else {
    // Si no está estructurado, intentar inferir del texto
    const textClima = (crop.reqClima || '').toLowerCase();
    if (textClima.includes("abundantes") || textClima.includes(">1500mm")) {
      if (precipAnual >= 1200) {
        motivos.push(`✓ El régimen local de lluvias (${precipAnual}mm) cumple con la demanda del cultivo.`);
      } else {
        waterPoints -= 40;
        riesgos.push(`⚠ Lluvias escasas (${precipAnual}mm): Se requieren lluvias abundantes o riego complementario.`);
      }
    } else {
      waterPoints = 90;
    }
  }

  // 4. EVALUAR RIESGO DE HELADAS (Peso: 10% por defecto)
  let frostPoints = 100;
  const nom = crop.nombre ? crop.nombre.toLowerCase() : "";
  const textClimaCrop = (crop.reqClima || '').toLowerCase();

  const isSensitive = textClimaCrop.includes("sensible a heladas") || textClimaCrop.includes("libre de heladas") || nom.includes("yerba mate") || nom.includes("te") || nom.includes("banana") || nom.includes("mandioca");

  if (isSensitive) {
    if (riesgoHeladas.includes("alto") || riesgoHeladas.includes("frecuentes")) {
      frostPoints -= 60;
      riesgos.push("⚠ Alerta de Heladas: El cultivo es sensible y la zona presenta alta frecuencia de heladas.");
    } else if (riesgoHeladas.includes("medio") || riesgoHeladas.includes("moderado")) {
      frostPoints -= 30;
      riesgos.push("⚠ Riesgo moderado de heladas otoñales o invernales.");
    } else {
      motivos.push("✓ Baja probabilidad de heladas, ideal para especies sensibles.");
    }
  } else {
    // Cultivo rústico
    if (riesgoHeladas.includes("alto")) {
      frostPoints -= 15;
    } else {
      frostPoints = 100;
    }
  }

  // 5. EVALUAR LIMITANTES Y RELIEVE (Peso: 10% por defecto)
  let limitantsPoints = 100;

  if (limitantesSuelo.includes("tosca")) {
    const isDeepRoot = nom.includes("pino") || nom.includes("eucalyptus") || nom.includes("forestacion") || nom.includes("vid") || nom.includes("olivo") || nom.includes("arbol");
    if (isDeepRoot) {
      limitantsPoints -= 40;
      riesgos.push("⚠ Presencia de tosca limitando la profundidad efectiva del sistema radicular.");
    }
  }

  if (limitantesSuelo.includes("salinidad") || limitantesSuelo.includes("sales")) {
    const isTolerant = nom.includes("cebada") || nom.includes("olivo") || nom.includes("sorgo");
    if (isTolerant) {
      motivos.push("✓ Tolerancia moderada a la conductividad o salinidad del suelo.");
      limitantsPoints -= 10;
    } else {
      limitantsPoints -= 70;
      riesgos.push("⚠ Alta conductividad/salinidad edáfica: Riesgo severo de fitotoxicidad.");
    }
  }

  // Asegurar límites inferiores
  soilPoints = Math.max(0, soilPoints);
  climatePoints = Math.max(0, climatePoints);
  waterPoints = Math.max(0, waterPoints);
  frostPoints = Math.max(0, frostPoints);
  limitantsPoints = Math.max(0, limitantsPoints);

  // Calcular puntaje ponderado final
  const totalWeight = weights.suelo + weights.clima + weights.agua + weights.temperatura + weights.limitantes;
  const finalScore = Math.round(
    ((soilPoints * weights.suelo) +
     (climatePoints * weights.clima) +
     (waterPoints * weights.agua) +
     (frostPoints * weights.temperatura) +
     (limitantsPoints * weights.limitantes)) / totalWeight
  );

  // Mapeo a categorías según especificaciones de FASE 4:
  // 0-39 → Baja
  // 40-69 → Media
  // 70-84 → Alta
  // 85-100 → Muy alta
  let categoria = "BAJA";
  if (finalScore >= 85) {
    categoria = "MUY ALTA";
  } else if (finalScore >= 70) {
    categoria = "ALTA";
  } else if (finalScore >= 40) {
    categoria = "MEDIA";
  }

  // Limpieza final de riesgos si no hay riesgos reales identificados
  const realRiesgos = riesgos.length > 0 ? riesgos : [];

  return {
    score: finalScore,
    categoria: categoria,
    motivos: motivos.length > 0 ? motivos : ["Las condiciones generales son aptas para el cultivo."],
    riesgos: realRiesgos
  };
}
