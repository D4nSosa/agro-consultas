/**
 * Servicio de Clima Integrado
 * Consolida datos de clima en vivo (Open-Meteo), alertas del SMN y climatología regional.
 */

import { fetchLiveWeather } from './sources/openMeteoService.js';
import { fetchSMNAlerts } from './sources/smnService.js';
import { DataStatus, ConfidenceLevel } from '../utils/dataModel.js';

/**
 * Consolida la información climática en vivo e histórica para una ubicación.
 * @param {number} lat - Latitud.
 * @param {number} lng - Longitud.
 * @param {string} provincia - Nombre de la provincia.
 * @param {Object|null} subregionStaticClima - Datos climatológicos estáticos de la subregión.
 * @returns {Promise<Object>} Reporte climático consolidado.
 */
/**
 * La API Forecast de Open-Meteo entrega una salida de modelo, no una medición
 * de estación. Los perfiles subregionales siguen identificados como regionales.
 */
export function resolveClimateEvidenceStatus(liveWeatherPoint, subregionStaticClima = null) {
  if (liveWeatherPoint?.available) {
    return {
      status: liveWeatherPoint.status || DataStatus.ESTIMATED,
      confidence: liveWeatherPoint.confidence || ConfidenceLevel.MEDIUM
    };
  }
  if (subregionStaticClima) {
    return { status: DataStatus.REGIONAL, confidence: ConfidenceLevel.LOW };
  }
  return { status: DataStatus.UNAVAILABLE, confidence: ConfidenceLevel.NONE };
}

export async function getClimateData(lat, lng, provincia, subregionStaticClima = null) {
  const [liveWeatherPoint, smnAlertsPoint] = await Promise.all([
    fetchLiveWeather(lat, lng),
    fetchSMNAlerts(provincia)
  ]);

  const liveVal = liveWeatherPoint?.value || liveWeatherPoint || {};
  const tempActual = liveWeatherPoint?.available && (liveVal.temperatura !== undefined || liveWeatherPoint.temperatura !== undefined)
    ? (liveVal.temperatura ?? liveWeatherPoint.temperatura)
    : null;

  const vientoActual = liveWeatherPoint?.available && (liveVal.viento !== undefined || liveWeatherPoint.viento !== undefined)
    ? (liveVal.viento ?? liveWeatherPoint.viento)
    : null;

  const weatherCode = liveWeatherPoint?.available
    ? (liveVal.codigoClima ?? liveWeatherPoint.codigoClima ?? null)
    : null;

  let descClima = "NO DISPONIBLE";
  if (weatherCode !== null && weatherCode !== undefined) {
    if (weatherCode === 0) descClima = "Despejado / Cielo limpio";
    else if (weatherCode >= 1 && weatherCode <= 3) descClima = "Parcialmente nublado";
    else if (weatherCode >= 45 && weatherCode <= 48) descClima = "Niebla / Neblina";
    else if (weatherCode >= 51 && weatherCode <= 67) descClima = "Llovizna / Lluvia ligera";
    else if (weatherCode >= 71 && weatherCode <= 77) descClima = "Nieve / Escarcha";
    else if (weatherCode >= 80 && weatherCode <= 82) descClima = "Chubascos de lluvia";
    else if (weatherCode >= 95) descClima = "Tormenta eléctrica potencial";
  }

  const alertasInternas = [];
  if (tempActual !== null) {
    if (tempActual <= 3) {
      alertasInternas.push({
        titulo: "Alerta de Helada en Vivo",
        descripcion: `Temperatura actual extremadamente baja (${tempActual}°C). Proteger cultivos sensibles.`,
        gravedad: "Alta"
      });
    } else if (tempActual >= 38) {
      alertasInternas.push({
        titulo: "Alerta de Golpe de Calor",
        descripcion: `Temperatura extrema detectada (${tempActual}°C). Alto riesgo de estrés hídrico.`,
        gravedad: "Alta"
      });
    }
  }

  const smnAlertsList = Array.isArray(smnAlertsPoint?.value) ? smnAlertsPoint.value : (Array.isArray(smnAlertsPoint?.alertas) ? smnAlertsPoint.alertas : []);
  const todasLasAlertas = [...smnAlertsList, ...alertasInternas];

  const precipAnualesText = subregionStaticClima?.precipitaciones || "NO DISPONIBLE";
  const tempMediaText = subregionStaticClima?.temperatura !== undefined
    ? (typeof subregionStaticClima.temperatura === 'number' ? `${subregionStaticClima.temperatura}°C (Promedio Regional)` : subregionStaticClima.temperatura)
    : "NO DISPONIBLE";
  const tempMediaVal = subregionStaticClima?.temperatura !== undefined
    ? (typeof subregionStaticClima.temperatura === 'number' ? subregionStaticClima.temperatura : extractFloat(subregionStaticClima.temperatura))
    : null;
  const precipAnualesVal = extractNumber(subregionStaticClima?.precipitaciones);

  const heladas = subregionStaticClima?.heladas || "NO DISPONIBLE";
  const deficit = subregionStaticClima?.deficit_hidrico || "NO DISPONIBLE";

  // Cálculo del Índice de Peligro de Incendios Agro-Forestales
  const peligroIncendio = calcularIndicePeligroIncendio(tempActual, vientoActual, weatherCode);

  const climateEvidence = resolveClimateEvidenceStatus(liveWeatherPoint, subregionStaticClima);
  const overallStatus = climateEvidence.status;
  const overallConfidence = climateEvidence.confidence;

  return {
    temperaturaActual: tempActual !== null ? `${tempActual}°C` : "NO DISPONIBLE",
    peligroIncendio: peligroIncendio,
    temperaturaActualNum: tempActual,
    vientoActual: vientoActual !== null ? `${vientoActual} km/h` : "NO DISPONIBLE",
    codigoClima: weatherCode,
    condicionActualTexto: descClima,
    fuenteClimaVivo: liveWeatherPoint?.source || "Open-Meteo",
    liveWeatherPoint: liveWeatherPoint,

    alertas: todasLasAlertas,
    fuenteAlertas: smnAlertsPoint?.source || "SMN",
    smnAlertsPoint: smnAlertsPoint,

    precipitacionesAnuales: precipAnualesText,
    precipitacionesAnualesVal: precipAnualesVal,
    temperaturaMedia: tempMediaText,
    temperaturaMediaVal: tempMediaVal,
    heladas: heladas,
    deficitHidrico: deficit,
    estacionalidad: subregionStaticClima?.estacionalidad || "NO DISPONIBLE",

    status: overallStatus,
    // La estación meteorológica actual no equivale a una serie climatológica histórica local.
    climatologyStatus: subregionStaticClima ? DataStatus.REGIONAL : DataStatus.UNAVAILABLE,
    confidence: overallConfidence,
    fechaActualizacion: new Date().toISOString()
  };
}

