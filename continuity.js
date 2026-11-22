import { pairVoices, commonBetween } from "./reharm.js";
import { noteName } from "./notes.js";

// Mapa de continuidad: qué notas se quedan y cuáles se mueven a lo largo de un
// arreglo, voz a voz. No calcula nada que Rearmonizar no calcule ya —el
// emparejamiento de voces es pairVoices y las notas comunes commonBetween—:
// lo que añade es seguir cada voz de acorde en acorde, para ver las líneas que
// atraviesan la progresión entera. De ahí sale la sensación de que una
// progresión flota aunque los nombres de los acordes cambien mucho: tres voces
// que no se mueven mientras el bajo sí.

// Las voces de una digitación, de grave a agudo, con la cuerda de la que salen.
// Se parte de los trastes y no de los midis del paso porque la cejilla y la
// afinación cambian qué suena en cada cuerda, y aquí hacen falta las dos cosas:
// la nota, para seguirla; la cuerda, para decir dónde está en el mástil.
export function voicesOf(frets, tuning, capo = 0) {
  return frets
    .map((f, string) => (f < 0 ? null : { midi: tuning[string] + capo + f, string, fret: f, open: f === 0 }))
    .filter(Boolean)
    .sort((a, b) => a.midi - b.midi);
}

// Los drones de un arreglo: las cuerdas que suenan al aire en todos sus
// acordes. Es la razón musical para reafinar —una nota que no para de sonar
// debajo o encima de todo—, y en el mapa de voces queda repartida entre filas.
// De 6ª a 1ª, con la nota que suena (afinación más cejilla).
export const drones = (steps, tuning, capo = 0) => tuning
  .map((midi, string) => ({ string: `${6 - string}ª`, note: noteName(midi + capo), idx: string }))
  .filter(d => steps.every(s => s.frets[d.idx] === 0))
  .map(({ string, note }) => ({ string, note }));

const line = n => ({ cells: new Array(n).fill(null) });
const cell = (v, from) => {
  const delta = from ? v.midi - from.midi : null;
  return {
    midi: v.midi, note: noteName(v.midi), string: v.string, fret: v.fret, open: v.open,
    delta,
    held: delta === 0,                                   // la misma nota
    still: delta === 0 && from.string === v.string,      // y además el mismo sitio: dedo o cuerda al aire que no se toca
  };
};

// Hasta dónde puede caer una voz que entra de la última nota de la fila que
// ocupa: una quinta. Más lejos ya no se lee como la misma voz.
const REUSE = 7;

// Las líneas de un arreglo: una por voz, una celda por acorde (o null donde la
// voz no suena). Cada voz del primer acorde abre una línea; cuando pairVoices
// deja una voz sin pareja, la línea se corta, y la que aparece ocupa una fila
// que quedó libre —que no sonara en el acorde anterior, para que el hueco diga
// que es otra voz— y cercana en altura; si no hay, abre la suya. Sin eso, un
// bajo que entra y sale en cada acorde (F E F · C E F) se repartía en una
// escalera de filas de una celda. Van de agudo a grave, como en una partitura.
export function voiceLines(steps, tuning, capo = 0) {
  const cols = steps.map(s => voicesOf(s.frets, tuning, capo));
  const n = steps.length;
  const lines = [];
  let active = cols[0].map(v => { const l = line(n); l.cells[0] = cell(v); lines.push(l); return l; });
  const transitions = [];
  for (let k = 1; k < n; k++) {
    const prev = cols[k - 1], next = cols[k];
    const p = pairVoices(prev.map(v => v.midi), next.map(v => v.midi));
    const pcs = vs => ({ pcs: new Set(vs.map(v => v.midi % 12)) });
    transitions.push({ common: commonBetween(pcs(prev), pcs(next)), moved: p.moved, held: p.held, leaps: p.leaps, structural: p.structural, paired: p.pairs.length });
    const following = new Array(next.length).fill(null);
    for (const [i, j] of p.pairs) {
      active[i].cells[k] = cell(next[j], prev[i]);
      following[j] = active[i];
    }
    // Las que entran, a la fila libre más cercana, las parejas más próximas primero.
    const last = l => l.cells.findLast(Boolean).midi;
    const free = lines.filter(l => !l.cells[k - 1] && !l.cells[k]);
    const offers = [];
    next.forEach((v, j) => {
      if (following[j]) return;
      for (const l of free) {
        const d = Math.abs(last(l) - v.midi);
        if (d <= REUSE) offers.push({ j, l, d });
      }
    });
    offers.sort((a, b) => a.d - b.d);
    for (const { j, l } of offers) {
      if (following[j] || l.cells[k]) continue;
      l.cells[k] = cell(next[j]);
      if (!orderable(lines, k)) { l.cells[k] = null; continue; }
      following[j] = l;
    }
    next.forEach((v, j) => {
      if (following[j]) return;
      const l = line(n);
      l.cells[k] = cell(v);
      lines.push(l);
      following[j] = l;
    });
    active = following;
  }
  return { lines: ordered(lines), transitions, runs: runsOf(lines) };
}

