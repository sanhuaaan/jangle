# Hilos abiertos

Ideas que salieron trabajando y no se hicieron en su momento. No son deuda
técnica: la app funciona sin ellas. Son sitios donde ya se ve por dónde
seguiría creciendo. Las hechas se quedan, con su fecha, como registro de por
qué se hicieron así.

## 1. Los nombres de la pestaña de cejilla

**Dónde está hoy.** Las extensiones que aparecen al poner cejilla se nombran con
una tabla por calidad de acorde (`EXT` en `capo.js`), con una variante para
cuando el acorde ya lleva séptima. Eso resolvió la mentira que había antes —un
`Cmaj7` con la novena al aire se llamaba `Cadd9` cuando lo que suena es un
`Cmaj9`— y mantiene todos los cifrados dentro del vocabulario que la base de
datos de diagramas sabe dibujar.

**Lo que queda cojo.** Un `m7` con la sexta al aire es un `m13`, que es el nombre
correcto y tonal lo entiende, pero **chords-db no lo indexa**. Son el 3,8% de las
propuestas (40 de 1040 en un barrido de doce fundamentales por ocho calidades) y
la única familia afectada. Se proponen igual y su tooltip se dibuja bien —esa
imagen sale de la forma base con la cuerda al aire, no del nombre—, pero no se
pueden abrir en el mástil, porque para eso hace falta que el cifrado exista en la
base de datos. Hay un test que lo documenta y que fallará si aparece otra familia
en la misma situación.

**El camino que se descartó.** `identify.js` ya tiene un cifrador de verdad
(`spell`): convierte un conjunto de notas en el nombre correcto sin tablas. Usarlo
aquí da nombres exactos siempre, pero produce cifrados literales que nadie más
entiende (`G7/11` en vez de `G7sus4`, `C6/11`, `Dm7/11`): medido, el **42%** de
las propuestas dejaba de poder abrirse en el mástil y **360 de 1040** nombres ni
siquiera los sabía leer tonal. Por eso se eligió la tabla.

**Por dónde seguiría.** El problema de fondo es que el vocabulario de `spell`
—pensado para el identificador, donde el nombre es la respuesta final y nadie más
lo consume— no es el mismo que el de la base de datos de diagramas. Una traducción
entre ambos (`7/11` → `11`, `m7/11` → `m11`…) permitiría usar `spell` sin perder
la posibilidad de dibujar. Antes de hacerlo conviene ver cuántos casos son de
verdad, porque puede que la tabla actual ya cubra el 96% con menos código.

## 2. Afinaciones abiertas — hecho (2026-08-20)

Implementado el mismo día en el orden que se planeó por la mañana: el selector
de afinación en el analizador fijó la representación (los seis midis al aire,
de 6ª a 1ª), el generador de digitaciones puso lo que chords-db no tiene, y la
pestaña **Afinaciones** enchufó el motor. El punto de partida era que tras el
hilo 3 el motor ya era agnóstico a la afinación: `linkCost`, el emparejamiento
de voces y los presets operan sobre midis y trastes, nada ahí supone estándar.

**El analizador sabe de afinaciones.** `TUNINGS` en guitar.js (estándar, Drop
D, DADGAD, Open G, Open D) más una **personalizada** que se edita cuerda a
cuerda, hereda la afinación puesta al elegirla —elegir Open G y retocar es como
se inventa una afinación— y sobrevive en localStorage. Cambiar de afinación
renombra lo que suena, no lo que está marcado. Cargar un acorde desde otra
pestaña vuelve a estándar, salvo que la tarjeta traiga la suya.

**El generador (`generate.js`).** Dado un acorde y una afinación, busca por
ventanas de cuatro trastes digitaciones tocables: al menos cuatro cuerdas, solo
notas del acorde, la fundamental siempre (la quinta justa es omisible cuando
hay séptimas o tensiones que defender), el bajo fundamental o quinta, mudas
solo en los extremos y cuatro dedos con la cejilla contando como uno —salvo que
quede una cuerda al aire por encima, que entonces no hay barra que valga—. La
salida calca el contrato de `playablePositions`, con su `position` relativa
para los diagramas, así que motor, diagramas y analizador la consumen sin saber
de dónde salió. El arnés que lo mantiene honesto: las formas curadas de
chords-db deben aparecer entre lo generado, y las seis-al-aire de Open G y
Open D también.

