import { Chord, Note } from "tonal";
import { parseProgression, detectKey, transposeSymbol, intervalTo } from "./rules.js";
import { reharmonize, PRESETS } from "./reharm.js";
import { KEYS } from "./notes.js";

// Una progresión común para empezar a componer. Las pestañas consumen una
// progresión; quien compone no la tiene todavía. De aquí sale una que suena a
// canción y da de sí en la guitarra, para partir de ella e irla alterando.
//
// Dos fuentes, y ninguna sobra: el tomo (progressions.json, las firmas que más
// canciones llevan en De Chordis Mysteriis) dice qué suena a canción, y el motor
// de rearmonizar con el preset resonante dice cuánto suena en el instrumento.
// Medido antes de hacerlo: las más comunes no son las que más dan de sí
// (correlación de rango 0,1–0,45 según el tono), así que se sortean unas cuantas
// por frecuencia y se ordenan por resonancia.

// La firma es la del tomo (archived/catalog.js): por acorde, semitonos de su
// fundamental sobre la del primero y familia. Aquí solo hace falta leerla. La
// familia s no distingue sus2 de sus4: para partir de algo, sus2, y que la
// pestaña de sustituciones lo cambie si hace falta.
const FAMILY = { M: "", m: "m", d: "dim", a: "aug", s: "sus2", 5: "5" };
export const parseSignature = sig => sig.split(".").map(t => [parseInt(t, 10), t.slice(-1)]);

// Em C D G y C D G Em son el mismo bucle empezado en otro sitio, y en el tomo la
// mitad de las firmas frecuentes son rotaciones de otra. Para elegir se funden
// —la forma canónica es la rotación que ordena primero—; para arrancar se
// respeta la rotación sorteada, que es por donde más canciones empiezan.
export function canonical(sig) {
  const p = parseSignature(sig);
  return p.map((_, i) => {
    const r = [...p.slice(i), ...p.slice(0, i)];
    return r.map(([o, f]) => ((o - r[0][0] + 12) % 12) + f).join(".");
  }).sort()[0];
}

const MAJOR = new Set([0, 2, 4, 5, 7, 9, 11]);

// Realizar una firma en un tono. De los doce arranques posibles gana el que
// detectKey lee en ese tono —lo mismo que va a decir el analizador al recibirla,
// que si no la tarjeta diría "en Sol" y la columna "Tonalidad estimada: Do"— y,
// entre esos, el que más notas diatónicas mete. Por eso I ♭VII IV I no existe
// aquí: sale como V IV I V, que es como lo lee la app entera (solo sabe de
// mayores). Los bucles eólicos se leen en su relativo mayor y entran igual. Si
// ninguna lectura cae en el tono (I ♭VI ♭VII I no cabe en ninguno), el primer
// acorde hace de casa: sobre la tónica si es mayor, sobre el vi si es menor.
// Se escribe en Do y se transporta por intervalo, que es lo que da la grafía de
// la tonalidad: en Mi sale G#m, no Abm.
export function realize(sig, key) {
  const p = parseSignature(sig);
  const shift = intervalTo("C", KEYS[key]);
  let best = null;
  let home = null;
  for (let r = 0; r < 12; r++) {
    const syms = p.map(([o, f]) => transposeSymbol(KEYS[(r + o) % 12] + FAMILY[f], shift));
    const chords = syms.map(s => Chord.get(s));
    if ((r + key) % 12 === (/[md]/.test(p[0][1]) ? 9 : 0)) home = syms;
    if (detectKey(chords) !== key) continue;
    let fit = 0;
    for (const c of chords) for (const n of c.notes) if (MAJOR.has((Note.chroma(n) - key + 12) % 12)) fit++;
    if (!best || fit > best.fit) best = { fit, syms };
  }
  return (best ?? { syms: home }).syms;
}

// Grados romanos respecto al tono, para decir qué es la progresión y no solo
// cómo se llama en ese tono: I V vi IV es lo mismo en Sol que en Mi.
const ROMAN = ["I", "♭II", "II", "♭III", "III", "IV", "♯IV", "V", "♭VI", "VI", "♭VII", "VII"];
export function roman(chords, key) {
  return chords.map(sym => {
    const c = Chord.get(sym);
    const iv = new Set(c.intervals);
    const deg = ROMAN[(Note.chroma(c.tonic) - key + 12) % 12];
    if (iv.has("3m")) return deg.toLowerCase() + (iv.has("5d") ? "°" : "");
    if (iv.has("3M")) return deg + (iv.has("5A") && !iv.has("5P") ? "+" : "");
    return deg + (iv.has("2M") ? "sus2" : iv.has("4P") ? "sus4" : "5");
  }).join(" ");
}

// Cuánto pesa cada firma al sortear. Con rare = 0 pesa lo que lleva, y sale lo
// más común; con rare = 1 pesan todas igual y, como la cola es larguísima, sale
// la rareza. Entre medias, una potencia.
export const weight = (total, rare) => Math.pow(total, 1 - rare);

// Una firma con una sola fundamental (G G7 G Gsus4 es 0M.0M.0M.0s) es un acorde
// adornado, no una progresión: sale del tomo porque las ventanas se cortan sin
// mirar, pero de aquí no.
export const moves = sig => new Set(parseSignature(sig).map(([o]) => o)).size > 1;

// Sortea n bucles distintos según los pesos. Con reposición y fundiendo
// rotaciones, que es más barato que quitar del saco y para veinte da igual.
function draw(all, rare, n, random) {
  const rows = all.filter(([sig]) => moves(sig));
  const cum = [];
  let acc = 0;
  for (const [, t] of rows) cum.push(acc += weight(t, rare));
  const out = [];
  const seen = new Set();
  for (let tries = 0; out.length < n && tries < n * 20; tries++) {
    const x = random() * acc;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < x) lo = mid + 1; else hi = mid; }
    const [sig, total] = rows[lo];
    const c = canonical(sig);
    if (seen.has(c)) continue;
    seen.add(c);
    out.push({ sig, total });
  }
  return out;
}

const RESONANCE = PRESETS.find(p => p.id === "resonance");

// Sugerencias en un tono: se sortean `draw` bucles por frecuencia, se realizan
// y se ordenan por las cuerdas al aire por acorde del mejor arreglo resonante,
// que es lo que mide cuánto da de sí la progresión una vez adornada. Sin la BD
// de digitaciones no hay criba y manda la frecuencia.
export function propose(db, data, { key, length = 4, rare = 0.25, draw: n = 24, keep = 6, random = Math.random } = {}) {
  const out = [];
  for (const { sig, total } of draw(data.lengths[length] ?? [], rare, n, random)) {
    const chords = realize(sig, key);
    let prog;
    try { prog = parseProgression(chords.join(" ")); } catch { continue; }
    let open = null;
    if (db) {
      const v = reharmonize(db, prog, RESONANCE);
      if (!v) continue; // algún acorde sin digitación en la BD (los de quinta, por ejemplo)
      open = v.open / v.steps.length;
    }
    out.push({ chords, roman: roman(chords, key), total, open });
  }
  return out.sort((a, b) => (b.open ?? -1) - (a.open ?? -1) || b.total - a.total).slice(0, keep);
}
