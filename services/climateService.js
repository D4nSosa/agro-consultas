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
  const tempMediaVal = subregionStaticClima?.temperatura !== undefined && typeof subregionStaticClima.temperatura === 'number'
    ? subregionStaticClima.temperatura
    : null;
  const precipAnualesVal = extractNumber(subregionStaticClima?.precipitaciones);

  const heladas = subregionStaticClima?.heladas || "NO DISPONIBLE";
  const deficit = subregionStaticClima?.deficit_hidrico || "NO DISPONIBLE";

  // Cálculo del Índice de Peligro de Incendios Agro-Forestales
  const peligroIncendio = calcularIndicePeligroIncendio(tempActual, vientoActual, weatherCode);

  const overallStatus = liveWeatherPoint?.available
    ? DataStatus.REAL
    : (subregionStaticClima ? DataStatus.REGIONAL : DataStatus.UNAVAILABLE);
  const overallConfidence = liveWeatherPoint?.available
    ? ConfidenceLevel.HIGH
    : (subregionStaticClima ? ConfidenceLevel.MEDIUM : ConfidenceLevel.NONE);

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
      nivel: "NO DISPONIBLE",
      icono: "⚪",
      clase: "badge-media",
      descripcion: "Faltan variables climáticas en vivo para calcular el riesgo."
    };
  }

  const isRain = weatherCode !== null && (weatherCode >= 51 && weatherCode <= 82);
  if (isRain) {
    return {
      nivel: "BAJO (Lluvia activa)",
      icono: "🟢",
      clase: "badge-alta",
      descripcion: "Ocurrencia de precipitaciones en vivo mitigando riesgo de fuego."
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
      nivel: "MUY ALTO / EXTREMO",
      icono: "🔴",
      clase: "badge-baja",
      descripcion: "Condiciones críticas: Alta temperatura y vientos fuertes. Prohibido realizar quemas."
    };
  } else if (score >= 4) {
    return {
      nivel: "ALTO",
      icono: "🟠",
      clase: "badge-media",
      descripcion: "Elevada probabilidad de propagación de incendios en cobertura vegetal."
    };
  } else if (score >= 2) {
    return {
      nivel: "MODERADO",
      icono: "🟡",
      clase: "badge-media",
      descripcion: "Riesgo moderado de incendio. Mantener precauciones de campo."
    };
  }

  return {
    nivel: "BAJO",
    icono: "🟢",
    clase: "badge-alta",
    descripcion: "Condiciones meteorológicas estables con bajo riesgo de propagación."
  };
}

function extractNumber(str) {
  if (typeof str === 'number') return str;
  if (!str) return null;
  const matches = str.match(/\d+/g);
  return matches ? parseInt(matches[0], 10) : null;
}
