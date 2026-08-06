/* ============================================================================
   script.js — Motor de recomendaciones + UI — Agro Consultas v1.0
   ============================================================================ */

/**
 * Normaliza una cadena para búsqueda (quita acentos, múltiples espacios, pasa a minúsculas)
 */
function normalizeKey(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Convierte índice de mes a nombre
 */
function monthIndexToName(i) {
  const months = [
    "Enero","Febrero","Marzo","Abril","Mayo","Junio",
    "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"
  ];
  return months[i - 1] || "";
}

/* ============================================================================
   Base de Datos de Cultivos — Información detallada
   ============================================================================ */

const cultivosData = {
  "trigo": {
    descripcion: "Cereal de invierno fundamental para la rotación de cultivos.",
    siembra: "Mayo a Julio",
    cosecha: "Noviembre a Enero",
    reqSuelo: "Suelos profundos, texturas francas, buena fertilidad y drenaje sin encharcamientos.",
    reqClima: "Templado, precipitaciones moderadas durante macollaje y llenado.",
    pino_eucalyptus: false
  },
  "soja": {
    descripcion: "Principal cultivo de exportación, leguminosa de verano.",
    siembra: "Octubre a Diciembre",
    cosecha: "Marzo a Mayo",
    reqSuelo: "Suelos fértiles, pH neutro, buena capacidad de retención de agua.",
    reqClima: "Templado-cálido, lluvias estivales abundantes.",
    pino_eucalyptus: false
  },
  "maiz": {
    descripcion: "Cereal versátil con altos requerimientos nutricionales.",
    siembra: "Septiembre a Diciembre",
    cosecha: "Marzo a Agosto",
    reqSuelo: "Suelos profundos, ricos en materia orgánica y nitrógeno, buen drenaje.",
    reqClima: "Templado-cálido, alta radiación, lluvias suficientes en floración.",
    pino_eucalyptus: false
  },
  "cebada": {
    descripcion: "Cereal de invierno, muy utilizado en la industria cervecera.",
    siembra: "Junio a Julio",
    cosecha: "Noviembre a Diciembre",
    reqSuelo: "Suelos fértiles y bien drenados, tolera salinidad moderada.",
    reqClima: "Templado-frío, moderada humedad.",
    pino_eucalyptus: false
  },
  "girasol": {
    descripcion: "Oleaginosa resistente a sequías moderadas.",
    siembra: "Agosto a Noviembre",
    cosecha: "Enero a Marzo",
    reqSuelo: "Suelos profundos, tolera texturas más arenosas pero requiere buen drenaje.",
    reqClima: "Templado-cálido, alta heliofania (sol). Resiste sequías moderadas.",
    pino_eucalyptus: false
  },
  "sorgo": {
    descripcion: "Cereal rústico ideal para zonas con menor disponibilidad hídrica.",
    siembra: "Octubre a Noviembre",
    cosecha: "Marzo a Mayo",
    reqSuelo: "Suelos arcillosos a francos, tolera salinidad y anegamiento temporario.",
    reqClima: "Cálido, alta resistencia al estrés hídrico y temperaturas extremas.",
    pino_eucalyptus: false
  },
  "mani": {
    descripcion: "Leguminosa regional de alto valor agregado.",
    siembra: "Octubre a Noviembre",
    cosecha: "Abril a Mayo",
    reqSuelo: "Suelos sueltos, arenosos, sin piedras para permitir el 'clavado' del fruto.",
    reqClima: "Templado-cálido, libre de heladas en ciclo de cultivo.",
    pino_eucalyptus: false
  },
  "arroz": {
    descripcion: "Cereal cultivado en suelos anegadizos con riego controlado.",
    siembra: "Septiembre a Noviembre",
    cosecha: "Febrero a Abril",
    reqSuelo: "Suelos pesados (arcillosos), impermeables para retener la lámina de agua.",
    reqClima: "Subtropical o templado cálido, alta radiación solar.",
    pino_eucalyptus: false
  },
  "yerba mate": {
    descripcion: "Cultivo perenne emblemático de la región mesopotámica.",
    siembra: "Marzo a Junio (plantación)",
    cosecha: "Abril a Septiembre",
    reqSuelo: "Suelos rojos lateríticos profundos, excelente drenaje, ácidos (pH 4.5 - 6.0).",
    reqClima: "Subtropical húmedo, lluvias abundantes (>1500mm), tolerante a heladas muy suaves.",
    pino_eucalyptus: false
  },
  "citrus": {
    descripcion: "Frutales como limón, naranja y mandarina.",
    siembra: "Primavera",
    cosecha: "Invierno a Primavera",
    reqSuelo: "Suelos permeables, profundos, sin capas impermeables cerca de superficie.",
    reqClima: "Cálido y húmedo, muy sensible a heladas fuertes.",
    pino_eucalyptus: false
  },
  "te": {
    descripcion: "Infusión cultivada principalmente en Misiones y Corrientes.",
    siembra: "Otoño",
    cosecha: "Noviembre a Abril",
    reqSuelo: "Suelos muy ácidos, profundos, ricos en materia orgánica, excelente drenaje.",
    reqClima: "Cálido-templado, alta humedad ambiente y lluvias copiosas durante brotación.",
    pino_eucalyptus: false
  },
  "algodon": {
    descripcion: "Fibra textil adaptada a climas subtropicales.",
    siembra: "Octubre a Diciembre",
    cosecha: "Abril a Julio",
    reqSuelo: "Suelos profundos, fértiles, texturas francas a arcillo-limosas.",
    reqClima: "Subtropical cálido, largo período libre de heladas, lluvias estivales.",
    pino_eucalyptus: false
  },
  "vid": {
    descripcion: "Cultivo base de la industria vitivinícola en zonas áridas con riego.",
    siembra: "Agosto a Octubre (plantación)",
    cosecha: "Febrero a Abril",
    reqSuelo: "Suelos pedregosos o arenosos, baja fertilidad, drenaje perfecto.",
    reqClima: "Árido a semiárido con alta amplitud térmica diurna/nocturna.",
    pino_eucalyptus: false
  },
  "olivo": {
    descripcion: "Frutal adaptado a climas secos para producción de aceite y aceitunas.",
    siembra: "Marzo a Mayo (plantación)",
    cosecha: "Febrero a Mayo",
    reqSuelo: "Suelos permeables, calizos o arenosos, tolera cierta salinidad.",
    reqClima: "Seco, inviernos frescos (horas de frío) y veranos cálidos y secos.",
    pino_eucalyptus: false
  },
  "manzana": {
    descripcion: "Fruta de pepita típica de los valles patagónicos.",
    siembra: "Agosto a Septiembre",
    cosecha: "Enero a Abril",
    reqSuelo: "Suelos aluviales profundos, bien drenados, buen contenido de materia orgánica.",
    reqClima: "Templado-frío, requiere acumulación de horas de frío en invierno.",
    pino_eucalyptus: false
  },
  "pera": {
    descripcion: "Fruta de pepita de alta calidad de exportación.",
    siembra: "Agosto a Septiembre",
    cosecha: "Enero a Marzo",
    reqSuelo: "Suelos aluviales profundos, tolera arcilla moderada si hay buen manejo.",
    reqClima: "Templado-frío, alta heliofania para calidad de fruta.",
    pino_eucalyptus: false
  },
  "cana de azucar": {
    descripcion: "Cultivo industrial clave en el NOA.",
    siembra: "Mayo a Septiembre",
    cosecha: "Junio a Octubre",
    reqSuelo: "Suelos fértiles, profundos, buena capacidad de retención de humedad.",
    reqClima: "Subtropical húmedo, alta radiación solar, libre de heladas fuertes.",
    pino_eucalyptus: false
  },
  "limon": {
    descripcion: "Líder mundial en exportación de derivados cítricos.",
    siembra: "Primavera",
    cosecha: "Abril a Septiembre",
    reqSuelo: "Suelos francos a franco-arenosos, bien aireados y profundos.",
    reqClima: "Templado cálido a subtropical, muy susceptible a heladas invernales.",
    pino_eucalyptus: false
  },
  "porotos": {
    descripcion: "Legumbre de ciclo corto producida principalmente en el NOA.",
    siembra: "Enero a Febrero",
    cosecha: "Mayo a Junio",
    reqSuelo: "Suelos francos, livianos, bien aireados, pH neutro.",
    reqClima: "Templado cálido, sensible a exceso de lluvias en maduración.",
    pino_eucalyptus: false
  },
  "papa": {
    descripcion: "Tubérculo de consumo masivo con diversas zonas de producción.",
    siembra: "Agosto a Octubre / Febrero",
    cosecha: "Diciembre a Abril / Junio",
    reqSuelo: "Suelos sueltos, francos, sin piedras, bien drenados y con buen aporte orgánico.",
    reqClima: "Templado a templado-frío, amplitudes térmicas óptimas.",
    pino_eucalyptus: false
  },
  "quinoa": {
    descripcion: "Pseudocereal andino de alto valor nutricional.",
    siembra: "Octubre a Noviembre",
    cosecha: "Marzo a Mayo",
    reqSuelo: "Suelos arenosos o francos, rústico, tolera suelos pobres y sequía.",
    reqClima: "Frío continental árido de montaña.",
    pino_eucalyptus: false
  },
  "mandioca": {
    descripcion: "Raíz amilácea fundamental en la dieta del NEA.",
    siembra: "Agosto a Octubre",
    cosecha: "Mayo a Agosto",
    reqSuelo: "Suelos sueltos, arenosos, profundos, con buen drenaje para evitar pudriciones.",
    reqClima: "Subtropical a tropical, muy sensible al frío y heladas tempranas.",
    pino_eucalyptus: false
  },
  "pino taeda": {
    descripcion: "Variedad forestal de rápido crecimiento del género Pinus, ideal para NEA maderero.",
    siembra: "Otoño a Invierno",
    cosecha: "Raleos intermedios; corte final a los 15 años",
    reqSuelo: "Suelos profundos, texturas franco-arcillosas a arcillosas ácidas (pH 4.5-5.5).",
    reqClima: "Subtropical templado-cálido, lluvias superiores a 1200mm anuales.",
    pino_eucalyptus: true
  },
  "pino elliottii": {
    descripcion: "Variedad forestal de Pinus muy resistente a heladas y suelos con peor drenaje.",
    siembra: "Otoño a Invierno",
    cosecha: "Turno final de 15-18 años",
    reqSuelo: "Suelos arenosos pobres o arcillosos con drenaje deficiente o moderado.",
    reqClima: "Subtropical húmedo a templado, alta tolerancia al frío invernal.",
    pino_eucalyptus: true
  },
  "eucalyptus grandis": {
    descripcion: "Variedad de Eucalyptus de máxima velocidad de crecimiento para pasta y madera en NEA.",
    siembra: "Primavera u Otoño",
    cosecha: "Turno de corte corto de 8-10 años",
    reqSuelo: "Suelos muy profundos, bien drenados, texturas francas a franco-arenosas.",
    reqClima: "Subtropical húmedo continuo, heliofilia extrema, muy sensible a heladas severas.",
    pino_eucalyptus: true
  },
  "eucalyptus globulus": {
    descripcion: "Variedad de Eucalyptus ideal para zonas templadas y costeras (Buenos Aires Sur).",
    siembra: "Otoño",
    cosecha: "Turno de corte a los 10-12 años",
    reqSuelo: "Suelos franco-arcillosos moderados, profundos, tolera cierta tosca.",
    reqClima: "Templado húmedo, excelente tolerancia a heladas moderadas e influencia oceánica.",
    pino_eucalyptus: true
  },
  "forestacion": {
    descripcion: "Especies nativas y exóticas para protección y producción maderera.",
    siembra: "Primavera u Otoño",
    cosecha: "Variable según especie (20-40 años)",
    reqSuelo: "Suelos de aptitud forestal de variada profundidad.",
    reqClima: "Adaptado a las condiciones climáticas del NEA pampeano.",
    pino_eucalyptus: true
  },
  "arandano": {
    descripcion: "Fruto de alto valor comercial, cultivado principalmente para exportación.",
    siembra: "Otoño a Invierno",
    cosecha: "Octubre a Diciembre",
    reqSuelo: "Suelos muy ácidos (pH 4.5 a 5.2), livianos, con excelente contenido de materia orgánica y drenaje.",
    reqClima: "Templado a templado-cálido, requiere acumulación de horas de frío invernal.",
    pino_eucalyptus: false
  },
  "ajo": {
    descripcion: "Hortaliza de bulbo de alta relevancia en las economías regionales occidentales.",
    siembra: "Marzo a Mayo",
    cosecha: "Noviembre a Diciembre",
    reqSuelo: "Suelos francos a franco-arenosos, bien drenados, ricos en potasio y materia orgánica.",
    reqClima: "Clima templado a templado-frío, seco durante la etapa de maduración de bulbos.",
    pino_eucalyptus: false
  },
  "nuez pecan": {
    descripcion: "Fruto seco de alta longevidad y excelente rentabilidad a mediano plazo.",
    siembra: "Julio a Agosto (plantas a raíz desnuda)",
    cosecha: "Abril a Mayo",
    reqSuelo: "Suelos profundos, fértiles, aluviales, con buen drenaje y sin capas impermeables.",
    reqClima: "Templado húmedo a subtropical, con veranos cálidos y otoños libres de heladas tempranas.",
    pino_eucalyptus: false
  },
  "alfalfa": {
    descripcion: "La reina de las forrajeras, base de la alimentación ganadera pampeana.",
    siembra: "Marzo a Abril",
    cosecha: "Múltiples cortes de Primavera a Otoño",
    reqSuelo: "Suelos profundos, bien drenados, pH neutro a ligeramente alcalino (no tolera acidez ni encharcamiento).",
    reqClima: "Templado, adaptable a diversas condiciones con buen régimen hídrico o riego.",
    pino_eucalyptus: false
  },
  "lupulo": {
    descripcion: "Cultivo especializado para la industria cervecera artesanal e industrial.",
    siembra: "Agosto a Septiembre (rizomas)",
    cosecha: "Febrero a Marzo",
    reqSuelo: "Suelos sueltos, profundos, ricos en nutrientes, con excelente drenaje físico.",
    reqClima: "Templado-frío, con días largos en verano y reparado de vientos fuertes continuos.",
    pino_eucalyptus: false
  },
  "cereza": {
    descripcion: "Fruta fina de alta calidad con excelente mercado de exportación.",
    siembra: "Invierno",
    cosecha: "Noviembre a Diciembre",
    reqSuelo: "Suelos aireados, de textura franca a franco-arenosa, sin capas arcillosas limitantes.",
    reqClima: "Templado-frío, con alta demanda de horas de frío y baja probabilidad de lluvias en cosecha.",
    pino_eucalyptus: false
  },
  "garbanzo": {
    descripcion: "Legumbre de invierno con fuerte inserción de exportación en el centro-norte del país.",
    siembra: "Mayo a Junio",
    cosecha: "Noviembre a Diciembre",
    reqSuelo: "Suelos sueltos, con buena aireación, tolerante a sequía pero sensible a encharcamientos.",
    reqClima: "Templado-seco a templado-cálido, tolera heladas suaves en etapas iniciales.",
    pino_eucalyptus: false
  },
  "lenteja": {
    descripcion: "Legumbre de invierno de alto valor nutricional y consumo local y externo.",
    siembra: "Mayo a Junio",
    cosecha: "Noviembre",
    reqSuelo: "Suelos francos a franco-limosos, fértiles y bien estructurados.",
    reqClima: "Templado-frío, tolerante a heladas y de bajo requerimiento de agua estival.",
    pino_eucalyptus: false
  },
  "lavanda": {
    descripcion: "Aromática perenne rústica adaptada a zonas serranas e industriales.",
    siembra: "Otoño o Primavera",
    cosecha: "Verano (floración)",
    reqSuelo: "Suelos pedregosos, calcáreos, secos, con excelente drenaje y tolerantes a pH elevados.",
    reqClima: "Templado a cálido, muy resistente a la sequía y heladas intensas.",
    pino_eucalyptus: false
  },
  "oregano": {
    descripcion: "Condimento esencial cultivado intensivamente en economías familiares.",
    siembra: "Otoño o Primavera",
    cosecha: "Primavera avanzada a Verano",
    reqSuelo: "Suelos ligeros, franco-arenosos, bien drenados, de fertilidad media.",
    reqClima: "Templado-cálido, pleno sol, resistente a sequías moderadas.",
    pino_eucalyptus: false
  },
  "sauce": {
    descripcion: "Especie forestal higrófila de rápido crecimiento para el Delta y valles irrigados.",
    siembra: "Invierno (estacas)",
    cosecha: "Turnos de corte de 10 a 15 años",
    reqSuelo: "Suelos húmedos, tolera anegamiento temporal y texturas arcillosas húmedas.",
    reqClima: "Templado-húmedo a templado-cálido con alta disponibilidad hídrica.",
    pino_eucalyptus: true
  },
  "alamo": {
    descripcion: "Árbol forestal de madera clara de alta demanda para cajonería y tableros.",
    siembra: "Invierno (estacas)",
    cosecha: "Turnos de corte de 12 a 18 años",
    reqSuelo: "Suelos profundos, aluviales, fértiles, con napa freática accesible pero no estancada.",
    reqClima: "Templado a templado-cálido, requiere veranos luminosos y riego o lluvias adecuadas.",
    pino_eucalyptus: true
  },
  "durazno": {
    descripcion: "Frutal de carozo tradicional de consumo en fresco e industria conservera.",
    siembra: "Otoño a Invierno",
    cosecha: "Noviembre a Febrero",
    reqSuelo: "Suelos francos, permeables, sin problemas de sales ni caliza excesiva.",
    reqClima: "Templado a templado-cálido, con requerimiento moderado de horas de frío.",
    pino_eucalyptus: false
  },
  "ciruela": {
    descripcion: "Frutal rústico de carozo, muy difundido para desecado y consumo fresco.",
    siembra: "Julio a Agosto",
    cosecha: "Enero a Marzo",
    reqSuelo: "Suelos franco-arcillosos, tolera condiciones de drenaje ligeramente más pesadas que el duraznero.",
    reqClima: "Templado con veranos secos y calurosos para facilitar el secado de fruta.",
    pino_eucalyptus: false
  },
  "almendro": {
    descripcion: "Fruto seco altamente valorado, con floración muy temprana.",
    siembra: "Invierno",
    cosecha: "Febrero a Marzo",
    reqSuelo: "Suelos ligeros, profundos, calcáreos y con excelente drenaje interno.",
    reqClima: "Clima templado-cálido, muy sensible a heladas tardías de primavera durante la floración.",
    pino_eucalyptus: false
  },
  "tabaco": {
    descripcion: "Cultivo industrial intensivo de gran impacto socioeconómico en el norte argentino.",
    siembra: "Julio (almácigos) - Trasplante en Octubre",
    cosecha: "Enero a Marzo",
    reqSuelo: "Suelos franco-arenosos, livianos, bien drenados, ricos en materia orgánica.",
    reqClima: "Subtropical o templado-cálido con humedad relativa adecuada durante el desarrollo foliar.",
    pino_eucalyptus: false
  },
  "avena": {
    descripcion: "Cereal forrajero de doble propósito clave para verdeos de invierno.",
    siembra: "Febrero a Abril",
    cosecha: "Noviembre a Diciembre (grano) o pastoreo directo",
    reqSuelo: "Suelos de fertilidad media, tolera mejor la acidez que el trigo y la cebada.",
    reqClima: "Templado-frío, muy resistente al frío y a las heladas invernales.",
    pino_eucalyptus: false
  },
  "centeno": {
    descripcion: "Cereal de invierno sumamente rústico para suelos arenosos y climas rigurosos.",
    siembra: "Marzo a Mayo",
    cosecha: "Diciembre",
    reqSuelo: "Suelos arenosos, de baja fertilidad y propensos a la erosión (excelente fijador de suelos).",
    reqClima: "Clima templado-frío a frío, alta tolerancia a la sequía y vientos secos.",
    pino_eucalyptus: false
  },
  "colza": {
    descripcion: "Oleaginosa de invierno de gran expansión como alternativa al trigo.",
    siembra: "Abril a Mayo",
    cosecha: "Octubre a Noviembre",
    reqSuelo: "Suelos profundos, sueltos, fértiles y sin impedimentos físicos.",
    reqClima: "Templado-frío, alta sensibilidad a heladas extremas en floración.",
    pino_eucalyptus: false
  },
  "kiwi": {
    descripcion: "Fruto exótico trepador de excelente rentabilidad y nicho comercial.",
    siembra: "Agosto a Septiembre",
    cosecha: "Abril a Mayo",
    reqSuelo: "Suelos muy permeables, ricos en materia orgánica, pH ligeramente ácido (5.5 a 6.5).",
    reqClima: "Templado húmedo, con alta humedad ambiental y libre de vientos fuertes o heladas tardías.",
    pino_eucalyptus: false
  },
  "pimiento": {
    descripcion: "Cultivo hortícola de alta rentabilidad, tanto para fresco como para pimentón.",
    siembra: "Agosto a Octubre",
    cosecha: "Enero a Abril",
    reqSuelo: "Suelos francos, fértiles, aireados y con excelente provisión de nutrientes.",
    reqClima: "Subtropical o templado-cálido con veranos soleados, muy sensible al frío.",
    pino_eucalyptus: false
  },
  "tomate": {
    descripcion: "Hortaliza de fruto líder en consumo fresco e industria de conservas.",
    siembra: "Agosto a Octubre",
    cosecha: "Diciembre a Abril",
    reqSuelo: "Suelos profundos, ricos en materia orgánica, bien abonados y permeables.",
    reqClima: "Templado-cálido a cálido, requiere alta luminosidad solar y temperaturas estables.",
    pino_eucalyptus: false
  },
  "arvejas": {
    descripcion: "Legumbre invernal excelente antecesora del maíz de segunda.",
    siembra: "Junio a Julio",
    cosecha: "Noviembre",
    reqSuelo: "Suelos sueltos, permeables, pH cercano al neutro.",
    reqClima: "Templado-frío, requiere temperaturas frescas durante la floración y llenado.",
    pino_eucalyptus: false
  },
  "melon": {
    descripcion: "Cucurbitácea de fruto dulce muy cotizado en el verano argentino.",
    siembra: "Octubre a Noviembre",
    cosecha: "Enero a Marzo",
    reqSuelo: "Suelos franco-arenosos, fértiles, profundos y con óptimo drenaje.",
    reqClima: "Templado-cálido, seco y muy soleado, excelente tolerancia al calor estival.",
    pino_eucalyptus: false
  },
  "sandia": {
    descripcion: "Fruto de verano rústico de excelente tamaño y contenido de agua.",
    siembra: "Septiembre a Noviembre",
    cosecha: "Enero a Marzo",
    reqSuelo: "Suelos arenosos o francos sueltos, tolera suelos menos fértiles con buena profundidad.",
    reqClima: "Templado-cálido a subtropical, requiere alta insolación y calor constante.",
    pino_eucalyptus: false
  }
};

const defaultCropInfo = {
  descripcion: "Información técnica en proceso de actualización.",
  siembra: "Consultar calendario regional",
  cosecha: "Sujeta a condiciones climáticas"
};

/* ============================================================================
   AgroDB — Provincias
   ============================================================================ */

const agroDB = {
  "buenos aires": { cultivos: ["trigo","soja","maiz","cebada","girasol","sorgo"], suelo: "Molisoles; alta fertilidad", clima: "Templado húmedo" },
  "ciudad autonoma de buenos aires": { cultivos: ["lechuga","tomate","espinaca"], suelo: "Urbano/Hidroponia", clima: "Templado" },
  "catamarca": { cultivos:["olivo","nogal","maiz"], suelo:"Aridisoles", clima:"Árido/semiárido" },
  "chaco": { cultivos:["algodon","soja","maiz","girasol"], suelo:"Vertisoles", clima:"Subtropical" },
  "chubut": { cultivos:["papa","frutilla","manzana"], suelo:"Aluviales", clima:"Frío templado" },
  "cordoba": { cultivos:["soja","maiz","trigo","mani"], suelo:"Molisoles", clima:"Templado subhúmedo" },
  "corrientes": { cultivos:["arroz","yerba mate","citrus","te"], suelo:"Hidromorfos", clima:"Subtropical húmedo" },
  "entre rios": { cultivos:["arroz","soja","maiz","trigo"], suelo:"Vertisoles", clima:"Templado húmedo" },
  "formosa": { cultivos:["soja","maiz","mandioca"], suelo:"Arcillosos", clima:"Subtropical" },
  "jujuy": { cultivos:["maiz","quinoa","papa","cana de azucar"], suelo:"Aluviales", clima:"Andino/subtropical" },
  "la pampa": { cultivos:["trigo","maiz","soja","girasol"], suelo:"Molisoles", clima:"Semiárido" },
  "la rioja": { cultivos:["vid","olivo"], suelo:"Aridisoles", clima:"Seco continental" },
  "mendoza": { cultivos:["vid","olivo","ajo","pera","manzana"], suelo:"Aridisoles", clima:"Desértico continental" },
  "misiones":{ cultivos:["yerba mate","te","citrus","mandioca"], suelo:"Lateríticos (rojos)", clima:"Tropical húmedo" },
  "neuquen":{ cultivos:["manzana","pera","vid"], suelo:"Aluviales", clima:"Semiárido frío" },
  "rio negro":{ cultivos:["manzana","pera","frutilla"], suelo:"Aluviales", clima:"Árido-frío" },
  "salta":{ cultivos:["soja","maiz","porotos","citrus","tabaco"], suelo:"Aluviales", clima:"Subtropical" },
  "san juan":{ cultivos:["vid","olivo","cebolla"], suelo:"Aridisoles", clima:"Desértico" },
  "san luis":{ cultivos:["trigo","maiz","soja","girasol"], suelo:"Arenosos", clima:"Semiárido" },
  "santa cruz":{ cultivos:["forrajeras","hortalizas en invernadero"], suelo:"Patagónico", clima:"Frío extremo" },
  "santa fe":{ cultivos:["soja","maiz","trigo","arroz","girasol"], suelo:"Argiudoles", clima:"Templado húmedo" },
  "santiago del estero":{ cultivos:["soja","maiz","girasol","algodon"], suelo:"Arenosos", clima:"Muy seco" },
  "tierra del fuego":{ cultivos:["lechuga","espinaca","frutilla"], suelo:"Turba/Fríos", clima:"Frío húmedo" },
  "tucuman":{ cultivos:["cana de azucar","limon","arandano"], suelo:"Aluviales", clima:"Subtropical húmedo" }
};

/* ============================================================================
   Datos Geográficos Adicionales (Centros de Provincias para el mapa)
   ============================================================================ */

const provinciaCoordenadas = {
  "buenos aires": { lat: -36.6769, lng: -60.5588, zoom: 6 },
  "ciudad autonoma de buenos aires": { lat: -34.6037, lng: -58.3816, zoom: 11 },
  "catamarca": { lat: -27.2682, lng: -66.9747, zoom: 6 },
  "chaco": { lat: -26.3860, lng: -60.7653, zoom: 7 },
  "chubut": { lat: -43.7886, lng: -68.5247, zoom: 6 },
  "cordoba": { lat: -32.1300, lng: -63.7000, zoom: 7 },
  "corrientes": { lat: -28.7745, lng: -57.8016, zoom: 7 },
  "entre rios": { lat: -32.0589, lng: -59.2014, zoom: 7 },
  "formosa": { lat: -24.8949, lng: -59.9324, zoom: 7 },
  "jujuy": { lat: -23.3200, lng: -65.7644, zoom: 7 },
  "la pampa": { lat: -37.1315, lng: -65.4384, zoom: 6 },
  "la rioja": { lat: -29.6850, lng: -67.1817, zoom: 6 },
  "mendoza": { lat: -34.6297, lng: -68.5831, zoom: 6 },
  "misiones": { lat: -26.8756, lng: -54.6543, zoom: 8 },
  "neuquen": { lat: -38.6417, lng: -70.1186, zoom: 6 },
  "rio negro": { lat: -40.3268, lng: -67.4891, zoom: 6 },
  "salta": { lat: -24.8500, lng: -64.4200, zoom: 6 },
  "san juan": { lat: -30.8653, lng: -68.8897, zoom: 6 },
  "san luis": { lat: -33.7577, lng: -66.0281, zoom: 6 },
  "santa cruz": { lat: -48.8154, lng: -69.9559, zoom: 5 },
  "santa fe": { lat: -30.7069, lng: -60.9461, zoom: 6 },
  "santiago del estero": { lat: -27.7824, lng: -63.2523, zoom: 6 },
  "tierra del fuego": { lat: -54.2115, lng: -67.8772, zoom: 5 },
  "tucuman": { lat: -26.9470, lng: -65.3647, zoom: 8 }
};

/* ============================================================================
   Base de Datos de Capas Agroambientales (Fase 2)
   Con foco especial en la región del NEA (Misiones, Corrientes, Chaco, Formosa)
   ============================================================================ */

const agroambientalesDB = {
  "misiones": {
    suelo: {
      tipo: "Lateríticos (Suelos Rojos - Ultisoles / Oxisoles)",
      textura: "Arcillo-limosa, rica en óxidos de hierro y aluminio",
      drenaje: "Excelente en lomadas, susceptible a erosión hídrica en pendientes",
      limitantes: "Alta acidez (pH bajo), fijación de fósforo, profundidad variable",
      aptitud: "Alta para Yerba Mate, Té, Pino (Taeda y Elliotis), Eucalyptus y Selva Nativa"
    },
    clima: {
      precipitaciones: "1800 - 2200 mm anuales (Distribución uniforme, sin estación seca definida)",
      temperatura: "Media anual de 20°C - 21°C",
      heladas: "Riesgo bajo a moderado en valles bajos (vórtices de aire frío)",
      deficit_hidrico: "Muy bajo o inexistente en años normales",
      estacionalidad: "Tropical/Subtropical húmedo"
    },
    geografia: {
      relieve: "Meseta ondulada, sierras de baja altura (hasta 800m), pendientes pronunciadas",
      hidrografia: "Rodeada por ríos Paraná, Uruguay e Iguazú. Red densa de arroyos internos",
      cobertura: "Selva Paranaense y plantaciones forestales masivas"
    }
  },
  "corrientes": {
    suelo: {
      tipo: "Aluviales e Hidromórficos (Spodosoles / Alfisoles)",
      textura: "Arenosa a franco-arenosa, con horizontes arcillosos impermeables en profundidad",
      drenaje: "Deficiente a moderado (zonas anegables, esteros y lagunas)",
      limitantes: "Saturación hídrica temporal, baja fertilidad natural en lomas arenosas",
      aptitud: "Excelente para Arroz (con riego controlado), Citrus, Pino y Eucalyptus en lomas"
    },
    clima: {
      precipitaciones: "1200 - 1600 mm anuales (Mayor concentración en primavera-otoño)",
      temperatura: "Media anual de 21°C - 22°C",
      heladas: "Riesgo muy bajo en el norte, moderado hacia el sur",
      deficit_hidrico: "Moderado durante el verano (Diciembre-Febrero)",
      estacionalidad: "Subtropical húmedo con veranos calurosos"
    },
    geografia: {
      relieve: "Planicie suavemente ondulada, lomas arenosas, macrosistema de Esteros del Iberá",
      hidrografia: "Límites por ríos Paraná y Uruguay, cuenca interna del Iberá y río Corriente",
      cobertura: "Pastizales naturales, humedales, forestación de pino y cultivos cítricos"
    }
  },
  "chaco": {
    suelo: {
      tipo: "Vertisoles y Molisoles (Suelos arcillosos pesados)",
      textura: "Franca a arcillosa, con arcillas expandibles (grietas en sequía)",
      drenaje: "Lento a deficiente (propensión a inundaciones superficiales breves)",
      limitantes: "Compactación, salinidad potencial, dificultad de labranza en húmedo",
      aptitud: "Alta para Algodón, Soja, Girasol, Sorgo y Ganadería silvopastoril"
    },
    clima: {
      precipitaciones: "800 - 1100 mm anuales (Marcado gradiente decreciente de este a oeste)",
      temperatura: "Media anual de 22°C - 23°C (Máximas extremas superiores a 45°C)",
      heladas: "Riesgo bajo (pocas heladas suaves en invierno)",
      deficit_hidrico: "Fuerte déficit hídrico invernal y estival",
      estacionalidad: "Subtropical con estación seca invernal marcada"
    },
    geografia: {
      relieve: "Llanura aluvial con pendiente mínima hacia el sudeste",
      hidrografia: "Ríos Paraná, Paraguay, Bermejo y Tapenagá. Cañadas temporales",
      cobertura: "Bosque nativo chaqueño (Quebracho, Algarrobo), cultivos anuales y pasturas"
    }
  },
  "formosa": {
    suelo: {
      tipo: "Entisoles y Alfisoles (Asociados a albardones de ríos)",
      textura: "Franco-arenosa en lomas y albardones, arcillosa pesada en esteros",
      drenaje: "Moderado en zonas altas, deficiente en bajos e interfluvios",
      limitantes: "Susceptibilidad a desbordes de ríos, baja retención de agua en lomas",
      aptitud: "Buena para Mandioca, Maíz, Banana, Pasturas megatérmicas y Forestal"
    },
    clima: {
      precipitaciones: "700 - 1200 mm anuales (Gradiente decreciente de este a oeste)",
      temperatura: "Media anual de 23°C",
      heladas: "Ocurrencia muy rara y leve",
      deficit_hidrico: "Elevado en invierno-primavera en el oeste provincial",
      estacionalidad: "Subtropical con estación seca"
    },
    geografia: {
      relieve: "Llanura sedimentaria muy plana, albardones y esteros paralelos",
      hidrografia: "Ríos Pilcomayo, Bermejo y Paraguay. Bañado La Estrella",
      cobertura: "Selva en galería, sabanas de palmeras (Caranday), monte chaqueño"
    }
  },
  "buenos aires": {
    suelo: {
      tipo: "Argiudoles y Molisoles típicos (Altísima fertilidad natural)",
      textura: "Franco-limosa a franco-arcillosa, excelente retención hídrica",
      drenaje: "Generalmente bueno, con áreas bajas inundables en la Cuenca del Salado",
      limitantes: "Riesgo de encharcamiento temporal en bajos, erosión hídrica en zonas de colinas",
      aptitud: "Máxima aptitud para Trigo, Soja, Maíz, Cebada, Girasol y ganadería extensiva"
    },
    clima: {
      precipitaciones: "850 - 1100 mm anuales (Distribución regular, mayor en verano-otoño)",
      temperatura: "Media anual de 15°C - 16°C",
      heladas: "Riesgo moderado a alto durante el período invernal (Mayo-Septiembre)",
      deficit_hidrico: "Leve estival en años secos (La Niña)",
      estacionalidad: "Templado pampeano húmedo"
    },
    geografia: {
      relieve: "Llanura pampeana mayormente plana con ondulaciones suaves y sistemas de Tandilia y Ventania",
      hidrografia: "Río de la Plata, Río Paraná, Río Salado, Quequén Grande y lagunas pampeanas",
      cobertura: "Pastizales pampeanos, áreas de cultivo intensivo y pasturas cultivadas"
    }
  },
  "ciudad autonoma de buenos aires": {
    suelo: {
      tipo: "Urbano antropogénico e Hidropónico",
      textura: "Modificada, artificial o sustratos preparados",
      drenaje: "Excelente en sistemas controlados / Pluvial urbano en exteriores",
      limitantes: "Espacio físico reducido, contaminación de suelos urbanos tradicionales",
      aptitud: "Especialmente apto para Horticultura vertical, Hidroponía de hoja y microgreens"
    },
    clima: {
      precipitaciones: "1000 - 1200 mm anuales",
      temperatura: "Media de 18°C (Efecto isla de calor urbana)",
      heladas: "Raras y muy leves",
      deficit_hidrico: "Nulo en sistemas hidropónicos controlados",
      estacionalidad: "Templado húmedo costero"
    },
    geografia: {
      relieve: "Urbano plano artificializado",
      hidrografia: "Costas del Río de la Plata y Cuenca Matanza-Riachuelo canalizada",
      cobertura: "Superficie de cemento, techos verdes y huertas urbanas comunitarias"
    }
  },
  "catamarca": {
    suelo: {
      tipo: "Aridisoles y Entisoles (Suelos pedregosos de zonas montañosas)",
      textura: "Franco-arenosa a esquelética (abundante canto rodado y piedras)",
      drenaje: "Excesivo a muy rápido",
      limitantes: "Bajo contenido de materia orgánica, salinidad en bolsones, escasez de agua",
      aptitud: "Excelente para Nogal, Olivo, Vid, Membrillo y cultivos bajo riego por goteo"
    },
    clima: {
      precipitaciones: "150 - 350 mm anuales (Altamente deficitario)",
      temperatura: "Media anual de 18°C - 21°C con fuerte amplitud térmica",
      heladas: "Frecuentes en alta montaña y valles desérticos elevados",
      deficit_hidrico: "Severo y continuo durante todo el año",
      estacionalidad: "Semiárido y árido de sierras y bolsones"
    },
    geografia: {
      relieve: "Montañoso, valles intermontanos, altiplanicie de la Puna",
      hidrografia: "Ríos de régimen temporario y ríos de deshielo aprovechados para riego",
      cobertura: "Estepa arbustiva rala, monte xerófilo de valles y oasis de riego"
    }
  },
  "chubut": {
    suelo: {
      tipo: "Aridisoles y Suelos Aluviales de valles",
      textura: "Fina a franco-arcillosa en valles aluviales, arenosa-pedregosa en la meseta",
      drenaje: "Bueno a moderado en áreas irrigadas",
      limitantes: "Bajas temperaturas del suelo, salinidad potencial por mal drenaje de riego",
      aptitud: "Buena para Fruta Fina (cereza, frutilla), Papa, Alfalfa y vid patagónica"
    },
    clima: {
      precipitaciones: "150 - 250 mm (este) a >1000 mm en la cordillera andina",
      temperatura: "Media anual de 8°C - 11°C",
      heladas: "Riesgo de heladas durante casi todo el año",
      deficit_hidrico: "Crónico en la meseta central",
      estacionalidad: "Árido patagónico a templado-frío de cordillera"
    },
    geografia: {
      relieve: "Cordillera al oeste, mesetas escalonadas en el centro, valles fluviales fértiles",
      hidrografia: "Río Chubut y Senguer, lagos andinos",
      cobertura: "Estepa patagónica achaparrada y bosque andino patagónico húmedo al oeste"
    }
  },
  "cordoba": {
    suelo: {
      tipo: "Molisoles (Haplustoles y Argiustoles fértiles)",
      textura: "Franca a franco-limosa con buena estructura y fertilidad natural",
      drenaje: "Moderado a bueno, propenso a erosión eólica e hídrica en laderas",
      limitantes: "Suelos arenosos en el sur, riesgo de compactación por labranza repetida",
      aptitud: "Excelente para Soja, Maíz, Trigo, Maní (principal productor) y Sorgo"
    },
    clima: {
      precipitaciones: "700 - 900 mm anuales (Fuertemente concentradas en primavera-verano)",
      temperatura: "Media anual de 16°C - 18°C",
      heladas: "Moderadas de Mayo a Septiembre",
      deficit_hidrico: "Estacional marcado en invierno y principios de primavera",
      estacionalidad: "Templado subhúmedo con invierno seco"
    },
    geografia: {
      relieve: "Llanura al este y sur, Sierras de Córdoba al oeste (Pampeanas)",
      hidrografia: "Ríos Primero (Suquía), Segundo, Tercero (Calamuchita), Cuarto y Quinto",
      cobertura: "Tierras de labranza continua, pastizales serranos y bosque nativo del Espinal"
    }
  },
  "entre rios": {
    suelo: {
      tipo: "Vertisoles (Suelos arcillosos con propiedades expansivas excepcionales)",
      textura: "Arcillo-limosa, muy pesada y plástica",
      drenaje: "Pobre a lento (genera encharcamientos temporarios y grietas en sequía)",
      limitantes: "Baja conductividad hidráulica, susceptibilidad a erosión hídrica en lomadas",
      aptitud: "Alta para Arroz (con represas), Soja, Trigo, Maíz y Citricultura en lomas"
    },
    clima: {
      precipitaciones: "1000 - 1300 mm anuales (Distribución regular)",
      temperatura: "Media anual de 18°C - 19°C",
      heladas: "Moderadas, menores en zonas costeras costeras de los ríos Paraná y Uruguay",
      deficit_hidrico: "Leve estival en años de sequía regional",
      estacionalidad: "Templado húmedo de transición"
    },
    geografia: {
      relieve: "Cuchillas u ondulaciones suaves interrumpidas por densa red fluvial",
      hidrografia: "Rodeada por ríos Paraná y Uruguay. Red interna de ríos (Gualeguay)",
      cobertura: "Bosques de espinal (ñandubay, algarrobo), cultivos anuales y citrus"
    }
  },
  "jujuy": {
    suelo: {
      tipo: "Suelos Aluviales y Entisoles de valles y quebradas",
      textura: "Franco-limosa a arenosa-pedregosa según relieve",
      drenaje: "Bueno a excesivo en laderas, riesgo de salinización en valles bajos",
      limitantes: "Pendientes extremas en quebradas, heladas fuertes en Puna, escasez de agua",
      aptitud: "Excelente para Caña de azúcar, Tabaco, Maíz, Quinoa, Papa andina y hortalizas"
    },
    clima: {
      precipitaciones: "200 mm (Puna) a >1200 mm en Yungas (selva de montaña)",
      temperatura: "Fuerte variación altitudinal (Media de 12°C en Puna a 21°C en yungas)",
      heladas: "Diarias en Puna, inexistentes a moderadas en yungas bajas",
      deficit_hidrico: "Extremo en quebradas y Puna, nulo en temporada húmeda serrana",
      estacionalidad: "Subtropical de montaña con valles templados"
    },
    geografia: {
      relieve: "Relieve extremo con Puna alta, Quebrada de Humahuaca, Sierras Subandinas y Valles bajos",
      hidrografia: "Río Grande de Jujuy, Río San Francisco",
      cobertura: "Selva de Yungas nubosa, estepa andina seca y cultivos bajo riego en valles"
    }
  },
  "la pampa": {
    suelo: {
      tipo: "Molisoles (Haplustoles) y Entisoles (suelos de llanuras semiáridas)",
      textura: "Franco-arenosa a arenosa, muy susceptibles a erosión eólica",
      drenaje: "Bueno a rápido, baja retención de agua en el oeste",
      limitantes: "Presencia de costras de tosca caliza a profundidad variable, baja fertilidad al oeste",
      aptitud: "Buena para Trigo, Maíz, Girasol, Alfalfa y ganadería de cría"
    },
    clima: {
      precipitaciones: "500 mm (oeste) a 800 mm (este) con gran variabilidad interanual",
      temperatura: "Media anual de 15°C - 16°C",
      heladas: "Intensas y prolongadas de Mayo a Octubre",
      deficit_hidrico: "Frecuente y severo en época estival hacia el oeste",
      estacionalidad: "Templado pampeano subhúmedo a semiárido"
    },
    geografia: {
      relieve: "Llanura plana con dunas arenosas estabilizadas y valles pampeanos amplios",
      hidrografia: "Río Colorado en el límite sur, cuencas sin salida interna (lagunas salinas)",
      cobertura: "Bosques de Caldén (caldonal), pastizales naturales y campos agrícolas"
    }
  },
  "la rioja": {
    suelo: {
      tipo: "Aridisoles y Entisoles desérticos",
      textura: "Franco-arenosa a pedregosa, nula materia orgánica",
      drenaje: "Muy rápido por alta permeabilidad",
      limitantes: "Baja retención de agua, salinidad en áreas de cuencas cerradas",
      aptitud: "Alta para Vid, Olivo, Nogal, Jojoba e higos, exclusivamente con riego presurizado"
    },
    clima: {
      precipitaciones: "100 - 250 mm anuales (Lluvias monzónicas estivales de corta duración)",
      temperatura: "Media anual de 19°C - 22°C (Veranos de calor extremo)",
      heladas: "Moderadas en invierno en áreas bajas abiertas",
      deficit_hidrico: "Extremo y continuo durante todo el ciclo",
      estacionalidad: "Árido montañoso y continental"
    },
    geografia: {
      relieve: "Sierras Pampeanas, valles áridos planos e intermontanos (Chilecito)",
      hidrografia: "Ríos de caudal efímero aprovechados con sistemas de captación subterránea",
      cobertura: "Monte arbustivo ralo (Jarilla, Retortuño), cactus y cultivos bajo oasis"
    }
  },
  "mendoza": {
    suelo: {
      tipo: "Aridisoles y Torrifluventes (Suelos aluviales de oasis áridos)",
      textura: "Arenosa, franco-arenosa, limosa con alto contenido de minerales y calcáreos",
      drenaje: "Excelente a excesivo, ideal para evitar pudriciones radiculares",
      limitantes: "Contenido de materia orgánica extremadamente bajo, peligro de salinización por mal drenaje",
      aptitud: "Excelente para Vid (Malbec premium), Olivo, Ajo, Pera y Manzana bajo riego"
    },
    clima: {
      precipitaciones: "150 - 250 mm anuales (Máxima concentración veraniega de alta torrencialidad)",
      temperatura: "Media anual de 15°C - 17°C, altísima amplitud térmica diaria",
      heladas: "Frecuentes en otoño tardío y primavera, riesgo de granizadas estivales severas",
      deficit_hidrico: "Severo (La producción depende 100% de la red de canales de deshielo)",
      estacionalidad: "Desértico o árido templado continental"
    },
    geografia: {
      relieve: "Cordillera de los Andes (Aconcagua), piedemontes y planicies aluviales al este",
      hidrografia: "Ríos Mendoza, Tunuyán, Atuel y Diamante (alimentados por deshielo glacial)",
      cobertura: "Estepas andinas, desierto arbustivo y oasis verdes intensamente cultivados"
    }
  },
  "neuquen": {
    suelo: {
      tipo: "Aridisoles, Andisoles en cordillera y aluviales en valles fluviales",
      textura: "Arenosa-pedregosa a limosa en valles bajos",
      drenaje: "Excesivo en zonas altas, controlado en los valles cultivados",
      limitantes: "Pedregosidad superficial extrema, cenizas volcánicas en sectores occidentales",
      aptitud: "Óptima para Manzana, Pera, Vid de zonas frías, Frutilla y forrajes de corte"
    },
    clima: {
      precipitaciones: "150 mm en estepa oriental hasta 2500 mm en cumbres andinas",
      temperatura: "Media anual de 10°C - 13°C (Vientos muy fuertes en primavera y verano)",
      heladas: "Alto riesgo de heladas tardías en floración (Primavera)",
      deficit_hidrico: "Elevado en toda la zona extraandina",
      estacionalidad: "Árido-templado patagónico con influencia andina húmeda"
    },
    geografia: {
      relieve: "Cordillera de los Andes con volcanes activos, mesetas y valles fluviales profundos",
      hidrografia: "Ríos Limay y Neuquén (cuenca del Río Negro)",
      cobertura: "Bosques andinos (Araucarias/Pehuenes), estepa patagónica y oasis irrigados"
    }
  },
  "rio negro": {
    suelo: {
      tipo: "Aridisoles de meseta y Fluventes en el Alto Valle fluvial",
      textura: "Limo-arenosa en terrazas de cultivo, pedregosa en meseta",
      drenaje: "Muy bueno a moderado en áreas sistematizadas",
      limitantes: "Erosión eólica constante, capas calcáreas (tosca) a poca profundidad en meseta",
      aptitud: "Líder nacional en Peras y Manzanas, Vid de clima frío, Alfalfa y Frutilla"
    },
    clima: {
      precipitaciones: "150 - 300 mm anuales (Clima muy seco de meseta)",
      temperatura: "Media anual de 12°C - 14°C (Altas temperaturas estivales con noches frescas)",
      heladas: "Prolongado período de heladas, sistemas activos de defensa en Alto Valle",
      deficit_hidrico: "Muy elevado (Cultivo dependiente de canales de riego derivados del Río Negro)",
      estacionalidad: "Árido-frío templado continental"
    },
    geografia: {
      relieve: "Cordillera andina al oeste, mesetas escalonadas y valles fluviales del Río Negro y Colorado",
      hidrografia: "Ríos Negro, Colorado y Limay, lagos cordilleranos",
      cobertura: "Estepas arbustivas xerófilas, bosques húmedos cordilleranos y valles agrícolas"
    }
  },
  "salta": {
    suelo: {
      tipo: "Aluviales profundos, Molisoles y Entisoles de valles de montaña",
      textura: "Franca a franco-arcillosa en áreas tabacaleras y cañeras",
      drenaje: "Bueno a moderado en valles, rápido en laderas con riesgo de aludes fluviales",
      limitantes: "Salinidad potencial en áreas llanas orientales de Chaco Salteño, erosión hídrica",
      aptitud: "Alta para Poroto (principal productor), Soja, Maíz, Citrus, Tabaco, Caña de azúcar y Vid (Cafayate)"
    },
    clima: {
      precipitaciones: "400 mm en la prepuna a >1500 mm en yungas (Lluvias monzónicas de verano)",
      temperatura: "Media de 18°C a 21°C con grandes variaciones altitudinales de temperatura",
      heladas: "Inexistentes en valles bajos protegidos, frecuentes en Cafayate y Puna alta",
      deficit_hidrico: "Fuerte déficit estacional durante el período invernal seco",
      estacionalidad: "Subtropical húmedo y de montaña con estación seca"
    },
    geografia: {
      relieve: "Complejo, con Puna árida, Valles Calchaquíes, Yungas boscosas y Llanura Chaqueña al este",
      hidrografia: "Río Bermejo, Pilcomayo, Juramento y río Calchaquí",
      cobertura: "Yungas, monte seco chaqueño, estepas andinas, y tierras de cultivo intensivo"
    }
  },
  "san juan": {
    suelo: {
      tipo: "Aridisoles y Entisoles de valles intermontanos",
      textura: "Franco-arenosa a pedregosa, baja retención de humedad",
      drenaje: "Excelente, óptimo para el desarrollo radicular de cultivos leñosos",
      limitantes: "Falta crítica de materia orgánica y nitrógeno natural, salinidad en bolsones",
      aptitud: "Excelente para Vid (pasas, vino, mesa), Olivo, Cebolla, Ajo e higos bajo riego"
    },
    clima: {
      precipitaciones: "80 - 150 mm anuales (Zonas más áridas del país)",
      temperatura: "Media anual de 16°C - 19°C (Vientos secos y cálidos muy frecuentes, Zonda)",
      heladas: "Heladas invernales normales y granizo veraniego esporádico",
      deficit_hidrico: "Crónico y absoluto todo el año (La agricultura vive del río San Juan)",
      estacionalidad: "Desértico y continental templado-cálido"
    },
    geografia: {
      relieve: "Sierras Pampeanas, Precordillera andina y valles áridos planos bajo cuenca de oasis",
      hidrografia: "Río San Juan y Jáchal (alimentados por glaciares y nieve de alta cumbre)",
      cobertura: "Estepa xerófila y oasis de cultivo intensivo de regadío"
    }
  },
  "san luis": {
    suelo: {
      tipo: "Molisoles arenosos y Entisoles (Suelos sueltos de llanuras templadas)",
      textura: "Franco-arenosa a arenosa con bajo contenido orgánico inicial",
      drenaje: "Muy rápido, excelente permeabilidad",
      limitantes: "Susceptibilidad severa a la erosión eólica, baja retención de agua de lluvia",
      aptitud: "Buena para Maíz, Soja, Sorgo, Trigo, Girasol y ganadería bovina extensiva"
    },
    clima: {
      precipitaciones: "500 - 700 mm anuales (Estacionales en primavera y verano)",
      temperatura: "Media anual de 16°C - 17°C",
      heladas: "Moderadas a intensas de Mayo a Septiembre",
      deficit_hidrico: "Marcado durante el invierno y principios de primavera",
      estacionalidad: "Templado subhúmedo a semiárido"
    },
    geografia: {
      relieve: "Sierras de San Luis al norte, llanura pampeana arenosa al sur y oeste",
      hidrografia: "Río Quinto, Río Conlara, cuencas de ríos de serranía aprovechados con diques",
      cobertura: "Pastizales de llanura, bosque nativo de Espinal (caldén) y campos agrícolas"
    }
  },
  "santa cruz": {
    suelo: {
      tipo: "Aridisoles y Entisoles de clima patagónico frío",
      textura: "Fina a pedregosa con abundante canto rodado",
      drenaje: "Generalmente excesivo",
      limitantes: "Bajas temperaturas del suelo todo el año, vientos desecantes severos",
      aptitud: "Producción forrajera patagónica (coirón, festucas), hortalizas bajo invernadero de protección"
    },
    clima: {
      precipitaciones: "150 mm (este) a 1000 mm (cumbres de la cordillera andina)",
      temperatura: "Media anual de 6°C - 8°C (Inviernos extremadamente crudos)",
      heladas: "Ocurrencia de heladas intensas durante los 12 meses del año",
      deficit_hidrico: "Elevado en la meseta central",
      estacionalidad: "Árido frío continental extremo"
    },
    geografia: {
      relieve: "Cordillera andina con campos de hielo continentales, meseta basáltica escalonada",
      hidrografia: "Ríos Santa Cruz, Deseado y Chico, lagos de origen glaciar gigantes (Argentino/Viedma)",
      cobertura: "Estepa patagónica rala arbustiva y estepas graminosas para ganadería ovina"
    }
  },
  "santa fe": {
    suelo: {
      tipo: "Argiudoles y Molisoles típicos (El núcleo agrícola de la Pampa húmeda)",
      textura: "Franco-limosa, excelente estabilidad de agregados y retención de humedad",
      drenaje: "Bueno a moderado, con llanuras aluviales anegables asociadas al Río Paraná al este",
      limitantes: "Erosión hídrica en zonas de lomas onduladas del sur, compactación de subsuelo",
      aptitud: "Aptitud de clase mundial para Soja, Maíz, Trigo, Girasol, Alfalfa, Sorgo y Arroz (norte)"
    },
    clima: {
      precipitaciones: "900 - 1100 mm anuales (Bien distribuidas, mayor peso en semestre cálido)",
      temperatura: "Media anual de 17°C (norte más cálido: 21°C)",
      heladas: "Moderadas en invierno en el sur, prácticamente inexistentes en el norte",
      deficit_hidrico: "Leve estival en años secos continentales",
      estacionalidad: "Templado pampeano húmedo (sur) a subtropical de transición (norte)"
    },
    geografia: {
      relieve: "Llanura pampeana sumamente plana al este de Argentina",
      hidrografia: "Río Paraná con su inmenso delta, río Salado del Norte e Carcarañá",
      cobertura: "Tierras de cultivo intensivo continuo, áreas de pasturas para producción lechera"
    }
  },
  "santiago del estero": {
    suelo: {
      tipo: "Haplustoles y Suelos arenosos de zonas semiáridas",
      textura: "Franca a arenosa, baja retención de agua general",
      drenaje: "Bueno a rápido en lomas arenosas, lento en valles bajos arcillosos",
      limitantes: "Salinidad potencial grave en bolsones, bajo nitrógeno, susceptibilidad de erosión",
      aptitud: "Alta para Soja y Maíz (bajo siembra directa), Algodón, Girasol, Sorgo y Ganadería caprina/bovina"
    },
    clima: {
      precipitaciones: "550 - 750 mm anuales (Fuertemente concentradas en meses de verano)",
      temperatura: "Media de 21°C - 22°C (El 'Impenetrable', veranos tórridos con marcas de 48°C)",
      heladas: "Heladas invernales suaves a moderadas",
      deficit_hidrico: "Severo y prolongado durante otoño, invierno y primavera",
      estacionalidad: "Subtropical continental con estación seca muy marcada"
    },
    geografia: {
      relieve: "Llanura aluvial muy chata con lagunas salinas bajas (Salinas Grandes)",
      hidrografia: "Ríos Dulce y Salado del Norte (Sistemas divagantes en la llanura)",
      cobertura: "Bosques nativos chaqueños xerófilos de quebracho/algarrobo y áreas de frontera agrícola"
    }
  },
  "tierra del fuego": {
    suelo: {
      tipo: "Histosoles (Turberas) y Spodosoles de zonas frías forestales",
      textura: "Orgánica en turberas, franca a franco-limosa en áreas boscosas",
      drenaje: "Deficiente en turberas y valles bajos, bueno en laderas boscosas",
      limitantes: "Suelos fríos, saturados de agua, descomposición orgánica sumamente lenta, acidez alta",
      aptitud: "Apto para Horticultura en invernadero (lechuga, frutilla), forrajeras adaptadas a frío extremo"
    },
    clima: {
      precipitaciones: "500 - 800 mm anuales (Constantes y en forma de nieve en invierno)",
      temperatura: "Media anual de 5°C - 6°C (Veranos de apenas 10°C)",
      heladas: "Riesgo de heladas severas durante todo el año, vientos polares del sudoeste",
      deficit_hidrico: "Nulo por baja tasa de evapotranspiración",
      estacionalidad: "Subpolar húmedo y frío extremo de isla austral"
    },
    geografia: {
      relieve: "Montañas andinas al sur (Ushuaia), llanuras bajas glaciarias al norte",
      hidrografia: "Río Grande, lagos glaciarios de gran tamaño (Fagnano) y Canal Beagle",
      cobertura: "Bosques caducifolios fríos (Lenga, Guindo), turbales y estepa de gramíneas al norte"
    }
  },
  "tucuman": {
    suelo: {
      tipo: "Aluviales de cuencas de montaña y Molisoles (Argiustoles muy fértiles)",
      textura: "Franco-limosa a franca con alta materia orgánica en el piedemonte",
      drenaje: "Moderado a bueno en valles agrícolas",
      limitantes: "Riesgo alto de erosión hídrica en pendientes de cultivo, compactación de suelo",
      aptitud: "Alta para Caña de azúcar (principal productor nacional), Limón (líder exportador), Arándano y Maíz"
    },
    clima: {
      precipitaciones: "800 - 1300 mm anuales (Régimen monzónico concentrado en verano)",
      temperatura: "Media de 19°C - 20°C con valles templados de microclimas húmedos",
      heladas: "Muy raras a leves en el llano de la cuenca cañera",
      deficit_hidrico: "Estacional marcado en invierno y principios de primavera",
      estacionalidad: "Subtropical húmedo con estación seca de invierno"
    },
    geografia: {
      relieve: "Complejo, con llanura oriental, Sierras del Aconquija (hasta 5500m) y piedemontes fértiles",
      hidrografia: "Río Salí (Río Dulce) y numerosos afluentes de deshielo y lluvias",
      cobertura: "Selva de Yungas nubosa en laderas y cultivos continuos e intensivos en el llano"
    }
  },
  // Fallback para provincias fuera del foco NEA
  "default": {
    suelo: {
      tipo: "Suelos regionales típicos (Molisoles / Aridisoles según zona)",
      textura: "Franca a franco-limosa en zonas agrícolas principales",
      drenaje: "Generalmente bueno a moderado",
      limitantes: "Erosión hídrica/eólica local, compactación por labranza",
      aptitud: "Cultivos anuales tradicionales (Trigo, Soja, Maíz, Girasol) o pasturas"
    },
    clima: {
      precipitaciones: "600 - 1000 mm anuales según la región",
      temperatura: "Media anual de 14°C - 18°C",
      heladas: "Riesgo moderado a alto según latitud",
      deficit_hidrico: "Estacional durante los meses de verano",
      estacionalidad: "Templado pampeano / Semiárido"
    },
    geografia: {
      relieve: "Llanuras o valles de producción agrícola",
      hidrografia: "Cuencas hídricas locales y sistemas de riego artificial en zonas áridas",
      cobertura: "Praderas, pasturas cultivadas y áreas agrícolas extensivas"
    }
  }
};

/* ============================================================================
   Base de Datos de Subregiones Agroecológicas de Alta Resolución (Fase A)
   ============================================================================ */

const subregionesDB = {
  "buenos aires": [
    {
      "id": "buenos_aires_norte",
      "nombre": "Buenos Aires Norte (Zona Núcleo)",
      "lat": -34.5,
      "lng": -60.5,
      "suelo": {
        "tipo": "Molisoles típicos (Argiudoles súper fértiles, clase I-II)",
        "textura": "Franca a franco-limosa con excelente retención de humedad y materia orgánica (>3%)",
        "drenaje": "Muy bueno, escurrimiento óptimo",
        "limitantes": "Bajo riesgo de erosión hídrica en pendientes suaves, compactación por tránsito pesado",
        "aptitud": "Máxima aptitud para Maíz, Soja de primera, Trigo y Cebada"
      },
      "clima": {
        "precipitaciones": "950 - 1100 mm anuales, excelente distribución estival",
        "temperatura": "Media anual de 16.5°C",
        "heladas": "Período libre de heladas amplio (octubre a abril)",
        "deficit_hidrico": "Leve e intermitente en enero",
        "estacionalidad": "Templado húmedo pampeano"
      },
      "geografia": {
        "relieve": "Ondulado suave, terrazas fluviales estables",
        "hidrografia": "Cuencas de los arroyos del norte, cercanía al Río Paraná"
      }
    },
    {
      "id": "buenos_aires_sur",
      "nombre": "Buenos Aires Sur (Zona Costera / Serrana)",
      "lat": -38.3,
      "lng": -61.5,
      "suelo": {
        "tipo": "Molisoles someros (Hapludoles y Argiustoles con tosca)",
        "textura": "Franco-arenosa a franco-limosa, menor retención hídrica",
        "drenaje": "Bueno a excesivo, limitado en profundidad por tosca caliza",
        "limitantes": "Tosca caliza subsuperficial (entre 40 y 80cm de profundidad), susceptibilidad a erosión eólica",
        "aptitud": "Excelente para Cebada cervecera, Trigo, Girasol y ganadería de cría"
      },
      "clima": {
        "precipitaciones": "750 - 850 mm anuales",
        "temperatura": "Media anual de 13.5°C (influencia oceánica y serrana fría)",
        "heladas": "Riesgo alto de heladas tardías (hasta noviembre) y tempranas",
        "deficit_hidrico": "Moderado durante verano",
        "estacionalidad": "Templado-frío subhúmedo"
      },
      "geografia": {
        "relieve": "Piedemonte de Ventania, llanuras con ondulación pronunciada y dunas dunas estabilizadas",
        "hidrografia": "Cuenca del Río Quequén Salado y arroyos serranos"
      }
    }
  ],
  "cordoba": [
    {
      "id": "cordoba_norte",
      "nombre": "Córdoba Centro-Norte",
      "lat": -31.3,
      "lng": -63.5,
      "suelo": {
        "tipo": "Molisoles y Haplustoles típicos",
        "textura": "Franca a franco-limosa con buena materia orgánica",
        "drenaje": "Moderado, propensión a escurrimiento rápido en laderas serranas",
        "limitantes": "Pérdida de estructura del suelo por monocultivo, erosión hídrica en lomadas",
        "aptitud": "Alta para Maíz de siembra tardía, Soja, Sorgo y pasturas cultivadas"
      },
      "clima": {
        "precipitaciones": "750 - 850 mm anuales (Estacionales de octubre a abril)",
        "temperatura": "Media anual de 17.5°C",
        "heladas": "Moderadas, riesgo concentrado de junio a agosto",
        "deficit_hidrico": "Marcado déficit invernal",
        "estacionalidad": "Templado subhúmedo con invierno seco"
      },
      "geografia": {
        "relieve": "Llanura suavemente ondulada, transición a piedemonte de Sierras Chicas",
        "hidrografia": "Cuencas de los ríos Primero (Suquía) y Segundo (Xanaes)"
      }
    },
    {
      "id": "cordoba_sur",
      "nombre": "Córdoba Sur (Zona Manicera)",
      "lat": -33.3,
      "lng": -64.3,
      "suelo": {
        "tipo": "Molisoles arenosos (Haplustoles énticos)",
        "textura": "Franca-arenosa, suelos muy sueltos y permeables",
        "drenaje": "Excelente a rápido",
        "limitantes": "Bajo contenido orgánico natural (<1.5%), altísima susceptibilidad a la erosión eólica",
        "aptitud": "Óptima para Maní (zona líder), Centeno de cobertura, Girasol y Maíz"
      },
      "clima": {
        "precipitaciones": "680 - 780 mm anuales (Gran variabilidad interanual)",
        "temperatura": "Media anual de 15.5°C",
        "heladas": "Riesgo alto de heladas primaverales tardías",
        "deficit_hidrico": "Frecuente en meses de primavera y verano tardío",
        "estacionalidad": "Templado semiárido pampeano"
      },
      "geografia": {
        "relieve": "Llanura eólica plana con médanos estabilizados y bajos temporarios",
        "hidrografia": "Cuenca del Río Quinto (Popopis) y lagunas salitrosas"
      }
    }
  ],
  "misiones": [
    {
      "id": "misiones_norte",
      "nombre": "Misiones Norte (Alto Paraná / Selva)",
      "lat": -26.1,
      "lng": -54.5,
      "suelo": {
        "tipo": "Lateríticos profundos (Oxisoles clase VI/VII)",
        "textura": "Arcillosa pesada pero porosa (arcillas de óxido de hierro)",
        "drenaje": "Muy rápido, alta conductividad hidráulica",
        "limitantes": "Pendientes pronunciadas, riesgo extremo de erosión hídrica tras desmonte",
        "aptitud": "Excelente para Pino Taeda, Araucaria, Silvicultura y Yerba Mate en curvas de nivel"
      },
      "clima": {
        "precipitaciones": "1900 - 2200 mm anuales (Distribución uniforme sin estación seca)",
        "temperatura": "Media de 21°C",
        "heladas": "Inexistentes a muy raras en laderas altas",
        "deficit_hidrico": "Nulo o inapreciable en condiciones normales",
        "estacionalidad": "Subtropical continuo muy húmedo"
      },
      "geografia": {
        "relieve": "Serrano ondulado con valles profundos y pendientes superiores al 10%",
        "hidrografia": "Tributarios directos del Río Paraná, saltos y cascadas constantes",
        "cobertura": "Parches de Selva Paranaense mixta con plantaciones forestales activas"
      }
    },
    {
      "id": "misiones_sur",
      "nombre": "Misiones Sur (Zona de Apóstoles / Campiña)",
      "lat": -27.8,
      "lng": -55.6,
      "suelo": {
        "tipo": "Lateríticos de lomadas bajas (Ultisoles con pedregosidad)",
        "textura": "Franco-arcillosa a pedregosa (presencia de piedra laja y areniscas)",
        "drenaje": "Bueno a moderado, con riesgo de encharcamiento en bajos planos",
        "limitantes": "Suelos más delgados y menos profundos que en el norte, pH muy ácido (4.5)",
        "aptitud": "Máxima aptitud para Yerba Mate tradicional, Té, Eucalyptus y pasturas subtropicales"
      },
      "clima": {
        "precipitaciones": "1600 - 1800 mm anuales",
        "temperatura": "Media de 19.5°C",
        "heladas": "Moderadas, con heladas anuales en zonas de cuenca baja de arroyos",
        "deficit_hidrico": "Leve estival en enero-febrero",
        "estacionalidad": "Subtropical húmedo con invierno templado"
      },
      "geografia": {
        "relieve": "Lomadas bajas y colinas redondeadas (Sierras de Apóstoles)",
        "hidrografia": "Cuenca tributaria del Río Uruguay",
        "cobertura": "Sabanas de pastizales naturales y montes de Yerba Mate"
      }
    }
  ],
  "mendoza": [
    {
      "id": "mendoza_uco",
      "nombre": "Mendoza (Valle de Uco)",
      "lat": -33.6,
      "lng": -69.1,
      "suelo": {
        "tipo": "Torrifluventes pedregosos calcáreos",
        "textura": "Franca a arenosa con alta proporción de cantos rodados de montaña",
        "drenaje": "Perfecto a excesivo (excelente escurrimiento radicular)",
        "limitantes": "Nula materia orgánica, suelos muy delgados y permeables",
        "aptitud": "Máxima calidad para Vid (Malbec de altura), Nogales y duraznos"
      },
      "clima": {
        "precipitaciones": "180 - 250 mm anuales",
        "temperatura": "Media anual de 14°C, altísima amplitud térmica (noches muy frías)",
        "heladas": "Frecuentes heladas primaverales tardías, alto riesgo de granizo",
        "deficit_hidrico": "Extremo, absoluta dependencia del riego de deshielo",
        "estacionalidad": "Árido templado-frío de altura"
      },
      "geografia": {
        "relieve": "Piedemonte de la Cordillera Frontal (altitud entre 900 y 1400 msnm)",
        "hidrografia": "Cuenca alta del Río Tunuyán"
      }
    },
    {
      "id": "mendoza_sur",
      "nombre": "Mendoza Sur (San Rafael / Alvear)",
      "lat": -34.6,
      "lng": -68.3,
      "suelo": {
        "tipo": "Aridisoles típicos y arenas aluvionales",
        "textura": "Arenosa a franco-arenosa, suelta y profunda",
        "drenaje": "Muy bueno, capas freáticas bajas",
        "limitantes": "Salinidad acumulada en zonas de bajo relieve con riego ineficiente",
        "aptitud": "Alta para Vid (Bonarda, Cabernet), Ciruela de secado, Olivo y Alfalfa"
      },
      "clima": {
        "precipitaciones": "150 - 200 mm anuales",
        "temperatura": "Media anual de 16°C",
        "heladas": "Heladas invernales prolongadas y tardías en primavera",
        "deficit_hidrico": "Crónico todo el año",
        "estacionalidad": "Desértico templado cálido"
      },
      "geografia": {
        "relieve": "Planicie aluvional de llanura desértica baja (800 msnm)",
        "hidrografia": "Cuencas de los ríos Atuel y Diamante"
      }
    }
  ],
  "corrientes": [
    {
      "id": "corrientes_norte",
      "nombre": "Corrientes Norte (Lomas Arenosas / Yerba y Té)",
      "lat": -27.8,
      "lng": -56.8,
      "suelo": {
        "tipo": "Spodosoles y Alfisoles (Lomas arenosas profundas)",
        "textura": "Arenosa con horizontes profundos bien drenados, pH ácido (5.0 - 5.5)",
        "drenaje": "Excelente en lomas, rápido escurrimiento hídrico",
        "limitantes": "Baja retención de nutrientes y materia orgánica en horizontes superficiales",
        "aptitud": "Alta para Yerba Mate, Té, Citrus, Pino Elliottii y Eucalyptus Grandis"
      },
      "clima": {
        "precipitaciones": "1400 - 1600 mm anuales, excelente humedad",
        "temperatura": "Media anual de 21.5°C",
        "heladas": "Ocurrencia muy baja y de corta duración",
        "deficit_hidrico": "Moderado durante veranos muy secos",
        "estacionalidad": "Subtropical húmedo sin estación seca marcada"
      },
      "geografia": {
        "relieve": "Lomas arenosas suaves alternadas con cañadas",
        "hidrografia": "Cercanía al Río Paraná y humedales del norte"
      }
    },
    {
      "id": "corrientes_sur_este",
      "nombre": "Corrientes Sur-Este (Arrocera / Malezales)",
      "lat": -29.2,
      "lng": -57.5,
      "suelo": {
        "tipo": "Alfisoles e Planosoles (Suelos hidromórficos de transición)",
        "textura": "Franco-arenosa superficial con un horizonte subsuperficial arcilloso muy pesado",
        "drenaje": "Pobre o imperfecto, propensión al estancamiento de agua",
        "limitantes": "Estrato arcilloso impermeable que genera anegamientos temporarios",
        "aptitud": "Excelente para el cultivo de Arroz bajo inundación controlada y ganadería"
      },
      "clima": {
        "precipitaciones": "1200 - 1350 mm anuales",
        "temperatura": "Media de 19.5°C",
        "heladas": "Moderadas de junio a agosto",
        "deficit_hidrico": "Poco frecuente debido a la retención de agua en el suelo",
        "estacionalidad": "Subtropical húmedo con invierno templado"
      },
      "geografia": {
        "relieve": "Plano-cóncavo, malezales y esteros",
        "hidrografia": "Cuenca del Río Aguapey y del Río Miriñay"
      }
    }
  ],
  "chaco": [
    {
      "id": "chaco_humedo",
      "nombre": "Chaco Este (Domo Central / Húmedo)",
      "lat": -26.8,
      "lng": -59.8,
      "suelo": {
        "tipo": "Molisoles y Vertisoles (Suelos arcillosos pesados y de alta fertilidad)",
        "textura": "Franca a arcillo-limosa con buena materia orgánica",
        "drenaje": "Lento a moderado, susceptible a anegamientos tras lluvias intensas",
        "limitantes": "Alta plasticidad del suelo arcilloso, compactación subsuperficial",
        "aptitud": "Alta para Algodón, Soja de primera, Sorgo y Maíz tardío"
      },
      "clima": {
        "precipitaciones": "1000 - 1150 mm anuales",
        "temperatura": "Media anual de 22°C",
        "heladas": "Raras y muy leves",
        "deficit_hidrico": "Leve en veranos extremos",
        "estacionalidad": "Subtropical húmedo con estación seca muy corta"
      },
      "geografia": {
        "relieve": "Llanura plana con albardones y suaves depresiones fluviales",
        "hidrografia": "Cuenca del Río Negro y afluentes del Río Paraná"
      }
    },
    {
      "id": "chaco_seco",
      "nombre": "Chaco Oeste (Impenetrable / Seco)",
      "lat": -25.8,
      "lng": -61.8,
      "suelo": {
        "tipo": "Entisoles e Inceptisoles (Suelos profundos aluviales)",
        "textura": "Franca a franco-arenosa, suelta, con baja materia orgánica",
        "drenaje": "Rápido a moderado",
        "limitantes": "Baja capacidad de retención de agua y susceptibilidad a la erosión eólica",
        "aptitud": "Apto para ganadería silvopastoril, Sorgo rústico, Algodón de secano y Girasol"
      },
      "clima": {
        "precipitaciones": "600 - 750 mm anuales, marcadamente estacionales de verano",
        "temperatura": "Media anual de 23.5°C con máximas superiores a 45°C",
        "heladas": "Ocasionales heladas invernales secas",
        "deficit_hidrico": "Severo durante otoño, invierno y primavera",
        "estacionalidad": "Subtropical semiárido con estación seca marcada de 6 meses"
      },
      "geografia": {
        "relieve": "Planicie eólica-aluvial muy plana con monte denso xerófilo",
        "hidrografia": "Sistemas fluviales intermitentes y cercanía al Río Bermejo"
      }
    }
  ],
  "formosa": [
    {
      "id": "formosa_este",
      "nombre": "Formosa Este (Subtropical Húmedo / Bananera)",
      "lat": -25.1,
      "lng": -58.2,
      "suelo": {
        "tipo": "Alfisoles y Entisoles fértiles de albardón",
        "textura": "Franco-arenosa a franca en albardones, limosa en valles bajos",
        "drenaje": "Moderado a bueno en las partes altas del relieve",
        "limitantes": "Saturación hídrica estacional en zonas bajas por desbordes",
        "aptitud": "Alta para Banana, Mandioca, Citrus, Caña de azúcar y Horticultura"
      },
      "clima": {
        "precipitaciones": "1100 - 1300 mm anuales",
        "temperatura": "Media de 23°C, veranos extremadamente calurosos",
        "heladas": "Inexistentes a sumamente excepcionales",
        "deficit_hidrico": "Prácticamente nulo en años promedio",
        "estacionalidad": "Subtropical húmedo sin estación seca"
      },
      "geografia": {
        "relieve": "Planicie aluvial de llanura baja con suaves elevaciones (albardones)",
        "hidrografia": "Río Paraguay y esteros asociados"
      }
    },
    {
      "id": "formosa_oeste",
      "nombre": "Formosa Oeste (Chaqueño Seco / Árido)",
      "lat": -24.3,
      "lng": -61.5,
      "suelo": {
        "tipo": "Entisoles y Aridisoles",
        "textura": "Arenoso-limosa, suelta, pobre en nutrientes",
        "drenaje": "Rápido a excesivo",
        "limitantes": "Baja fertilidad, propensión a salinización por riego ineficiente",
        "aptitud": "Ganadería caprina y bovina extensiva, Sorgo, pasturas megatérmicas"
      },
      "clima": {
        "precipitaciones": "550 - 700 mm anuales",
        "temperatura": "Media anual de 24°C",
        "heladas": "Leves heladas nocturnas en invierno",
        "deficit_hidrico": "Crónico y muy marcado la mayor parte del año",
        "estacionalidad": "Subtropical semiárido con estación seca prolongada"
      },
      "geografia": {
        "relieve": "Llanura sedimentaria plana con dunas fósiles estabilizadas",
        "hidrografia": "Cuencas secas temporales del Río Pilcomayo"
      }
    }
  ],
  "entre rios": [
    {
      "id": "entre_rios_lomadas",
      "nombre": "Entre Ríos (Lomadas y Cuchillas / Agrícola)",
      "lat": -32.1,
      "lng": -59.5,
      "suelo": {
        "tipo": "Vertisoles y Molisoles arcillosos de lomadas",
        "textura": "Arcillo-limosa, muy pesada, rica en nutrientes pero difícil de trabajar",
        "drenaje": "Lento, alta propensión a la escorrentía superficial en pendientes",
        "limitantes": "Peligro severo de erosión hídrica en laderas de cuchillas, baja labranza",
        "aptitud": "Muy alta para Trigo, Maíz, Soja de primera, Cebada y Girasol"
      },
      "clima": {
        "precipitaciones": "1100 - 1250 mm anuales",
        "temperatura": "Media anual de 18.5°C",
        "heladas": "Moderadas de junio a agosto",
        "deficit_hidrico": "Ocasional durante veranos de sequías severas",
        "estacionalidad": "Templado húmedo pampeano"
      },
      "geografia": {
        "relieve": "Colinas y lomadas suaves (Cuchilla Grande y Cuchilla de Montiel)",
        "hidrografia": "Densa red de ríos y arroyos, cuenca del Río Gualeguay"
      }
    },
    {
      "id": "entre_rios_citricola",
      "nombre": "Entre Ríos Norte (Zona Citrícola Costera)",
      "lat": -31.3,
      "lng": -58.1,
      "suelo": {
        "tipo": "Suelos arenosos de terrazas aluviales (Alfisoles / Entisoles)",
        "textura": "Franca-arenosa a arenosa profunda, muy bien drenada",
        "drenaje": "Muy bueno, sin horizontes arcillosos restrictivos en superficie",
        "limitantes": "Bajo contenido de arcilla y materia orgánica, requiere fertilización constante",
        "aptitud": "Máxima aptitud nacional para Citrus (Naranja, Mandarina) y Arándanos"
      },
      "clima": {
        "precipitaciones": "1200 - 1350 mm anuales",
        "temperatura": "Media anual de 19.5°C con inviernos atemperados por el Río Uruguay",
        "heladas": "Leves y poco frecuentes debido al efecto termorregulador del río",
        "deficit_hidrico": "Bajo",
        "estacionalidad": "Templado-cálido húmedo"
      },
      "geografia": {
        "relieve": "Terrazas aluviales estables y llanuras arenosas costeras",
        "hidrografia": "Cercanía inmediata al Embalse de Salto Grande y Río Uruguay"
      }
    }
  ],
  "santa fe": [
    {
      "id": "santa_fe_sur",
      "nombre": "Santa Fe Sur (Zona Núcleo Pampeana)",
      "lat": -33.2,
      "lng": -61.2,
      "suelo": {
        "tipo": "Molisoles típicos (Argiudoles súper fértiles)",
        "textura": "Franca a franco-limosa con alto contenido de materia orgánica",
        "drenaje": "Excelente a moderado",
        "limitantes": "Prácticamente nulas limitantes físicas, ocasional compactación superficial",
        "aptitud": "Máxima aptitud nacional para Maíz, Soja de primera, Trigo y legumbres"
      },
      "clima": {
        "precipitaciones": "950 - 1050 mm anuales, muy bien distribuidos en el ciclo",
        "temperatura": "Media anual de 16°C",
        "heladas": "Concentradas entre junio y agosto, sin heladas tardías extremas",
        "deficit_hidrico": "Leve y ocasional en veranos con fenómeno La Niña",
        "estacionalidad": "Templado húmedo pampeano"
      },
      "geografia": {
        "relieve": "Llanura plana con suaves ondulaciones estables",
        "hidrografia": "Cuencas de arroyos tributarios del Río Paraná"
      }
    },
    {
      "id": "santa_fe_norte",
      "nombre": "Santa Fe Norte (Bajos Submeridionales / Ganadero)",
      "lat": -29.2,
      "lng": -60.8,
      "suelo": {
        "tipo": "Vertisoles e Planosoles hidromórficos de llanura baja",
        "textura": "Arcillosa pesada a franco-limosa superficial con gleyzación profunda",
        "drenaje": "Muy pobre, anegamientos crónicos y estancamiento de aguas",
        "limitantes": "Salinidad y alcalinidad subsuperficial, impermeabilidad extrema",
        "aptitud": "Apto para ganadería vacuna de cría, pasturas tolerantes y Arroz"
      },
      "clima": {
        "precipitaciones": "900 - 1100 mm anuales",
        "temperatura": "Media anual de 21°C",
        "heladas": "Raras y sumamente suaves",
        "deficit_hidrico": "Variable, propenso a alternar inundaciones severas y sequías",
        "estacionalidad": "Subtropical húmedo con invierno seco"
      },
      "geografia": {
        "relieve": "Depresión tectónica plana-cóncava extremadamente baja (Bajos Submeridionales)",
        "hidrografia": "Cuenca del Río Salado del Norte y lagunas temporales"
      }
    }
  ],
  "ciudad autonoma de buenos aires": [
    {
      "id": "caba_urbana",
      "nombre": "CABA (Microemprendimientos Hidropónicos / Huertas)",
      "lat": -34.6,
      "lng": -58.4,
      "suelo": {
        "tipo": "Sustratos preparados y sistemas hidropónicos",
        "textura": "Sustratos de coco, perlita o turba controlada. No depende de suelo natural",
        "drenaje": "Perfectamente controlado mediante sistemas pluviales y de drenaje hidropónico",
        "limitantes": "Falta de espacio horizontal tradicional, costos de instalación iniciales",
        "aptitud": "Especialmente apto para Horticultura vertical, Microgreens, Lechuga, Tomate cherry"
      },
      "clima": {
        "precipitaciones": "1100 mm anuales",
        "temperatura": "Media de 18.2°C con fuerte efecto de isla de calor",
        "heladas": "Muy escasas y débiles por la protección del ejido urbano",
        "deficit_hidrico": "Nulo en sistemas hidropónicos con automatización de riego",
        "estacionalidad": "Templado húmedo costero"
      },
      "geografia": {
        "relieve": "Terreno urbano llano totalmente pavimentado con techos verdes",
        "hidrografia": "Costanera del Río de la Plata"
      }
    }
  ],
  "catamarca": [
    {
      "id": "catamarca_valles",
      "nombre": "Catamarca Valles (Oasis de Riego / Olivo)",
      "lat": -28.4,
      "lng": -65.8,
      "suelo": {
        "tipo": "Aridisoles y Entisoles aluvionales de valle",
        "textura": "Franca a franco-arenosa, profunda, de baja fertilidad natural",
        "drenaje": "Muy bueno, excelente filtración de agua",
        "limitantes": "Bajo contenido de materia orgánica (<0.5%) y escasez absoluta de agua natural",
        "aptitud": "Máxima calidad para Olivo, Vid, Nogal y Alfalfa bajo riego por goteo"
      },
      "clima": {
        "precipitaciones": "200 - 300 mm anuales, clima extremadamente seco",
        "temperatura": "Media anual de 20.5°C con alta radiación solar",
        "heladas": "Riesgo de heladas primaverales tardías en fondos de valles",
        "deficit_hidrico": "Extremo y constante todo el año",
        "estacionalidad": "Árido templado-cálido de valles"
      },
      "geografia": {
        "relieve": "Valle plano intermontano (Valle de Catamarca y Pomán)",
        "hidrografia": "Río del Valle y afluentes serranos canalizados"
      }
    }
  ],
  "chubut": [
    {
      "id": "chubut_valle",
      "nombre": "Chubut Valle Inferior (Fruta Fina / Alfalfa)",
      "lat": -43.3,
      "lng": -65.3,
      "suelo": {
        "tipo": "Suelos Aluviales y Fluvientes de valle plano",
        "textura": "Franco-limosa a arcillosa con horizontes salinos subsuperficiales",
        "drenaje": "Moderado a imperfecto, riesgo de salinización por ascenso freático",
        "limitantes": "Bajo nivel freático, salinidad y bajas temperaturas primaverales",
        "aptitud": "Excelente para Fruta Fina (Cereza, Frutilla, Frambuesa), Alfalfa y Vid Patagónica"
      },
      "clima": {
        "precipitaciones": "150 - 180 mm anuales, desierto absoluto de meseta",
        "temperatura": "Media anual de 12.5°C con fuertes vientos del oeste",
        "heladas": "Riesgo extremo durante 8 meses al año",
        "deficit_hidrico": "Crónico todo el año, riego obligatorio por canales de desvío",
        "estacionalidad": "Árido templado-frío patagónico"
      },
      "geografia": {
        "relieve": "Valle plano aluvial encajonado en la meseta patagónica",
        "hidrografia": "Cuenca inferior del Río Chubut"
      }
    }
  ],
  "jujuy": [
    {
      "id": "jujuy_valles",
      "nombre": "Jujuy Valles Bajos (Tabacalera / Azucarera)",
      "lat": -24.2,
      "lng": -65.2,
      "suelo": {
        "tipo": "Suelos Aluviales fértiles (Molisoles e Inceptisoles)",
        "textura": "Franca a franco-limosa, muy profunda y rica en sedimentos de montaña",
        "drenaje": "Bueno a moderado",
        "limitantes": "Ocasionales desbordes aluvionales en épocas de lluvias estivales",
        "aptitud": "Excelente para Caña de Azúcar, Tabaco, Cítricos, Maíz y Hortalizas"
      },
      "clima": {
        "precipitaciones": "850 - 1100 mm anuales, fuertemente concentradas en el verano",
        "temperatura": "Media anual de 19.8°C con primaveras cálidas y secas",
        "heladas": "Muy raras, leves y confinadas a zonas bajas",
        "deficit_hidrico": "Marcado durante el invierno y primavera",
        "estacionalidad": "Subtropical con estación seca"
      },
      "geografia": {
        "relieve": "Valles planos de sedimentación y terrazas fluviales estables",
        "hidrografia": "Río Grande de Jujuy y Río San Francisco"
      }
    }
  ],
  "la pampa": [
    {
      "id": "la_pampa_este",
      "nombre": "La Pampa Este (Zona Agrícola semiárida)",
      "lat": -36.5,
      "lng": -64.1,
      "suelo": {
        "tipo": "Molisoles (Haplustoles énticos)",
        "textura": "Franco-arenosa, muy suelta, propensa a la degradación",
        "drenaje": "Rápido a excelente",
        "limitantes": "Tosca caliza subsuperficial a profundidades variables (40 - 100cm)",
        "aptitud": "Buena para Trigo, Girasol, Maíz de siembra tardía y Centeno de cobertura"
      },
      "clima": {
        "precipitaciones": "650 - 750 mm anuales con gran variabilidad interanual",
        "temperatura": "Media anual de 15°C",
        "heladas": "Moderadas a severas de mayo a septiembre",
        "deficit_hidrico": "Frecuente en primavera y verano tardío",
        "estacionalidad": "Templado subhúmedo-semiárido"
      },
      "geografia": {
        "relieve": "Llanura pampeana plana con médanos fósiles estabilizados",
        "hidrografia": "Nula red de drenaje fluvial superficial permanente"
      }
    }
  ],
  "la rioja": [
    {
      "id": "la_rioja_chilecito",
      "nombre": "La Rioja (Chilecito / Oasis de Riego)",
      "lat": -29.1,
      "lng": -67.5,
      "suelo": {
        "tipo": "Aridisoles y Entisoles pedregosos",
        "textura": "Franca a arenoso-pedregosa con cantos rodados, permeable",
        "drenaje": "Perfecto a rápido",
        "limitantes": "Casi nula materia orgánica (<0.3%) y salinidad potencial en bajos",
        "aptitud": "Máxima aptitud para Vid (Torrontés Riojano), Olivo y Nogal"
      },
      "clima": {
        "precipitaciones": "120 - 180 mm anuales, clima sumamente árido",
        "temperatura": "Media anual de 19°C con enorme radiación y baja nubosidad",
        "heladas": "Concentradas en invierno, heladas tardías de primavera son un riesgo constante",
        "deficit_hidrico": "Extremo, absoluta dependencia del agua de pozos y deshielo de montaña",
        "estacionalidad": "Continental desértico árido de sierras"
      },
      "geografia": {
        "relieve": "Valle intermontano amplio entre la Sierra de Famatina y Velasco",
        "hidrografia": "Ríos temporarios de montaña captados para riego presurizado"
      }
    }
  ],
  "neuquen": [
    {
      "id": "neuquen_alto_valle",
      "nombre": "Neuquén (Alto Valle / Frutícola)",
      "lat": -38.9,
      "lng": -68.1,
      "suelo": {
        "tipo": "Torrifluventes y Aridisoles aluvionales fértiles",
        "textura": "Franca a franco-limosa en el valle, arenosa en terrazas",
        "drenaje": "Bueno a moderado, con capas freáticas controladas por drenes",
        "limitantes": "Compactación subsuperficial y horizontes con acumulación de sales",
        "aptitud": "Máxima aptitud nacional para Manzana, Pera, Durazno y Vid fría"
      },
      "clima": {
        "precipitaciones": "150 mm anuales",
        "temperatura": "Media anual de 14.5°C con otoños templados y fríos primaverales",
        "heladas": "Altamente peligrosas en primavera durante la floración",
        "deficit_hidrico": "Crónico permanente, riego sistematizado por goteo o inundación",
        "estacionalidad": "Árido templado-frío patagónico"
      },
      "geografia": {
        "relieve": "Valle plano delimitado por bardas escarpadas de meseta",
        "hidrografia": "Cuenca inferior del Río Neuquén y Río Limay"
      }
    }
  ],
  "rio negro": [
    {
      "id": "rio_negro_valle_medio",
      "nombre": "Río Negro (Valle Medio / Fruta y Tomate)",
      "lat": -39.3,
      "lng": -65.6,
      "suelo": {
        "tipo": "Fluventes y Aridisoles de terraza de río",
        "textura": "Franco-arcillosa a franco-limosa con buena materia orgánica aluvial",
        "drenaje": "Bueno",
        "limitantes": "Salinidad potencial en áreas con deficiente sistema de drenaje pluvial",
        "aptitud": "Excelente para Manzana, Pera, Frutos Secos (Almendra, Avellana) y Tomate"
      },
      "clima": {
        "precipitaciones": "180 mm anuales",
        "temperatura": "Media anual de 13.8°C",
        "heladas": "Fuertes heladas invernales y primaverales",
        "deficit_hidrico": "Absoluto, subsanado al 100% por red de riego de canales",
        "estacionalidad": "Templado-frío árido continental"
      },
      "geografia": {
        "relieve": "Valle fluvial amplio con islas fluviales estables",
        "hidrografia": "Río Negro, excelente caudal de agua de deshielo"
      }
    }
  ],
  "salta": [
    {
      "id": "salta_valle_lerma",
      "nombre": "Salta (Valle de Lerma / Tabaco)",
      "lat": -24.9,
      "lng": -65.5,
      "suelo": {
        "tipo": "Molisoles e Inceptisoles (Suelos limosos de gran fertilidad)",
        "textura": "Franca a franco-limosa, muy homogénea",
        "drenaje": "Muy bueno, sin horizontes arcillosos pesados",
        "limitantes": "Compactación superficial por labranza intensa de tabaco",
        "aptitud": "Excelente para Tabaco, Poroto negro, Cítricos, Maíz y Soja"
      },
      "clima": {
        "precipitaciones": "700 - 850 mm anuales, concentradas en meses de verano",
        "temperatura": "Media anual de 16.5°C con primaveras secas y templadas",
        "heladas": "Ocurrencia de heladas invernales de mediana intensidad",
        "deficit_hidrico": "Marcado déficit en el invierno y primavera",
        "estacionalidad": "Templado-cálido subtropical de montaña"
      },
      "geografia": {
        "relieve": "Valle intermontano amplio (1200 msnm) rodeado por sierras de transición",
        "hidrografia": "Río Arenales y cuenca del Embalse Cabra Corral"
      }
    }
  ],
  "san juan": [
    {
      "id": "san_juan_tulum",
      "nombre": "San Juan (Valle del Tulum / Vid y Olivo)",
      "lat": -31.5,
      "lng": -68.5,
      "suelo": {
        "tipo": "Torrifluventes arenosos y pedregosos",
        "textura": "Arenosa a franca-pedregosa de profundidad ilimitada",
        "drenaje": "Excelente a excesivo",
        "limitantes": "Bajo nitrógeno natural, nula materia orgánica (<0.2%) y salinidad en bajos",
        "aptitud": "Excelente para Vid (Uva de mesa, pasas y vinificación), Olivo y Cebolla"
      },
      "clima": {
        "precipitaciones": "90 - 120 mm anuales, sol absoluto",
        "temperatura": "Media anual de 17.5°C con vientos Zonda fuertes y cálidos",
        "heladas": "Moderadas en invierno, raras heladas tardías de primavera",
        "deficit_hidrico": "Extremo durante todo el año, riego presurizado de goteo obligatorio",
        "estacionalidad": "Desértico continental seco templado-cálido"
      },
      "geografia": {
        "relieve": "Valle plano sedimentario cercado por precordillera andina",
        "hidrografia": "Cuenca inferior del Río San Juan"
      }
    }
  ],
  "san luis": [
    {
      "id": "san_luis_villa_mercedes",
      "nombre": "San Luis (Domo Oriental / Maíz y Girasol)",
      "lat": -33.6,
      "lng": -65.4,
      "suelo": {
        "tipo": "Molisoles arenosos (Haplustoles)",
        "textura": "Franco-arenosa, suelta, muy permeable",
        "drenaje": "Bueno a rápido",
        "limitantes": "Alta susceptibilidad a la erosión eólica, baja retención de agua",
        "aptitud": "Alta para Maíz de siembra tardía, Soja de segunda, Girasol y pasturas alfalfa"
      },
      "clima": {
        "precipitaciones": "600 - 700 mm anuales con lluvias estivales estacionales",
        "temperatura": "Media de 16.2°C con inviernos fríos",
        "heladas": "Ocurrencia frecuente de heladas severas de mayo a septiembre",
        "deficit_hidrico": "Moderado a alto fuera de la temporada estival",
        "estacionalidad": "Templado-semiárido pampeano"
      },
      "geografia": {
        "relieve": "Llanura arenosa con médanos planos estabilizados",
        "hidrografia": "Cercanía al Río Quinto"
      }
    }
  ],
  "santa cruz": [
    {
      "id": "santa_cruz_invernaderos",
      "nombre": "Santa Cruz (Horticultura en Invernadero / Forraje)",
      "lat": -51.6,
      "lng": -69.2,
      "suelo": {
        "tipo": "Suelos de turba costeros y fluviales",
        "textura": "Variable, predominantemente pedregosa a orgánica en valles protegidos",
        "drenaje": "Deficiente en bajos costeros, rápido en mesetas",
        "limitantes": "Temperaturas del suelo extremadamente frías todo el año, vientos de más de 100 km/h",
        "aptitud": "Horticultura en túneles (Lechuga, Espinaca, Frutilla), Alfalfa patagónica"
      },
      "clima": {
        "precipitaciones": "200 - 300 mm anuales",
        "temperatura": "Media anual de 7.5°C con inviernos nival severos",
        "heladas": "Riesgo de heladas durante todos los meses del año",
        "deficit_hidrico": "Alto en la meseta central",
        "estacionalidad": "Templado-frío subpolar continental"
      },
      "geografia": {
        "relieve": "Mesetas escalonadas y llanuras costeras expuestas a vientos",
        "hidrografia": "Río Gallegos y Río Santa Cruz"
      }
    }
  ],
  "santiago del estero": [
    {
      "id": "santiago_riego",
      "nombre": "Santiago del Estero (Valle de Riego / Algodón)",
      "lat": -27.8,
      "lng": -64.2,
      "suelo": {
        "tipo": "Haplustoles y Entisoles aluvionales limosos",
        "textura": "Franca a franco-limosa con alta retención de humedad",
        "drenaje": "Moderado a bueno",
        "limitantes": "Peligro severo de salinización de suelos por mal drenaje de riego",
        "aptitud": "Alta para Algodón, Soja de primera, Maíz tardío, Alfalfa y Zapallo"
      },
      "clima": {
        "precipitaciones": "550 - 650 mm anuales, fuertemente estivales",
        "temperatura": "Media anual de 21.8°C con veranos de temperaturas extremas (>45°C)",
        "heladas": "Raras, leves e invernales",
        "deficit_hidrico": "Crónico la mayor parte de las estaciones de primavera e invierno",
        "estacionalidad": "Subtropical semiárido con estación seca invernal"
      },
      "geografia": {
        "relieve": "Valle fluvial ancho y plano rodeado de llanura chaqueña",
        "hidrografia": "Río Dulce y Río Salado del Norte canalizados para regadío"
      }
    }
  ],
  "tierra del fuego": [
    {
      "id": "tierra_del_fuego_sur",
      "nombre": "Tierra del Fuego (Zonas Costeras Protegidas / Forraje)",
      "lat": -54.8,
      "lng": -68.3,
      "suelo": {
        "tipo": "Turberas e Histosoles orgánicos ácidos",
        "textura": "Altamente orgánica, retentiva pero fría, pH ácido (4.0 - 4.8)",
        "drenaje": "Muy lento a pobre en las llanuras, rápido en pendientes",
        "limitantes": "Frío extremo que ralentiza la mineralización, acidez excesiva",
        "aptitud": "Horticultura protegida en invernaderos, pasturas frías (Lolium, Dactylis)"
      },
      "clima": {
        "precipitaciones": "550 - 650 mm anuales distribuidos uniformemente",
        "temperatura": "Media de 5.5°C, veranos extremadamente frescos (máxima media de 12°C)",
        "heladas": "Riesgo absoluto de heladas y nevadas durante todo el año",
        "deficit_hidrico": "Muy bajo o nulo",
        "estacionalidad": "Frío húmedo subantártico"
      },
      "geografia": {
        "relieve": "Valles andinos australes y costas protegidas de canales",
        "hidrografia": "Arroyos de deshielo, Canal Beagle y turberas extensas"
      }
    }
  ],
  "tucuman": [
    {
      "id": "tucuman_pedemonte",
      "nombre": "Tucumán Pedemonte (Zona Citrícola / Limón)",
      "lat": -26.9,
      "lng": -65.4,
      "suelo": {
        "tipo": "Molisoles profundos y fértiles (Argiudoles y Hapludoles)",
        "textura": "Franca a franco-limosa con excelente contenido de materia orgánica (>2.5%)",
        "drenaje": "Bueno, sin horizontes arcillosos impermeables",
        "limitantes": "Erosión hídrica en zonas con pendientes pronunciadas no protegidas",
        "aptitud": "Máxima aptitud nacional e internacional para Limón y Cítricos"
      },
      "clima": {
        "precipitaciones": "900 - 1200 mm anuales",
        "temperatura": "Media anual de 19°C con veranos cálidos e inviernos atemperados",
        "heladas": "Prácticamente nulas debido a corrientes ascendentes de aire cálido",
        "deficit_hidrico": "Leve e invernal, mitigado por alta nubosidad",
        "estacionalidad": "Subtropical húmedo con estación seca corta"
      },
      "geografia": {
        "relieve": "Piedemonte con colinas y llanuras inclinadas hacia el este",
        "hidrografia": "Río Lules, Río Salí y numerosos afluentes serranos"
      }
    }
  ]
};

/* ============================================================================
   Lógica del Mapa Base (Fase 1)
   ============================================================================ */

let mapInstance = null;
let currentMarker = null;
let subregionesLayers = [];

// Variables para el Simulador de Lote
let simuladorValoresPersonalizados = null;


/**
 * Inicializa el mapa interactivo de Leaflet
 */
function inicializarMapa(provinciaRaw) {
  const mapElement = document.getElementById("map");
  if (!mapElement) return;

  // Centro por defecto: Argentina (Rosario/Córdoba aprox)
  let defaultLat = -38.4161;
  let defaultLng = -63.6167;
  let defaultZoom = 4;

  const key = normalizeKey(provinciaRaw);
  if (provinciaCoordenadas[key]) {
    defaultLat = provinciaCoordenadas[key].lat;
    defaultLng = provinciaCoordenadas[key].lng;
    defaultZoom = provinciaCoordenadas[key].zoom;
  }

  // Crear la instancia de mapa
  mapInstance = L.map('map').setView([defaultLat, defaultLng], defaultZoom);

  // Agregar capa base de OpenStreetMap
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
  }).addTo(mapInstance);

  // Si hay una provincia seleccionada, colocar un marcador inicial
  if (provinciaCoordenadas[key]) {
    colocarMarcador(defaultLat, defaultLng, provinciaRaw);
    dibujarSubregionesColoreadas(key);
  }

  // Evento de Click en el mapa
  mapInstance.on('click', (e) => {
    const { lat, lng } = e.latlng;
    procesarSeleccionCoordenadas(lat, lng);
  });

  // Inicializar geolocalización
  const btnGeo = document.getElementById("btn-geolocalizar");
  if (btnGeo) {
    btnGeo.addEventListener("click", usarGeolocalizacion);
  }
}

