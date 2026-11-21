import test from 'node:test';
import assert from 'node:assert/strict';

import { isRelevantOfficialLayer } from '../services/mapViewer.js';

test('official map layer discovery keeps only thematic layers relevant to existing analysis', () => {
  assert.equal(isRelevantOfficialLayer('idecor', { name: 'idecor:soil_map' }), true);
  assert.equal(isRelevantOfficialLayer('idecor', { title: 'Cobertura y uso del suelo' }), true);
  assert.equal(isRelevantOfficialLayer('idecor', { name: 'idecor:street_labels' }), false);
  assert.equal(isRelevantOfficialLayer('idecorr', { title: 'Incendios y cobertura vegetal' }), true);
  assert.equal(isRelevantOfficialLayer('ign', { title: 'Red hidrográfica provincial' }), true);
  assert.equal(isRelevantOfficialLayer('inta', { name: 'geonode:ph_0_30' }), true);
  assert.equal(isRelevantOfficialLayer('conae_saocom', { name: 'HumedadDeSuelos:DSS_MSM_1' }), true);
  assert.equal(isRelevantOfficialLayer('conae_saocom', { name: 'HumedadDeSuelos:DSS_MSMKR_1' }), true);
  assert.equal(isRelevantOfficialLayer('conae_smap', { name: 'HumedadDeSuelos:SMAP_Pasada_Ascendente' }), true);
  assert.equal(isRelevantOfficialLayer('conae_fuel', { name: 'AlertaTemprana:INC_SIARTIVGEOL89_DC_1' }), true);
  assert.equal(isRelevantOfficialLayer('conae_burned', { title: 'Área quemada AQM' }), true);
  assert.equal(isRelevantOfficialLayer('unknown', { name: 'anything' }), false);
});
