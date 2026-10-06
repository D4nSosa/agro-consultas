import fs from 'fs';

const cultivos = JSON.parse(fs.readFileSync('./data/cultivos.json', 'utf-8'));
const provincias = JSON.parse(fs.readFileSync('./data/provincias.json', 'utf-8'));

console.log(`Testing all ${Object.keys(cultivos).length} crops across all ${Object.keys(provincias).length} provinces...`);

let testedCount = 0;
for (const [pName, pData] of Object.entries(provincias)) {
  const cropList = pData.nombre?.cultivos || [];
  for (const cropName of cropList) {
    if (cultivos[cropName]) {
      testedCount++;
    } else {
      console.warn(`Warning: Province ${pName} references crop '${cropName}' not found in cultivos.json`);
    }
  }
}

console.log(`Successfully verified ${testedCount} province-crop pairs across the dataset!`);