/**
 * Coloca o mueve el marcador en el mapa
 */

/**
 * Dibuja circulos interactivos para cada subregion de la provincia seleccionada,
 * coloreandolos segun su aptitud predominante.
 */
function dibujarSubregionesColoreadas(provinciaKey) {
  if (!mapInstance) return;

  // Limpiar capas anteriores
  subregionesLayers.forEach(layer => mapInstance.removeLayer(layer));
  subregionesLayers = [];

  const subregiones = subregionesDB[provinciaKey];
  if (!subregiones) return;

  subregiones.forEach(sub => {
    const aptitud = (sub.suelo.aptitud || '').toLowerCase();

    // Determinar color en base a aptitud predominante
    let color = '#3498db'; // Azul por defecto (Riego/Vid/General)
    if (aptitud.includes('pino') || aptitud.includes('eucalyptus') || aptitud.includes('silvicultura') || aptitud.includes('forestal')) {
      color = '#2ecc71'; // Verde para forestal
    } else if (aptitud.includes('soja') || aptitud.includes('maiz') || aptitud.includes('trigo') || aptitud.includes('cebada') || aptitud.includes('sorgo')) {
      color = '#f1c40f'; // Amarillo para pampeano/cereales
    } else if (aptitud.includes('citrus') || aptitud.includes('limon') || aptitud.includes('naranja') || aptitud.includes('banana')) {
      color = '#e67e22'; // Naranja para citricos y frutales subtropicales
    } else if (aptitud.includes('vid') || aptitud.includes('olivo') || aptitud.includes('nogal')) {
      color = '#9b59b6'; // Purpura para vides y olivos de oasis
    } else if (aptitud.includes('horticultura') || aptitud.includes('lechuga') || aptitud.includes('huertas')) {
      color = '#1abc9c'; // Turquesa para horticultura urbana/protegida
    }

    // Dibujar circulo interactivo
    const circle = L.circle([sub.lat, sub.lng], {
      color: color,
      fillColor: color,
      fillOpacity: 0.5,
      radius: 35000 // Radio de 35 km para ser bien visible
    }).addTo(mapInstance);

    // Popup detallado al hacer click en el circulo
    circle.bindPopup(`
      <div style="font-family: Arial, sans-serif; font-size: 0.9rem;">
        <strong style="color: ${color}; font-size: 1rem;">${sub.nombre}</strong><br>
        <strong>Aptitud:</strong> ${sub.suelo.aptitud}<br>
        <strong>Suelo:</strong> ${sub.suelo.tipo} (${sub.suelo.textura})<br>
        <span style="font-size: 0.8rem; color: #7f8c8d;">Haz click aqui para seleccionar esta subregion</span>
      </div>
    `);

    // Al hacer click sobre la subregion, procesar coordenadas
    circle.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      procesarSeleccionCoordenadas(sub.lat, sub.lng);
    });

    subregionesLayers.push(circle);
  });
}

