import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function importSource(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}
const geo = await importSource('../forestal/utils/geo.js');
const scoring = await importSource('../utils/scoring.js');
const intaService = await importSource('../services/sources/intaService.js');

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}
const square = (west,south,east,north) => ({type:'Polygon',coordinates:[[[west,south],[east,south],[east,north],[west,north],[west,south]]]});

test('MultiPolygon suma partes independientes sin conectarlas',()=>{
 const multi={type:'MultiPolygon',coordinates:[square(0,0,1,1).coordinates,square(2,0,3,1).coordinates]};
 const one=geo.calculateArea(square(0,0,1,1)),two=geo.calculateArea(multi);
 assert.equal(two.valid,true);assert.ok(Math.abs(two.squareMeters-one.squareMeters*2)<1);
});
test('Polygon descuenta los anillos interiores',()=>{
 const polygon={type:'Polygon',coordinates:[[[0,0],[2,0],[2,2],[0,2],[0,0]],[[.5,.5],[1.5,.5],[1.5,1.5],[.5,1.5],[.5,.5]]]};
 assert.ok(geo.calculateArea(polygon).squareMeters<geo.calculateArea(square(0,0,2,2)).squareMeters);
});
test('FeatureCollection solo acepta una entidad de lote',()=>{
 const feature=g=>({type:'Feature',geometry:g,properties:{}});
 assert.equal(geo.validateGeoJSON({type:'FeatureCollection',features:[feature(square(0,0,1,1)),feature(square(2,0,3,1))]}).valid,false);
 assert.equal(geo.validateGeoJSON({type:'FeatureCollection',features:[feature(square(0,0,1,1))]}).valid,true);
});
test('rechaza anillos abiertos, coordenadas fuera de WGS84 y autointersecciones',()=>{
 assert.equal(geo.validateGeoJSON({type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1]]]}).valid,false);
 assert.equal(geo.validateGeoJSON({type:'Point',coordinates:[200,0]}).valid,false);
 assert.equal(geo.validateGeoJSON({type:'Polygon',coordinates:[[[0,0],[1,1],[0,1],[1,0],[0,0]]]}).valid,false);
});
test('centroide MultiPolygon pondera por superficie y no por conteo de vértices',()=>{
 const multi={type:'MultiPolygon',coordinates:[square(0,0,2,2).coordinates,square(10,0,11,1).coordinates]};
 const c=geo.calculateCentroid(multi);assert.ok(c.lng>0&&c.lng<5);
});
test('KML conserva todas las partes y anillos interiores del MultiPolygon',()=>{
 const multi={type:'MultiPolygon',coordinates:[square(0,0,1,1).coordinates,square(2,0,3,1).coordinates]};
 const kml=geo.exportToKML(multi,'Lote & prueba');
 assert.match(kml,/<MultiGeometry>/);assert.match(kml,/Lote &amp; prueba/);assert.equal((kml.match(/<Polygon>/g)||[]).length,2);
});
test('GPX exporta cada parte de un MultiPolygon como segmento separado',()=>{
 const multi={type:'MultiPolygon',coordinates:[square(0,0,1,1).coordinates,square(2,0,3,1).coordinates]};
 assert.equal((geo.exportToGPX(multi).match(/<trk>/g)||[]).length,2);
});
test('aptitud no se clasifica alta cuando falta una variable climática requerida',()=>{
 const crop={nombre:'Cultivo prueba',requerimientos:{suelo:{phMin:5,phMax:7,texturas:['franca']},clima:{temperaturaMin:10,temperaturaMax:25,precipitacionMin:500}}};
 const soil={status:'REAL',ph:6,textura:'franca',drenaje:'bueno'};
 const climate={status:'REAL',temperaturaMediaVal:null,precipitacionesAnualesVal:700};
 const result=scoring.calcularCompatibilidad(crop,soil,climate);
 assert.notEqual(result.nivelAptitud,'ALTA');assert.ok(result.datosFaltantes.some(x=>x.includes('temperatura')));
});
test('ficha sin requerimientos cuantificables queda pendiente y no favorable por defecto',()=>{
 const result=scoring.calcularCompatibilidad({nombre:'Sin criterios'},{status:'REAL',ph:6},{status:'REAL',temperaturaMediaVal:20});
 assert.equal(result.nivelAptitud,'INFORMACIÓN PENDIENTE');
});

test('contexto regional limita la clasificación a aptitud media',()=>{
 const crop={nombre:'Cultivo prueba',requerimientos:{suelo:{phMin:5,phMax:7},clima:{temperaturaMin:10,temperaturaMax:25,precipitacionMin:500}}};
 const result=scoring.calcularCompatibilidad(crop,{status:'REGIONAL',ph:6},{status:'REGIONAL',temperaturaMediaVal:20,precipitacionesAnualesVal:700});
 assert.notEqual(result.nivelAptitud,'ALTA');
});
test('evidencia REAL completa permite una aptitud alta cuando no hay limitantes',()=>{
 const crop={nombre:'Cultivo prueba',requerimientos:{suelo:{phMin:5,phMax:7,texturas:['franca'],drenaje:['bueno']},clima:{temperaturaMin:10,temperaturaMax:25,precipitacionMin:500}}};
 const result=scoring.calcularCompatibilidad(crop,{status:'REAL',ph:6,textura:'franca',drenaje:'bueno'},{status:'REAL',temperaturaMediaVal:20,precipitacionesAnualesVal:700});
 assert.equal(result.nivelAptitud,'ALTA');
 assert.match(result.calidadEvidencia,/ALTA/);
});
test('calculateArea acepta FeatureCollection de un único lote',()=>{
 const collection={type:'FeatureCollection',features:[{type:'Feature',geometry:square(0,0,1,1),properties:{}}]};
 assert.equal(geo.calculateArea(collection).valid,true);
});

