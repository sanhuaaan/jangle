import { optionsFor, detectKey } from "./rules.js";
import { playablePositions, STRINGS } from "./guitar.js";
import { noteName } from "./notes.js";

// Rearmonizar la progresión entera en vez de acorde a acorde. La pestaña de
// sustituciones da opciones sueltas; aquí se eligen unas cuantas que encajen
// entre sí, y el criterio para encajar lo pone un sistema de costes con pesos:
// cada preset premia un aspecto —la línea de arriba, el movimiento mínimo, las
// notas comunes, las cuerdas al aire— y el mismo motor encuentra el arreglo que
// mejor lo sirve. No hay una versión correcta: hay varias lecturas de la misma
// progresión.
//
// Es un camino mínimo sobre un grafo por capas: cada hueco de la progresión
// ofrece varios acordes, cada acorde varias digitaciones, y el coste de
// encadenar dos digitaciones lo pone el preset. Viterbi encuentra la cadena
// entera de una pasada.

// Cada preset es un vector de pesos sobre la misma función de coste. `dir` solo
// pinta cuando se paga `movTop`: -1 quiere la línea bajando, +1 subiendo, 0
// quieta. No es una imposición: es lo que sale barato, así que si la progresión
// no da para ello se cede en vez de fallar.
export const PRESETS = [
  {
    id: "descending", dir: -1,
    name: "Línea descendente",
    why: "La voz de arriba cae por grados conjuntos. Es el recurso más socorrido para que una progresión estática tire hacia delante.",
    w: { topMove: 1, hand: 0.4 },
  },
  {
    id: "ascending", dir: 1,
    name: "Línea ascendente",
    why: "La voz de arriba sube paso a paso, que empuja y abre. Funciona bien en un puente o subiendo a un estribillo.",
    w: { topMove: 1, hand: 0.4 },
  },
  {
    id: "pedal", dir: 0,
    name: "Nota pedal arriba",
    why: "La misma nota aguda se mantiene mientras los acordes cambian por debajo. Da unidad y hace que los cambios suenen a color, no a movimiento.",
    w: { topMove: 1, hand: 0.4 },
  },
  {
    id: "minimal",
    name: "Movimiento mínimo",
    why: "Cada voz va a lo que tiene más cerca: los acordes se funden uno en otro casi sin mover ni la mano ni el oído.",
    w: { voiceMove: 1, leap: 3, structure: 2, hand: 0.4 },
  },
  {
    id: "continuity",
    name: "Máxima continuidad",
    why: "Las notas que dos acordes comparten se quedan sonando donde están; cambia lo justo para que el cambio se note.",
    w: { common: 1.5, still: 2, structure: 2, voiceMove: 0.3, hand: 0.4 },
  },
  {
    id: "resonance",
    name: "Máxima resonancia",
    why: "Manda la caja: cuantas más cuerdas al aire y más dedos quietos, más suena la guitarra sola.",
    w: { open: 3, still: 2, stillOpen: 2, common: 0.5, hand: 0.4 },
  },
];

// ── Emparejamiento de voces ─────────────────────────────────────────────────
//
// Qué voz de un voicing se convierte en qué voz del siguiente. Con las notas
// ordenadas de grave a agudo, el emparejamiento de movimiento total mínimo
// nunca cruza dos voces, así que basta un alineamiento por programación
// dinámica: emparejar las dos siguientes o dejar una sin pareja (una voz que
// aparece o desaparece), con un peaje fijo que decide cuándo compensa lo uno o
// lo otro.
const UNPAIRED = 4; // semitonos que "cuesta" una voz sin pareja al alinear