function colocarMarcador(lat, lng, titulo) {
  if (!mapInstance) return;

  if (currentMarker) {
    currentMarker.setLatLng([lat, lng]);
  } else {
    currentMarker = L.marker([lat, lng], { draggable: false }).addTo(mapInstance);
  }

  if (titulo) {
    currentMarker.bindPopup(`<b>${titulo}</b><br>Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`).openPopup();
  }
}

/**
 * Busca a qué provincia corresponde un par de coordenadas (geocodificación inversa local robusta)
 */
function buscarProvinciaPorCoordenadas(lat, lng) {
  // Encontramos la provincia cuya coordenada de referencia sea la más cercana usando distancia euclidiana simplificada
  let provinciaCercana = null;
  let distanciaMinima = Infinity;

  for (const [prov, coord] of Object.entries(provinciaCoordenadas)) {
    const d = Math.pow(lat - coord.lat, 2) + Math.pow(lng - coord.lng, 2);
    if (d < distanciaMinima) {
      distanciaMinima = d;
      provinciaCercana = prov;
    }
  }

  // Si la distancia mínima es ridículamente grande, podría ser fuera de Argentina, pero para propósitos locales asumimos la más cercana
  return provinciaCercana;
}

/**
 * Procesa la selección de coordenadas (ya sea por click o geolocalización)
 */
