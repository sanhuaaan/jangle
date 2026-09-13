import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { Chord, Note } from "tonal";
import { parseProgression, suggest, detectKey, transposeSymbol, intervalTo, rootOf, RULES, KINDS } from "./rules.js";
import { reharmonizations, pairVoices } from "./reharm.js";
import { capoSuggestions, capoArrangements, shapeSymbol } from "./capo.js";
import { parseSearch, parseTab, suggestionSlug, decodeEntities } from "./song.js";
import { findShape, shapeSvg, fretboardSvg, openString, absoluteFrets, playablePositions, STRINGS, TUNINGS, MAX_FRET } from "./guitar.js";
import { NOTES, KEYS } from "./notes.js";
import { identify, soundingNotes, degreeName, spell } from "./identify.js";
import { generateShapes, tuningArrangements } from "./generate.js";
import {
  KEY, emptyLibrary, readLibrary, writeLibrary, libraryJson, parseLibrary,
  mergeLibrary, saveSection, removeSection, removeSong, songKey,
} from "./library.js";
import {
  signature, fingerprint, windows, shardFor, search, song, whereSounds, withoutEdition, score,
} from "./archived/catalog.js";

const guitarDb = createRequire(import.meta.url)("@tombatossals/chords-db/lib/guitar.json");

const sameChroma = (a, b) =>
  assert.equal(Note.chroma(Chord.get(a).tonic), Note.chroma(Chord.get(b).tonic), `${a} vs ${b}`);

const find = (text, ruleName, index = 0) => {
  const progression = parseProgression(text);
  const s = suggest(progression).find(x => x.rule === ruleName && x.index === index);
  return { progression, s };
};

test("parsea y rechaza acordes inválidos", () => {
  assert.equal(parseProgression("C | Am, F G7").length, 4);
  assert.throws(() => parseProgression("C Zx9"));
});

test("tritono: G7 → Db7", () => {
  const { s } = find("G7", "Sustitución de tritono");
  sameChroma(s.replacement[0], "Db7");
  assert.match(s.replacement[0], /7$/);
});

test("relativo: C → Am y Am → C", () => {
  assert.equal(find("C", "Relativo").s.replacement[0], "Am");
  assert.equal(find("Am", "Relativo").s.replacement[0], "C");
});

test("ii-V: G7 → Dm7 G7", () => {
  assert.deepEqual(find("G7", "Inserción ii-V").s.replacement, ["Dm7", "G7"]);
});

test("dominante secundario: → Dm inserta A7", () => {
  assert.deepEqual(find("C Dm", "Dominante secundario", 1).s.replacement, ["A7", "Dm"]);
});

test("disminuido de paso: C → Dm inserta C#dim7", () => {
  const { s } = find("C Dm", "Disminuido de paso");
  sameChroma(s.replacement[1], "C#dim7");
  assert.match(s.replacement[1], /dim7$/);
});

test("intercambio modal: F → Fm, pero no sobre menores ni dominantes", () => {
  assert.equal(find("F", "Intercambio modal").s.replacement[0], "Fm");
  assert.equal(find("Am", "Intercambio modal").s, undefined);
  assert.equal(find("G7", "Intercambio modal").s, undefined);
});

test("mediante: C → Em, solo sobre tríadas mayores", () => {
  assert.equal(find("C", "Mediante").s.replacement[0], "Em");
  assert.equal(find("Am", "Mediante").s, undefined);
  assert.equal(find("Cmaj7", "Mediante").s, undefined, "ya lleva séptima: no es tríada");
});

test("dominante sin fundamental: G7 → Bm7b5 y → Bdim7", () => {
  assert.equal(find("G7", "Dominante sin fundamental").s.replacement[0], "Bm7b5");
  assert.equal(find("G7", "Disminuido dominante").s.replacement[0], "Bdim7");
  assert.equal(find("C", "Dominante sin fundamental").s, undefined);
});

test("adornos: séptima según el grado, sexta y novena según lo que ya suene", () => {
  // En C mayor el V pide séptima menor y el I mayor; el ii, m7.
  assert.equal(find("C G", "Séptima diatónica", 1).s.replacement[0], "G7");
  assert.equal(find("C G", "Séptima diatónica", 0).s.replacement[0], "Cmaj7");
  assert.equal(find("Am", "Séptima diatónica").s.replacement[0], "Am7");
  assert.equal(find("C", "Sexta").s.replacement[0], "C6");
  assert.equal(find("C", "Novena").s.replacement[0], "Cadd9");
  assert.equal(find("Am7", "Novena").s.replacement[0], "Am9", "sobre un m7 la novena es m9, no madd9");
  assert.equal(find("Cmaj7", "Séptima diatónica").s, undefined, "la séptima ya está puesta");
});

test("aproximaciones prestadas: puerta trasera, IV menor y cromática", () => {
  assert.deepEqual(find("C", "Dominante de puerta trasera").s.replacement, ["Bb7", "C"]);
  assert.deepEqual(find("C", "Subdominante menor").s.replacement, ["Fm", "C"]);
  assert.deepEqual(find("C", "Aproximación cromática").s.replacement, ["C#7", "C"]);
  assert.deepEqual(find("C", "ii-V secundario").s.replacement, ["Dm7", "G7", "C"]);
  assert.deepEqual(find("Am", "ii-V secundario").s.replacement, ["Bm7b5", "E7", "Am"],
    "el ii de un menor es semidisminuido");
});

test("líneas: la voz interna baja mientras el acorde se queda", () => {
  assert.deepEqual(find("Am", "Línea cromática interna").s.replacement, ["Am", "AmMaj7", "Am7", "Am6"]);
  assert.deepEqual(find("C F", "Línea hacia el IV").s.replacement, ["C", "Cmaj7", "C7"]);
  assert.equal(find("C G", "Línea hacia el IV").s, undefined, "G no es el IV de C");
});

test("el disminuido de paso también rellena el tono descendente", () => {
  const { s } = find("Am G", "Disminuido de paso");
  sameChroma(s.replacement[1], "Abdim7");
  assert.match(s.replacement[1], /dim7$/);
  assert.equal(find("C G", "Disminuido de paso").s, undefined, "cuarta justa: no es paso de tono");
});

test("cada acorde recibe un buen puñado de opciones, agrupadas y sin repetir", () => {
  const kinds = new Set(KINDS.map(k => k.id));
  for (const rule of RULES) assert.ok(kinds.has(rule.kind), `regla sin grupo válido: ${rule.name}`);

  const progression = parseProgression("C Am F G7");
  const suggestions = suggest(progression);
  progression.forEach((c, i) => {
    const mine = suggestions.filter(s => s.index === i);
    assert.ok(mine.length >= 9, `${c.symbol} solo saca ${mine.length} opciones`);
    assert.equal(new Set(mine.map(s => s.replacement.join(" "))).size, mine.length,
      `${c.symbol} repite alguna propuesta`);
    assert.ok(mine.every(s => kinds.has(s.kind)), `${c.symbol} tiene opciones sin grupo`);
    assert.ok(new Set(mine.map(s => s.kind)).size === 3, `${c.symbol} no llega a los tres grupos`);
  });
});

test("toda sugerencia lleva explicación con sus acordes", () => {
  const suggestions = suggest(parseProgression("C Am F G7"));
  assert.ok(suggestions.length > 0);
  for (const s of suggestions) {
    assert.ok(s.why && s.why.length > 20, `sin why: ${s.rule}`);
    assert.ok(s.why.includes(s.replacement[0]) || s.why.includes(s.replacement[1]), `why no menciona la sustitución: ${s.why}`);
  }
});

test("detectKey estima la tonalidad mayor de la progresión", () => {
  assert.equal(NOTES[detectKey(parseProgression("C Am F G7"))], "C");
  assert.equal(NOTES[detectKey(parseProgression("D Bm G A7"))], "D");
  assert.equal(NOTES[detectKey(parseProgression("Bb Gm Eb F7"))], "Bb");
});

test("paso diatónico: inserta el grado intermedio subiendo y bajando", () => {
  assert.deepEqual(find("C Em", "Paso diatónico").s.replacement, ["C", "Dm"]);
  assert.deepEqual(find("Am F", "Paso diatónico").s.replacement, ["Am", "G"]);
  assert.equal(find("C Dm", "Paso diatónico").s, undefined); // grados adyacentes: nada que rellenar
});

test("findShape encuentra varias posiciones y usa la enarmonía de la BD", () => {
  const dm7 = findShape(guitarDb, "Dm7");
  assert.equal(dm7.name, "Dm7");
  assert.ok(dm7.positions.length >= 2);
  assert.equal(dm7.positions[0].frets.length, 6);
  assert.ok(dm7.positions[0].midi.length >= 3);
  assert.equal(findShape(guitarDb, "Gb7").name, "F#7");
  assert.equal(findShape(guitarDb, "Zx9"), null);
});