test('rechaza huecos fuera del anillo exterior y anillos de área nula',()=>{
 const outsideHole={type:'Polygon',coordinates:[
  [[0,0],[1,0],[1,1],[0,1],[0,0]],
  [[2,2],[3,2],[3,3],[2,3],[2,2]]
 ]};
 const zeroArea={type:'Polygon',coordinates:[[[0,0],[1,0],[2,0],[3,0],[0,0]]]};
 assert.equal(geo.validateGeoJSON(outsideHole).valid,false);
 assert.equal(geo.validateGeoJSON(zeroArea).valid,false);
});

test('consulta puntual conserva un bounding box con margen espacial',()=>{
 const bbox=geo.getBoundingBox({type:'Point',coordinates:[-56,-28]});
 assert.ok(bbox[0]<-56&&bbox[2]>-56&&bbox[1]<-28&&bbox[3]>-28);
});

test('placeholders de suelo no cuentan como evidencia edáfica disponible',()=>{
 const crop={nombre:'Cultivo prueba',requerimientos:{suelo:{phMin:5,phMax:7,texturas:['franca']},clima:{temperaturaMin:10,temperaturaMax:25,precipitacionMin:500}}};
 const soil={status:'REGIONAL',ph:'NO DISPONIBLE',tipo:'Información de suelo no disponible para esta ubicación',textura:'No disponible',drenaje:'NO DISPONIBLE'};
 const climate={status:'REAL',temperaturaMediaVal:20,precipitacionesAnualesVal:700};
 const result=scoring.calcularCompatibilidad(crop,soil,climate);
 assert.notEqual(result.nivelAptitud,'ALTA');
 assert.ok(result.datosFaltantes.some(item=>item.toLowerCase().includes('cartografía edáfica')));
 assert.equal(result.calidadEvidencia,'PARCIAL');
});

test('rechaza componentes MultiPolygon superpuestos o en contacto',()=>{
 const overlapping={type:'MultiPolygon',coordinates:[square(0,0,2,2).coordinates,square(1,1,3,3).coordinates]};
 const touching={type:'MultiPolygon',coordinates:[square(0,0,1,1).coordinates,square(1,0,2,1).coordinates]};
 assert.equal(geo.validateGeoJSON(overlapping).valid,false);
 assert.equal(geo.validateGeoJSON(touching).valid,false);
});

test('respuesta WMS sin atributos no se convierte en suelo disponible',async()=>{
 const previousFetch=globalThis.fetch,previousStorage=globalThis.localStorage;
 globalThis.localStorage=memoryStorage();
 globalThis.fetch=async()=>({ok:true,json:async()=>({features:[{type:'Feature',properties:{}}]})});
 try{
  const result=await intaService.fetchINTASoilData(-31.1234,-56.1234,null);
  assert.equal(result.status,'UNAVAILABLE');
  assert.equal(result.ph,null);
  assert.equal(result.tipo,'Información de suelo no disponible para esta ubicación');
 }finally{
  globalThis.fetch=previousFetch;
  if(previousStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=previousStorage;
 }
});
test('respuesta WMS con atributos válidos informa escala sin inventarla',async()=>{
 const previousFetch=globalThis.fetch,previousStorage=globalThis.localStorage;
 globalThis.localStorage=memoryStorage();
 globalThis.fetch=async()=>({ok:true,json:async()=>({features:[{type:'Feature',properties:{tipo_suelo:'Argiudol',textura:'franca',drenaje:'bueno',ph:'6.2'}}]})});
 try{
  const result=await intaService.fetchINTASoilData(-31.2234,-56.2234,null);
  assert.equal(result.status,'REAL');
  assert.equal(result.ph,6.2);
  assert.equal(result.escala,'No informada por la respuesta WMS');
 }finally{
  globalThis.fetch=previousFetch;
  if(previousStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=previousStorage;
 }
});
test('fallback regional no atribuye una escala si la ficha no la informa',async()=>{
 const previousFetch=globalThis.fetch,previousStorage=globalThis.localStorage;
 globalThis.localStorage=memoryStorage();
 globalThis.fetch=async()=>({ok:false,status:503});
 try{
  const result=await intaService.fetchINTASoilData(-31.3234,-56.3234,{tipo:'Argiudol',textura:'franca'});
  assert.equal(result.status,'REGIONAL');
  assert.equal(result.escala,'Regional (escala no informada)');
 }finally{
  globalThis.fetch=previousFetch;
  if(previousStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=previousStorage;
 }
});
test('sin WMS ni variables regionales, el fallback permanece no disponible',async()=>{
 const previousFetch=globalThis.fetch,previousStorage=globalThis.localStorage;
 globalThis.localStorage=memoryStorage();
 globalThis.fetch=async()=>({ok:false,status:503});
 try{
  const result=await intaService.fetchINTASoilData(-31.4234,-56.4234,{tipo:'Información Regional de Suelos',textura:'No disponible'});
  assert.equal(result.status,'UNAVAILABLE');
  assert.equal(result.tipo,'NO DISPONIBLE');
 }finally{
  globalThis.fetch=previousFetch;
  if(previousStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=previousStorage;
 }
});