// Qué fila va sobre cuál: en cada columna, la que suena más aguda encima. Hasta
// la columna `upTo`, que al reaprovechar filas solo cuenta lo ya colocado.
function stacking(lines, upTo = (lines[0]?.cells.length ?? 0) - 1) {
  const below = new Map(lines.map(l => [l, new Set()]));
  const above = new Map(lines.map(l => [l, 0]));
  for (let k = 0; k <= upTo; k++) {
    // Por alturas: todas las de una altura, sobre todas las de la siguiente
    // (dos voces en la misma nota no dicen nada entre ellas).
    const groups = new Map();
    for (const l of lines) if (l.cells[k]) groups.set(l.cells[k].midi, [...(groups.get(l.cells[k].midi) ?? []), l]);
    const heights = [...groups.keys()].sort((a, b) => b - a);
    for (let i = 1; i < heights.length; i++) {
      for (const hi of groups.get(heights[i - 1])) {
        for (const lo of groups.get(heights[i])) {
          if (below.get(hi).has(lo)) continue;
          below.get(hi).add(lo);
          above.set(lo, above.get(lo) + 1);
        }
      }
    }
  }
  return { below, above };
}

// Las filas en orden, de aguda a grave. Ninguna nota sola representa una fila
// —una voz sube, baja, entra y sale—, así que se respeta a la vez lo que dice
// cada columna y la altura media decide lo que las columnas dejan libre. Si no
// hay orden posible sin cruzar dos voces, devuelve las que se quedan sin sitio
// al final de `out` con `ok` en falso.
function stack(lines, upTo) {
  const { below, above } = stacking(lines, upTo);
  const mean = l => { const cs = l.cells.filter(Boolean); return cs.reduce((a, c) => a + c.midi, 0) / cs.length; };
  const height = new Map(lines.map(l => [l, mean(l)]));
  const out = [];
  const left = new Set(lines);
  let ok = true;
  while (left.size) {
    const ready = [...left].filter(l => !above.get(l));
    if (!ready.length) ok = false;
    const pick = (ready.length ? ready : [...left]).reduce((a, b) => (height.get(b) > height.get(a) ? b : a));
    left.delete(pick);
    out.push(pick);
    for (const l of below.get(pick)) above.set(l, above.get(l) - 1);
  }
  return { out, ok };
}

// Una fila solo se reaprovecha si después sigue habiendo una manera de
// ordenarlas todas sin cruzar dos voces en ninguna columna.
const orderable = (lines, k) => stack(lines, k).ok;
const ordered = lines => stack(lines).out;

// Las rachas: una nota que se queda dos, tres, cuatro acordes seguidos. Es lo
// que se busca a simple vista en el mapa y lo que se cuenta debajo. Ordenadas
// de más larga a más corta y, a igualdad, de aguda a grave.
function runsOf(lines) {
  const runs = [];
  for (const l of lines) {
    let start = -1;
    l.cells.forEach((c, k) => {
      if (c && (start === -1 || !c.held)) { if (start !== -1 && k - start > 1) runs.push({ note: l.cells[start].note, from: start, length: k - start, midi: l.cells[start].midi }); start = k; }
      if (!c && start !== -1) { if (k - start > 1) runs.push({ note: l.cells[start].note, from: start, length: k - start, midi: l.cells[start].midi }); start = -1; }
    });
    if (start !== -1 && l.cells.length - start > 1) runs.push({ note: l.cells[start].note, from: start, length: l.cells.length - start, midi: l.cells[start].midi });
  }
  return runs.sort((a, b) => b.length - a.length || b.midi - a.midi);
}