**La pestaña compite setups, no afinaciones.** Un setup es afinación + cejilla
opcional; la cejilla es solo una afinación virtual (midis + traste), así que no
hay formas con nombre que transponer y las notas salen bien solas. Cada capa
son los adornos del acorde (el mismo filtro `isAdornment` de la cejilla, ahora en
rules.js) por sus digitaciones generadas, encadenados con el mismo camino
mínimo resonante (`bestChain`, movida a reharm.js y parametrizada por preset
y coste de nodo). Mismo preset y misma progresión en todos los setups: los
costes por fin SON comparables y las tarjetas se ordenan por coste total. La
estándar compite como una más —perder contra ella ahorra reafinar—. Las
cejillas van bajo demanda (desplegable por tarjeta, trastes 1–5, las tres
mejores), que el producto completo serían segundos de cálculo.

**El solape asumido.** «Estándar + cejilla N» aquí y la pestaña Cejilla pueden
responder distinto, porque beben de fuentes distintas: digitaciones generadas
contra formas curadas. Son dos preguntas —qué es posible si preparas el
instrumento, contra cómo se toca con las formas que ya conoces— y está contado
así en el README.

**Lo que quedó fuera, a posta** (marcado `ponytail:` en el código): cejillas
parciales, mudas interiores y ergonomía fina de la mano. Y **lo que se ganaría
de paso** sigue pendiente: usar el generador también en la pestaña Cejilla, en
estándar, donde la base de datos da solo cuatro posiciones por acorde y eso es
el techo de su buscador de arreglos.

## 3. Rearmonización mediante sistema de costes — hecho (2026-08-19)

Implementado tal como se describía: `reharm.js` tiene una única función de
coste con factores con nombre (movimiento de voces, voz superior, notas
quietas, notas comunes, voces que aparecen o desaparecen, saltos grandes,
cuerdas al aire, desplazamiento de la mano) y cada **preset** es un vector de
pesos sobre ella. A los tres de línea de siempre (descendente, ascendente,
pedal) se suman **Movimiento mínimo**, **Máxima continuidad** y **Máxima
resonancia**; cada tarjeta enseña los mismos números —cuerdas al aire, notas
comunes, semitonos de movimiento— para poder compararlas, que es la gracia:
ninguna se presenta como la correcta.

El movimiento entre dos voicings se mide con **emparejamiento óptimo de
voces**: con las notas ordenadas de grave a agudo, el emparejamiento de
movimiento mínimo nunca cruza voces, así que basta un alineamiento por
programación dinámica donde una voz sin pareja (aparece o desaparece) paga un
peaje fijo. El movimiento del bajo no se mide aparte: el emparejamiento
ordenado ya casa bajo con bajo.

**Conectar con la cejilla — hecho también (2026-08-19).** El motor de
`capo.js` ya no tiene tabla de valores propia: su arreglo paga los enlaces con
el mismo `linkCost` y el preset resonante, y solo añade la cejilla como
dimensión de búsqueda y el filtro de solo-adornos. El factor que solo conocía
la cejilla —la nota quieta que además es al aire cuenta doble— entró al
vocabulario común como `stillOpen`. Queda para más adelante el paso
siguiente: buscar rearmonización y cejilla a la vez.

**Lo que queda abierto de aquí:**

- **Pesos ajustables por el usuario.** Se descartó el slider
  Melódico↔Resonante porque los seis presets ya cubren los extremos y el
  centro. Si algún día se quiere, la maquinaria está: es exponer el vector de
  pesos en la interfaz.

## 4. Fuente de canciones propia a partir de Chordonomicon — hecho y guardado (2026-08-19)

