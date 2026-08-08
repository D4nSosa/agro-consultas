const fs = require('fs');

const cultivosPath = 'data/cultivos.json';
const forestalesPath = 'data/forestales.json';

const cultivos = JSON.parse(fs.readFileSync(cultivosPath, 'utf8'));
const forestales = JSON.parse(fs.readFileSync(forestalesPath, 'utf8'));

// Base structured requirements for specific known crops
const cropRequirements = {
  "yerba mate": {
    suelo: { phMin: 4.5, phMax: 6.0, drenaje: ["bueno", "moderado"], texturas: ["franca", "arcillosa"] },
    clima: { precipitacionMin: 1500, temperaturaMin: 18, temperaturaMax: 28 }
  },
  "te": {
    suelo: { phMin: 4.5, phMax: 6.0, drenaje: ["bueno"], texturas: ["franca"] },
    clima: { precipitacionMin: 1600, temperaturaMin: 15, temperaturaMax: 25 }
  },
  "pino taeda": {
    suelo: { phMin: 4.5, phMax: 6.0, drenaje: ["bueno", "moderado"], texturas: ["franca", "arenosa"] },
    clima: { precipitacionMin: 1200, temperaturaMin: 12, temperaturaMax: 26 }
  },
  "pino elliottii": {
    suelo: { phMin: 4.5, phMax: 6.2, drenaje: ["bueno", "moderado", "pobre"], texturas: ["franca", "arenosa", "arcillosa"] },
    clima: { precipitacionMin: 1000, temperaturaMin: 10, temperaturaMax: 26 }
  },
  "eucalyptus grandis": {
    suelo: { phMin: 5.0, phMax: 6.5, drenaje: ["bueno", "moderado"], texturas: ["franca", "arenosa"] },
    clima: { precipitacionMin: 1100, temperaturaMin: 14, temperaturaMax: 28 }
  },
  "eucalyptus globulus": {
    suelo: { phMin: 5.5, phMax: 7.0, drenaje: ["bueno", "moderado"], texturas: ["franca", "arenosa", "arcillosa"] },
    clima: { precipitacionMin: 800, temperaturaMin: 10, temperaturaMax: 22 }
  },
  "alfalfa": {
    suelo: { phMin: 6.2, phMax: 7.8, drenaje: ["bueno"], texturas: ["franca", "franco-limosa"] },
    clima: { precipitacionMin: 600, temperaturaMin: 5, temperaturaMax: 30 }
  },
  "soja": {
    suelo: { phMin: 6.0, phMax: 7.5, drenaje: ["bueno", "moderado"], texturas: ["franca", "franco-limosa", "franco-arcillosa"] },
    clima: { precipitacionMin: 700, temperaturaMin: 15, temperaturaMax: 32 }
  },
  "trigo": {
    suelo: { phMin: 6.0, phMax: 7.5, drenaje: ["bueno", "moderado"], texturas: ["franca", "franco-limosa", "franco-arcillosa"] },
    clima: { precipitacionMin: 500, temperaturaMin: 5, temperaturaMax: 25 }
  },
  "maiz": {
    suelo: { phMin: 6.0, phMax: 7.5, drenaje: ["bueno", "moderado"], texturas: ["franca", "franco-limosa", "franco-arcillosa"] },
    clima: { precipitacionMin: 600, temperaturaMin: 10, temperaturaMax: 30 }
  },
  "cebada": {
    suelo: { phMin: 6.0, phMax: 8.2, drenaje: ["bueno", "moderado"], texturas: ["franca", "franco-limosa", "franco-arcillosa"], tolerancias: ["salinidad"] },
    clima: { precipitacionMin: 400, temperaturaMin: 5, temperaturaMax: 24 }
  },
  "olivo": {
    suelo: { phMin: 6.0, phMax: 8.5, drenaje: ["bueno", "excelente"], texturas: ["franca", "arenosa", "pedregosa"], tolerancias: ["salinidad", "tosca"] },
    clima: { precipitacionMin: 350, temperaturaMin: 10, temperaturaMax: 35 }
  },
  "arroz": {
    suelo: { phMin: 5.5, phMax: 7.0, drenaje: ["pobre", "moderado", "lento"], texturas: ["arcillosa", "franco-arcillosa"] },
    clima: { precipitacionMin: 1200, temperaturaMin: 18, temperaturaMax: 35 }
  },
  "mani": {
    suelo: { phMin: 5.8, phMax: 7.2, drenaje: ["bueno", "excelente"], texturas: ["arenosa", "franco-arenosa"] },
    clima: { precipitacionMin: 550, temperaturaMin: 15, temperaturaMax: 30 }
  },
  "papa": {
    suelo: { phMin: 5.5, phMax: 6.8, drenaje: ["bueno", "excelente"], texturas: ["arenosa", "franca", "franco-arenosa"] },
    clima: { precipitacionMin: 600, temperaturaMin: 10, temperaturaMax: 22 }
  }
};

// Enrich crops in cultivos.json
for (const [key, crop] of Object.entries(cultivos)) {
  if (cropRequirements[key]) {
    crop.requerimientos = cropRequirements[key];
  } else {
    // Non-invented requirements are set to null/unspecified as requested
    crop.requerimientos = {
      suelo: { phMin: null, phMax: null, drenaje: null, texturas: null },
      clima: { precipitacionMin: null, temperaturaMin: null, temperaturaMax: null }
    };
  }
}

// Enrich crops in forestales.json
for (const [key, crop] of Object.entries(forestales)) {
  if (cropRequirements[key]) {
    crop.requerimientos = cropRequirements[key];
  } else {
    crop.requerimientos = {
      suelo: { phMin: null, phMax: null, drenaje: null, texturas: null },
      clima: { precipitacionMin: null, temperaturaMin: null, temperaturaMax: null }
    };
  }
}

fs.writeFileSync(cultivosPath, JSON.stringify(cultivos, null, 2));
fs.writeFileSync(forestalesPath, JSON.stringify(forestales, null, 2));

console.log("Crops and forestry files enriched with structured requirements successfully!");
