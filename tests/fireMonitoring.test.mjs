import test from 'node:test';
import assert from 'node:assert/strict';
import { harmonizeFireDetections, aggregateFireDays } from '../services/fireMonitoringService.mjs';
const point=(source,date,lon,lat,confidence=80,powerMw=10)=>({type:'Feature',geometry:{type:'Point',coordinates:[lon,lat]},properties:{source,date,confidence,powerMw}});
test('harmonizes same-day MODIS and VIIRS detections within 1 km',()=>{const events=harmonizeFireDetections([point('MODIS','2026-11-01',-56,-27),point('VIIRS','2026-11-01',-55.999,-27)]);assert.equal(events.length,1);assert.deepEqual(events[0].sources,['MODIS','VIIRS']);assert.equal(events[0].harmonization,'coincident');});
test('does not match detections from different dates or distant pixels',()=>{const events=harmonizeFireDetections([point('MODIS','2026-11-01',-56,-27),point('VIIRS','2026-11-02',-56,-27),point('VIIRS','2026-11-01',-55.9,-27)]);assert.equal(events.length,3);assert.ok(events.every(event=>event.harmonization==='single-sensor'));});
test('matches VIIRS detections one-to-one',()=>{const events=harmonizeFireDetections([point('MODIS','2026-11-01',-56,-27),point('MODIS','2026-11-01',-56.0002,-27),point('VIIRS','2026-11-01',-56.0001,-27)]);assert.equal(events.filter(event=>event.harmonization==='coincident').length,1);assert.equal(events.length,2);});
test('aggregates harmonized events by observation date',()=>{const days=aggregateFireDays([{date:'2026-10-01'},{date:'2026-10-21'},{date:'2026-11-01'}]);assert.deepEqual(days,[{date:'2026-10-01',events:1},{date:'2026-10-21',events:1},{date:'2026-11-01',events:1}]);});