Se hizo entero y se retiró el mismo día, después de usarlo. Lo que se construyó sigue en pie:
**385.664 canciones con sus progresiones por partes** publicadas en un repo estático aparte
—**De Chordis Mysteriis**—, el módulo que las lee y la tubería que las fabrica, todo en `archived/`
y todo probado. Lo que no está es enchufado a la app: ni la segunda fuente del buscador ni la
pestaña «Dónde suena». La versión conectada vive en la rama `catalogo`.

**Por qué se guardó.** La consulta inversa era la razón de hacerlo —de tu progresión hacia afuera,
descubrimiento en vez de consulta— y en uso resultó no aportar: saber que `C Am F G` suena en 24.190
canciones no dice nada de `C Am F G`, y una lista de cuarenta que no has elegido, ordenada por una
señal pobre, no lleva a ninguna parte. La búsqueda por título se fue con ella, porque Ultimate
Guitar ya la cubre y con transcripciones mejores.

**Lo que se aprendió, que es lo que queda:**

- El join contra el volcado de 56M de pistas cubre **376.400 de los 430.323 ids** (87,5%), medido, y
  tarda **37 segundos** leyendo solo tres columnas por HTTP: no hay que bajarse los 4 GB.
  Propagando el nombre del intérprete por su id de Spotify se recuperan 80.000 filas más.
- La grafía de Chordonomicon traduce **exacta en el 99,93%** de los 52 millones de acordes. El resto
  baja por una escalera de simplificaciones hasta algo que tonal sepa leer; un solo token de 4.314
  no da ni para eso.
- La firma transpositiva sale barata: con familias en vez de cifrados completos, las ventanas de
  cuatro acordes de todo el catálogo son **112.071 firmas distintas**, y las de tres, 13.046. Eso es
  lo que hace que el índice inverso quepa en 47 MB en vez de en varios cientos.
- El total publicado son **211 MB** en 12.500 ficheros. Una búsqueda se lleva un trozo del índice
  (20-100 KB comprimidos), abrir una canción otro de 40 KB.
- **Sin señal de popularidad no hay orden bueno.** Se usó cuántas canciones tiene cada intérprete en
  el propio dataset, que confunde "muy transcrito" con "conocido" —Johnny Cash tiene 571 y los
  Beatles 136—. Se mitigó quitando las coletillas de edición ("- Remastered 2009") antes de
  comparar, pero es medio arreglo, y es medio arreglo de lo que más se notaba al usarlo.

**Si algún día vuelve**, además de reconectarlo (`archived/README.md` dice cómo), estas dos quedaron
sin hacer y siguen valiendo: rellenar los ~54.000 títulos que faltan con el oEmbed público de
Spotify, y traer popularidad de una fuente libre (MusicBrainz, ListenBrainz) para que el orden deje
de ser el punto flojo.


## 5. Explorar desde este resultado

**La idea.** Si una tarjeta te gusta —esa versión con cejilla 2, esos voicings—, pulsar
**Explorar** y que Jangle vuelva a buscar partiendo de ahí. No hay resultado final:
encuentro algo, trasteo con ello, encuentro otra cosa. Es la forma de la aplicación
llevada a su conclusión.

**Dónde está hoy.** Media idea ya funciona, por accidente. Todo el estado de la app es
el texto del campo más el hash: `transposeTo` reescribe el campo y hace
`form.requestSubmit()`, y de ahí salen gratis la persistencia al recargar, el atrás como
deshacer y el enlace compartible. Un «Explorar» que solo se lleve **los acordes** de una
tarjeta (`Cmaj7 Am7 F6 G7sus4` en vez de `C Am F G`) es ese mismo gesto y cabe en cinco
líneas.