function procesarSeleccionCoordenadas(lat, lng) {
  const provinciaKey = buscarProvinciaPorCoordenadas(lat, lng);
  if (!provinciaKey) return;

  // Encontrar el nombre de provincia bonito
  const nombreProvinciaBonito = provinciaKey.split(" ")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  colocarMarcador(lat, lng, nombreProvinciaBonito);

  // Actualizar la vista de recomendaciones de cultivos con coordenadas de alta resolución (Fase A)
  renderRecomendaciones(nombreProvinciaBonito, lat, lng);
  dibujarSubregionesColoreadas(provinciaKey);

  // Mostrar información territorial básica en el panel lateral (Fase 1)
  actualizarPanelTerritorialBasico(nombreProvinciaBonito, lat, lng);
}

/**
 * Obtiene la subregión agroecológica más cercana en base a coordenadas si existe
 */
function buscarSubregion(provinciaKey, lat, lng) {
  const subregiones = subregionesDB[provinciaKey];
  if (!subregiones || subregiones.length === 0) return null;

  let subregionMasCercana = null;
  let distMin = Infinity;

  for (const sub of subregiones) {
    const d = Math.pow(lat - sub.lat, 2) + Math.pow(lng - sub.lng, 2);
    if (d < distMin) {
      distMin = d;
      subregionMasCercana = sub;
    }
  }

  // Consideramos subregión válida si está a una distancia prudente (p.ej. < 3 grados de lat/lng)
  return distMin < 9 ? subregionMasCercana : null;
}