test("las reglas generan grafías que existen en la BD de guitarra", () => {
  // Las doce fundamentales por cada calidad que se puede escribir en el buscador:
  // ninguna regla debe proponer un cifrado que luego no se pueda dibujar.
  const roots = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  for (const rootNote of roots) {
    for (const quality of ["", "m", "7", "m7", "maj7", "6", "sus4"]) {
      for (const s of suggest(parseProgression(`${rootNote}${quality} ${rootNote}`))) {
        for (const sym of s.replacement) {
          assert.ok(findShape(guitarDb, sym), `sin posición de guitarra: ${sym} (de ${rootNote}${quality})`);
        }
      }
    }
  }
});

test("cejilla: C sin cejilla gana 6, add9 y maj7 en cuerdas al aire", () => {
  const [best] = capoSuggestions(parseProgression("C"));
  assert.equal(best.capo, 0);
  assert.deepEqual(best.perChord[0].extensions.map(e => e.as), ["C6", "Cadd9", "Cmaj7"]);
});

test("cejilla: Am sin cejilla gana m11, m7 y madd9", () => {
  const zero = capoSuggestions(parseProgression("Am")).find(cp => cp.capo === 0);
  assert.deepEqual(zero.perChord[0].extensions.map(e => e.as), ["Am11", "Am7", "Amadd9"]);
});

