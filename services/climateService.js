/**
 * Servicio de Clima Integrado
 * Consolida datos de clima en vivo (Open-Meteo), alertas del SMN y climatología local de respaldo.
 */

import { fetchLiveWeather } from './sources/openMeteoService.js';
import { fetchSMNAlerts } from './sources/smnService.js';

/**
 * Consolida la información climática en vivo e histórica para una ubicación.
 * @param {number} lat - Latitud.
 * @param {number} lng - Longitud.
 * @param {string} provincia - Nombre de la provincia.
 * @param {Object} subregionStaticClima - Datos climatológicos estáticos de la subregión (de regiones.json).
 * @returns {Promise<Object>} Reporte climático consolidado.
 */
export async function getClimateData(lat, lng, provincia, subregionStaticClima = null) {
  // 1. Ejecutar las peticiones asíncronas en paralelo para optimizar tiempo de respuesta
  const [liveWeather, smnAlerts] = await Promise.all([
    fetchLiveWeather(lat, lng),
    fetchSMNAlerts(provincia)
  ]);

  // Mapear código de clima a texto en español
  const code = liveWeather.codigoClima;
  let descClima = "Despejado / Estable";
  if (code >= 1 && code <= 3) descClima = "Parcialmente nublado";
  if (code >= 45 && code <= 48) descClima = "Niebla / Neblina";
  if (code >= 51 && code <= 67) descClima = "Llovizna / Lluvia ligera";
  if (code >= 71 && code <= 77) descClima = "Nieve / Escarcha";
  if (code >= 80 && code <= 82) descClima = "Chubascos de lluvia";
  if (code >= 95) descClima = "Tormenta eléctrica potencial";

  // Generar alertas automáticas basadas en temperatura en vivo
  const alertasInternas = [];
  if (liveWeather.temperatura <= 3) {
    alertasInternas.push({
      titulo: "Alerta de Helada en Vivo",
      descripcion: `Temperatura actual extremadamente baja de ${liveWeather.temperatura}°C. Proteger cultivos sensibles a heladas tardías/tempranas.`,
      gravedad: "Alta"
    });
  } else if (liveWeather.temperatura >= 38) {
    alertasInternas.push({
      titulo: "Alerta de Golpe de Calor",
      descripcion: `Temperatura extrema detectada de ${liveWeather.temperatura}°C. Alto riesgo de estrés hídrico y tasas elevadas de evapotranspiración.`,
      gravedad: "Alta"
    });
  }

  // Combinar alertas del SMN con nuestras alertas internas por umbrales
  const todasLasAlertas = [...(smnAlerts.alertas || []), ...alertasInternas];

  // 3. Estructurar reporte final consolidado
  return {
    temperaturaActual: liveWeather.temperatura,
    vientoActual: liveWeather.viento,
    codigoClima: liveWeather.codigoClima,
    condicionActualTexto: descClima,
    fuenteClimaVivo: liveWeather.fuente,

    // Alertas de contingencia consolidada
    alertas: todasLasAlertas,
    fuenteAlertas: smnAlerts.fuente,

    // Históricos climatológicos regionales (de regiones.json) o fallback
    precipitacionesAnuales: subregionStaticClima ? subregionStaticClima.precipitaciones : "Variable (600 - 1200 mm)",
    temperaturaMedia: subregionStaticClima ? subregionStaticClima.temperatura : "Variable",
    heladasPeriodo: subregionStaticClima ? subregionStaticClima.heladas : "Variable",
    deficitHidrico: subregionStaticClima ? subregionStaticClima.deficit_hidrico : "Moderado",
    estacionalidad: subregionStaticClima ? subregionStaticClima.estacionalidad : "Templado/Subtropical",

    fechaActualizacion: new Date().toISOString()
  };
}