export function pairVoices(a, b) {
  const D = Array.from({ length: a.length + 1 }, (_, i) => {
    const row = new Array(b.length + 1).fill(0);
    row[0] = i * UNPAIRED;
    return row;
  });
  for (let j = 1; j <= b.length; j++) D[0][j] = j * UNPAIRED;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      D[i][j] = Math.min(
        D[i - 1][j - 1] + Math.abs(a[i - 1] - b[j - 1]),
        D[i - 1][j] + UNPAIRED,
        D[i][j - 1] + UNPAIRED,
      );
    }
  }
  // Vuelta atrás para contar qué pasó: semitonos movidos, voces que no se
  // mueven, saltos grandes y voces que se quedaron sin pareja.
  let i = a.length, j = b.length, moved = 0, held = 0, leaps = 0, structural = 0;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + Math.abs(a[i - 1] - b[j - 1])) {
      const d = Math.abs(a[i - 1] - b[j - 1]);
      moved += d;
      if (d === 0) held++;
      if (d > 4) leaps++;
      i--; j--;
    } else if (i > 0 && D[i][j] === D[i - 1][j] + UNPAIRED) { structural++; i--; }
    else { structural++; j--; }
  }
  return { moved, held, leaps, structural };
}

export const openStrings = frets => frets.filter(f => f === 0).length;
const stillBetween = (a, b) => a.frets.reduce((n, f, i) => n + (f >= 0 && f === b.frets[i] ? 1 : 0), 0);
// Una nota quieta que además es al aire cuenta doble: no se toca ni al cambiar.
const stillOpenBetween = (a, b) => a.frets.reduce((n, f, i) => n + (f === 0 && b.frets[i] === 0 ? 1 : 0), 0);
const commonBetween = (a, b) => [...a.pcs].filter(x => b.pcs.has(x)).length;

// Lo que cuesta encadenar dos digitaciones según el preset. Cada factor mide
// una cosa y el peso dice cuánto importa; lo que pesa cero ni se calcula.
// Lo comparte la pestaña de cejilla: su arreglo es este mismo coste con el
// preset resonante, con la cejilla como dimensión extra de búsqueda.
export function linkCost(prev, next, preset) {
  const w = preset.w;
  let cost = (w.hand ?? 0) * Math.abs(next.baseFret - prev.baseFret); // saltos de mano por el mástil
  if (w.topMove) {
    // Manda el salto de la voz superior: el grado conjunto sale gratis porque
    // es lo que hace línea, repetir nota cuesta poco, y el salto se paga caro.
    const delta = next.top - prev.top;
    const step = Math.abs(delta);
    let top = step === 0 ? (preset.dir === 0 ? 0 : 3)
      : step <= 2 ? (preset.dir === 0 ? 5 : 0)
      : step <= 4 ? 6
      : 12 + step;
    if (preset.dir !== 0 && Math.sign(delta) === -preset.dir) top += 7; // se va en contra de la línea
    if (next.topString !== 5) top += 1.5; // mejor que la línea caiga en la 1ª cuerda
    cost += w.topMove * top;
  }
  if (w.voiceMove || w.structure || w.leap) {
    const p = pairVoices(prev.midis, next.midis);
    cost += (w.voiceMove ?? 0) * p.moved
      + (w.structure ?? 0) * p.structural
      + (w.leap ?? 0) * p.leaps;
  }
  if (w.still) cost -= w.still * stillBetween(prev, next);
  if (w.stillOpen) cost -= w.stillOpen * stillOpenBetween(prev, next);
  if (w.common) cost -= w.common * commonBetween(prev, next);
  return cost;
}

// Sustituir tiene que ganarse el sitio, pero barato: quien de verdad limita los
// cambios es el presupuesto de abajo. Meter acordes de más densifica la
// progresión, así que eso sí se cobra aparte. Adornar (un maj7, una 9ª) no
// cambia de acorde, así que cuesta menos que cambiarlo por otro.
// El primer acorde es el que planta la tonalidad: cambiarlo desdibuja la canción
// de entrada, así que se cobra aparte y solo cae si compensa de sobra.
const optionCost = (option, slot) =>
  (option.rule ? (option.kind === "color" ? 0.4 : 0.8) : 0)
  + (option.chords.length - 1) * 1.5
  + (option.rule && slot === 0 ? 6 : 0);

// Cuánto presupuesto gasta cada opción. Se cuenta en medios para que un adorno
// valga la mitad que una sustitución de verdad: con dos docenas de reglas, si
// todas costasen lo mismo el arreglo se iría en maj7 y se quedaría sin cambiar
// un solo acorde.
const budgetCost = option => (!option.rule ? 0 : option.kind === "color" ? 1 : 2);

