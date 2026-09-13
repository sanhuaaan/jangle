// Construye progressions.json: las progresiones más comunes del tomo De Chordis
// Mysteriis (hilo 4, guardado en archived/), como firmas con cuántas canciones
// las llevan. Es la fuente del generador de progresiones (MEJORAS, hilo 10): no
// hace falta reconectar el catálogo, solo este fichero, construido una vez.
//
// La firma es la de archived/catalog.js: por acorde, semitonos de su fundamental
// sobre la del primero y su familia (M, m, d, a, s, 5), separados por punto. Se
// guardan tal cual, sin fundir rotaciones: Em C D G y C D G Em son bucles
// iguales pero se empiezan distinto, y eso el generador quiere elegirlo.
//
//   node progressions.mjs            # lee los cubos publicados (48 MB, 2.048 peticiones)
//   node progressions.mjs <dir>      # o de una copia local con <dir>/4/*.json y <dir>/3/*.json

import { readFileSync, writeFileSync } from "node:fs";

const BASE = "https://sanhuaaan.github.io/de-chordis-mysteriis";
const LENGTHS = [4, 3];
const MIN_SONGS = 100; // una progresión que llevan cien canciones es una progresión común
const BUCKETS = 1024;  // los que reparte fingerprint() en archived/catalog.js
const local = process.argv[2];

const bucket = async (n, h) => {
  if (local) return JSON.parse(readFileSync(`${local}/${n}/${h}.json`, "utf8"));
  const r = await fetch(`${BASE}/progresiones/${n}/${h}.json`);
  if (!r.ok) throw new Error(`${n}/${h}: ${r.status}`);
  return r.json();
};

// Unas cuantas peticiones a la vez, que son dos mil.
async function pool(items, width, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: width }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

const lengths = {};
for (const n of LENGTHS) {
  const hexes = Array.from({ length: BUCKETS }, (_, i) => i.toString(16).padStart(3, "0"));
  const all = await pool(hexes, 16, h => bucket(n, h));
  const rows = [];
  for (const obj of all) for (const [sig, [total]] of Object.entries(obj)) if (total >= MIN_SONGS) rows.push([sig, total]);
  rows.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  lengths[n] = rows;
  console.error(`${n} acordes: ${rows.length} firmas con ≥ ${MIN_SONGS} canciones (la primera lleva ${rows[0][1]})`);
}

writeFileSync("progressions.json", JSON.stringify({
  version: 1,
  source: "De Chordis Mysteriis — ailsntua/Chordonomicon (CC BY-NC 4.0)",
  minSongs: MIN_SONGS,
  lengths,
}));
