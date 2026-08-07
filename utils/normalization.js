/**
 * Utilidades de normalización de cadenas de texto y fechas para Agro Consultas
 */

/**
 * Normaliza una cadena para búsqueda y claves (minúsculas, sin acentos, espacios limpios).
 * @param {string} s
 * @returns {string}
 */
export function normalizeKey(s) {
  if (!s) return "";
  return s.toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Quitar acentos
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Convierte un índice de mes (0-11) al nombre en español.
 * @param {number} i
 * @returns {string}
 */
export function monthIndexToName(i) {
  const meses = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ];
  return meses[i] || "";
}