**Lo que no cabe ahí.** Lo que pides es partir de la **realización**, no de los símbolos,
y eso choca con dos cosas. Una, los motores arrancan libres: `reharmonize` monta sus capas
desde `optionsFor` y `bestChain` empieza cobrando `nodeCost` en la capa 0 —no hay por
dónde clavar un voicing de salida. Dos, una realización no se sabe escribir: el hash
guarda seis caracteres por acorde y una realización son seis trastes, una afinación y una
cejilla por acorde.

**Por dónde seguiría.** Un ancla opcional en las dos búsquedas: una capa 0 de un solo
nodo (el voicing de partida) y, si acaso, un peaje por alejarse de la digitación anclada
—que sería otro factor de `linkCost`, no un caso especial—. Con eso «Explorar» es *rehacer
la pregunta con este acorde ya decidido*, que es más útil que rehacerla desde cero. La
serialización es la parte aburrida y la que decide si el resultado se puede compartir;
merece la pena resolverla junto con el hilo 9, que necesita exactamente lo mismo.

## 6. Comparar dos realizaciones

**La idea.** Marcar dos tarjetas y verlas enfrentadas —diagramas, cuerdas al aire, notas
comunes, movimiento total, voz superior— sin que ninguna se declare mejor. Una herramienta
de decisión, no un veredicto.

**Dónde está hoy.** Los números ya están todos calculados y ya se enseñan: `arrangementStats`
devuelve `open`, `common`, `still`, `movement` y `unpaired` para **todas** las versiones,
pese al preset que las ganara, y `lineStats` da la línea de arriba. Eso se hizo así a
posta —«comparar los números entre tarjetas es parte de la gracia»— pero se quedó a medias:
hoy comparas leyendo dos párrafos separados por media pantalla.

**Por dónde seguiría.** Es casi todo interfaz: seleccionar dos tarjetas y pintarlas en dos
columnas con los mismos números alineados por fila. Lo único que hay que pensar de verdad
es qué pasa cuando las dos realizaciones no tienen los mismos acordes (una rearmonización
contra otra que sustituyó en otro sitio): la fila de la izquierda ya no es «el mismo
acorde». Alinear por hueco de la progresión original —el `slot` que cada paso ya lleva—
en vez de por posición en la lista.

**El riesgo.** Que la tabla invite a leer «gana la que tiene más cuerdas al aire». Los
números están para escuchar mentalmente, y eso hay que decirlo en la propia tarjeta, no
darlo por supuesto.

## 7. Mantener una nota — pedal y cuerda abierta

**La idea.** Elegir una nota (o una cuerda) y que Jangle busque realizaciones que la
mantengan siempre que se pueda. Son dos ideas que resultaron ser una: una cuerda abierta
es una nota mantenida que además no cuesta un dedo. Y es la manera natural de llegar a los
add9, los sus2 y los acordes incompletos: no partes del acorde buscando digitación, partes
de una resonancia que quieres conservar y ves qué se puede construir alrededor.

**Dónde está hoy.** El preset `pedal` mantiene la **voz de arriba**, que no es lo mismo:
manda `topMove` con `dir: 0`, así que sujeta la nota más aguda, sea la que sea, y no una
elegida. Los factores `still` y `stillOpen` cuentan cuerdas quietas y quietas-al-aire,
pero sin decir cuáles. Y hay un problema de forma: mantener una cuerda concreta es una
propiedad **del nodo** (`frets[i] === 0`), no del enlace, y `linkCost` solo sabe de pares.
El hueco donde entraría ya existe: `bestChain(layers, preset, nodeCost)` recibe el coste
de nodo desde fuera; la rearmonización lo mete a mano dentro de `internal`.

**Lo que dicen los números.** Medido sobre 96 acordes (doce fundamentales × ocho calidades):

- Con las formas curadas de chords-db, una cuerda dada está al aire en el **8–23%** de los
  acordes según cuál (la 1ª es la mejor servida, la 6ª la peor). Con `generate.js` en
  estándar sube a un **29% parejo en las seis**, y ahí se para: no es la base de datos, es
  que el 71% restante **no contiene esa nota**. Es un techo musical, no técnico. Por eso
  esto no puede ser un filtro: sobre una progresión de cuatro acordes, exigir la 2ª al aire
  fallaría casi siempre. Tiene que ser un peso, como todo lo demás —lo que sale barato, no
  lo que se impone—.
