import { Chord, Note } from "tonal";
import { qualityOf, transposeSymbol, intervalTo, optionsFor, isAdornment } from "./rules.js";
import { openStrings, PRESETS, bestChain } from "./reharm.js";
import { dbSpelling, playablePositions, MAX_FRET, STRINGS } from "./guitar.js";
import { noteName } from "./notes.js";

// Forma que se toca (relativa a la cejilla) para que suene `symbol` con cejilla
// en `capo`: el mismo acorde transpuesto hacia abajo tantos semitonos como trastes.
// El destino se nombra con la grafía de la base de datos de diagramas y no con la
// de la tonalidad, porque aquí se nombra una forma que se toca, no un acorde de
// la canción, y es esa grafía la que tiene dibujo.
export const shapeSymbol = (symbol, capo) => {
  const tonic = Chord.get(symbol).tonic;
  const down = dbSpelling(noteName(Note.chroma(tonic) - capo));
  return transposeSymbol(symbol, intervalTo(tonic, down));
};

// Lista blanca de extensiones por calidad: semitonos desde la raíz → sufijo.
// Lo que no está aquí (b9, #11, b13…) se descarta: choca más que colorea.
// Hay tabla aparte para cuando el acorde ya lleva séptima, porque la séptima
// sigue sonando y el nombre tiene que contarlo: la novena al aire sobre un maj7
// da un maj9, no un add9, y sobre un m7 un m9, no un madd9.
const EXT = {
  maj: { 2: "add9", 5: "sus4", 9: "6", 11: "maj7" },
  maj7: { 2: "maj9", 5: "sus4", 9: "maj13" },
  min: { 2: "madd9", 5: "m11", 9: "m6", 10: "m7" },
  min7: { 2: "m9", 5: "m11", 9: "m13" },
  dom: { 2: "9", 5: "7sus4", 9: "13" },
};

// Qué tabla toca: la calidad, y si ya hay séptima, su versión con séptima.
const extTable = c => {
  const kind = qualityOf(c);
  if (kind === "maj" && c.intervals.includes("7M")) return EXT.maj7;
  if (kind === "min" && c.intervals.includes("7m")) return EXT.min7;
  return EXT[kind];
};

// Para cada cejilla 0..maxFret, qué cuerdas al aire extienden cada acorde de la
// progresión (sin digitaciones: eso lo pone el guitarrista). Ordenado de más a
// menos color ganado: acordes cubiertos, luego extensiones totales, luego traste.
export function capoSuggestions(progression, maxFret = 7) {
  const chords = [...new Map(progression.map(c => [c.symbol, c])).values()];
  const out = [];
  for (let capo = 0; capo <= maxFret; capo++) {
    const perChord = [];
    for (const c of chords) {
      const ext = extTable(c);
      if (!ext) continue; // dim: sin extensiones de cuerda al aire
      const root = Note.chroma(c.tonic);
      const tones = new Set(c.notes.map(Note.chroma));
      const seen = new Set();
      const extensions = [];
      for (const [i, [string, open]] of STRINGS.entries()) {
        const sounding = (open + capo) % 12; // solo importa el croma de la cuerda pisada por la cejilla
        const suffix = ext[(sounding - root + 12) % 12];
        if (!suffix || tones.has(sounding) || seen.has(suffix)) continue;
        seen.add(suffix);
        extensions.push({ string, stringIdx: i, note: noteName(sounding), as: c.tonic + suffix });
      }
      if (extensions.length) perChord.push({ chord: c.symbol, extensions });
    }
    if (perChord.length) out.push({ capo, perChord });
  }
  const total = p => p.perChord.reduce((n, x) => n + x.extensions.length, 0);
  return out.sort((a, b) => b.perChord.length - a.perChord.length || total(b) - total(a) || a.capo - b.capo);
}

// Qué cejilla en estándar da los mismos colores que una afinación: la más baja
// cuyas cuerdas al aire contienen todas las notas al aire de la afinación. Los
// colores de arriba dependen solo de qué notas suenan al aire, no de en qué
// cuerda ni en qué octava, así que esa cejilla ofrece al menos los mismos.
// Medido (2026-11-22): las quince afinaciones con nombre caben en una sola
// cejilla (Open G sin ella, CGCGCD en la 3, Open C en la 5…) y sobre catorce
// progresiones ni uno de sus 1.201 colores faltaba en la pestaña Cejilla. Lo
// que reafinar da de verdad es dónde suenan —bordón, registro, más cuerdas al
// aire a la vez—, no qué colores. Null si no cabe en ninguna (una afinación
// personalizada rara); puede devolver 8 a 11, más allá de lo que prueba Cejilla.
export function colorCapo(midis) {
  const standard = new Set(STRINGS.map(([, m]) => m % 12));
  const open = [...new Set(midis.map(m => m % 12))];
  for (let capo = 0; capo < 12; capo++) {
    if (open.every(c => standard.has((c - capo + 12) % 12))) return capo;
  }
  return null;
}