/**
 * Calcula el nivel de peligro de incendios agro-forestales en vivo basado en meteorología real
 */
export function calcularIndicePeligroIncendio(temp, viento, weatherCode) {
  if (temp === null || temp === undefined || viento === null || viento === undefined) {
    return {
      tipoIndice: "HEURISTICA_METEOROLOGICA_INTERNA",
      fuenteVariables: "Open-Meteo: temperatura, viento y código meteorológico actual",
      limitacion: "No es el Fire Weather Index (FWI), no estima ignición y no sustituye alertas oficiales.",
      nivel: "NO DISPONIBLE",
      icono: "⚪",
      clase: "badge-media",
      descripcion: "Faltan variables climáticas en vivo para calcular el riesgo."
    };
  }

  const isRain = weatherCode !== null && (weatherCode >= 51 && weatherCode <= 82);
  if (isRain) {
    return {
      tipoIndice: "HEURISTICA_METEOROLOGICA_INTERNA",
      fuenteVariables: "Open-Meteo: temperatura, viento y código meteorológico actual",
      limitacion: "No es el Fire Weather Index (FWI), no estima ignición y no sustituye alertas oficiales.",
      nivel: "BAJO (Lluvia activa)",
      icono: "🟢",
      clase: "badge-alta",
      descripcion: "El código meteorológico actual indica precipitación; no equivale a humedad del combustible ni a un FWI oficial."
    };
  }

  let score = 0;
  if (temp > 35) score += 3;
  else if (temp > 28) score += 2;
  else if (temp > 22) score += 1;

  if (viento > 35) score += 3;
  else if (viento > 22) score += 2;
  else if (viento > 12) score += 1;

  if (weatherCode === 0) score += 1; // Despejado / seco

  if (score >= 6) {
    return {
      tipoIndice: "HEURISTICA_METEOROLOGICA_INTERNA",
      fuenteVariables: "Open-Meteo: temperatura, viento y código meteorológico actual",
      limitacion: "No es el Fire Weather Index (FWI), no estima ignición y no sustituye alertas oficiales.",
      nivel: "MUY ALTO / EXTREMO",
      icono: "🔴",
      clase: "badge-baja",
      descripcion: "Temperatura y viento elevados pueden favorecer la propagación. Verificar alertas oficiales y normativa local antes de cualquier actividad."
    };
  } else if (score >= 4) {
    return {
      tipoIndice: "HEURISTICA_METEOROLOGICA_INTERNA",
      fuenteVariables: "Open-Meteo: temperatura, viento y código meteorológico actual",
      limitacion: "No es el Fire Weather Index (FWI), no estima ignición y no sustituye alertas oficiales.",
      nivel: "ALTO",
      icono: "🟠",
      clase: "badge-media",
      descripcion: "Condiciones meteorológicas que pueden favorecer la propagación en cobertura vegetal; no estima ignición ni confirma incendios."
    };
  } else if (score >= 2) {
    return {
      tipoIndice: "HEURISTICA_METEOROLOGICA_INTERNA",
      fuenteVariables: "Open-Meteo: temperatura, viento y código meteorológico actual",
      limitacion: "No es el Fire Weather Index (FWI), no estima ignición y no sustituye alertas oficiales.",
      nivel: "MODERADO",
      icono: "🟡",
      clase: "badge-media",
      descripcion: "Condiciones meteorológicas intermedias según el indicador interno. Mantener precauciones y consultar alertas oficiales."
    };
  }

  return {
    tipoIndice: "HEURISTICA_METEOROLOGICA_INTERNA",
    fuenteVariables: "Open-Meteo: temperatura, viento y código meteorológico actual",
    limitacion: "No es el Fire Weather Index (FWI), no estima ignición y no sustituye alertas oficiales.",
    nivel: "BAJO",
    icono: "🟢",
    clase: "badge-alta",
    descripcion: "El indicador interno no detecta condiciones elevadas con las variables disponibles; no descarta peligro local."
  };
}

function extractFloat(str) {
  if (typeof str === 'number') return str;
  if (!str) return null;
  const matches = str.match(/[-+]?\d*\.?\d+/);
  return matches ? parseFloat(matches[0]) : null;
}

function extractNumber(str) {
  if (typeof str === 'number') return str;
  if (!str) return null;
  const matches = str.match(/\d+/g);
  return matches ? parseInt(matches[0], 10) : null;
}