- Ahora bien, si la nota mantenida puede **renombrar** el acorde en vez de tener que
  pertenecer a él, la cobertura pasa de 29% a **56%**: 28 acordes de 96 ya la tienen y otros
  26 la admiten como add9, sus4, 6, maj7, m9… Ese segundo camino es el interesante, y es
  justo el que ya sabe recorrer la tabla `EXT` de `capo.js`.

**Por dónde seguiría.** Un preset con parámetro (nota o cuerda objetivo) que pague coste de
nodo por no sostenerla, más la decisión de si el pedal puede renombrar. Depende del resto
del hilo 2 —meter `generate.js` en estándar—, porque con cuatro formas por acorde el
buscador no tiene sitio donde elegir. Ese resto deja de ser un extra y pasa a ser el
requisito.

## 8. Un modo caos controlado

**La idea.** Un **Sorpréndeme** que no busque lo óptimo, sino que se aleje a posta de lo
convencional sin abandonar la progresión: `C Am F G` devolviendo `Cmaj7 Am(add9) F6
G7sus4`, o colando un acorde prestado. Con un mando: conservador ↔ aventurado.

**Dónde está hoy.** El presupuesto de rareza **ya existe**, solo que fijo y escondido:
`budgetFor` permite tocar un tercio de la progresión y `budgetCost` cobra un adorno a mitad
de precio que una sustitución, contado en medios dentro del estado del Viterbi. El
comentario dice por qué: «un Fm prestado en el sitio justo es un hallazgo, y en cada compás
es otra canción».

**Por dónde seguiría.** Lo barato es exponer ese presupuesto como el mando y ya. Lo que no
resuelve es el «sorpréndeme»: subir el presupuesto da **el mismo** arreglo con más cambios,
porque el camino mínimo sigue siendo único y determinista. Para que sorprenda hace falta
otra cosa —el segundo o tercer mejor camino en vez del primero, o desempatar al azar entre
caminos de coste parecido—, y eso es maquinaria nueva (k-mejores caminos sobre el mismo
grafo). Antes de escribirla conviene probar si con el mando solo ya aparecen cosas que no
se te habrían ocurrido, que puede que sí.

**El riesgo.** Que salga ruido con nombre de acorde. La red que ya hay —`repeatCost`, el
recargo por tocar el primer acorde— está puesta contra eso y habrá que ver si aguanta con
el presupuesto abierto.

## 9. Guardar hallazgos, no solo canciones

**La idea.** Junto al cancionero, una colección de **hallazgos**: no «canción →
progresión», sino la receta entera —`C Am F G`, afinación estándar, cejilla 2, preset
Resonancia, cuatro cuerdas al aire, nota pedal B—. Jangle como cuaderno propio de recursos
guitarrísticos.

**Dónde está hoy.** `library.js` guarda canciones en localStorage con una identidad
deliberadamente sencilla: `songKey` es intérprete + título en minúsculas, sin ids
generados, para que el JSON exportado se pueda editar a mano. Un hallazgo no tiene título
ni intérprete, así que necesita su propia identidad, y lo honesto es que sea la receta
misma —acordes + setup + preset— para que guardar dos veces lo mismo siga sin duplicar.

**Por dónde seguiría.** Otra colección al lado, con su clave y su versión, que reutilice
descargar/cargar/fundir tal cual. Lo que hay que resolver primero es **cómo se escribe una
realización**, que es el mismo problema del hilo 5: hoy no hay forma de nombrar «estos
voicings». Resuelto eso, un hallazgo es esa cadena más una nota tuya, y «Explorar» y
«Guardar» son el mismo dato leído de dos maneras.

**Lo que lo haría valer la pena.** Que un hallazgo se pueda volver a abrir y seguir
trasteando —o sea, el hilo 5— y que se pueda pasar a alguien, que es lo que ya hacen
descargar y cargar. Sin esas dos, es una lista de capturas de pantalla en texto.

