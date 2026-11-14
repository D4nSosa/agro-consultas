import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function importSource(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}
const geo = await importSource('../forestal/utils/geo.js');
const scoring = await importSource('../utils/scoring.js');
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
