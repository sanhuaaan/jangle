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

// Las líneas de un arreglo: una por voz, una celda por acorde (o null donde la
// voz no suena). Cada voz del primer acorde abre una línea; cuando pairVoices
// deja una voz sin pareja, la línea se corta, y la que aparece abre la suya.
// Van de agudo a grave, como en una partitura.
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
    next.forEach((v, j) => {
      if (following[j]) return;
      const l = line(n);
      l.cells[k] = cell(v);
      lines.push(l);
      following[j] = l;
    });
    active = following;
  }
  const first = l => l.cells.find(Boolean).midi;
  lines.sort((a, b) => first(b) - first(a));
  return { lines, transitions, runs: runsOf(lines) };
}

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
