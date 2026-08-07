/**
 * Adaptador de Servicio para la Infraestructura de Datos Espaciales (IDERA) e Instituto Geográfico Nacional (IGN) de Argentina
 * Proporciona metadatos cartográficos, capas base y límites provinciales/departamentales con caché y tolerancia a fallos.
 */

const CACHE_PREFIX = 'agro_cache_ign_';
const CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 1 semana de vigencia para datos geográficos estables

/**
 * Retorna la configuración oficial de capas base para Leaflet (Argenmap u otras fuentes IGN).
 * @returns {Object} Configuración del tile layer.
 */
export function getIGNBaseLayerConfig() {
  return {
    url: 'https://wms.ign.gob.ar/geoserver/gwc/service/tms/1.0.0/mapabase_gris@EPSG%3A3857@png/{z}/{x}/{y}.png',
    options: {
      attribution: 'Mapas de Fondo: &copy; <a href="http://www.ign.gob.ar" target="_blank">Instituto Geográfico Nacional</a>',
      tms: true, // Requerido para el servidor de TMS de IGN
      maxZoom: 18,
      minZoom: 3
    }
  };
}

/**
 * Obtiene límites oficiales de una provincia por su nombre o id desde la API de Datos Abiertos del IGN / Gobierno Nacional (IDE).
 * @param {string} provinciaName - Nombre de la provincia.
 * @returns {Promise<Object>} Límites geográficos o metadatos de límites.
 */
export async function fetchIGNProvincialBoundaries(provinciaName) {
  const cacheKey = `${CACHE_PREFIX}boundary_${provinciaName.toLowerCase().replace(/\s+/g, '_')}`;

  // 1. Intentar recuperar desde Caché
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_EXPIRY) {
        return { ...data, fuente: 'IGN API / IDE (Caché local)', cached: true };
      }
    }
  } catch (err) {
    console.warn("[IGN] Error al leer caché de límites:", err);
  }

  // 2. Intentar llamar al servicio oficial de la API de Provincias (IGN / IDE)
  try {
    const url = `https://apis.datos.gob.ar/georef/api/provincias?nombre=${encodeURIComponent(provinciaName)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);

    const resData = await response.json();
    if (resData && resData.provincias && resData.provincias.length > 0) {
      const provInfo = resData.provincias[0];
      const data = {
        id: provInfo.id,
        nombre: provInfo.nombre,
        centroide: {
          lat: provInfo.centroide.lat,
          lng: provInfo.centroide.lon
        },
        fechaActualizacion: new Date().toISOString()
      };

      // Guardar en caché
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ data, timestamp: Date.now() }));
      } catch (e) {}

      return { ...data, fuente: 'IGN Georef Oficial (API en vivo)', cached: false };
    } else {
      throw new Error("Provincia no encontrada en Georef API");
    }
  } catch (err) {
    console.log(`[IGN] Error al consultar Georef para ${provinciaName}, activando fallback local:`, err.message);

    // 3. Fallback en caso de error
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const { data } = JSON.parse(cached);
        return { ...data, fuente: 'IGN Georef (Caché Expirado - Respaldo)', fallback: true };
      }
    } catch (e) {}

    // Coordenadas aproximadas de respaldo (centroides provinciales típicos)
    const fallbackCentroides = {
      misiones: { lat: -26.8756, lng: -54.6543 },
      corrientes: { lat: -28.5, lng: -57.8 },
      chaco: { lat: -26.3, lng: -60.5 },
      formosa: { lat: -25.0, lng: -60.0 },
      buenos_aires: { lat: -36.0, lng: -60.0 },
      cordoba: { lat: -32.13, lng: -63.7 },
      mendoza: { lat: -34.6, lng: -68.5 }
    };

    const provKey = provinciaName.toLowerCase().trim()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // quitar acentos
      .replace(/\s+/g, '_');

    const centroide = fallbackCentroides[provKey] || { lat: -38.4161, lng: -63.6167 }; // Centro de Argentina

    const data = {
      id: "fallback_ign",
      nombre: provinciaName,
      centroide,
      fechaActualizacion: new Date().toISOString()
    };

    try {
      localStorage.setItem(cacheKey, JSON.stringify({ data, timestamp: Date.now() }));
    } catch (e) {}

    return { ...data, fuente: 'IGN Georef (Base Estática Adaptada Local)', cached: false, fallback: true };
  }
}
