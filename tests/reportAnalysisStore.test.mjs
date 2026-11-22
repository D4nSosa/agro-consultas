import test from 'node:test';
import assert from 'node:assert/strict';
import { saveReportSection, getReportSnapshot, clearReportSnapshot } from '../services/reportAnalysisStore.js';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
globalThis.localStorage = new MemoryStorage();

const lotA = { type: 'Polygon', coordinates: [[[-56.1,-28.1],[-56.0,-28.1],[-56.0,-28.0],[-56.1,-28.1]]] };
const lotB = { type: 'Polygon', coordinates: [[[-56.2,-28.1],[-56.0,-28.1],[-56.0,-28.0],[-56.2,-28.1]]] };

test('stores and retrieves module results only for the exact lot geometry', () => {
  saveReportSection(lotA, 'hansen', { tree_cover_2000: { mean_percent: 58 } }, { module: 'forestal', source: 'Hansen' });
  assert.equal(getReportSnapshot(lotA).sections.hansen.payload.tree_cover_2000.mean_percent, 58);
  assert.equal(getReportSnapshot(lotB), null);
});

test('keeps independent specialist results in the same lot report snapshot', () => {
  saveReportSection(lotA, 'gfw-drivers', { drivers: [{ driver: 'Agricultura permanente', area_ha: 2 }] }, { module: 'forestal' });
  saveReportSection(lotA, 'jrc', { forest_area_ha: 1 }, { module: 'forestal' });
  const sections = getReportSnapshot(lotA).sections;
  assert.ok(sections.hansen);
  assert.ok(sections['gfw-drivers']);
  assert.ok(sections.jrc);
});

test('clears only the selected lot report snapshot', () => {
  saveReportSection(lotB, 'jrc', { forest_area_ha: 4 });
  assert.equal(clearReportSnapshot(lotA), true);
  assert.equal(getReportSnapshot(lotA), null);
  assert.ok(getReportSnapshot(lotB));
});
