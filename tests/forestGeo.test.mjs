import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateArea, exportToKML, exportToGPX, exportToPyQGISScript } from '../forestal/utils/geo.js';

const square = [
  [-56.1, -28.1],
  [-56.0, -28.1],
  [-56.0, -28.0],
  [-56.1, -28.0],
  [-56.1, -28.1]
];

test('calcula superficie positiva para un Polygon', () => {
  const result = calculateArea({ type: 'Polygon', coordinates: [square] });
  assert.ok(result.squareMeters > 0);
  assert.equal(result.hectares, Math.round(result.squareMeters / 10000 * 100) / 100);
});

test('suma partes separadas de un MultiPolygon sin conectarlas', () => {
  const second = square.map(([lng, lat]) => [lng + 0.2, lat]);
  const oneArea = calculateArea({ type: 'Polygon', coordinates: [square] }).squareMeters;
  const result = calculateArea({ type: 'MultiPolygon', coordinates: [[square], [second]] });
  assert.ok(Math.abs(result.squareMeters - oneArea * 2) < 0.02);
});

test('descuenta los anillos interiores de un Polygon', () => {
  const hole = [
    [-56.075, -28.075],
    [-56.025, -28.075],
    [-56.025, -28.025],
    [-56.075, -28.025],
    [-56.075, -28.075]
  ];
  const full = calculateArea({ type: 'Polygon', coordinates: [square] }).squareMeters;
  const withHole = calculateArea({ type: 'Polygon', coordinates: [square, hole] }).squareMeters;
  assert.ok(withHole > 0);
  assert.ok(withHole < full);
});

test('acepta Features GeoJSON y conserva el área de su geometría', () => {
  const geometry = { type: 'Polygon', coordinates: [square] };
  const raw = calculateArea(geometry);
  const feature = calculateArea({ type: 'Feature', properties: {}, geometry });
  assert.equal(feature.squareMeters, raw.squareMeters);
});

test('no asigna superficie a un punto', () => {
  const result = calculateArea({ type: 'Point', coordinates: [-56, -28] });
  assert.equal(result.isPoint, true);
  assert.equal(result.squareMeters, 0);
});

test('combina todas las Features Polygon de una FeatureCollection', async () => {
  const { validateGeoJSON } = await import('../forestal/utils/geo.js');
  const second = square.map(([lng, lat]) => [lng + 0.2, lat]);
  const result = validateGeoJSON({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { name: 'A' }, geometry: { type: 'Polygon', coordinates: [square] } },
      { type: 'Feature', properties: { name: 'B' }, geometry: { type: 'Polygon', coordinates: [second] } }
    ]
  });
  assert.equal(result.valid, true);
  assert.equal(result.geometry.type, 'MultiPolygon');
  assert.equal(result.geometry.coordinates.length, 2);
});

test('rechaza una FeatureCollection si alguna geometría es inválida', async () => {
  const { validateGeoJSON } = await import('../forestal/utils/geo.js');
  const result = validateGeoJSON({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [square] } },
      { type: 'Feature', properties: {}, geometry: null }
    ]
  });
  assert.equal(result.valid, false);
});

test('pondera el centroide de un MultiPolygon por superficie', async () => {
  const { calculateCentroid } = await import('../forestal/utils/geo.js');
  const small = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
  const large = [[10, 10], [20, 10], [20, 20], [10, 20], [10, 10]];
  const centroid = calculateCentroid({ type: 'MultiPolygon', coordinates: [[small], [large]] });
  const expected = (0.5 + 15 * 100) / 101;
  assert.ok(Math.abs(centroid.lng - expected) < 1e-9);
  assert.ok(Math.abs(centroid.lat - expected) < 1e-9);
});


test('KML conserva huecos, partes MultiPolygon y escapa XML', () => {
 const hole=[[-56.075,-28.075],[-56.025,-28.075],[-56.025,-28.025],[-56.075,-28.025],[-56.075,-28.075]];
 const second=square.map(([x,y])=>[x+0.2,y]);
 const kml=exportToKML({type:'MultiPolygon',coordinates:[[square,hole],[second]]},'Lote <Norte> & "Sur"');
 assert.equal((kml.match(/<Polygon>/g)||[]).length,2);
 assert.equal((kml.match(/<innerBoundaryIs>/g)||[]).length,1);
 assert.match(kml,/Lote &lt;Norte&gt; &amp; &quot;Sur&quot;/);
});
test('GPX exporta partes y anillos como tracks separados',()=>{
 const second=square.map(([x,y])=>[x+0.2,y]);
 const gpx=exportToGPX({type:'MultiPolygon',coordinates:[[square],[second]]},'Campo');
 assert.equal((gpx.match(/<trk>/g)||[]).length,2);
 assert.match(gpx,/Campo - Centroide/);
});
test('PyQGIS usa geometría genérica EPSG:4326 y protege nombres',()=>{
 const script=exportToPyQGISScript({type:'MultiPolygon',coordinates:[[square]]},'Lote "A"');
 assert.ok(script.includes('Unknown?crs=EPSG:4326'));
 assert.match(script,/QgsGeometry\\.fromGeoJson/);
 assert.match(script,/Lote/);
});
test('exportadores rechazan coordenadas WGS84 inválidas',()=>{
 const bad={type:'Point',coordinates:[300,-28]};
 assert.throws(()=>exportToKML(bad),/coordenadas WGS84 inválidas/);
 assert.throws(()=>exportToGPX(bad),/coordenadas WGS84 inválidas/);
 assert.throws(()=>exportToPyQGISScript(bad),/coordenadas WGS84 inválidas/);
});