// ── Arreglo con cuerdas al aire ─────────────────────────────────────────────
//
// Lo de arriba dice qué colores pone a tu alcance cada cejilla; esto dice cómo
// se toca la progresión para aprovecharlos: la cadena de digitaciones, solo con
// adornos (el color cambia, la función no), que mejor cumpla una intención.
// Por defecto la resonante —el máximo de cuerdas al aire y de notas quietas, que
// en guitarra son la misma cosa: una cuerda al aire común a dos acordes seguidos
// sigue sonando sola mientras la mano se va a otro sitio—, pero vale cualquiera
// de los presets: la línea de arriba que baja o sube, el pedal, el movimiento
// mínimo, la continuidad. Es la antigua pestaña Rearmonizar con la cejilla como
// dimensión y sin sustituciones de verdad, que son cosa de Sustituciones.
//
// Medido (2026-11-22) sobre 14 progresiones comunes contra aquella pestaña: la
// línea descendente sale perfecta en 13 frente a 9 y la ascendente en 14 frente
// a 12; lo que se dejaba eran 5 cambios en 42 versiones de línea y, en
// continuidad y resonancia, casi siempre la línea cromática interna, que está en
// Sustituciones a un clic.
export const RESONANT = PRESETS.find(p => p.id === "resonance");

// ponytail: peaje fijo por adornar, fuera del vocabulario de pesos; es el mando
// de cuántos adornos salen, no parte del coste de encadenar.
const nodeCostFor = preset => n => -(preset.w.open ?? 0) * n.open + (n.rule ? 1 : 0);

// Para cada cejilla, el mejor arreglo que se puede tocar detrás de ella. Null si
// la BD no da digitaciones para alguno de los acordes.
function arrangement(db, progression, capo, preset) {
  const layers = optionsFor(progression).map(options => options
    .filter(isAdornment)
    .flatMap(o => playablePositions(db, shapeSymbol(o.chords[0], capo))
      // Los trastes de la forma se cuentan desde la cejilla, así que lo que hay
      // que comprobar es dónde caen de verdad en el mástil.
      .filter(v => v.frets.every(f => capo + f <= MAX_FRET))
      .map(v => ({ ...v, open: openStrings(v.frets), sounding: o.chords[0], rule: o.rule }))));
  if (layers.some(l => !l.length)) return null;

  const chain = bestChain(layers, preset, nodeCostFor(preset));
  const still = chain.slice(1).reduce((n, p, i) =>
    n + p.frets.filter((f, s) => f >= 0 && f === chain[i].frets[s]).length, 0);
  // La voz de arriba en lo que suena: la forma se toca desde la cejilla.
  const tops = chain.map(n => n.top + capo);
  const moves = tops.slice(1).map((t, i) => t - tops[i]);
  return {
    capo,
    preset,
    cost: chain.at(-1).total,
    steps: chain.map((n, i) => ({
      sounding: n.sounding,
      shape: n.symbol,
      position: n.position,
      frets: n.frets,
      open: n.open,
      top: tops[i],
      topNote: noteName(tops[i]),
      rule: n.rule,
      changed: n.sounding !== progression[i].symbol,
    })),
    open: chain.reduce((n, x) => n + x.open, 0),
    still,
    line: tops.map(noteName),
    moves: moves.length,
    conjunct: moves.filter(d => d && Math.abs(d) <= 2).length,
    held: moves.filter(d => d === 0).length,
    leaps: moves.filter(d => Math.abs(d) > 4).length,
  };
}

// Las cejillas ordenadas por lo bien que cumplen la intención. La resonante, por
// lo que resuena: cuerdas al aire primero, luego notas quietas, y a igualdad el
// traste más bajo, que es el que menos aprieta la mano. Las demás, por su coste:
// mismo preset y misma progresión en todas las cejillas, así que es comparable.
export function capoArrangements(db, progression, maxFret = 7, preset = RESONANT) {
  const out = [];
  for (let capo = 0; capo <= maxFret; capo++) {
    const a = arrangement(db, progression, capo, preset);
    if (a) out.push(a);
  }
  return preset === RESONANT
    ? out.sort((x, y) => y.open - x.open || y.still - x.still || x.capo - y.capo)
    : out.sort((x, y) => x.cost - y.cost || x.capo - y.capo);
}
