import test from 'node:test';
import assert from 'node:assert/strict';
import { harmonizeFireDetections, aggregateFireDays, parseFireCsv, filterFireDetectionsToGeometry, aggregateFireMonths, aggregateFireYears } from '../services/fireMonitoringService.mjs';
const point=(source,date,lon,lat,confidence=80,powerMw=10)=>({type:'Feature',geometry:{type:'Point',coordinates:[lon,lat]},properties:{source,date,confidence,powerMw}});
test('harmonizes same-day MODIS and VIIRS detections within 1 km',()=>{const events=harmonizeFireDetections([point('MODIS','2026-11-01',-56,-27),point('VIIRS','2026-11-01',-55.999,-27)]);assert.equal(events.length,1);assert.deepEqual(events[0].sources,['MODIS','VIIRS']);assert.equal(events[0].harmonization,'coincident');});
test('does not match detections from different dates or distant pixels',()=>{const events=harmonizeFireDetections([point('MODIS','2026-11-01',-56,-27),point('VIIRS','2026-11-02',-56,-27),point('VIIRS','2026-11-01',-55.9,-27)]);assert.equal(events.length,3);assert.ok(events.every(event=>event.harmonization==='single-sensor'));});
test('matches VIIRS detections one-to-one',()=>{const events=harmonizeFireDetections([point('MODIS','2026-11-01',-56,-27),point('MODIS','2026-11-01',-56.0002,-27),point('VIIRS','2026-11-01',-56.0001,-27)]);assert.equal(events.filter(event=>event.harmonization==='coincident').length,1);assert.equal(events.length,2);});
test('aggregates harmonized events by observation date',()=>{const days=aggregateFireDays([{date:'2026-10-01'},{date:'2026-10-21'},{date:'2026-11-01'}]);assert.deepEqual(days,[{date:'2026-10-01',events:1},{date:'2026-10-21',events:1},{date:'2026-11-01',events:1}]);});

test('parses CONAE CSV with Spanish headers, MODIS and VIIRS sensors',()=>{const csv='Instrumento,Satélite,Latitud,Longitud,Fecha,Hora,FP_Confidence,FP_Power\nMODIS,TERRA,-27.1,-56.2,2026-10-03,1430,90,12.4\nVIIRS,SNPP,-27.2,-56.3,04/10/2026,0215,75,8.1';const parsed=parseFireCsv(csv,'CONAE_FC_MODIS_VIIRS.csv');assert.equal(parsed.features.length,2);assert.equal(parsed.features[0].properties.source,'MODIS');assert.equal(parsed.features[1].properties.source,'VIIRS');assert.equal(parsed.features[1].properties.date,'2026-10-04');});
test('parses NASA FIRMS CSV and filters points by lot geometry',()=>{const csv='latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight\n-27.1,-56.2,320,0.4,0.4,2026-10-03,1430,Terra,MODIS,nominal,6.1NRT,290,12.4,D';const parsed=parseFireCsv(csv,'FIRMS_MODIS.csv');const geometry={type:'Polygon',coordinates:[[[-56.3,-27.2],[-56.1,-27.2],[-56.1,-27],[-56.3,-27],[-56.3,-27.2]]]};assert.equal(filterFireDetectionsToGeometry(parsed.features,geometry).length,1);assert.equal(filterFireDetectionsToGeometry(parsed.features,{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}).length,0);});
test('aggregates historical detections by month and sensor without mixing counts',()=>{const rows=[point('MODIS','2026-10-01',-56,-27),point('VIIRS','2026-10-02',-56,-27),point('MODIS','2026-11-01',-56,-27)];assert.deepEqual(aggregateFireMonths(rows),[{month:'2026-10',total:2,MODIS:1,VIIRS:1},{month:'2026-11',total:1,MODIS:1,VIIRS:0}]);});
test('rejects aggregate CSVs without point coordinates',()=>{assert.throws(()=>parseFireCsv('provincia,mes,area_quemada_ha\nCorrientes,2026-10,120'),/latitud/i);});
test('aggregates historical detections by year and sensor',()=>{const rows=[point('MODIS','2025-10-01',-56,-27),point('VIIRS','2025-11-02',-56,-27),point('MODIS','2026-01-01',-56,-27)];assert.deepEqual(aggregateFireYears(rows),[{year:'2025',total:2,MODIS:1,VIIRS:1},{year:'2026',total:1,MODIS:1,VIIRS:0}]);});

test('imports FIRMS CSV with semicolon and decimal comma even without sensor metadata',()=>{
 const parsed=parseFireCsv('latitude;longitude;acq_date;acq_time\n-27,1;-56,2;2026-10-03;1430','export.csv');
 assert.equal(parsed.features.length,1);assert.equal(parsed.features[0].properties.source,'UNKNOWN');assert.equal(parsed.features[0].properties.date,'2026-10-03');
});
test('reports invalid rows while preserving valid detections',()=>{
 const parsed=parseFireCsv('lat;lon;date;satellite\n-27;-56;2026-10-03;NOAA-21\ninvalid;-56;bad;NOAA-21','detections.csv');
 assert.equal(parsed.features.length,1);assert.equal(parsed.skipped,1);assert.equal(parsed.totalRows,2);
});
test('supports historical date filtering without a lot geometry',()=>{
 const rows=[point('MODIS','2025-10-01',-56,-27),point('VIIRS','2026-11-02',-56,-27)];
 assert.equal(filterFireDetectionsToGeometry(rows,null,0,'2026-01-01','').length,1);
});