## 10. Un generador de progresiones para empezar a componer — hecho (2026-09-13)

**La idea.** Hoy las cuatro pestañas consumen una progresión; para quien está componiendo,
lo que no tiene es precisamente eso. Un botón junto al campo —«Sugiéreme una»— que dé una
progresión común en el tono que pidas, y que las pestañas hagan el resto: para componer
post-rock, que vive de acordes extendidos y cuerdas al aire, el plan es **partir de una
progresión común e irla alterando**, y alterar es lo que jangle ya sabe hacer.

**Por qué no un generador cualquiera.** Diatónicos al azar hay mil y no tienen nada de
jangle. Este tendría dos fuentes propias:

- **El tomo como fuente.** De Chordis Mysteriis guarda 112.071 firmas de cuatro acordes y
  13.046 de tres, cada una con cuántas canciones la llevan (`progresiones/4/<hex>.json`, un
  objeto `firma → [total, muestra]` en 1.024 ficheros). Para buscar, esa frecuencia no decía
  nada; para generar es justo lo que hace falta: frecuente suena a canción, rara-pero-no-única
  es interesante, y el mando conservador↔aventurado sale gratis de los totales. La firma es
  invariante a transposición, así que «dado un tono» es exacto: se prueban los doce
  arranques y se queda el que `detectKey` lleve al tono pedido. Y como la firma solo guarda
  familias (M, m, d, a, s, 5), lo que sale son tríadas: el color lo ponen las pestañas, que
  es donde debe estar. Los bucles de dos acordes del post-rock aparecen como `A.B.A.B` dentro
  de las ventanas de cuatro, así que no hace falta indexar nada nuevo.
- **La guitarra como criba.** Entre veinte candidatas, ordenar por lo que ganan en tu
  instrumento: el coste del mejor arreglo resonante (`reharmonize` con el preset
  `resonance`, milisegundos por candidata). No cuenta cómo suenan las tríadas peladas sino
  **cuánto dan de sí** una vez adornadas —la pregunta del post-rock—. Con afinación elegida
  en la pestaña, la misma criba dice qué progresiones hacen sonar *esa* afinación.

**Lo que no hace falta reconectar.** El catálogo sigue guardado. Esto solo necesita **un
JSON** con las N firmas más frecuentes y sus totales, construido una vez offline leyendo los
1.024 cubos del índice publicado y llevado con la app: decenas de KB, cero peticiones en
uso. Es reutilizar el trabajo del hilo 4 sin abrir la puerta que se cerró.

**Los parámetros.** Tono, sí, con el aviso de siempre: `detectKey` solo sabe de mayores, así
que menor es «relativo mayor sesgado hacia el vi», que en la práctica va bien. Longitud no
como campo: cuatro por defecto, «más larga» encadena dos ventanas que compartan el arranque.
El mando de rareza, y un «otra». Y las suspendidas: la familia `s` no distingue sus2 de
sus4; para post-rock, sus2 por defecto y que la pestaña lo cambie.

**Dónde va.** No es pestaña: es el patrón de `transposeTo` —rellenar el campo y
`requestSubmit()`—, así que no hay estado nuevo y las cuatro pestañas responden al
instante sobre lo sugerido. Con el hilo 5 cierra el bucle de componer: sugerir → mirar →
explorar → guardar (hilo 9).

**Lo que se ha medido (2026-09-13), antes de tocar interfaz.** El fichero ya está:
`progressions.json`, construido por `progressions.mjs` desde los 2.048 cubos publicados. Corte
en cien canciones —una progresión que llevan cien canciones es una progresión común—: 4.611
firmas de cuatro acordes y 1.633 de tres, **124 KB, 31 comprimido**. Y las dos preguntas:

