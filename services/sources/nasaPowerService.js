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

    // Promedio histórico completo disponible en la API para comparar
    let histPrecSum = 0;
    let histPrecCount = 0;
    let histT2mSum = 0;
    let histT2mCount = 0;

    monthlyKeys.forEach(k => {
      const p = isVal(paramsData.PRECTOTCORR?.[k]) ? paramsData.PRECTOTCORR[k] : null;
      const t = isVal(paramsData.T2M?.[k]) ? paramsData.T2M[k] : null;
      if (p !== null) { histPrecSum += p * daysInMonth(k); histPrecCount++; }
      if (t !== null) { histT2mSum += t; histT2mCount++; }
    });

    const allPrecMonthlyAvg = histPrecCount > 0 ? (histPrecSum / (histPrecCount / 12)) : null;
    const allT2mAvg = histT2mCount > 0 ? (histT2mSum / histT2mCount) : null;

    const t2mMeanPeriod = t2mValidCount > 0 ? t2mSum / t2mValidCount : null;
    const rhMeanPeriod = rhValidCount > 0 ? rhSum / rhValidCount : null;
    const wsMeanKmH = wsValidCount > 0 ? (wsSum / wsValidCount) * 3.6 : null;
    const radMeanPeriod = radValidCount > 0 ? radSum / radValidCount : null;

    // Normalizar promedio histórico para la cantidad de meses del período seleccionado
    let precDiffMm = null;
    let precDiffPct = null;
    let classPrec = "Información comparativa no disponible";

    if (allPrecMonthlyAvg !== null && precValidCount > 0) {
      const expectedHistoricalPrecForPeriod = (allPrecMonthlyAvg / 12) * precValidCount;
      precDiffMm = precTotalPeriodMm - expectedHistoricalPrecForPeriod;
      precDiffPct = expectedHistoricalPrecForPeriod > 0 ? (precDiffMm / expectedHistoricalPrecForPeriod) * 100 : 0;
      if (precDiffPct > 15) classPrec = "Por encima del promedio histórico (superávit hídrico)";
      else if (precDiffPct < -15) classPrec = "Por debajo del promedio histórico (déficit hídrico)";
      else classPrec = "Cercano al promedio histórico";
    }

    let tempAnomaly = null;
    let classTemp = "Información comparativa no disponible";
    if (t2mMeanPeriod !== null && allT2mAvg !== null) {
      tempAnomaly = t2mMeanPeriod - allT2mAvg;
      if (tempAnomaly > 0.75) classTemp = "Anomalía cálida (por encima del promedio)";
      else if (tempAnomaly < -0.75) classTemp = "Anomalía fría (por debajo del promedio)";
      else classTemp = "Cercano al promedio histórico";
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
          precipitacionMediaAnualMm: allPrecMonthlyAvg !== null ? Math.round(allPrecMonthlyAvg * 10) / 10 : "NO DISPONIBLE",
          temperaturaMediaHistoricaC: allT2mAvg !== null ? Math.round(allT2mAvg * 10) / 10 : "NO DISPONIBLE"
        },
        comparison: {
          precipitacionesDiferenciaMm: precDiffMm !== null ? Math.round(precDiffMm * 10) / 10 : "NO DISPONIBLE",
          precipitacionesDiferenciaPct: precDiffPct !== null ? Math.round(precDiffPct * 10) / 10 : "NO DISPONIBLE",
          clasificacionPrecipitacion: classPrec,
          temperaturaAnomalia: tempAnomaly !== null ? Math.round(tempAnomaly * 10) / 10 : "NO DISPONIBLE",
          clasificacionTemperatura: classTemp,
          criterioEstadistico: "Clasificación basada en desviaciones relativas (+/-15% precipitación, +/-0.75°C anomalía térmica) respecto a la media de la serie 1981-actualidad."
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
