/**
 * Adaptador de Servicio para la API Meteorológica de Open-Meteo
 * Cuenta con empaquetamiento DataPoint, almacenamiento en caché (localStorage) y tolerancia a fallos.
 */

import { createDataPoint, createUnavailableDataPoint, DataStatus, ConfidenceLevel } from '../../utils/dataModel.js';

const CACHE_PREFIX = 'agro_cache_weather_';
const CACHE_EXPIRY = 30 * 60 * 1000; // 30 minutos

export async function fetchLiveWeather(lat, lng) {
  const cacheKey = `${CACHE_PREFIX}${lat.toFixed(3)}_${lng.toFixed(3)}`;

  // 1. Intentar recuperar desde Caché
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_EXPIRY) {
        return { ...data, cached: true };
      }
    }
  } catch (err) {
    console.warn("[OpenMeteo] Error al leer caché meteorológico:", err);
  }

  // 2. Intentar llamada a la API con timeout
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);

    const result = await response.json();
    const weather = result.current_weather;

    if (!weather) throw new Error("Datos meteorológicos ausentes");

    const data = createDataPoint({
      value: {
        temperatura: weather.temperature,
        viento: weather.windspeed,
        codigoClima: weather.weathercode
      },
      unit: "°C / km/h",
      source: 'Open-Meteo (API en tiempo real)',
      sourceUrl: 'https://open-meteo.com/',
      dataset: 'Forecast API v1',
      retrievedAt: new Date().toISOString(),
      status: DataStatus.REAL,
      confidence: ConfidenceLevel.HIGH
    });

    try {
      localStorage.setItem(cacheKey, JSON.stringify({ data, timestamp: Date.now() }));
    } catch (e) {}

    return data;
  } catch (err) {
    console.warn("[OpenMeteo] Fallo o timeout en API externa, verificando respaldo:", err.message);

    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const { data } = JSON.parse(cached);
        return {
          ...data,
          status: DataStatus.ESTIMATED,
          confidence: ConfidenceLevel.LOW,
          message: 'Datos meteorológicos de caché expirado (red no disponible)'
        };
      }
    } catch (e) {}

    return createUnavailableDataPoint('Open-Meteo API', 'Datos meteorológicos en tiempo real no disponibles');
  }
}