// Cuántas digitaciones se prueban por acorde. Las opciones que meten varios
// acordes multiplican combinaciones (tres acordes a cinco digitaciones son 125
// caminos por hueco), así que ahí se recorta: con dos por acorde ya hay de sobra
// para que la línea encuentre por dónde ir.
const voicingsFor = (option, max) => (option.chords.length > 2 ? 2 : option.chords.length > 1 ? 3 : max);

// Un cambio que deja el mismo acorde dos veces seguidas donde el original tenía
// movimiento no es rearmonizar: es quedarse sin un acorde. Si la repetición ya
// venía en el original se respeta, que para eso la escribió quien la escribió.
const repeatCost = (prevSym, nextSym, prevOrig, nextOrig) =>
  prevSym === nextSym && prevOrig !== nextOrig ? 30 : 0;

// Cuántos acordes como mucho se permite tocar. Con peaje y sin tope, o no
// sustituye nunca o sustituye en todas partes: un Fm prestado en el sitio justo
// es un hallazgo, y en cada compás es otra canción. Un tercio de la progresión.
const budgetFor = progression => Math.max(1, Math.round(progression.length / 3));

// Devuelve la progresión rearmonizada según `preset`, o null si la BD no da
// digitaciones para alguno de los acordes originales.
export function reharmonize(db, progression, preset, maxVoicings = 5) {
  const key = detectKey(progression);
  const cache = new Map();
  const voi = (sym, max) => {
    if (!cache.has(sym)) cache.set(sym, playablePositions(db, sym, maxVoicings));
    return cache.get(sym).slice(0, max);
  };

  // Cada capa son los caminos posibles dentro de un hueco: una opción de acorde
  // con una digitación elegida para cada uno de sus acordes.
  const layers = optionsFor(progression, key).map((options, slot) => {
    const nodes = [];
    for (const option of options) {
      const per = voicingsFor(option, maxVoicings);
      const chains = option.chords.reduce(
        (acc, sym) => acc.flatMap(chain => voi(sym, per).map(v => [...chain, v])),
        [[]],
      );
      for (const chain of chains) {
        let internal = optionCost(option, slot);
        for (const v of chain) internal -= (preset.w.open ?? 0) * openStrings(v.frets);
        for (let k = 1; k < chain.length; k++) internal += linkCost(chain[k - 1], chain[k], preset);
        nodes.push({ option, chain, internal });
      }
    }
    return nodes;
  });
  if (layers.some(l => !l.length)) return null; // algún acorde sin digitación en la BD

  // Viterbi con el presupuesto de sustituciones dentro del estado: para cada
  // hueco se guarda el mejor camino que llega habiendo gastado b cambios.
  const budget = budgetFor(progression) * 2; // en medios: adornar cuesta 1, cambiar 2
  layers.forEach((layer, i) => {
    for (const node of layer) {
      node.costs = new Array(budget + 1).fill(Infinity);
      node.froms = new Array(budget + 1).fill(null);
      const used = budgetCost(node.option);
      if (i === 0) {
        if (used <= budget) node.costs[used] = node.internal;
        continue;
      }
      for (const p of layers[i - 1]) {
        const link = linkCost(p.chain.at(-1), node.chain[0], preset)
          + repeatCost(p.chain.at(-1).symbol, node.chain[0].symbol, progression[i - 1].symbol, progression[i].symbol);
        for (let b = 0; b <= budget; b++) {
          if (p.costs[b] === Infinity || b + used > budget) continue;
          const c = p.costs[b] + link + node.internal;
          if (c < node.costs[b + used]) {
            node.costs[b + used] = c;
            node.froms[b + used] = { node: p, budget: b };
          }
        }
      }
    }
  });

  // El mejor final entre todos los presupuestos, y vuelta atrás por los punteros.
  let best = null;
  for (const node of layers.at(-1)) {
    for (let b = 0; b <= budget; b++) {
      if (node.costs[b] < (best?.cost ?? Infinity)) best = { node, budget: b, cost: node.costs[b] };
    }
  }
  if (!best) return null;
  const path = [];
  for (let cur = best; cur; cur = cur.node.froms[cur.budget]) path.unshift(cur.node);

  // Aplanar a la lista de acordes que se tocan, con de dónde sale cada uno.
  const steps = [];
  path.forEach((n, slot) => {
    n.chain.forEach((v, k) => {
      steps.push({
        slot,
        symbol: v.symbol,
        from: progression[slot].symbol,
        changed: v.symbol !== progression[slot].symbol, // el ii-V deja el dominante como estaba
        rule: k === 0 ? n.option.rule : null,
        why: k === 0 ? n.option.why : "",
        position: v.position,
        frets: v.frets,
        midis: v.midis,
        pcs: v.pcs,
        top: v.top,
        topNote: noteName(v.top),
        topString: STRINGS[v.topString][0],
      });
    });
  });

  return {
    intention: preset, key, steps,
    line: steps.map(s => s.topNote),
    cost: best.cost,
    ...lineStats(steps),
    ...arrangementStats(steps),
  };
}

