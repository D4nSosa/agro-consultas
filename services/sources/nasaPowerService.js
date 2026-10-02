/**
 * services/sources/nasaPowerService.js
 *
 * Servicio de integración con la API oficial de NASA POWER (Prediction Of Worldwide Energy Resources).
 * Proporciona reanálisis meteorológico y climático espacial para coordenadas específicas.
 *
 * Regla de Integridad:
 * Si la API falla, no responde o faltan datos, devuelve status "UNAVAILABLE" ("NO DISPONIBLE").
 * NUNCA se inventan datos ni se generan números sintéticos.
 */

const NASA_POWER_MONTHLY_URL = "https://power.larc.nasa.gov/api/temporal/monthly/point";
const NASA_POWER_CLIMATOLOGY_URL = "https://power.larc.nasa.gov/api/temporal/climatology/point";

/**
 * Consulta la Climatología de Referencia de NASA POWER (período base normado 2001-2020)
 */
async function fetchClimatologyReference(lat, lng) {
  try {
    const url = `${NASA_POWER_CLIMATOLOGY_URL}?parameters=PRECTOTCORR,T2M&community=AG&longitude=${lng.toFixed(4)}&latitude=${lat.toFixed(4)}&format=JSON`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const params = json?.properties?.parameter;
    if (!params || !params.PRECTOTCORR || !params.T2M) return null;
    return {
      precip: params.PRECTOTCORR, // Objeto con 'JAN', 'FEB', ..., 'ANN' en mm/día
      t2m: params.T2M // Objeto con 'JAN', 'FEB', ..., 'ANN' en °C
    };
  } catch (err) {
    console.warn("[NASA POWER] Climatology API indisponible:", err.message);
    return null;
  }
}

/**
 * Obtiene la serie histórica climática de NASA POWER para un par de coordenadas (lat, lng) y un período en meses.
 * @param {number} lat - Latitud WGS84
 * @param {number} lng - Longitud WGS84
 * @param {number} monthsCount - Cantidad de meses a analizar hacia atrás (por defecto 12)
 * @returns {Promise<Object>} Ficha de datos climáticos e históricos con trazabilidad
 */
