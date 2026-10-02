/**
 * exifExtractor.js — Extractor de Metadatos EXIF en Cliente (Pure ES6)
 * Parsea encabezados JPEG APP1 para extraer metadatos GPS, fecha, cámara y dimensiones.
 * No genera coordenadas ficticias si la imagen no posee GPS EXIF.
 */

export async function extractExifMetadata(file) {
  const result = {
    hasGps: false,
    gps: null,
    date: 'Fecha EXIF: NO DISPONIBLE',
    fileDate: file.lastModified ? new Date(file.lastModified).toISOString().split('T')[0] : 'NO DISPONIBLE',
    camera: null,
    dimensions: null,
    fileSize: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
    filename: file.name
  };

  try {
    const arrayBuffer = await file.arrayBuffer();
    const dataView = new DataView(arrayBuffer);

    // Obtener dimensiones básicas vía Image Object
    const imgDimensions = await getImageDimensions(file);
    result.dimensions = `${imgDimensions.width} x ${imgDimensions.height} px`;

    // Verificar si es JPEG (SOI 0xFFD8)
    if (dataView.getUint16(0) !== 0xFFD8) {
      return result;
    }

    let offset = 2;
    const length = dataView.byteLength;

    while (offset < length - 2) {
      const marker = dataView.getUint16(offset);
      offset += 2;

      // APP1 Marker (0xFFE1) - Contiene EXIF
      if (marker === 0xFFE1) {
        const app1Length = dataView.getUint16(offset);
        const exifHeader = getAsciiString(dataView, offset + 2, 4);

        if (exifHeader === 'Exif') {
          const tiffOffset = offset + 8;
          const isLittleEndian = dataView.getUint16(tiffOffset) === 0x4949;

          const firstIfdOffset = dataView.getUint32(tiffOffset + 4, isLittleEndian);
          if (firstIfdOffset) {
            parseIFD(dataView, tiffOffset, tiffOffset + firstIfdOffset, isLittleEndian, result);
          }
        }
        break;
      } else if ((marker & 0xFF00) === 0xFF00) {
        const blockLength = dataView.getUint16(offset);
        offset += blockLength;
      } else {
        break;
      }
    }
  } catch (err) {
    console.warn('[exifExtractor] No se pudieron extraer metadatos EXIF completos:', err.message);
  }

  return result;
}

function parseIFD(dataView, tiffOffset, ifdOffset, isLittleEndian, result) {
  try {
    const entries = dataView.getUint16(ifdOffset, isLittleEndian);

    for (let i = 0; i < entries; i++) {
      const entryOffset = ifdOffset + 2 + (i * 12);
      const tag = dataView.getUint16(entryOffset, isLittleEndian);

      // Make (0x010F) / Model (0x0110)
      if (tag === 0x010F || tag === 0x0110) {
        const val = getStringTag(dataView, tiffOffset, entryOffset, isLittleEndian);
        if (val) {
          result.camera = result.camera ? `${result.camera} ${val}` : val;
        }
      }

      // DateTimeOriginal (0x9003)
      if (tag === 0x9003) {
        const dateStr = getStringTag(dataView, tiffOffset, entryOffset, isLittleEndian);
        if (dateStr) {
          result.date = `${dateStr.split(' ')[0].replace(/:/g, '-')} (EXIF Original)`;
        }
      }

      // GPS IFD Pointer (0x8825)
      if (tag === 0x8825) {
        const gpsIfdOffset = tiffOffset + dataView.getUint32(entryOffset + 8, isLittleEndian);
        parseGPSIFD(dataView, tiffOffset, gpsIfdOffset, isLittleEndian, result);
      }
    }
  } catch (e) {}
}

function parseGPSIFD(dataView, tiffOffset, gpsOffset, isLittleEndian, result) {
  try {
    const entries = dataView.getUint16(gpsOffset, isLittleEndian);
    let lat = null, latRef = 'N', lng = null, lngRef = 'W';

    for (let i = 0; i < entries; i++) {
      const entryOffset = gpsOffset + 2 + (i * 12);
      const tag = dataView.getUint16(entryOffset, isLittleEndian);

      if (tag === 1) latRef = String.fromCharCode(dataView.getUint8(entryOffset + 8));
      if (tag === 2) lat = getGPSCoordinate(dataView, tiffOffset, entryOffset, isLittleEndian);
      if (tag === 3) lngRef = String.fromCharCode(dataView.getUint8(entryOffset + 8));
      if (tag === 4) lng = getGPSCoordinate(dataView, tiffOffset, entryOffset, isLittleEndian);
    }

    if (lat !== null && lng !== null) {
      const finalLat = (latRef === 'S' || latRef === 's') ? -lat : lat;
      const finalLng = (lngRef === 'W' || lngRef === 'w') ? -lng : lng;

      result.hasGps = true;
      result.gps = {
        lat: Math.round(finalLat * 100000) / 100000,
        lng: Math.round(finalLng * 100000) / 100000
      };
    }
  } catch (e) {}
}

function getGPSCoordinate(dataView, tiffOffset, entryOffset, isLittleEndian) {
  const valuesOffset = tiffOffset + dataView.getUint32(entryOffset + 8, isLittleEndian);
  const deg = dataView.getUint32(valuesOffset, isLittleEndian) / dataView.getUint32(valuesOffset + 4, isLittleEndian);
  const min = dataView.getUint32(valuesOffset + 8, isLittleEndian) / dataView.getUint32(valuesOffset + 12, isLittleEndian);
  const sec = dataView.getUint32(valuesOffset + 16, isLittleEndian) / dataView.getUint32(valuesOffset + 20, isLittleEndian);

  return deg + (min / 60) + (sec / 3600);
}

function getStringTag(dataView, tiffOffset, entryOffset, isLittleEndian) {
  const count = dataView.getUint32(entryOffset + 4, isLittleEndian);
  if (count <= 4) {
    return getAsciiString(dataView, entryOffset + 8, count - 1);
  } else {
    const p = tiffOffset + dataView.getUint32(entryOffset + 8, isLittleEndian);
    return getAsciiString(dataView, p, count - 1);
  }
}

function getAsciiString(dataView, offset, length) {
  let str = '';
  for (let i = 0; i < length; i++) {
    const charCode = dataView.getUint8(offset + i);
    if (charCode === 0) break;
    str += String.fromCharCode(charCode);
  }
  return str.trim();
}

function getImageDimensions(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({ width: 0, height: 0 });
    };
    img.src = url;
  });
}
