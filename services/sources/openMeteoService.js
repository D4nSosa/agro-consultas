/**
 * Adaptador de Servicio para la API Meteorológica de Open-Meteo
 * Cuenta con almacenamiento en caché (localStorage) y tolerancia a fallos.
 */

const CACHE_PREFIX = 'agro_cache_weather_';
const CACHE_EXPIRY = 30 * 60 * 1000; // 30 minutos de vigencia de clima

export async function fetchLiveWeather(lat, lng) {
  const cacheKey = `${CACHE_PREFIX}${lat.toFixed(3)}_${lng.toFixed(3)}`;

  // 1. Intentar recuperar desde Caché
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_EXPIRY) {
        console.log(`[OpenMeteo] Clima obtenido desde caché para [${lat}, ${lng}]`);
        return { ...data, fuente: 'Open-Meteo (Caché local)', cached: true, timestamp };
      }
    }
  } catch (err) {
    console.warn("[OpenMeteo] Error al leer caché meteorológico:", err);
  }

  // 2. Intentar llamar a API Externa
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);

    const result = await response.json();
    const weather = result.current_weather;

    if (!weather) throw new Error("Datos meteorológicos ausentes");

    const data = {
      temperatura: weather.temperature,
      viento: weather.windspeed,
      codigoClima: weather.weathercode,
      fechaActualizacion: new Date().toISOString()
    };

    // Almacenar en Caché
    try {
      localStorage.setItem(cacheKey, JSON.stringify({
        data,
        timestamp: Date.now()
      }));
    } catch (e) {
      console.warn("[OpenMeteo] Error al guardar en caché:", e);
    }

    return { ...data, fuente: 'Open-Meteo (API en tiempo real)', cached: false };
  } catch (err) {
    console.error("[OpenMeteo] Fallo en API externa, activando fallback local:", err);

    // 3. Fallback en caso de fallo de red/API
    // Intentar recuperar caché expirado si existe
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const { data } = JSON.parse(cached);
        return { ...data, fuente: 'Open-Meteo (Caché Expirado - Respaldo)', fallback: true };
      }
    } catch (e) {}

    // Retornar datos meteorológicos de respaldo estándar para evitar caídas
    return {
      temperatura: 20.0,
      viento: 12.0,
      codigoClima: 0,
      fechaActualizacion: new Date().toISOString(),
      fuente: 'Estático Respaldo Local (Sin conexión)',
      fallback: true
    };
  }
}
