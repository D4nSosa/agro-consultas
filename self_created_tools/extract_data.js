const fs = require('fs');
const vm = require('vm');

let code = fs.readFileSync('script.js', 'utf8');

// Append global bindings so vm can retrieve const declared variables
code += `
globalThis.cultivosData = cultivosData;
globalThis.agroDB = agroDB;
globalThis.provinciaCoordenadas = provinciaCoordenadas;
globalThis.agroambientalesDB = agroambientalesDB;
globalThis.subregionesDB = subregionesDB;
`;

// Mock browser objects
const sandbox = {
  document: {
    addEventListener: () => {},
    getElementById: () => ({ addEventListener: () => {} }),
    querySelectorAll: () => []
  },
  window: {},
  navigator: {
    geolocation: {}
  },
  L: {
    map: () => ({ setView: () => {}, on: () => {} }),
    tileLayer: () => ({ addTo: () => {} }),
    circle: () => ({ addTo: () => {}, bindPopup: () => {} }),
    marker: () => ({ addTo: () => {}, bindPopup: () => {} })
  },
  console: console,
  localStorage: {
    getItem: () => null,
    setItem: () => {}
  },
  globalThis: {}
};

// Bind globalThis to sandbox
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
try {
  vm.runInContext(code, sandbox);
  console.log("Successfully ran script.js in Node VM!");

  // Extract data
  const cultivosData = sandbox.globalThis.cultivosData;
  const agroDB = sandbox.globalThis.agroDB;
  const provinciaCoordenadas = sandbox.globalThis.provinciaCoordenadas;
  const agroambientalesDB = sandbox.globalThis.agroambientalesDB;
  const subregionesDB = sandbox.globalThis.subregionesDB;

  if (!cultivosData) {
    throw new Error("cultivosData is not defined on sandbox!");
  }

  console.log("Crops keys count:", Object.keys(cultivosData).length);
  console.log("Provinces in agroambientalesDB count:", Object.keys(agroambientalesDB).length);
  console.log("Subregions provinces count:", Object.keys(subregionesDB).length);

  const cultivos = {};
  const forestales = {};
  for (const [key, crop] of Object.entries(cultivosData)) {
    if (crop.pino_eucalyptus === true) {
      forestales[key] = crop;
    } else {
      cultivos[key] = crop;
    }
  }

  const provincias = {};
  for (const [key, display] of Object.entries(agroDB)) {
    provincias[key] = {
      nombre: display,
      coordenadas: provinciaCoordenadas[key] || null,
      datos: agroambientalesDB[key] || null
    };
  }

  const regiones = {
    subregiones: subregionesDB
  };

  fs.writeFileSync('data/cultivos.json', JSON.stringify(cultivos, null, 2));
  fs.writeFileSync('data/forestales.json', JSON.stringify(forestales, null, 2));
  fs.writeFileSync('data/provincias.json', JSON.stringify(provincias, null, 2));
  fs.writeFileSync('data/regiones.json', JSON.stringify(regiones, null, 2));

  console.log("All JSON files exported successfully under /data!");
} catch (e) {
  console.error("Error evaluating script.js:", e);
}
