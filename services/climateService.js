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

  let descClima = "Datos en vivo no disponibles";
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

  const precipAnuales = subregionStaticClima?.precipitaciones || "600 - 1200 mm (Regional)";
  const tempMedia = subregionStaticClima?.temperatura !== undefined ? subregionStaticClima.temperatura : 18;
  const heladas = subregionStaticClima?.heladas || "Bajo a Moderado";
  const deficit = subregionStaticClima?.deficit_hidrico || "Moderado";

  const overallStatus = liveWeatherPoint?.available ? DataStatus.REAL : (subregionStaticClima ? DataStatus.REGIONAL : DataStatus.UNAVAILABLE);
  const overallConfidence = liveWeatherPoint?.available ? ConfidenceLevel.HIGH : (subregionStaticClima ? ConfidenceLevel.MEDIUM : ConfidenceLevel.LOW);

  return {
    temperaturaActual: tempActual !== null ? `${tempActual}°C` : "No disponible",
    temperaturaActualNum: tempActual,
    vientoActual: vientoActual !== null ? `${vientoActual} km/h` : "No disponible",
    codigoClima: weatherCode,
    condicionActualTexto: descClima,
    fuenteClimaVivo: liveWeatherPoint?.source || "Open-Meteo",
    liveWeatherPoint: liveWeatherPoint,

    alertas: todasLasAlertas,
    fuenteAlertas: smnAlertsPoint?.source || "SMN",
    smnAlertsPoint: smnAlertsPoint,

    precipitacionesAnuales: precipAnuales,
    precipitacionesNum: extractNumber(precipAnuales, 800),
    temperaturaMedia: typeof tempMedia === 'number' ? `${tempMedia}°C (Promedio Regional)` : tempMedia,
    temperaturaMediaNum: typeof tempMedia === 'number' ? tempMedia : 18,
    heladasPeriodo: heladas,
    deficitHidrico: deficit,
    estacionalidad: subregionStaticClima?.estacionalidad || "Templado/Subtropical",

    status: overallStatus,
    confidence: overallConfidence,
    fechaActualizacion: new Date().toISOString()
  };
}

function extractNumber(str, defaultVal) {
  if (typeof str === 'number') return str;
  if (!str) return defaultVal;
  const matches = str.match(/\d+/g);
  return matches ? parseInt(matches[0], 10) : defaultVal;
}