export async function getClimateHistory(lat, lng, monthsCount = 12) {
  if (lat === null || lat === undefined || lng === null || lng === undefined) {
    return {
      status: "UNAVAILABLE",
      message: "NO DISPONIBLE — Se requieren coordenadas válidas para consultar NASA POWER.",
      data: null
    };
  }

  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const endYear = currentYear - 1; // Usamos año completado más reciente para garantizar datos mensuales consolidados
  const startYear = Math.max(1981, endYear - Math.ceil(monthsCount / 12) + 1);

  const parameters = [
    'PRECTOTCORR', // Precipitación corregida (mm/día)
    'T2M',         // Temp. a 2m (°C)
    'T2M_MAX',     // Temp. máx (°C)
    'T2M_MIN',     // Temp. mín (°C)
    'RH2M',        // Humedad relativa (%)
    'WS2M',        // Velocidad de viento a 2m (m/s)
    'ALLSKY_SFC_SW_DWN' // Radiación solar (MJ/m²/día)
  ].join(',');

  const url = `${NASA_POWER_MONTHLY_URL}?parameters=${parameters}&community=AG&longitude=${lng.toFixed(4)}&latitude=${lat.toFixed(4)}&start=${startYear}&end=${endYear}&format=JSON`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return {
        status: "UNAVAILABLE",
        message: `NO DISPONIBLE — Error HTTP ${response.status} en API NASA POWER.`,
        data: null
      };
    }

    const json = await response.json();
    const props = json?.properties;
    const paramsData = props?.parameter;

    if (!paramsData || !paramsData.PRECTOTCORR || !paramsData.T2M) {
      return {
        status: "UNAVAILABLE",
        message: "NO DISPONIBLE — La respuesta de NASA POWER no contiene los parámetros esperados.",
        data: null
      };
    }

    // Filtrar los meses correspondientes eliminando los códigos anuales (ej: '202313')
    const monthlyKeys = Object.keys(paramsData.T2M).filter(k => k.length === 6 && !k.endsWith('13')).sort();

    if (monthlyKeys.length === 0) {
      return {
        status: "UNAVAILABLE",
        message: "NO DISPONIBLE — No se encontraron registros mensuales válidos en la serie.",
        data: null
      };
    }

    // Seleccionar los últimos N meses solicitados
    const selectedKeys = monthlyKeys.slice(-monthsCount);

    // Días por mes aproximados para convertir mm/día a mm/mes
    const daysInMonth = (yyyymm) => {
      const year = parseInt(yyyymm.substring(0, 4));
      const month = parseInt(yyyymm.substring(4, 6));
      return new Date(year, month, 0).getDate();
    };

    let precTotalPeriodMm = 0;
    let t2mSum = 0;
    let t2mMaxAbs = null;
    let t2mMinAbs = null;
    let rhSum = 0;
    let wsSum = 0;
    let radSum = 0;

    let precValidCount = 0;
    let t2mValidCount = 0;
    let rhValidCount = 0;
    let wsValidCount = 0;
    let radValidCount = 0;

    const isVal = (v) => v !== undefined && v !== null && v !== -999 && v !== 999 && !isNaN(v);

    const monthlyBreakdown = selectedKeys.map(key => {
      const dailyPrec = isVal(paramsData.PRECTOTCORR?.[key]) ? paramsData.PRECTOTCORR[key] : null;
      const t2m = isVal(paramsData.T2M?.[key]) ? paramsData.T2M[key] : null;
      const t2mMax = isVal(paramsData.T2M_MAX?.[key]) ? paramsData.T2M_MAX[key] : null;
      const t2mMin = isVal(paramsData.T2M_MIN?.[key]) ? paramsData.T2M_MIN[key] : null;
      const rh = isVal(paramsData.RH2M?.[key]) ? paramsData.RH2M[key] : null;
      const ws = isVal(paramsData.WS2M?.[key]) ? paramsData.WS2M[key] : null;
      const rad = isVal(paramsData.ALLSKY_SFC_SW_DWN?.[key]) ? paramsData.ALLSKY_SFC_SW_DWN[key] : null;

      const days = daysInMonth(key);
      const monthlyPrec = dailyPrec !== null ? dailyPrec * days : null;

      if (monthlyPrec !== null) { precTotalPeriodMm += monthlyPrec; precValidCount++; }
      if (t2m !== null) { t2mSum += t2m; t2mValidCount++; }
      if (t2mMax !== null) { if (t2mMaxAbs === null || t2mMax > t2mMaxAbs) t2mMaxAbs = t2mMax; }
      if (t2mMin !== null) { if (t2mMinAbs === null || t2mMin < t2mMinAbs) t2mMinAbs = t2mMin; }
      if (rh !== null) { rhSum += rh; rhValidCount++; }
      if (ws !== null) { wsSum += ws; wsValidCount++; }
      if (rad !== null) { radSum += rad; radValidCount++; }

      return {
        monthKey: key,
        precipitacionMm: monthlyPrec !== null ? Math.round(monthlyPrec * 10) / 10 : null,
        tempMediaC: t2m !== null ? Math.round(t2m * 10) / 10 : null,
        tempMaxC: t2mMax !== null ? Math.round(t2mMax * 10) / 10 : null,
        tempMinC: t2mMin !== null ? Math.round(t2mMin * 10) / 10 : null,
        humedadPct: rh !== null ? Math.round(rh * 10) / 10 : null,
        vientoKmH: ws !== null ? Math.round((ws * 3.6) * 10) / 10 : null,
        radiacionMjM2Day: rad !== null ? Math.round(rad * 10) / 10 : null
      };
    });

    if (precValidCount === 0 && t2mValidCount === 0) {
      return {
        status: "UNAVAILABLE",
        message: "NO DISPONIBLE — Los registros de la serie climática contienen valores no válidos.",
        data: null
      };
    }

    // Obtener la climatología de referencia independiente
    const climatology = await fetchClimatologyReference(lat, lng);

    const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

    let expectedClimPrecPeriodMm = 0;
    let climT2mSum = 0;
    let climCount = 0;

    selectedKeys.forEach(key => {
      const monthIdx = parseInt(key.substring(4, 6)) - 1;
      const mCode = monthNames[monthIdx];
      const days = daysInMonth(key);

      if (climatology && climatology.precip && isVal(climatology.precip[mCode])) {
        expectedClimPrecPeriodMm += climatology.precip[mCode] * days;
      }
      if (climatology && climatology.t2m && isVal(climatology.t2m[mCode])) {
        climT2mSum += climatology.t2m[mCode];
        climCount++;
      }
    });

    const t2mMeanPeriod = t2mValidCount > 0 ? t2mSum / t2mValidCount : null;
    const rhMeanPeriod = rhValidCount > 0 ? rhSum / rhValidCount : null;
    const wsMeanKmH = wsValidCount > 0 ? (wsSum / wsValidCount) * 3.6 : null;
    const radMeanPeriod = radValidCount > 0 ? radSum / radValidCount : null;

    const refClimT2mAvg = climCount > 0 ? climT2mSum / climCount : (climatology?.t2m?.ANN ?? null);
    const refClimAnnualPrec = climatology?.precip?.ANN !== undefined ? climatology.precip.ANN * 365.25 : null;

    let precDiffMm = null;
    let precDiffPct = null;
    let classPrec = "ANOMALÍA: NO DISPONIBLE";

    if (expectedClimPrecPeriodMm > 0 && precValidCount > 0) {
      precDiffMm = precTotalPeriodMm - expectedClimPrecPeriodMm;
      precDiffPct = (precDiffMm / expectedClimPrecPeriodMm) * 100;
      if (precDiffPct > 15) classPrec = "Por encima de la referencia climatológica (superávit hídrico)";
      else if (precDiffPct < -15) classPrec = "Por debajo de la referencia climatológica (déficit hídrico)";
      else classPrec = "Cercano a la referencia climatológica";
    }

    let tempAnomaly = null;
    let classTemp = "ANOMALÍA: NO DISPONIBLE";
    if (t2mMeanPeriod !== null && refClimT2mAvg !== null) {
      tempAnomaly = t2mMeanPeriod - refClimT2mAvg;
      if (tempAnomaly > 0.75) classTemp = "Anomalía cálida (por encima de la referencia)";
      else if (tempAnomaly < -0.75) classTemp = "Anomalía fría (por debajo de la referencia)";
      else classTemp = "Cercano a la referencia climatológica";
    }

    return {
      status: "REAL",
      data: {
        periodMetrics: {
          precipitacionAcumuladaMm: precValidCount > 0 ? Math.round(precTotalPeriodMm * 10) / 10 : "NO DISPONIBLE",
          temperaturaMediaC: t2mMeanPeriod !== null ? Math.round(t2mMeanPeriod * 10) / 10 : "NO DISPONIBLE",
          temperaturaMaximaAbsolutaC: t2mMaxAbs !== null ? Math.round(t2mMaxAbs * 10) / 10 : "NO DISPONIBLE",
          temperaturaMinimaAbsolutaC: t2mMinAbs !== null ? Math.round(t2mMinAbs * 10) / 10 : "NO DISPONIBLE",
          humedadRelativaMediaPct: rhMeanPeriod !== null ? Math.round(rhMeanPeriod * 10) / 10 : "NO DISPONIBLE",
          vientoMedioKmH: wsMeanKmH !== null ? Math.round(wsMeanKmH * 10) / 10 : "NO DISPONIBLE",
          radiacionSolarMediaMjM2Day: radMeanPeriod !== null ? Math.round(radMeanPeriod * 10) / 10 : "NO DISPONIBLE"
        },
        historicalAverages: {
          precipitacionMediaAnualMm: refClimAnnualPrec !== null ? Math.round(refClimAnnualPrec * 10) / 10 : "NO DISPONIBLE",
          temperaturaMediaHistoricaC: refClimT2mAvg !== null ? Math.round(refClimT2mAvg * 10) / 10 : "NO DISPONIBLE"
        },
        comparison: {
          precipitacionesDiferenciaMm: precDiffMm !== null ? Math.round(precDiffMm * 10) / 10 : "ANOMALÍA: NO DISPONIBLE",
          precipitacionesDiferenciaPct: precDiffPct !== null ? Math.round(precDiffPct * 10) / 10 : "ANOMALÍA: NO DISPONIBLE",
          clasificacionPrecipitacion: classPrec,
          temperaturaAnomalia: tempAnomaly !== null ? Math.round(tempAnomaly * 10) / 10 : "ANOMALÍA: NO DISPONIBLE",
          clasificacionTemperatura: classTemp,
          criterioEstadistico: "Clasificación basada en desviaciones relativas respecto a la referencia climatológica normada de NASA POWER (Climatology 2001-2020)."
        },
        monthlyBreakdown
      },
      traceability: {
        fuente: "REAL — NASA POWER (Prediction Of Worldwide Energy Resources)",
        apiEndpoint: "https://power.larc.nasa.gov/",
        coordenadas: { lat: parseFloat(lat.toFixed(4)), lng: parseFloat(lng.toFixed(4)) },
        periodo: `${startYear}–${endYear}`,
        mesesAnalizados: selectedKeys.length,
        variablesConsultadas: ['PRECTOTCORR', 'T2M', 'T2M_MAX', 'T2M_MIN', 'RH2M', 'WS2M', 'ALLSKY_SFC_SW_DWN'],
        fechaConsulta: new Date().toISOString().split('T')[0],
        disclaimer: "Estos datos representan reanálisis espacial/modelado de NASA POWER y no sustituyen una estación meteorológica local."
      }
    };

  } catch (err) {
    return {
      status: "UNAVAILABLE",
      message: `NO DISPONIBLE — Fallo de conexión o red al consultar NASA POWER: ${err.message}`,
      data: null
    };
  }
}