- **Cómo de concentrado está el tomo.** Las cien firmas de cuatro más frecuentes cubren el 37%
  de todas las ventanas; las 2.000, el 83%. Las de tres, más aún: cien cubren el 68%. Las cinco
  primeras son `I V I V`, `I IV I IV`, `I IV ♭VII IV`, `I V ii I` y `I V IV I`. Y **la mitad son
  rotaciones**: de las cien firmas de cuatro más frecuentes salen 50 bucles distintos. El
  generador tiene que fundirlas al elegir y separarlas al arrancar.
- **Si la criba resonante separa.** Sesenta bucles frecuentes distintos realizados en G, D y E,
  medido el mejor arreglo *sin añadir acordes* (la línea cromática `Em EmMaj7 Em7 Em6` inflaba
  la primera medida por tener más pasos, no más resonancia). Cuerdas al aire en cuatro acordes:
  en G de 0 a 12 con mediana 7; en D de 0 a 12 con mediana 4; en E de 0 a 11 con mediana 3.
  Separa, y mucho. Y la correlación de rango entre frecuencia y resonancia es **0,45 / 0,10 /
  0,36**: las más comunes no son las que más dan de sí, así que la segunda fuente no es
  redundante. Lo que sale arriba ya suena a lo que se busca: `C G6 Dsus2 Em`, `Em A Dsus2 Em`,
  `C#m B6 Asus2 E`.

**Dos detalles que salieron midiendo.** Realizar una firma «en G» exigiendo que `detectKey`
devuelva G descarta la mitad: los bucles eólicos (`Em C D Em`) empatan entre G y su relativo y
el desempate se los lleva. Mejor elegir el arranque que más notas diatónicas mete y dejar que
`detectKey` etiquete. Y la grafía: el generador debe escribir con `transposeSymbol` e
`intervalTo` desde el tono, no con `noteName`, o en E sale `Abm` donde va `G#m`.

**Hecho el mismo día**, tal como se planeó: `progressions.js` sortea por frecuencia, realiza
en el tono, funde rotaciones y criba con `reharmonize` y el preset resonante; el diálogo «una
común» va junto a la canción y el cancionero y rellena el campo por el camino de siempre. Dos
cosas se decidieron construyendo:

- **La realización sigue a `detectKey`**, no al encaje diatónico: si no, la tarjeta decía «en
  Sol» y la columna «Tonalidad estimada: Do». Consecuencia honesta: `I ♭VII IV I` no existe
  para la app, sale `V IV I V`. Y salió un fallo de `detectKey` que ya estaba: en empate
  decidía el croma más bajo, así que `G D G D` se leía en Re y `G C G C` en Do —las dos firmas
  más frecuentes del tomo, mal etiquetadas—. Ahora en empate gana el tono del primer acorde,
  y si ese acorde es menor, su relativo mayor: `Em Bm Em Bm` se lee en Sol, no en Re. Con eso
  las firmas que arrancan en menor y la app lee en su relativo pasan del 16% al 50% (63% por
  canciones), y eso es lo que hace posible ofrecer **tonos menores**: «en Em» es «en Sol
  alrededor del Em». Lo que no entra son las dóricas (`Em A Em A`, que se lee en Re sin
  empate): ahí el límite es el modelo de un solo modo, el `ponytail:` de `rules.js`.
- Las firmas de una sola fundamental (`0M.0M.0M.0s`, que es `G G7 G Gsus4`) se filtran: el tomo
  las trae porque las ventanas se cortan sin mirar.

**Otra parte de la misma canción — hecha la barata (2026-09-13).** Volver a pulsar solo
compartía el tono. Ahora, con progresión en el campo, «otra parte» se queda con las sorteadas
que comparten algún acorde con ella (por fundamental y familia, sin color), arrancan en otro y
no son el mismo bucle girado; se sortean el doble porque los filtros tiran la mitad. **Lo que
queda abierto:** la de verdad —qué otras partes llevan las canciones del tomo que tienen ésta,
coocurrencia de firmas por canción, que habría que construir offline desde los ficheros de
canciones— y las progresiones de ocho, encadenando dos ventanas.