test("las extensiones de cejilla se llaman como acordes que existen", () => {
  // Barrido de las doce fundamentales por calidad, no una progresión suelta: el
  // nombre de la extensión depende de la calidad del acorde y de si ya lleva
  // séptima, así que una sola progresión deja casi todas las tablas sin probar.
  // m13 es el único cifrado correcto que chords-db no indexa: se propone igual
  // (el tooltip dibuja la forma base con la cuerda al aire, no ese acorde), pero
  // no se puede abrir en el mástil. Si aparece otro, que se entere alguien.
  const withoutDiagram = new Set();
  for (const rootNote of NOTES) {
    for (const quality of ["", "m", "7", "m7", "maj7", "6", "m6", "sus4"]) {
      for (const cp of capoSuggestions(parseProgression(rootNote + quality))) {
        for (const pc of cp.perChord) {
          for (const e of pc.extensions) {
            assert.ok(Chord.get(e.as).tonic, `cifrado que no se puede leer: ${e.as}`);
            if (!findShape(guitarDb, e.as)) withoutDiagram.add(e.as.replace(/^[A-G][b#]?/, ""));
          }
        }
      }
    }
  }
  assert.deepEqual([...withoutDiagram], ["m13"]);
});

test("cejilla: con séptima el nombre la conserva, sin ella no la inventa", () => {
  const ext = sym => capoSuggestions(parseProgression(sym))
    .flatMap(cp => cp.perChord.flatMap(pc => pc.extensions.map(e => e.as)));
  // La novena al aire sobre una tríada es un add9, pero sobre el maj7 es un maj9:
  // la séptima sigue sonando y el nombre tiene que contarlo.
  assert.ok(ext("C").includes("Cadd9"));
  assert.ok(ext("Cmaj7").includes("Cmaj9"), "el maj7 con la 9ª al aire no es un add9");
  assert.ok(!ext("Cmaj7").includes("Cadd9"));
  assert.ok(ext("Am").includes("Amadd9"));
  assert.ok(ext("Am7").includes("Am9"), "el m7 con la 9ª al aire no es un madd9");
  assert.ok(ext("Cmaj7").includes("Cmaj13"), "la 6ª sobre un maj7 es la 13ª");
});

test("cejilla: respeta la lista blanca por calidad y no repite acordes", () => {
  for (const cp of capoSuggestions(parseProgression("C Am G7 G7"))) {
    assert.ok(cp.perChord.length <= 3, "acorde repetido no deduplicado");
    for (const pc of cp.perChord) {
      for (const e of pc.extensions) {
        if (pc.chord === "G7") assert.ok(!e.as.includes("maj7"), `maj7 sobre dominante: ${e.as}`);
        assert.ok(e.string && e.note, "extensión sin cuerda o nota");
      }
    }
  }
});

test("shapeSymbol da la forma transpuesta que se toca con cejilla", () => {
  assert.equal(shapeSymbol("D", 2), "C");
  assert.equal(shapeSymbol("G7", 5), "D7");
  assert.equal(shapeSymbol("Em", 7), "Am");
  assert.equal(shapeSymbol("C", 0), "C");
});

test("con cejilla 2, Dadd9 (E en 4ª) se dibuja sobre la forma de C", () => {
  const shape = findShape(guitarDb, shapeSymbol("D", 2));
  assert.equal(shape.name, "C");
  const opened = openString(shape.positions[0], 2);
  assert.ok(opened, "la 4ª de la forma de C se puede abrir");
  assert.equal(opened.frets[2], 0);
});

test("openString abre la cuerda pedida sobre la forma en primera posición", () => {
  const am = findShape(guitarDb, "Am").positions[0]; // x02210
  const opened = openString(am, 2);
  assert.equal(opened.frets[2], 0);
  assert.deepEqual(opened.frets.toSpliced(2, 1), am.frets.toSpliced(2, 1), "solo cambia esa cuerda");
  assert.deepEqual(openString(am, 5).frets, am.frets, "ya estaba al aire: la forma vale tal cual");
  const high = findShape(guitarDb, "Am").positions.find(p => p.baseFret > 1);
  assert.equal(openString(high, 2).frets[2], 0, "en formas altas la cuerda al aire es la cejilla");
});

test("shapeSvg dibuja cuerdas, trastes y puntos", () => {
  const svg = shapeSvg(findShape(guitarDb, "F#7").positions[0]);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("<circle"));
  assert.ok(svg.includes("<line"));
});

test("el generador encuentra las formas abiertas de toda la vida", () => {
  // El arnés que lo mantiene honesto: si en estándar no salen las formas
  // curadas de chords-db, el generador está mal.
  const cases = {
    "C": [-1, 3, 2, 0, 1, 0],
    "Am": [-1, 0, 2, 2, 1, 0],
    "E": [0, 2, 2, 1, 0, 0],
    "G7": [3, 2, 0, 0, 0, 1],
    "Dm7": [-1, -1, 0, 2, 1, 1],
    "F": [1, 3, 3, 2, 1, 1],
  };
  for (const [symbol, frets] of Object.entries(cases)) {
    const gen = generateShapes(symbol);
    assert.ok(gen.some(s => s.frets.join() === frets.join()), `${symbol} = ${frets}`);
  }
});

test("todo lo generado cumple el contrato, en cualquier afinación", () => {
  const byId = id => TUNINGS.find(t => t.id === id).midis;
  for (const [symbol, tuning] of [["C", byId("standard")], ["G", byId("openg")], ["Dm7", byId("dadgad")], ["Amaj7", byId("dropd")]]) {
    const chromas = new Set(Chord.get(symbol).notes.map(Note.chroma));
    const root = Note.chroma(Chord.get(symbol).tonic);
    const shapes = generateShapes(symbol, tuning);
    assert.ok(shapes.length, `${symbol} genera algo`);
    for (const s of shapes) {
      const sounding = s.frets.filter(f => f >= 0);
      assert.ok(sounding.length >= 4, "suenan al menos cuatro cuerdas");
      assert.ok([...s.pcs].every(c => chromas.has(c)), "solo notas del acorde");
      assert.ok(s.pcs.has(root), "la fundamental siempre suena");
      const fretted = s.frets.filter(f => f > 0);
      if (fretted.length) {
        assert.ok(Math.max(...fretted) - Math.min(...fretted) < 4, "cabe en una mano");
      }
      const i0 = s.frets.findIndex(f => f >= 0);
      const i1 = s.frets.findLastIndex(f => f >= 0);
      assert.ok(!s.frets.slice(i0, i1).includes(-1), "sin mudas interiores");
      assert.ok([root, (root + 7) % 12].includes(s.bass % 12), "el bajo es fundamental o quinta");
    }
  }
});

test("en las afinaciones abiertas el generador encuentra lo que les da nombre", () => {
  const byId = id => TUNINGS.find(t => t.id === id).midis;
  const openStrings = [0, 0, 0, 0, 0, 0];
  assert.ok(generateShapes("G", byId("openg")).some(s => s.frets.join() === openStrings.join()), "Open G: las seis al aire son G");
  assert.ok(generateShapes("D", byId("opend")).some(s => s.frets.join() === openStrings.join()), "Open D: las seis al aire son D");
  // Y el orden pone la fundamental en el bajo por delante de la quinta.
  const [primera] = generateShapes("G", byId("openg"));
  assert.equal(primera.bass % 12, Note.chroma("G"), "la primera lleva G en el bajo");
});

test("las afinaciones compiten por la misma progresión con costes comparables", () => {
  const progression = parseProgression("D G A D");
  const out = tuningArrangements(progression, TUNINGS);
  assert.equal(out.length, TUNINGS.length, "todas las afinaciones dan arreglo");
  assert.ok(out.every((a, i) => !i || out[i - 1].cost <= a.cost), "ordenadas por coste");
  for (const a of out) {
    assert.equal(a.steps.length, 4, "un paso por acorde");
    a.steps.forEach((s, i) => {
      if (!s.changed) assert.equal(s.sounding, progression[i].symbol, "sin adorno suena lo escrito");
      assert.equal(rootOf(s.sounding), rootOf(progression[i].symbol), "el adorno no cambia la raíz");
    });
  }
  // Los adornos entran en la búsqueda como en la cejilla: con tanto aire a
  // mano, alguna afinación colorea algún acorde.
  assert.ok(out.some(a => a.steps.some(s => s.changed)), "algún adorno sale elegido");
  // La gracia de la pestaña: para una progresión en re, la estándar no gana.
  const standard = out.find(a => a.tuning.id === "standard");
  assert.ok(out[0].open >= standard.open, "la ganadora resuena al menos como la estándar");
  assert.notEqual(out[0].tuning.id, "standard", "una afinación abierta le gana a la estándar en re");
});

test("la cejilla entra como dimensión del setup", () => {
  const progression = parseProgression("F Bb C");
  const standard = TUNINGS[0];
  const out = tuningArrangements(progression, [standard, { ...standard, capo: 1 }]);
  // Para F Bb C, la cejilla al 1 desbloquea las formas abiertas de E A B.
  assert.equal(out[0].capo, 1, "la cejilla al 1 gana a la estándar pelada");
  assert.ok(out[0].open > out[1].open, "y gana por resonancia");
  // Los trastes de los pasos son relativos a la cejilla y caben en el mástil.
  for (const s of out[0].steps) {
    assert.ok(s.frets.every(f => f + out[0].capo <= MAX_FRET), "todo dentro del mástil");
  }
});

test("identifica acordes abiertos corrientes por sus pulsaciones", () => {
  const cases = {
    "C": [-1, 3, 2, 0, 1, 0],
    "Am": [-1, 0, 2, 2, 1, 0],
    "E": [0, 2, 2, 1, 0, 0],
    "G7": [3, 2, 0, 0, 0, 1],
    "F": [1, 3, 3, 2, 1, 1],
    "Dm7": [-1, -1, 0, 2, 1, 1],
    "Dsus4": [-1, -1, 0, 2, 3, 3],
  };
  for (const [nombre, frets] of Object.entries(cases)) {
    assert.equal(identify(frets).candidates[0].symbol, nombre, `${nombre} = ${frets}`);
  }
});

test("la afinación cambia lo que suena, no lo que está marcado", () => {
  const openShape = [0, 0, 0, 0, 0, 0];
  const byId = id => TUNINGS.find(t => t.id === id).midis;
  // Las seis al aire: en estándar no forman nada corriente; en las abiertas, sí.
  assert.equal(identify(openShape, byId("dadgad")).candidates[0].symbol, "Dsus4");
  assert.equal(identify(openShape, byId("openg")).candidates[0].symbol, "G/D");
  assert.equal(identify(openShape, byId("opend")).candidates[0].symbol, "D");
  // La forma de E estándar, con la 6ª en Drop D, gana una séptima en el bajo:
  // mismo dibujo, otro acorde.
  assert.equal(identify([0, 2, 2, 1, 0, 0], byId("dropd")).candidates[0].symbol, "E7/D");
  // Sin afinación, la estándar: exactamente lo mismo que antes de que existieran.
  assert.deepEqual(identify([-1, 3, 2, 0, 1, 0]), identify([-1, 3, 2, 0, 1, 0], byId("standard")));
  // Y cada afinación sabe decir sus notas, que es lo que enseña el selector.
  assert.equal(TUNINGS.find(t => t.id === "dadgad").notes, "D A D G A D");
});

test("el bajo distingue la inversión: C/E no es C", () => {
  const { candidates } = identify([0, 3, 2, 0, 1, 0]); // C con la 6ª al aire
  assert.equal(candidates[0].symbol, "C/E");
  assert.ok(candidates[0].inversion);
  assert.ok(!identify([-1, 3, 2, 0, 1, 0]).candidates[0].inversion, "C en fundamental no es inversión");
});

test("las notas salen ordenadas de grave a aguda, no por cuerda", () => {
  const notes = soundingNotes([-1, 0, 2, 2, 1, 0]); // Am
  assert.deepEqual(notes.map(n => n.note), ["A", "E", "A", "C", "E"]);
  assert.deepEqual(notes.map(n => n.string), ["5ª", "4ª", "3ª", "2ª", "1ª"]);
  assert.ok(notes.every((n, i) => i === 0 || n.midi >= notes[i - 1].midi), "orden por altura real");
  // La 3ª cuerda muy pisada suena por encima de la 2ª: el bajo es el de la 2ª.
  const high = soundingNotes([-1, -1, -1, 8, 1, 3]);
  assert.deepEqual(high.map(n => n.string), ["2ª", "3ª", "1ª"]);
  assert.equal(identify([-1, -1, -1, 8, 1, 3]).candidates[0].symbol, "Cm", "sin inversión: el bajo es C");
});

test("cada nota recibe su grado dentro del acorde elegido", () => {
  const [c] = identify([-1, 3, 2, 0, 1, 0]).candidates; // C
  assert.equal(c.root, "C");
  assert.deepEqual(c.degrees, [
    { note: "C", degree: "fundamental" },
    { note: "E", degree: "3ª mayor" },
    { note: "G", degree: "5ª justa" },
  ]);
  assert.equal(degreeName("C", "Bb"), "7ª menor");
  assert.equal(degreeName("Eb", "Eb"), "fundamental");
});

test("con una sola nota no hay acorde que nombrar; con dos ya sí", () => {
  assert.deepEqual(identify([-1, -1, -1, -1, -1, -1]), { notes: [], pcs: [], candidates: [] });
  assert.equal(identify([0, -1, -1, -1, -1, 0]).candidates.length, 0, "la misma nota en dos cuerdas no es acorde");
  assert.equal(identify([-1, -1, -1, -1, 1, 0]).candidates.length, 2, "dos notas: una lectura por nota");
});

test("dos notas ya son acorde: quintas, terceras y sextas", () => {
  const names = frets => identify(frets).candidates.filter(c => !c.rootless).map(c => c.symbol);
  // La quinta justa es el acorde de quinta de toda la vida, y se lleva la lectura
  // buena: la otra tendría que inventarse una fundamental que no está en el bajo.
  assert.deepEqual(names([-1, 3, 5, -1, -1, -1]), ["C5", "Gsus4(no5)/C"]);
  // La tercera decide el carácter; el cifrado avisa de que no hay quinta.
  assert.deepEqual(names([-1, 3, 2, -1, -1, -1]), ["C(no5)", "E(#5,no3)/C"]);
  assert.equal(names([-1, 3, 1, -1, -1, -1])[0], "Cm(no5)");
  // Una sexta es esa misma tercera vista desde la otra nota, así que las dos
  // lecturas son las mismas dos y lo que cambia el orden es cuál queda en el bajo.
  assert.deepEqual(names([-1, 3, 7, -1, -1, -1]), ["C6(no3,no5)", "Am(no5)/C"]);
  assert.deepEqual(names([-1, -1, -1, 2, 1, -1]), ["Am(no5)", "C6(no3,no5)/A"]);
  // Ningún cifrado de díada promete notas que no suenan.
  for (const frets of [[-1, 3, 5, -1, -1, -1], [-1, 3, 2, -1, -1, -1], [-1, 3, 7, -1, -1, -1]]) {
    const { pcs, candidates } = identify(frets);
    assert.equal(pcs.length, 2);
    assert.ok(candidates.every(c => c.degrees.length === 2), "cada lectura explica las dos notas");
  }
});

test("nombra el acorde aunque no suene su fundamental", () => {
  const rootless = frets => identify(frets).candidates.filter(c => c.rootless).map(c => c.symbol);
  // El caso de manual: B-D-F no es un Bdim cualquiera, es el G7 sin el G.
  assert.ok(rootless([-1, -1, -1, 4, 3, 1]).includes("G7/B"), "B-D-F es G7 sin fundamental");
  assert.ok(rootless([-1, -1, -1, 9, 8, 7]).includes("Cmaj7/E"), "E-G-B es Cmaj7 sin fundamental");
  assert.ok(rootless([-1, -1, 3, 2, 1, 0]).includes("Dm9/F"), "F-A-C-E es Dm9 sin fundamental");
  assert.ok(rootless([-1, -1, -1, 9, 11, 10]).includes("C9/E"), "E-Bb-D es C9 sin fundamental");

  const { candidates } = identify([-1, -1, -1, 4, 3, 1]); // B-D-F
  assert.equal(candidates[0].symbol, "Bdim", "manda lo que suena: la fundamental pisada va primero");
  assert.equal(candidates.findIndex(c => c.rootless), candidates.filter(c => !c.rootless).length,
    "las lecturas sin fundamental van todas detrás");
  assert.ok(candidates.filter(c => c.rootless).every(c => !c.degrees.some(d => d.degree === "fundamental")),
    "si la lectura es sin fundamental, ninguna nota marcada lo es");

  // Sin notas guía no se inventa nada: hacen falta 3ª y 7ª para echar de menos
  // una fundamental, y con dos notas la suposición sería mayor que el dato.
  assert.deepEqual(rootless([-1, 3, 3, 0, -1, -1]), [], "un sus4 no arrastra lecturas sin fundamental");
  assert.deepEqual(rootless([-1, 3, 1, 11, 10, -1]), [], "ni un dim7, que no tiene 7ª de las que valen");
  assert.deepEqual(rootless([-1, 3, 5, -1, -1, -1]), [], "una quinta pelada tampoco");
  // Salvo el tritono, que solo puede ser la 3ª y la 7ª de un dominante.
  assert.deepEqual(rootless([-1, -1, -1, 4, 6, -1]).sort(), ["C#7/B", "G7/B"]);
});

test("da una lectura por cada nota que se tome como fundamental", () => {
  const { pcs, candidates } = identify([3, 3, 2, 4, 0, 0]); // G C E B: el acorde de referencia
  const soundingNow = candidates.filter(c => !c.rootless);
  assert.deepEqual(pcs, ["G", "C", "E", "B"]);
  assert.equal(soundingNow.length, 4, "una lectura por nota distinta");
  assert.deepEqual(soundingNow.map(c => c.root).sort(), ["B", "C", "E", "G"]);
  assert.deepEqual(soundingNow.map(c => c.symbol), ["Cmaj7/G", "G6/11", "Emb6/G", "Bsus4b6b9/G"]);
  assert.ok(candidates.every(c => c.degrees.length === 4), "todas explican las mismas cuatro notas");
  // El bajo lo pone la cuerda más grave, no la fundamental de cada lectura.
  assert.ok(soundingNow.every(c => (c.root === "G") !== c.inversion));
});

test("cualquier puñado de notas recibe nombre, por raro que sea", () => {
  for (const frets of [[1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4, 5], [-1, -1, 5, 6, 7, 8]]) {
    const { pcs, candidates } = identify(frets);
    const soundingNow = candidates.filter(c => !c.rootless);
    assert.equal(soundingNow.length, pcs.length, `una lectura por nota distinta en ${frets}`);
    assert.ok(candidates.every(c => c.symbol.length > 1), "ninguna se queda sin cifrar");
    assert.equal(new Set(candidates.map(c => c.symbol)).size, candidates.length, "sin lecturas repetidas");
  }
});

test("las lecturas evidentes van antes que las rebuscadas", () => {
  const { candidates } = identify([-1, 3, 2, 0, 1, 0]); // C
  assert.equal(candidates[0].symbol, "C");
  assert.equal(candidates.filter(c => !c.rootless).length, 3, "también se lee desde E y desde G");
  assert.ok(candidates[0].score > candidates[1].score, "la lectura llana puntúa más");
});

test("spell cifra los acordes corrientes como en un cancionero", () => {
  const semitones = sym => new Set(Chord.get(sym).notes.map(Note.chroma));
  const expected = {
    C: "", Cm: "m", C7: "7", Cm7: "m7", Cmaj7: "maj7", C6: "6", Cm6: "m6",
    Csus4: "sus4", Csus2: "sus2", Cdim: "dim", Cdim7: "dim7", Cm7b5: "m7b5",
    Caug: "aug", C9: "9", Cm9: "m9", Cmaj9: "maj9", C13: "13", Cadd9: "add9",
    Cmadd9: "madd9", C5: "5", C7sus4: "7sus4", C69: "6/9", Cm11: "m11", C11: "11",
  };
  for (const [sym, sufijo] of Object.entries(expected)) {
    assert.equal(spell(semitones(sym)), sufijo, `${sym} debería cifrarse "${sufijo}"`);
  }
});

test("spell lee las alteraciones según haya séptima o no", () => {
  const s = (...semitones) => spell(new Set([0, ...semitones]));
  assert.equal(s(3, 7, 8), "mb6", "sin séptima, el Ab sobre C es b6");
  assert.equal(s(4, 7, 10, 8), "7b13", "con séptima, ese mismo Ab es b13");
  assert.equal(s(4, 7, 9), "6", "sin séptima, el A sobre C es la 6ª");
  assert.equal(s(4, 7, 10, 9), "13", "con séptima, esa 6ª es la 13ª");
  assert.equal(s(4, 7, 10, 6), "7#11", "el Gb sobre un dominante es #11, no b5");
  assert.equal(s(4, 5, 9), "6/11", "cifras pegadas se separan con barra");
});

test("spell cifra los intervalos sueltos diciendo lo que falta", () => {
  const s = (...semitones) => spell(new Set([0, ...semitones]));
  assert.equal(s(7), "5", "la quinta justa ya se llama así: no hace falta añadir nada");
  assert.equal(s(4), "(no5)");
  assert.equal(s(3), "m(no5)");
  assert.equal(s(9), "6(no3,no5)");
  assert.equal(s(5), "sus4(no5)", "la suspensión ya dice que no hay tercera");
  assert.equal(s(2), "sus2(no5)");
  assert.equal(s(6), "(b5,no3)", "escrito entre paréntesis: Cb5 se leería como Cb");
  // Dos notas SIN la fundamental no son un intervalo pelado, son notas guía: la
  // 3ª y la 7ª de un dominante al que le falta el resto.
  assert.equal(spell(new Set([4, 10])), "7");
  assert.equal(spell(new Set([3, 10])), "m7");
});

test("los nombres identificados existen en la BD de guitarra", () => {
  const voicings = [[-1, 3, 2, 0, 1, 0], [-1, 0, 2, 2, 1, 0], [3, 2, 0, 0, 0, 1], [-1, 3, 2, 0, 3, 0], [-1, -1, 0, 2, 1, 1]];
  for (const frets of voicings) {
    const [c] = identify(frets).candidates;
    assert.ok(findShape(guitarDb, c.symbol), `sin diagrama: ${c.symbol}`);
  }
});

test("fretboardSvg dibuja el mástil con una zona clicable por traste y cuerda", () => {
  const svg = fretboardSvg([-1, 3, 2, 0, 1, 0], { maxFret: 12 });
  assert.ok(svg.startsWith("<svg"));
  assert.match(svg, /width="\d+" height="\d+"/, "medidas explícitas: sin viewBox suelto no colapsa");
  assert.equal((svg.match(/class="cell"/g) ?? []).length, 6 * 13, "6 cuerdas × (12 trastes + al aire)");
  for (let s = 0; s < 6; s++) {
    assert.ok(svg.includes(`data-string="${s}" data-fret="0"`), `columna de al aire/muda de la cuerda ${s}`);
  }
  assert.ok(svg.includes("×"), "la 6ª muda lleva su aspa");
  assert.equal((svg.match(/class="note/g) ?? []).length, 5, "una note byId cuerda que sounds");
  assert.equal((svg.match(/>C</g) ?? []).length, 2, "las dos C del acorde llevan su nombre escrito");
});

test("el mástil escribe el nombre de cada nota y resalta la fundamental", () => {
  const svg = fretboardSvg([-1, 3, 2, 0, 1, 0], { root: "C", labels: ["", "1", "3", "5", "1", "3"] });
  for (const note of ["C", "E", "G"]) assert.ok(svg.includes(`>${note}<`), `falta la nota ${note}`);
  assert.equal((svg.match(/class="note root"/g) ?? []).length, 2, "las dos C pulsadas son fundamental");
  assert.equal((svg.match(/class="note open"/g) ?? []).length, 2, "3ª y 1ª al aire");
  assert.equal((svg.match(/class="degree"/g) ?? []).length, 5, "un grado por cuerda que suena");
  assert.ok(svg.includes(">5<"), "la 3ª al aire está etiquetada como quinta");
  assert.ok(!fretboardSvg([-1, -1, -1, -1, -1, -1]).includes("class=\"note"), "sin pulsaciones no hay notas");
});

test("el mástil llega al traste 15 y numera todos los trastes", () => {
  const svg = fretboardSvg([-1, -1, -1, -1, -1, -1]);
  assert.equal((svg.match(/class="cell"/g) ?? []).length, 6 * 16, "6 cuerdas × (15 trastes + al aire)");
  assert.equal((svg.match(/class="fret-no"/g) ?? []).length, 16, "del 0 al 15");
  assert.ok(svg.includes('data-fret="15"'), "se puede pulsar el traste 15");
});

test("absoluteFrets pasa los trastes de chords-db al mástil", () => {
  const openOne = findShape(guitarDb, "C").positions[0]; // x32010, baseFret 1
  assert.deepEqual(absoluteFrets(openOne), [-1, 3, 2, 0, 1, 0], "en primera posición no cambia nada");

  const high = findShape(guitarDb, "C").positions.find(p => p.baseFret === 3);
  assert.deepEqual(absoluteFrets(high), [3, 3, 5, 5, 5, 3], "el 1 de la forma es el baseFret");

  // El resultado tiene que sonar lo que dice la BD, que es la prueba de fuego.
  for (const sym of ["C", "Am", "G7", "F", "Dm7", "Bb", "F#7"]) {
    for (const p of findShape(guitarDb, sym).positions) {
      const midi = absoluteFrets(p)
        .map((f, i) => (f < 0 ? null : STRINGS[i][1] + f))
        .filter(m => m !== null);
      assert.deepEqual(midi.toSorted((a, b) => a - b), p.midi.toSorted((a, b) => a - b), `${sym} baseFret ${p.baseFret}`);
    }
  }
});

test("las posiciones de la BD se identifican como el acorde que dicen ser", () => {
  // Alguna posición de la BD lleva otra nota en el bajo (el primer Cmaj7 empieza
  // por G), así que vale la inversión: es el mismo acorde con otro bajo.
  for (const sym of ["C", "Am", "G7", "Dm7", "F", "Cmaj7", "Bb", "Esus4"]) {
    const p = findShape(guitarDb, sym).positions.find(q => absoluteFrets(q).every(f => f <= MAX_FRET));
    const readOnes = identify(absoluteFrets(p)).candidates.map(c => c.symbol);
    assert.ok(readOnes.some(s => s === sym || s.startsWith(`${sym}/`)), `${sym} no se reconoce en su propia posición: ${readOnes}`);
  }
});

test("rearmoniza la progresión entera respetando el original donde toca", () => {
  const prog = parseProgression("C Am F G7");
  const versions = reharmonizations(guitarDb, prog);
  assert.ok(versions.length >= 2, "varias versiones");
  for (const v of versions) {
    assert.ok(v.steps.length >= prog.length, "no se pierde ningún hueco");
    assert.equal(v.steps[0].from, "C");
    assert.ok(!v.steps[0].changed, "el primer acorde planta la tonalidad: no se toca");
    assert.equal(v.line.length, v.steps.length, "una nota de línea por acorde");
    // Ningún acorde repetido seguido que no viniera ya en el original.
    for (let i = 1; i < v.steps.length; i++) {
      if (v.steps[i].symbol !== v.steps[i - 1].symbol) continue;
      assert.equal(prog[v.steps[i].slot]?.symbol, prog[v.steps[i - 1].slot]?.symbol,
        `repetición inventada: ${v.steps.map(s => s.symbol).join(" ")}`);
    }
    // Cada digitación tiene que sonar el acorde que dice.
    for (const s of v.steps) {
      const readOnes = identify(s.frets).candidates.map(c => c.symbol.toLowerCase());
      const said = s.symbol.toLowerCase();
      assert.ok(readOnes.some(x => x === said || x.startsWith(`${said}/`)),
        `${s.symbol} no suena a lo que dice: ${readOnes}`);
      assert.equal(s.top, Math.max(...s.frets.map((f, i) => (f < 0 ? -1 : STRINGS[i][1] + f))), "la voz de arriba es la nota más aguda");
    }
  }
});

test("la línea se mueve hacia donde pide cada intención", () => {
  const prog = parseProgression("D A Bm G");
  const versions = reharmonizations(guitarDb, prog);
  const leaps = v => v.steps.slice(1).map((s, i) => s.top - v.steps[i].top);

  const low = versions.find(v => v.intention.id === "descending");
  if (low) assert.ok(leaps(low).every(d => d <= 0), `la descendente sube: ${low.line.join(" ")}`);

  const pedal = versions.find(v => v.intention.id === "pedal");
  if (pedal) assert.ok(pedal.held >= 1, "la pedal debería repetir alguna nota");

  // Los presets que persiguen la línea no deben dar saltos grandes en la voz de
  // arriba: ese es su punto. Los demás optimizan otra cosa y pueden saltar.
  for (const v of versions.filter(x => x.intention.w.topMove)) {
    assert.equal(v.leaps, 0, `${v.intention.name} da saltos: ${v.line.join(" → ")}`);
  }
});

test("el emparejamiento de voces cuenta movimiento, quietas y voces sueltas", () => {
  // El ejemplo de MEJORAS.md: C (G-C-E) → Am (A-C-E) es G→A y dos voces quietas.
  assert.deepEqual(pairVoices([55, 60, 64], [57, 60, 64]), { moved: 2, held: 2, leaps: 0, structural: 0 });
  // Una voz nueva no se empareja a lo loco: cuenta como cambio estructural.
  const p = pairVoices([55, 60, 64], [55, 60, 64, 67]);
  assert.equal(p.structural, 1);
  assert.equal(p.moved, 0);
  // Un salto de quinta es un salto, no dos voces sueltas.
  assert.deepEqual(pairVoices([60], [67]), { moved: 7, held: 0, leaps: 1, structural: 0 });
});

test("cada preset gana en lo suyo", () => {
  for (const text of ["C Am F G7", "D A Bm G"]) {
    const versions = reharmonizations(guitarDb, parseProgression(text));
    const ids = versions.map(v => v.intention.id);
    assert.ok(ids.length >= 3, `pocas versiones para "${text}": ${ids}`);
    const byId = id => versions.find(v => v.intention.id === id);
    const rest = id => versions.filter(v => v.intention.id !== id);
    // El dedupe puede fundir presets, así que cada aserto solo aplica si su
    // versión sobrevivió con etiqueta propia.
    const res = byId("resonance");
    if (res) for (const v of rest("resonance")) {
      assert.ok(res.open >= v.open, `resonancia (${res.open} al aire) pierde con ${v.intention.id} (${v.open})`);
    }
    // Su función objetivo pesa 1 el semitono movido y 2 la voz sin pareja: la
    // comparación usa esa misma vara, no los semitonos a secas.
    const min = byId("minimal");
    const still = v => v.movement + 2 * v.unpaired;
    if (min) for (const v of rest("minimal")) {
      assert.ok(still(min) <= still(v), `mínimo (${still(min)}) pierde con ${v.intention.id} (${still(v)})`);
    }
    const cont = byId("continuity");
    if (cont) for (const v of rest("continuity")) {
      assert.ok(cont.common + cont.still >= v.common + v.still,
        `continuidad (${cont.common}+${cont.still}) pierde con ${v.intention.id} (${v.common}+${v.still})`);
    }
  }
});

test("las sustituciones del arreglo salen de las reglas y van explicadas", () => {
  const names = new Set(RULES.map(r => r.name));
  for (const text of ["C Am F G7", "Am F C G", "D A Bm G", "C Am F G7 C Am Dm G7"]) {
    for (const v of reharmonizations(guitarDb, parseProgression(text))) {
      // El presupuesto cuenta huecos tocados (un cliché mete varios acordes en
      // un solo hueco y gasta uno), así que aquí se cuenta lo mismo.
      const slots = new Set(v.steps.filter(s => s.changed).map(s => s.slot));
      assert.ok(slots.size <= Math.max(1, Math.round(parseProgression(text).length / 3)) * 2,
        `demasiados cambios en "${text}": ${v.steps.map(s => s.symbol).join(" ")}`);
      for (const s of v.steps.filter(x => x.rule)) {
        assert.ok(names.has(s.rule), `regla desconocida: ${s.rule}`);
        assert.ok(s.why.length > 20, `sin explicación: ${s.rule}`);
      }
    }
  }
});

// Página de UG simulada: los datos van HTML-escapados en el atributo data-content.
const ugPage = data => {
  const json = JSON.stringify({ store: { page: { data } } })
    .replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  return `<html><div class="js-store" data-content="${json}"></div></html>`;
};

test("parseSearch filtra a acordes y se queda la versión más votada de cada canción", () => {
  const html = ugPage({ results: [
    { song_name: "Let It Be", artist_name: "The Beatles", type: null, tab_url: "pro" },
    { song_name: "Let It Be", artist_name: "The Beatles", type: "Chords", rating: 4.7, votes: 100, tab_url: "peor" },
    { song_name: "Let It Be", artist_name: "The Beatles", type: "Chords", rating: 4.8, votes: 14046, tab_url: "mejor" },
    { song_name: "Let It Be", artist_name: "The Beatles", type: "Tabs", rating: 5, votes: 99999, tab_url: "tab" },
    { song_name: "Otra", artist_name: "Alguien", type: "Chords", rating: 4, votes: 3, tab_url: "otra" },
  ] });
  const results = parseSearch(html);
  assert.deepEqual(results.map(r => r.url), ["mejor", "otra"]);
  assert.equal(results[0].votes, 14046);
});

test("parseTab separa secciones, limpia bajos y N.C. y funde secciones repetidas", () => {
  const content = [
    "[Intro]",
    "[ch]C[/ch] [ch]G[/ch]",
    "[Verse 1]",
    "[tab][ch]C[/ch] [ch]C[/ch] [ch]Am/G[/ch] [ch]N.C.[/ch] [ch]F[/ch]",
    "letra que no importa[/tab]",
    "[Verse 2]",
    "[tab][ch]C[/ch] [ch]Am[/ch] [ch]F[/ch][/tab]",
    "[Solo]",
  ].join("\n");
  const s = parseTab(ugPage({
    tab: { song_name: "Prueba", artist_name: "Nadie", tonality_name: "C" },
    tab_view: { wiki_tab: { content } },
  }));
  assert.equal(s.song, "Prueba");
  assert.equal(s.key, "C");
  // C C → C (repetido seguido), Am/G → Am (sin bajo), N.C. fuera; Verse 1 y 2
  // quedan con la misma progresión, así que se funden; Solo sin acordes, fuera.
  assert.equal(s.sections.length, 2);
  assert.deepEqual(s.sections[0], { name: "Intro", chords: ["C", "G"] });
  assert.deepEqual(s.sections[1], { name: "Verse 1, Verse 2", chords: ["C", "Am", "F"] });
});

test("las progresiones de una canción pasan por parseProgression sin ajustes", () => {
  const content = "[Verse]\n[ch]Cadd9[/ch] [ch]Dsus4/A[/ch] [ch]Em7[/ch] [ch]G/B[/ch]";
  const s = parseTab(ugPage({ tab: {}, tab_view: { wiki_tab: { content } } }));
  assert.equal(parseProgression(s.sections[0].chords.join(" ")).length, 4);
});

test("deshace las entidades HTML que UG guarda dentro de su propio JSON", () => {
  // El caso real: el intérprete de "Hentai" viene como "Rosal&iacute;a".
  assert.equal(decodeEntities("Rosal&iacute;a (Rosal&iacute;a Vila)"), "Rosalía (Rosalía Vila)");
  assert.equal(decodeEntities("Sinéad O&#039;Connor"), "Sinéad O'Connor");
  assert.equal(decodeEntities("Bj&ouml;rk &amp; Beck"), "Björk & Beck");
  assert.equal(decodeEntities("Mot&#246;rhead"), "Motörhead");
  assert.equal(decodeEntities("Sigur R&#xF3;s"), "Sigur Rós");
  assert.equal(decodeEntities("Nick Cave"), "Nick Cave"); // sin entidades, intacto
  assert.equal(decodeEntities("caf&eacute;s &hellip; y m&aacute;s"), "cafés &hellip; y más",
    "lo que no está en la tabla se queda literal, no roto");

  const html = ugPage({ results: [
    { song_name: "Hentai", artist_name: "Rosal&iacute;a", type: "Chords", votes: 1, tab_url: "u" },
  ] });
  assert.equal(parseSearch(html)[0].artist, "Rosalía");

  const tab = parseTab(ugPage({
    tab: { song_name: "Hentai", artist_name: "Rosal&iacute;a" },
    tab_view: { wiki_tab: { content: "[Estribillo con &ntilde;]\n[ch]F[/ch] [ch]A7[/ch]" } },
  }));
  assert.equal(tab.artist, "Rosalía");
  assert.equal(tab.sections[0].name, "Estribillo con ñ"); // también los nombres de parte
});

test("suggestionSlug normaliza como espera el endpoint de sugerencias de UG", () => {
  assert.equal(suggestionSlug("Let It Be"), "let_i"); // 5 caracteres máximo
  assert.equal(suggestionSlug("  Rosalía "), "rosal"); // sin tildes ni espacios sobrantes
  assert.equal(suggestionSlug("AC/DC"), "ac_dc"); // símbolos como _
  assert.equal(suggestionSlug(""), "");
});

// ── Cancionero ──────────────────────────────────────────────────────────────

// localStorage no existe en node, y tampoco hace falta: al módulo se le pasa el
// almacenamiento, así que aquí basta un Map con la misma cara.
const fakeStore = () => {
  const data = new Map();
  return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) };
};

test("el cancionero guarda partes por canción, sin duplicar progresiones", () => {
  const beatles = { song: "Let It Be", artist: "The Beatles", key: "C" };
  let lib = emptyLibrary();
  ({ lib } = saveSection(lib, beatles, { name: "Estrofa", chords: ["C", "G", "Am", "F"] }));
  ({ lib } = saveSection(lib, beatles, { name: "Estribillo", chords: ["Am", "G", "F", "C"] }));
  assert.equal(lib.songs.length, 1);
  assert.deepEqual(lib.songs[0].sections.map(s => s.name), ["Estrofa", "Estribillo"]);
  assert.equal(lib.songs[0].key, "C");

  // La misma progresión con otro nombre no entra otra vez: lo que se guarda es
  // la progresión, y "added" es lo que distingue guardarla de ya tenerla.
  const again = saveSection(lib, beatles, { name: "Estrofa 2", chords: ["C", "G", "Am", "F"] });
  assert.equal(again.added, false);
  assert.equal(again.lib.songs[0].sections.length, 2);

  // Mismo título y otro intérprete es otra canción: la identidad son los dos.
  ({ lib } = saveSection(lib, { song: "Let It Be", artist: "Nick Cave" }, { name: "Estrofa", chords: ["C", "G"] }));
  assert.equal(lib.songs.length, 2);

  // Sin nombre no se puede encontrar luego, y sin acordes no hay nada que guardar.
  assert.throws(() => saveSection(lib, { song: "" }, { name: "A", chords: ["C"] }));
  assert.throws(() => saveSection(lib, { song: "Vacía" }, { name: "A", chords: [] }));
  assert.throws(() => saveSection(lib, { song: "Inventada" }, { name: "A", chords: ["Zx9"] }));
});

test("quitar la última parte se lleva la canción por delante", () => {
  let lib = emptyLibrary();
  ({ lib } = saveSection(lib, { song: "Dos partes" }, { name: "A", chords: ["C"] }));
  ({ lib } = saveSection(lib, { song: "Dos partes" }, { name: "B", chords: ["G"] }));
  ({ lib } = saveSection(lib, { song: "Otra" }, { name: "A", chords: ["D"] }));

  const key = songKey({ song: "Dos partes" });
  lib = removeSection(lib, key, 0);
  assert.deepEqual(lib.songs.find(s => songKey(s) === key).sections.map(s => s.name), ["B"]);
  lib = removeSection(lib, key, 0);
  assert.deepEqual(lib.songs.map(s => s.song), ["Otra"]);
  assert.equal(removeSong(lib, songKey({ song: "Otra" })).songs.length, 0);
});

test("leer el cancionero nunca rompe, y lo escrito se vuelve a leer igual", () => {
  const store = fakeStore();
  assert.deepEqual(readLibrary(store), emptyLibrary()); // sin la clave
  store.setItem(KEY, "{esto no es json");
  assert.deepEqual(readLibrary(store), emptyLibrary()); // contenido corrompido
  assert.deepEqual(readLibrary({ getItem: () => { throw new Error("bloqueado"); } }), emptyLibrary());

  const { lib } = saveSection(emptyLibrary(), { song: "Ida y vuelta", artist: "Yo" }, { name: "A", chords: ["C", "F"] });
  writeLibrary(lib, store);
  assert.deepEqual(readLibrary(store), lib);

  // Escribir sí avisa cuando falla: la cuota y el modo privado son reales.
  assert.throws(() => writeLibrary(lib, { setItem: () => { throw new Error("QuotaExceeded"); } }), /no ha dejado guardar/);
});

test("cargar un cancionero funde con el que ya hay y cuenta lo que entra", () => {
  let mine = emptyLibrary();
  ({ lib: mine } = saveSection(mine, { song: "Común", artist: "A" }, { name: "Estrofa", chords: ["C", "G"] }));

  const { lib: incoming, dropped } = parseLibrary(JSON.stringify({
    version: 1,
    songs: [
      { song: "Común", artist: "A", sections: [
        { name: "Estrofa", chords: ["C", "G"] },  // esta ya la tengo
        { name: "Puente", chords: ["Dm", "E7"] }, // esta es nueva
      ] },
      { song: "Común", artist: "A", sections: [{ name: "Coda", chords: ["F", "C"] }] }, // repetida en el propio fichero
      { song: "Nueva", artist: "B", key: "G", sections: [{ name: "A", chords: ["G", "D"] }] },
      { song: "Rota", sections: [{ name: "A", chords: ["Zx9"] }] },
    ],
  }));
  assert.equal(dropped, 1); // "Rota"
  assert.equal(incoming.songs.length, 2); // las dos entradas de "Común" se funden al leer

  const merged = mergeLibrary(mine, incoming);
  assert.equal(merged.songs, 1); // "Nueva"
  assert.equal(merged.sections, 3); // "Puente", "Coda" y la parte de "Nueva"
  assert.deepEqual(
    merged.lib.songs.find(s => s.song === "Común").sections.map(s => s.name),
    ["Estrofa", "Puente", "Coda"],
  );

  // Cargar dos veces el mismo fichero no cambia nada: fundir es idempotente.
  assert.deepEqual(mergeLibrary(merged.lib, incoming), { lib: merged.lib, songs: 0, sections: 0 });
});

test("solo se cargan ficheros que sean cancioneros, con envoltorio o sin él", () => {
  assert.throws(() => parseLibrary("no soy json"), /JSON/);
  assert.throws(() => parseLibrary('{"canciones":[]}'), /lista de canciones/);
  assert.throws(() => parseLibrary('{"version":9,"songs":[]}'), /versión 9/);

  // Una lista pelada vale: es lo que queda al recortar el fichero a mano.
  const { lib } = parseLibrary('[{"song":"Suelta","sections":[{"chords":["C","Am"]}]}]');
  assert.equal(lib.version, 1);
  assert.equal(lib.songs[0].artist, "");
  assert.equal(lib.songs[0].sections[0].name, "Progresión"); // sin nombre, uno por defecto
});

test("exportar el mismo cancionero da siempre el mismo fichero", () => {
  let lib = emptyLibrary();
  ({ lib } = saveSection(lib, { song: "Estable", artist: "A", url: "https://x/y" }, { name: "A", chords: ["C", "G7"] }));
  const json = libraryJson(lib);
  assert.equal(json, libraryJson(parseLibrary(json).lib)); // ida y vuelta sin deriva
  assert.deepEqual(JSON.parse(json), {
    version: 1,
    songs: [{ song: "Estable", artist: "A", url: "https://x/y", sections: [{ name: "A", chords: ["C", "G7"] }] }],
  });
});

test("transponer mueve la fundamental y también el bajo", () => {
  assert.equal(transposeSymbol("C", "2M"), "D");
  assert.equal(transposeSymbol("C/E", "2M"), "D/F#", "el bajo se queda atrás si no se transpone");
  assert.equal(transposeSymbol("Am7/G", "3m"), "Cm7/Bb");
  assert.equal(transposeSymbol("Cadd9", "2M"), "Dadd9", "el sufijo se conserva tal cual");
});

test("transponer por intervalo escribe cada tono con su grafía", () => {
  const sounds = (prog, target) => {
    const iv = intervalTo("C", target);
    return parseProgression(prog).map(c => transposeSymbol(c.symbol, iv)).join(" ");
  };
  // A tonos con bemoles salen bemoles, y a tonos con sostenidos, sostenidos:
  // eso es lo que da transponer por intervalo en vez de por semitonos.
  assert.equal(sounds("C Am F G", "Ab"), "Ab Fm Db Eb");
  assert.equal(sounds("C Am F G", "B"), "B G#m E F#");
  assert.equal(sounds("C Am F G", "E"), "E C#m A B");
  assert.equal(sounds("C Am F G", "C"), "C Am F G", "al mismo tono no cambia nada");
});

test("transponer ida y vuelta deja la progresión como estaba", () => {
  const original = "C Am F G7";
  for (const target of KEYS) {
    const there = parseProgression(original).map(c => transposeSymbol(c.symbol, intervalTo("C", target)));
    const roundTrip = there.map(sym => transposeSymbol(sym, intervalTo(target, "C")));
    assert.deepEqual(roundTrip, ["C", "Am", "F", "G7"], `no vuelve pasando por ${target}`);
  }
});

test("todo acorde transpuesto a cualquier tono sigue teniendo diagrama", () => {
  for (const sym of ["C", "Am7", "F#m", "Bb", "G7", "Ebmaj7", "Bdim"]) {
    for (const target of KEYS) {
      const t = transposeSymbol(sym, intervalTo("C", target));
      assert.ok(findShape(guitarDb, t), `sin posición de guitarra: ${sym} → ${t} (a ${target})`);
    }
  }
});

test("los doce tonos del selector son los que escribe un guitarrista", () => {
  assert.equal(KEYS.length, 12);
  assert.equal(KEYS[1], "Db", "Db mayor (5 bemoles) antes que C# mayor (7 sostenidos)");
  KEYS.forEach((k, i) => assert.equal(Note.chroma(k), i, `${k} no está en su sitio`));
});

test("los nombres que se leen y las claves de la BD son tablas distintas", () => {
  // La grafía de la base de datos de diagramas vive dentro de guitar.js y no se
  // exporta: si vuelve a salir de ahí, cualquier sitio que solo quiera nombrar
  // una nota puede volver a coger la tabla equivocada, que es lo que hacía que
  // una progresión en Db se anunciara como "C# mayor".
  const sourceText = readFileSync(new URL("./guitar.js", import.meta.url), "utf8");
  assert.ok(!/export\s+const\s+DB_SPELLING/.test(sourceText), "la grafía de la BD no debe exportarse");

  // Las dos tablas de notes.js responden a preguntas distintas y solo coinciden
  // en once de doce: el sonido 1 se lee C# suelto pero Db como tonalidad.
  assert.equal(NOTES.length, 12);
  assert.equal(KEYS.length, 12);
  NOTES.forEach((n, i) => assert.equal(Note.chroma(n), i, `${n} fuera de sitio`));
  KEYS.forEach((k, i) => assert.equal(Note.chroma(k), i, `${k} fuera de sitio`));
  const different = NOTES.filter((n, i) => n !== KEYS[i]);
  assert.deepEqual(different, ["C#"]);
});

test("el arreglo de cejilla ordena por lo que resuena y sale tocable", () => {
  const prog = parseProgression("C Am F G");
  const arrangements = capoArrangements(guitarDb, prog);
  assert.ok(arrangements.length >= 5, "debería encontrar arreglo para casi toda cejilla");

  // Ordenado por cuerdas al aire: es el criterio que da nombre a la pestaña.
  const open = arrangements.map(a => a.open);
  assert.deepEqual(open, [...open].sort((x, y) => y - x));

  for (const a of arrangements) {
    assert.equal(a.steps.length, prog.length, "un acorde del arreglo por acorde de la progresión");
    a.steps.forEach((s, i) => {
      // Solo adornos: cambia el color, nunca la fundamental ni el acorde.
      assert.equal(Chord.get(s.sounding).tonic, prog[i].tonic, `${s.sounding} no adorna a ${prog[i].symbol}`);
      // La forma se toca detrás de la cejilla, así que hay que llegar con la mano.
      assert.ok(s.frets.every(f => a.capo + f <= MAX_FRET), `${s.shape} se sale del mástil con cejilla ${a.capo}`);
      assert.ok(findShape(guitarDb, s.shape), `forma sin diagrama: ${s.shape}`);
      assert.equal(s.open, s.frets.filter(f => f === 0).length);
    });
    // Las cuentas que se enseñan salen de las digitaciones elegidas, no de otro sitio.
    assert.equal(a.open, a.steps.reduce((n, s) => n + s.open, 0));
  }
});

test("el arreglo de cejilla prefiere las digitaciones que dejan cuerdas al aire", () => {
  const best = capoArrangements(guitarDb, parseProgression("C Am F G"))[0];
  // La referencia: tocar la progresión tal cual, con la primera digitación de cada acorde.
  const asWritten = parseProgression("C Am F G")
    .reduce((n, c) => n + playablePositions(guitarDb, c.symbol)[0].frets.filter(f => f === 0).length, 0);
  assert.ok(best.open > asWritten, `el arreglo (${best.open}) no mejora lo obvio (${asWritten})`);
  assert.ok(best.still > 0, "algo tendrá que quedarse quieto entre acordes");
});

test("el mástil dibuja la cejilla y lo que solo pisa ella suena al aire", () => {
  // C6 detrás de una cejilla en el 5: la forma 3 2 0 0 0 0 cae en 8 7 5 5 5 5.
  const withCapo = fretboardSvg([8, 7, 5, 5, 5, 5], { capo: 5 });
  const withoutCapo = fretboardSvg([8, 7, 5, 5, 5, 5]);

  assert.match(withCapo, /class="capo"/, "falta la barra de la cejilla");
  assert.doesNotMatch(withoutCapo, /class="capo"/);

  // Las cuatro cuerdas que solo pisa la cejilla se dibujan como cuerdas al aire,
  // que es lo que hace que la forma se reconozca al venir de la pestaña de cejilla.
  assert.equal([...withCapo.matchAll(/class="note[^"]*\bopen\b/g)].length, 4);
  assert.equal([...withoutCapo.matchAll(/class="note[^"]*\bopen\b/g)].length, 0);

  // Detrás de la cejilla no se puede pisar nada, así que esas casillas no existen.
  const fretsOf = s => [...s.matchAll(/class="cell" data-string="0" data-fret="(\d+)"/g)].map(m => Number(m[1]));
  assert.deepEqual(fretsOf(withCapo), [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  assert.equal(Math.min(...fretsOf(withoutCapo)), 0);
});

test("rootOf saca la fundamental tal como está escrita", () => {
  // Es lo que decide por qué lectura se abre un acorde en el mástil, así que
  // tiene que respetar la grafía: un Db no se abre como C#.
  assert.equal(rootOf("C6"), "C");
  assert.equal(rootOf("Bbmaj7"), "Bb");
  assert.equal(rootOf("F#m7/A"), "F#");
  assert.equal(rootOf("Db"), "Db");
  assert.equal(rootOf("xyz"), null);
});

// ── Catálogo ────────────────────────────────────────────────────────────────

// El catálogo son ficheros estáticos, así que aquí se le pone un servidor de
// mentira: lo que se prueba es qué pide y qué hace con lo que le llega.
const withCatalog = (files, fn) => async () => {
  const before = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async url => {
    const path = new URL(url).pathname.split("/").filter(Boolean).slice(1).join("/");
    requested.push(path);
    return path in files
      ? { ok: true, status: 200, json: async () => files[path] }
      : { ok: false, status: 404 };
  };
  try {
    await fn(requested);
  } finally {
    globalThis.fetch = before;
  }
};

test("la firma de una progresión no depende del tono ni del color", () => {
  // Es lo que hace que preguntar por Am F C G encuentre también a quien la toca
  // en si menor, y a quien le pone séptimas.
  assert.equal(signature(["Am", "F", "C", "G7"]), signature(["Bm", "G", "D", "A"]));
  assert.equal(signature(["Am", "F", "C", "G7"]), signature(["Am7", "F6", "Cmaj7", "G"]));
  // Pero sí depende de lo que suena: un mayor donde había un menor es otra cosa.
  assert.notEqual(signature(["Am", "F", "C", "G"]), signature(["A", "F", "C", "G"]));
  // Y el bajo no cuenta: C/E es C tocado de otra manera.
  assert.equal(signature(["C", "F", "G"]), signature(["C/E", "F", "G/B"]));
  assert.equal(signature(["C", "Zzz", "G"]), null);
});

test("una progresión larga se pregunta por trozos, los de cuatro primero", () => {
  const vs = windows(["C", "Am", "F", "G", "Em"]);
  assert.deepEqual(vs.filter(v => v.length === 4).map(v => v.chords.join(" ")),
    ["C Am F G", "Am F G Em"]);
  assert.deepEqual(vs.filter(v => v.length === 3).map(v => v.from), [0, 1, 2]);
  // Con tres acordes justos no hay ventana de cuatro, y la de tres es la entera.
  assert.deepEqual(windows(["C", "Am", "F"]).map(v => v.length), [3]);
  assert.deepEqual(windows(["C", "Am"]), []);

  // Una progresión que da la vuelta pasa dos veces por las mismas ventanas, y
  // preguntar dos veces lo mismo daría dos veces la misma respuesta.
  const roundTrip = windows(["C", "G", "Am", "F", "C", "G", "Am", "F"]);
  assert.equal(new Set(roundTrip.map(v => v.signature)).size, roundTrip.length);
  assert.deepEqual(roundTrip.filter(v => v.length === 4).map(v => v.chords.join(" ")),
    ["C G Am F", "G Am F C", "Am F C G", "F C G Am"]);
});

test("de qué palabra tirar: el prefijo más largo que esté publicado", () => {
  const man = { the: 6000, wal: 40, wall: 12, wallf: 3 };
  assert.equal(shardFor("wallflower", man), "wallf");
  assert.equal(shardFor("wall", man), "wall");
  assert.equal(shardFor("walk", man), "wal");
  assert.equal(shardFor("the", man), "the");
  // Palabra más corta que los prefijos: valen los que empiecen por ella.
  assert.deepEqual(shardFor("wa", man), ["wal", "wall", "wallf"]);
  assert.equal(shardFor("zz", man), null);
});

test("buscar pide un solo trozo del índice y filtra con la consulta entera", withCatalog({
  "titulos.json": { hot: 3, cal: 2 },
  "titulos/cal.json": {
    a: ["Eagles", "Gipsy Kings"],
    f: [[1, "Hotel California", 0], [2, "Hotel California (Spanish Mix)", 1]],
  },
  "titulos/hot.json": { a: ["Otro"], f: [[3, "Hot Stuff", 0]] },
}, async requested => {
  const r = await search("hotel california");
  // Tira de "cal", que es el trozo más pequeño de los dos que valen.
  assert.ok(requested.includes("titulos/cal.json"));
  assert.ok(!requested.includes("titulos/hot.json"));
  // El título exacto va primero, y lo que no lleva las dos palabras no sale.
  assert.deepEqual(r.map(x => x.id), [1, 2]);
  assert.equal(r[0].artist, "Eagles");
  assert.deepEqual(await search("   "), []);
}));

test("las partes de una canción del catálogo se leen en castellano", withCatalog({
  "canciones/4.json": { 1000: [["verse_1, verse_2", "C Am F G"], ["chorus_1", "F G C"]] },
}, async () => {
  const parts = await song(1000);
  assert.deepEqual(parts.map(p => p.name), ["Estrofa, Estrofa 2", "Estribillo"]);
  assert.deepEqual(parts[0].chords, ["C", "Am", "F", "G"]);
  // Una canción que no está no es un error: es que no está.
  assert.equal(await song(1001), null);
}));

test("dónde suena devuelve cuántas la llevan y una muestra con nombre", withCatalog({
  [`progresiones/4/${fingerprint(signature(["C", "Am", "F", "G"]))}.json`]: {
    [signature(["C", "Am", "F", "G"])]: [24190, [[7, "Let It Be", "The Beatles"], [8, "Sin nadie", ""]]],
  },
}, async () => {
  const [v] = windows(["C", "Am", "F", "G"]);
  const r = await whereSounds(v);
  assert.equal(r.total, 24190);
  assert.deepEqual(r.songs.map(c => c.song), ["Let It Be", "Sin nadie"]);
  assert.equal(r.songs[1].artist, "");
  // La misma progresión en otro tono cae en el mismo sitio del índice.
  const [otra] = windows(["D", "Bm", "G", "A"]);
  assert.equal((await whereSounds(otra)).total, 24190);
}));

test("al puntuar un título se le quita la coletilla de la edición", () => {
  // Los títulos vienen de Spotify y arrastran cómo se publicó la pista. Sin
  // quitarla, cualquier versión que se llame exactamente igual le gana al original.
  assert.equal(withoutEdition("Let It Be - Remastered 2009"), "Let It Be");
  assert.equal(withoutEdition("Hotel California - Live; 1999 Remaster"), "Hotel California");
  assert.equal(withoutEdition("Wonderwall (Remastered)"), "Wonderwall");
  // Pero un título que lleva esas palabras de suyo se queda como está.
  assert.equal(withoutEdition("Live and Let Die"), "Live and Let Die");
  assert.equal(withoutEdition("Cover Me"), "Cover Me");
  assert.equal(withoutEdition("- Live"), "- Live"); // no se puede quedar en nada

  const ws = ["hotel", "california"];
  const original = [1, "Hotel California - 2013 Remaster", "Eagles"];
  const version = [2, "Hotel California", "Grupo Cualquiera"];
  // Con el original arriba del fichero —su intérprete está más transcrito— gana él.
  assert.ok(score(original, ws, 0) > score(version, ws, 0.9));
});

// ── progressions.json: la fuente del generador (hilo 10) ─────────────────

const common = createRequire(import.meta.url)("./progressions.json");

test("progressions.json trae firmas legibles, comunes y ordenadas", () => {
  assert.equal(common.version, 1);
  for (const n of [4, 3]) {
    const rows = common.lengths[n];
    assert.ok(rows.length > 1000, `pocas firmas de ${n}`);
    for (const [sig, total] of rows) {
      const parts = sig.split(".");
      assert.equal(parts.length, n, sig);
      assert.match(parts[0], /^0[Mmdas5]$/, `la primera va sobre sí misma: ${sig}`);
      for (const p of parts) assert.match(p, /^(1[01]|[0-9])[Mmdas5]$/, sig);
      assert.ok(total >= common.minSongs, `${sig} con ${total}`);
    }
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1][1] >= rows[i][1], `desorden en ${n} en ${i}`);
  }
  // La firma del tomo y la de aquí son la misma: si cambia una, cambian las dos.
  assert.equal(signature(["C", "G", "Am", "F"]), "0M.7M.9m.5M");
  assert.ok(common.lengths[4].some(([s]) => s === "0M.7M.9m.5M"), "I V vi IV tendría que ser común");
});