// Qué tal ha salido la línea, para poder decirlo en pantalla en vez de que el
// usuario lo deduzca de los nombres de nota.
function lineStats(steps) {
  const moves = steps.slice(1).map((s, i) => s.top - steps[i].top);
  return {
    moves: moves.length,
    conjunct: moves.filter(d => Math.abs(d) > 0 && Math.abs(d) <= 2).length,
    held: moves.filter(d => d === 0).length,
    leaps: moves.filter(d => Math.abs(d) > 4).length,
  };
}

// Y qué tal el arreglo entero. Se mide todo en todas las versiones, pese al
// preset: comparar los números entre tarjetas es parte de la gracia.
function arrangementStats(steps) {
  let open = 0, common = 0, still = 0, movement = 0, unpaired = 0;
  steps.forEach((s, i) => {
    open += openStrings(s.frets);
    if (!i) return;
    const p = steps[i - 1];
    common += commonBetween(p, s);
    still += stillBetween(p, s);
    const pairs = pairVoices(p.midis, s.midis);
    movement += pairs.moved;
    unpaired += pairs.structural;
  });
  return { open, common, still, movement, unpaired };
}

// Una versión por preset, cada una con su etiqueta y su porqué. Dos presets
// pueden acabar en el mismo arreglo (una progresión no siempre da para todo);
// en ese caso se enseña una sola vez, con la primera etiqueta que lo consiguió.
// Sin ordenar por coste: los costes de presets distintos no son comparables
// —cada uno mide con su propia regla—, así que manda el orden de la lista.
export function reharmonizations(db, progression) {
  const seen = new Set();
  return PRESETS
    .map(p => reharmonize(db, progression, p))
    .filter(Boolean)
    .filter(v => {
      const key = v.steps.map(s => `${s.symbol}:${s.frets.join(".")}`).join(" ");
      return !seen.has(key) && seen.add(key);
    });
}

// Camino mínimo por capas, sin presupuesto de cambios: cada capa ofrece sus
// voicings, los enlaces los paga linkCost con el preset dado y cada nodo su
// propio coste. Lo comparten la cejilla y las afinaciones; la rearmonización
// tiene su Viterbi aparte porque además raciona cuántos acordes se cambian.
export function bestChain(layers, preset, nodeCost) {
  layers.forEach((layer, i) => {
    for (const n of layer) {
      if (i === 0) {
        n.total = nodeCost(n);
        n.from = null;
        continue;
      }
      let best = null;
      for (const p of layers[i - 1]) {
        const total = p.total + linkCost(p, n, preset);
        if (!best || total < best.total) best = { total, node: p };
      }
      n.total = best.total + nodeCost(n);
      n.from = best.node;
    }
  });
  const chain = [];
  for (let n = layers.at(-1).reduce((a, b) => (b.total < a.total ? b : a)); n; n = n.from) chain.unshift(n);
  return chain;
}