/**
 * Consulta la API de Open-Meteo en vivo para una coordenada dada de forma asíncrona
 */
async function consultarClimaEnVivo(lat, lng) {
  const container = document.getElementById("live-weather-info");
  if (!container) return;

  container.innerHTML = `
    <div style="font-size: 0.85rem; color: var(--texto-secundario); padding: 10px; text-align: center;">
      <span class="spinner" style="display: inline-block; animation: spin 1s linear infinite; margin-right: 5px;">⏳</span> Cargando clima en vivo...
    </div>
  `;

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true&relative_humidity_2m=true`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Error de respuesta de red");
    const data = await res.json();

    if (data && data.current_weather) {
      const temp = data.current_weather.temperature;
      const wind = data.current_weather.windspeed;
      const code = data.current_weather.weathercode;

      // Mapeo simple de códigos de clima de Open-Meteo
      let descClima = "Despejado / Estable";
      if (code >= 1 && code <= 3) descClima = "Parcialmente nublado";
      if (code >= 45 && code <= 48) descClima = "Niebla / Neblina";
      if (code >= 51 && code <= 67) descClima = "Llovizna / Lluvia ligera";
      if (code >= 71 && code <= 77) descClima = "Nieve / Escarcha";
      if (code >= 80 && code <= 82) descClima = "Chubascos de lluvia";
      if (code >= 95) descClima = "Tormenta eléctrica potencial";

      let warningHtml = "";
      if (temp <= 3) {
        warningHtml = `
          <div style="margin-top: 8px; padding: 6px; background: rgba(198, 40, 40, 0.1); border: 1px solid #c62828; border-radius: 6px; font-size: 0.8rem; color: #c62828;">
            ⚠️ <strong>Alerta de Helada en Vivo:</strong> Temperatura actual de ${temp}°C. Proteger cultivos sensibles.
          </div>
        `;
      } else if (temp >= 38) {
        warningHtml = `
          <div style="margin-top: 8px; padding: 6px; background: rgba(239, 108, 0, 0.1); border: 1px solid #ef6c00; border-radius: 6px; font-size: 0.8rem; color: #ef6c00;">
            ⚠️ <strong>Alerta de Golpe de Calor:</strong> Temperatura extrema de ${temp}°C. Monitorear estrés hídrico.
          </div>
        `;
      }

      container.innerHTML = `
        <div style="background: rgba(0,0,0,0.03); border: 1px solid var(--borde-suave); border-radius: 8px; padding: 10px; margin-top: 5px;">
          <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 4px;">
            <span>🌡️ <strong>Temp. Actual:</strong></span>
            <span>${temp}°C</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 4px;">
            <span>💨 <strong>Viento:</strong></span>
            <span>${wind} km/h</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
            <span>🌤️ <strong>Condición:</strong></span>
            <span>${descClima}</span>
          </div>
          ${warningHtml}
        </div>
      `;
    } else {
      throw new Error("Formato de datos inválido");
    }
  } catch (err) {
    container.innerHTML = `
      <div style="font-size: 0.8rem; color: #c62828; padding: 6px; text-align: center;">
        ❌ No se pudo conectar con el servicio meteorológico en vivo.
      </div>
    `;
  }
}

/**
 * Actualiza el panel lateral con datos básicos de coordenadas y datos agroambientales integrados (Fase 2 + Fase A Subregiones)
 */
function actualizarPanelTerritorialBasico(provincia, lat, lng) {
  const detailsContainer = document.getElementById("territory-details");
  if (!detailsContainer) return;

  const key = normalizeKey(provincia);

  // Buscar si hay subregión agroecológica más específica para esta coordenada
  const subregion = buscarSubregion(key, lat, lng);

  let agroInfo = null;
  let nombreTerritorio = provincia;

  if (subregion) {
    agroInfo = subregion;
    nombreTerritorio = `${provincia} (${subregion.nombre})`;
  } else {
    agroInfo = agroambientalesDB[key] || agroambientalesDB["default"];
  }

  detailsContainer.innerHTML = `
    <div class="info-item">
      <strong>📍 Ubicación Seleccionada</strong>
      <span style="font-weight: 600; color: var(--verde-principal);">${nombreTerritorio}</span>
      <span style="font-size: 0.8rem; display: block; color: var(--texto-secundario);">(Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)})</span>
    </div>

    <!-- Clima en Vivo (Fase B) -->
    <div class="info-section-title" style="margin: 12px 0 5px 0; font-weight: bold; border-bottom: 1px solid var(--borde-suave); padding-bottom: 3px; color: var(--verde-principal); font-size: 0.95rem;">
      ⚡ Clima en Vivo (Open-Meteo)
    </div>
    <div id="live-weather-info">
      <!-- Cargado asincrónicamente -->
    </div>

    <div class="info-section-title" style="margin: 15px 0 5px 0; font-weight: bold; border-bottom: 1px solid var(--borde-suave); padding-bottom: 3px; color: var(--verde-principal); font-size: 0.95rem;">
      🌱 Propiedades del Suelo (INTA)
    </div>
    <div class="info-item">
      <strong>Tipo y Clasificación:</strong>
      <span>${agroInfo.suelo.tipo}</span>
    </div>
    <div class="info-item">
      <strong>Textura Predominante:</strong>
      <span>${agroInfo.suelo.textura}</span>
    </div>
    <div class="info-item">
      <strong>Drenaje / Escurrimiento:</strong>
      <span>${agroInfo.suelo.drenaje}</span>
    </div>
    <div class="info-item">
      <strong>Limitantes Edáficas:</strong>
      <span>${agroInfo.suelo.limitantes}</span>
    </div>
    <div class="info-item">
      <strong>Aptitud Productiva:</strong>
      <span>${agroInfo.suelo.aptitud}</span>
    </div>

    <div class="info-section-title" style="margin: 15px 0 5px 0; font-weight: bold; border-bottom: 1px solid var(--borde-suave); padding-bottom: 3px; color: var(--verde-principal); font-size: 0.95rem;">
      🌦️ Datos Climáticos (SMN / Regional)
    </div>
    <div class="info-item">
      <strong>Precipitaciones Medias:</strong>
      <span>${agroInfo.clima.precipitaciones}</span>
    </div>
    <div class="info-item">
      <strong>Temperatura Media:</strong>
      <span>${agroInfo.clima.temperatura}</span>
    </div>
    <div class="info-item">
      <strong>Riesgo de Heladas:</strong>
      <span>${agroInfo.clima.heladas}</span>
    </div>
    <div class="info-item">
      <strong>Déficit Hídrico:</strong>
      <span>${agroInfo.clima.deficit_hidrico}</span>
    </div>

    <div class="info-section-title" style="margin: 15px 0 5px 0; font-weight: bold; border-bottom: 1px solid var(--borde-suave); padding-bottom: 3px; color: var(--verde-principal); font-size: 0.95rem;">
      🗺️ Geografía y Relieve (IGN)
    </div>
    <div class="info-item">
      <strong>Relieve y Topografía:</strong>
      <span>${agroInfo.geografia?.relieve || "Ondulado suave"}</span>
    </div>
    <div class="info-item">
      <strong>Hidrografía y Cuencas:</strong>
      <span>${agroInfo.geografia?.hidrografia || "Arroyos y ríos locales"}</span>
    </div>
  `;

  // Disparar la consulta del clima en vivo
  consultarClimaEnVivo(lat, lng);
}

/**
 * Usa el API de Geolocalización del Navegador
 */
function usarGeolocalizacion() {
  if (!navigator.geolocation) {
    alert("La geolocalización no está soportada por tu navegador.");
    return;
  }

  const btnGeo = document.getElementById("btn-geolocalizar");
  if (btnGeo) {
    btnGeo.disabled = true;
    btnGeo.innerText = "📍 Buscando ubicación...";
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;

      if (mapInstance) {
        mapInstance.setView([latitude, longitude], 9);
      }
      procesarSeleccionCoordenadas(latitude, longitude);

      if (btnGeo) {
        btnGeo.disabled = false;
        btnGeo.innerText = "📍 Usar mi Geolocalización";
      }
    },
    (error) => {
      alert("No se pudo obtener la geolocalización. Asegúrate de otorgar permisos.");
      if (btnGeo) {
        btnGeo.disabled = false;
        btnGeo.innerText = "📍 Usar mi Geolocalización";
      }
    },
    { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
  );
}

/* ============================================================================
   Lógica de Negocio & Motor de Recomendación Territorial (Fase 3)
   ============================================================================ */

/**
 * Entrega una rotación de cultivo sugerida y prácticas sostenibles para el suelo
 */
function obtenerPracticasSostenibles(cultivoKey, provinciaKey) {
  const rotaciones = {
    "soja": {
      rotacion: "Rotar con Maíz o Trigo/Soja de segunda para evitar el monocultivo y fijar nitrógeno.",
      manejo: "Siembra Directa estricta para mitigar erosión hídrica, y cultivos de cobertura invernales (como Vicia)."
    },
    "maiz": {
      rotacion: "Rotar con Soja o Leguminosas. El rastrojo de maíz aporta alta relación C/N protegiendo el suelo.",
      manejo: "Fertilización nitrogenada fraccionada y siembra directa para captar humedad."
    },
    "trigo": {
      rotacion: "Secuencia Trigo/Soja de segunda o rotación con pasturas plurianuales en suelos pampeanos.",
      manejo: "Monitoreo temprano de roya y fertilización con fósforo al inicio de la siembra."
    },
    "yerba mate": {
      rotacion: "Consorciar con cubiertas verdes perennes (ej. leguminosas rastreras) para no dejar el suelo rojo expuesto.",
      manejo: "Sistematización de suelos en curvas de nivel para frenar la fuerte erosión hídrica de laderas misiones."
    },
    "te": {
      rotacion: "Consociar con árboles de sombra leguminosos en bordes.",
      manejo: "Mantener mulching de rastrojo para conservar acidez, humedad y evitar erosión."
    },
    "pino taeda": {
      rotacion: "Sistemas silvopastoriles intercalados con pasturas megatérmicas.",
      manejo: "Podas tempranas a partir del año 3 para maximizar madera libre de nudos."
    },
    "pino elliottii": {
      rotacion: "Sistemas silvopastoriles con hacienda vacuna en lomas bajas.",
      manejo: "Raleo sistemático y control del sotobosque para prevenir incendios forestales."
    },
    "eucalyptus grandis": {
      rotacion: "Sistemas silvopastoriles con pastoreo rotativo intensivo en los callejones.",
      manejo: "Tratamiento de hormigas cortadoras de forma estricta los primeros 2 años."
    },
    "eucalyptus globulus": {
      rotacion: "Rotaciones madereras largas con intercalado de verdeos invernales.",
      manejo: "Control del escarabajo del eucalipto y fajas amortiguadoras de erosión."
    },
    "mani": {
      rotacion: "Rotar obligatoriamente 1 año de Maní cada 4-5 años con Gramíneas (Maíz/Sorgo) para evitar degradación física.",
      manejo: "Siembra inmediata de cultivos de cobertura (Centeno) tras el arrancado para frenar la erosión eólica."
    },
    "vid": {
      rotacion: "Mantener cubiertas verdes espontáneas o sembradas entre hileras (Cereales/Leguminosas).",
      manejo: "Riego presurizado por goteo de alta eficiencia para mitigar el déficit crónico."
    },
    "olivo": {
      rotacion: "Cubiertas vegetales de gramíneas para proteger el suelo de escorrentías en laderas.",
      manejo: "Poda de rejuvenecimiento bien planificada y riego localizado."
    },
    "citrus": {
      rotacion: "Manejo integrado de malezas interfilares sin labranza intensiva.",
      manejo: "Monitoreo estricto de HLB y protección contra heladas con riego por aspersión."
    },
    "limon": {
      rotacion: "Suelos cubiertos en entre líneas para mitigar erosión en laderas tucumanas.",
      manejo: "Podas sanitarias preventivas post-cosecha."
    }
  };

  return rotaciones[cultivoKey] || {
    rotacion: "Rotar con gramíneas locales y leguminosas para sostener la fertilidad biológica.",
    manejo: "Asegurar cobertura permanente del suelo y rotación de principios activos agrícolas."
  };
}

/**
 * Evalúa la compatibilidad de un cultivo dadas las características agroambientales
 * @param {string} cultivoKey
 * @param {object} agroInfo
 * @returns {object} { score: 'ALTA'|'MEDIA'|'BAJA', motivos: string[], riesgos: string[] }
 */
function evaluarCompatibilidadCultivo(cultivoKey, agroInfo, provinciaKey) {
  const cData = cultivosData[cultivoKey];
  if (!cData) return { score: 'MEDIA', motivos: ['Datos técnicos generales.'], riesgos: ['Sin datos específicos.'] };

  const motivos = [];
  const riesgos = [];
  let score = 'ALTA';

  // Extraer valores base
  let tipoSuelo = agroInfo.suelo.tipo;
  let texturaSuelo = agroInfo.suelo.textura;
  let drenajeSuelo = agroInfo.suelo.drenaje;
  let limitantesSuelo = agroInfo.suelo.limitantes;
  let phSuelo = 6.5; // Default standard pH for natural soils if not specified

  // Si hay valores de subregión o provincia que mencionan acidez
  if (tipoSuelo.toLowerCase().includes("ácido") || tipoSuelo.toLowerCase().includes("lateríticos") || limitantesSuelo.toLowerCase().includes("acidez")) {
    phSuelo = 5.0;
  } else if (tipoSuelo.toLowerCase().includes("molisoles") || tipoSuelo.toLowerCase().includes("argiudoles")) {
    phSuelo = 6.2;
  } else if (tipoSuelo.toLowerCase().includes("aridisoles") || tipoSuelo.toLowerCase().includes("pedregosos")) {
    phSuelo = 7.5;
  }

  // SI EL SIMULADOR ESTÁ ACTIVO, SOBREESCRIBIMOS CON LOS PARÁMETROS DEL USUARIO
  if (simuladorValoresPersonalizados) {
    phSuelo = simuladorValoresPersonalizados.ph;
    texturaSuelo = simuladorValoresPersonalizados.textura;
    drenajeSuelo = simuladorValoresPersonalizados.drenaje;
    limitantesSuelo = simuladorValoresPersonalizados.limitante;
    tipoSuelo = "Lote Simulado (" + texturaSuelo.toUpperCase() + ")";

    motivos.push("Simulación activa: Parámetros del lote personalizados.");
  }

  const sueloTexto = (tipoSuelo + " " + (agroInfo.suelo.aptitud || "")).toLowerCase();
  const limitantesTexto = limitantesSuelo.toLowerCase();

  // VALIDACIONES BASADAS EN EL PH (QUÍMICA DEL SUELO)
  if (cultivoKey === "yerba mate" || cultivoKey === "te" || cultivoKey.includes("pino taeda")) {
    // Requieren acidez
    if (phSuelo >= 4.5 && phSuelo <= 6.0) {
      motivos.push("pH óptimo (" + phSuelo.toFixed(1) + ") para especies acidófilas.");
    } else if (phSuelo > 6.5) {
      score = 'MEDIA';
      riesgos.push("pH alto (" + phSuelo.toFixed(1) + "): Riesgo de clorosis férrica y pobre desarrollo.");
    }
  } else if (cultivoKey === "alfalfa" || cultivoKey === "soja" || cultivoKey === "trigo" || cultivoKey === "maiz") {
    // Requieren pH más neutro
    if (phSuelo >= 6.0 && phSuelo <= 7.5) {
      motivos.push("pH equilibrado (" + phSuelo.toFixed(1) + ") ideal para asimilación de nitrógeno y fósforo.");
    } else if (phSuelo < 5.5) {
      score = 'MEDIA';
      riesgos.push("Acidez excesiva (pH " + phSuelo.toFixed(1) + "): Afecta la nodulación y disponibilidad de nutrientes.");
      if (phSuelo < 5.0) {
        score = 'BAJA';
      }
    }
  }

  // VALIDACIONES BASADAS EN TEXTURA Y DRENAJE
  if (texturaSuelo.toLowerCase().includes("arcillo") || texturaSuelo.toLowerCase().includes("arcillosa")) {
    if (cultivoKey === "arroz") {
      motivos.push("Textura arcillosa pesada ideal para retener lámina de agua.");
    } else if (cultivoKey === "mani" || cultivoKey === "papa") {
      score = 'BAJA';
      riesgos.push("Suelo muy arcilloso/pesado: Dificulta la cosecha subterránea y clavado de frutos.");
    }
  }

  if (texturaSuelo.toLowerCase().includes("arenosa") || texturaSuelo.toLowerCase().includes("arenoso")) {
    if (cultivoKey === "mani") {
      motivos.push("Textura arenosa suelta perfecta para el correcto enterramiento del fruto.");
    }
  }

  if (drenajeSuelo.toLowerCase().includes("pobre") || drenajeSuelo.toLowerCase().includes("lento")) {
    if (cultivoKey !== "arroz") {
      if (score === 'ALTA') score = 'MEDIA';
      riesgos.push("Drenaje deficiente: Alto riesgo de anegamiento y asfixia radicular.");
    }
  }

  // VALIDACIONES BASADAS EN LIMITANTES
  if (limitantesTexto.includes("tosca")) {
    if (cultivoKey.includes("pino") || cultivoKey.includes("eucalyptus") || cultivoKey === "forestacion" || cultivoKey === "vid") {
      score = 'MEDIA';
      riesgos.push("La tosca limita la profundidad efectiva de raíces pivots.");
    }
  }
  if (limitantesTexto.includes("salinidad")) {
    if (cultivoKey === "cebada" || cultivoKey === "olivo") {
      motivos.push("Tolerancia moderada a la salinidad presente.");
    } else {
      score = 'BAJA';
      riesgos.push("Alta salinidad: Fitotoxicidad severa para la mayoría de los cultivos.");
    }
  }

  if (motivos.length === 0) {
    motivos.push("Las condiciones generales del territorio son aptas para el cultivo.");
  }

  return {
    score: score,
    motivos: motivos,
    riesgos: riesgos.length > 0 ? riesgos : ["Ninguno identificado bajo condiciones estándar."]
  };
}

function getRecomendaciones(provinciaRaw, lat, lng) {
  const key = normalizeKey(provinciaRaw);
  const info = agroDB[key];

  if (!info) return null;

  // Si tenemos coordenadas de click, buscamos si cae en subregión
  let agroInfo = null;
  if (lat !== undefined && lng !== undefined) {
    const subregion = buscarSubregion(key, lat, lng);
    agroInfo = subregion || agroambientalesDB[key] || agroambientalesDB["default"];
  } else {
    agroInfo = agroambientalesDB[key] || agroambientalesDB["default"];
  }

  return info.cultivos.map(nombre => {
    const cultivoKey = normalizeKey(nombre);
    const detalle = cultivosData[cultivoKey] || defaultCropInfo;
    const compatibilidad = evaluarCompatibilidadCultivo(cultivoKey, agroInfo, key);
    const sostenibilidad = obtenerPracticasSostenibles(cultivoKey, key);

    return {
      nombre: nombre.charAt(0).toUpperCase() + nombre.slice(1),
      descripcion: detalle.descripcion,
      siembra: detalle.siembra,
      cosecha: detalle.cosecha,
      reqSuelo: detalle.reqSuelo || "Suelos fértiles estándar.",
      reqClima: detalle.reqClima || "Climas templados a cálidos estándar.",
      compatibilidad: compatibilidad.score,
      motivos: compatibilidad.motivos,
      riesgos: compatibilidad.riesgos,
      sostenibilidad: sostenibilidad
    };
  });
}

/**
 * Renderiza las tarjetas de cultivo inteligentes con compatibilidad territorial (Fase 3 + Sostenibilidad)
 */
function renderRecomendaciones(provinciaRaw, lat, lng) {
  const container = document.getElementById("crop-results");
  const tituloUbicacion = document.getElementById("resultado_ubicacion");

  if (!container) return;

  const recomendaciones = getRecomendaciones(provinciaRaw, lat, lng);

  if (tituloUbicacion) tituloUbicacion.innerText = provinciaRaw;

  if (!recomendaciones) {
    container.innerHTML = `
      <div class="error-msg">
        <p>Lo sentimos, no tenemos datos registrados para la provincia: <strong>${provinciaRaw}</strong>.</p>
        <p>Asegúrate de escribir correctamente el nombre (ej. Córdoba, Buenos Aires, Santa Fe).</p>
      </div>`;
    return;
  }

  container.innerHTML = recomendaciones.map(c => {
    let badgeClass = "badge-alta";
    if (c.compatibilidad === "MEDIA") badgeClass = "badge-media";
    if (c.compatibilidad === "BAJA") badgeClass = "badge-baja";

    // Icono correspondiente según cultivo
    let icon = "🌱";
    const nom = c.nombre.toLowerCase();
    if (nom.includes("trigo") || nom.includes("cebada") || nom.includes("avena") || nom.includes("centeno")) icon = "🌾";
    else if (nom.includes("soja") || nom.includes("poroto") || nom.includes("arveja")) icon = "🫛";
    else if (nom.includes("maiz") || nom.includes("sorgo")) icon = "🌽";
    else if (nom.includes("arroz")) icon = "🌾";
    else if (nom.includes("mani")) icon = "🥜";
    else if (nom.includes("girasol") || nom.includes("colza")) icon = "🌻";
    else if (nom.includes("pino") || nom.includes("eucalyptus") || nom.includes("sauce") || nom.includes("alamo") || nom.includes("forestacion")) icon = "🌲";
    else if (nom.includes("yerba")) icon = "🧉";
    else if (nom.includes("te")) icon = "🍵";
    else if (nom.includes("citrus") || nom.includes("limon") || nom.includes("naranja") || nom.includes("mandarina") || nom.includes("pomelo")) icon = "🍊";
    else if (nom.includes("vid")) icon = "🍇";
    else if (nom.includes("olivo")) icon = "🫒";
    else if (nom.includes("manzana")) icon = "🍎";
    else if (nom.includes("pera")) icon = "🍐";
    else if (nom.includes("cana")) icon = "🎋";
    else if (nom.includes("papa") || nom.includes("mandioca")) icon = "🥔";
    else if (nom.includes("quinoa")) icon = "🌾";
    else if (nom.includes("arandano")) icon = "🫐";
    else if (nom.includes("durazno") || nom.includes("ciruela")) icon = "🍑";
    else if (nom.includes("almendro") || nom.includes("nuez")) icon = "🌰";
    else if (nom.includes("ajo")) icon = "🧄";
    else if (nom.includes("lupulo")) icon = "🌿";
    else if (nom.includes("lavanda") || nom.includes("oregano")) icon = "🪻";
    else if (nom.includes("tomate") || nom.includes("pimiento")) icon = "🍅";
    else if (nom.includes("melon") || nom.includes("sandia")) icon = "🍉";

    return `
      <article class="crop-card">
        <div class="crop-card-header">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span class="crop-icon">${icon}</span>
            <h3 style="margin: 0; font-weight: 700; text-transform: capitalize;">${c.nombre}</h3>
          </div>
          <span class="compatibility-badge ${badgeClass}">${c.compatibilidad}</span>
        </div>

        <p class="desc">${c.descripcion}</p>

        <!-- Sub-cards internas para mejorar la visual de dashboard premium -->
        <div class="crop-grid-details">
          <div class="sub-card calendar-sub-card">
            <h4>📅 Calendario Agrícola</h4>
            <div style="margin-top: 5px;"><strong>Siembra:</strong> ${c.siembra}</div>
            <div><strong>Cosecha:</strong> ${c.cosecha}</div>
          </div>

          <div class="sub-card req-sub-card">
            <h4>🌱 Requerimientos de Cultivo</h4>
            <div style="margin-top: 5px;"><strong>Suelo:</strong> ${c.reqSuelo}</div>
            <div style="margin-top: 4px;"><strong>Clima:</strong> ${c.reqClima}</div>
          </div>
        </div>

        <div class="compatibility-report premium-report">
          <div class="report-header">
            <span style="font-size: 1.1rem;">📍</span> Reporte de Compatibilidad Territorial
          </div>
          <div class="report-body">
            <div class="report-block">
              <strong>💡 Factores de Éxito / Motivos:</strong>
              <ul>
                ${c.motivos.map(m => `<li>${m}</li>`).join("")}
              </ul>
            </div>
            <div class="report-block">
              <strong>⚠️ Limitantes / Riesgos Identificados:</strong>
              <ul style="color: var(--texto-secundario);">
                ${c.riesgos.map(r => `<li>${r}</li>`).join("")}
              </ul>
            </div>
          </div>
        </div>

        <!-- Sección de Prácticas Sostenibles (Fase C) -->
        <div class="sustainability-report premium-sustainability">
          <div class="sustainability-header">
            <span>🔄</span> Manejo Sostenible Recomendado
          </div>
          <div style="margin-top: 6px;"><strong>🚜 Rotación Recomendada:</strong> ${c.sostenibilidad.rotacion}</div>
          <div style="margin-top: 4px;"><strong>🌍 Conservación de Suelo:</strong> ${c.sostenibilidad.manejo}</div>
        </div>
      </article>
    `;
  }).join("");
}

/* ============================================================================
   Inicialización
   ============================================================================ */

document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const ubic = params.get("ubicacion");

  // Si se buscó una ubicación, renderizarla tradicionalmente
  if (ubic) {
    const key = normalizeKey(ubic);
    const coords = provinciaCoordenadas[key];
    if (coords) {
      renderRecomendaciones(ubic, coords.lat, coords.lng);
    } else {
      renderRecomendaciones(ubic);
    }
  }


  // Inicialización del Simulador de Lote
  const simPh = document.getElementById("sim-ph");
  const valPh = document.getElementById("val-ph");
  const simTextura = document.getElementById("sim-textura");
  const simDrenaje = document.getElementById("sim-drenaje");
  const simLimitantes = document.getElementById("sim-limitantes");
  const btnSimular = document.getElementById("btn-simular");
  const btnRestablecerSim = document.getElementById("btn-restablecer-sim");

  if (simPh && valPh) {
    simPh.addEventListener("input", (e) => {
      valPh.innerText = parseFloat(e.target.value).toFixed(1);
    });
  }

  if (btnSimular) {
    btnSimular.addEventListener("click", () => {
      simuladorValoresPersonalizados = {
        ph: parseFloat(simPh.value),
        textura: simTextura.value,
        drenaje: simDrenaje.value,
        limitante: simLimitantes.value
      };

      // Obtener coordenadas seleccionadas actuales si existen para recalcular bajo ese contexto subregional/provincial
      let activeLat, activeLng;
      if (currentMarker) {
        const latLng = currentMarker.getLatLng();
        activeLat = latLng.lat;
        activeLng = latLng.lng;
      }

      const activeUbic = document.getElementById("resultado_ubicacion")?.innerText || ubic || "Argentina";
      renderRecomendaciones(activeUbic, activeLat, activeLng);
    });
  }

  if (btnRestablecerSim) {
    btnRestablecerSim.addEventListener("click", () => {
      simuladorValoresPersonalizados = null;
      if (simPh && valPh) {
        simPh.value = "6.0";
        valPh.innerText = "6.0";
      }
      if (simTextura) simTextura.value = "franca";
      if (simDrenaje) simDrenaje.value = "bueno";
      if (simLimitantes) simLimitantes.value = "ninguna";

      let activeLat, activeLng;
      if (currentMarker) {
        const latLng = currentMarker.getLatLng();
        activeLat = latLng.lat;
        activeLng = latLng.lng;
      }
      const activeUbic = document.getElementById("resultado_ubicacion")?.innerText || ubic || "Argentina";
      renderRecomendaciones(activeUbic, activeLat, activeLng);
    });
  }

  // Inicializar mapa de forma segura
  setTimeout(() => {
    inicializarMapa(ubic || "Argentina");

    // Si hay una provincia en la URL, cargar sus datos básicos en el panel lateral también
    if (ubic) {
      const key = normalizeKey(ubic);
      if (provinciaCoordenadas[key]) {
        actualizarPanelTerritorialBasico(ubic, provinciaCoordenadas[key].lat, provinciaCoordenadas[key].lng);
      }
    }
  }, 100);
});
