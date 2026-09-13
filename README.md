# Jangle

## La idea

**Jangle no busca respuestas; busca posibilidades.**

Jangle es una herramienta para explorar qué posibilidades armónicas y guitarrísticas contiene una canción.

Una progresión de acordes puede admitir muchas interpretaciones: cambiar el color de un acorde, sustituir su función, añadir movimiento entre dos acordes, mantener una nota como pedal, buscar una línea melódica en la voz superior o simplemente encontrar una posición de guitarra que haga que toda la progresión resuene de otra manera.

Jangle intenta hacer visibles esas posibilidades. No pretende encontrar *la forma correcta* de tocar una progresión, sino facilitar la experimentación, la comparación y el descubrimiento.

La teoría sirve para **explicar lo que ocurre**, no para decirte qué debes tocar.

Todo parte de la guitarra: las posibilidades armónicas se relacionan con las digitaciones, las cuerdas al aire, la conducción de voces y la cejilla. Las distintas opciones se presentan como caminos posibles para explorar una misma progresión, no como respuestas definitivas.

En definitiva, Jangle es una herramienta para **trastear con la armonía, descubrir colores y encontrar nuevas formas de tocar lo que ya conoces**.

## Uso

Es una página estática sin build, pero **hay que servirla**: abrir `index.html` a pelo con `file://`
no vale, porque el navegador bloquea los módulos ES por CORS y no arranca nada. Sirve la carpeta con
cualquier servidor estático:

```bash
python3 -m http.server 8123
# o
npx serve .
```

En pantallas anchas la app se reparte en dos columnas: a la izquierda, siempre a la vista, la
progresión actual, los controles de transposición y el identificador de acordes; a la derecha, las
pestañas de análisis. **La columna izquierda va fija**: se queda a la vista por mucho que bajes por
las sugerencias, y si no cabe en la ventana se desplaza por dentro. Su ancho lo marca el mástil
(38rem) y la página crece otro tanto, así que tenerlo a mano no le quita sitio al análisis. El
buscador de canciones y el cancionero se abren en un diálogo, para consultarlos sin mover la columna.
En pantallas estrechas todo fluye en una sola columna.

Abre `http://localhost:8123`, escribe una progresión (p. ej. `C Am F G7`, separada por espacios, comas o `|`) y pulsa **Sugerir**. Cada sugerencia muestra por qué funciona, y al posar el ratón sobre cualquier nombre de acorde aparece un tooltip con hasta 4 posiciones del acorde en el mástil.

Un acorde corriente saca del orden de doce opciones, así que la pestaña de
**Sustituciones** las pliega por acorde (abierta la del primero) y dentro las agrupa por lo que le
hacen, que es la decisión de verdad antes de mirar la regla concreta:

- **Adornar** — el mismo acorde con más notas: cambia el color, no la función (`C → Cmaj7`, `C6`, `Cadd9`, `Csus2`).
- **Cambiar** — otro acorde en su lugar, que hace el mismo papel (`C → Am`, `Em`, `Cm`).
- **Añadir** — acordes que lo preparan o lo alargan, repartiéndose su tiempo (`C → Dm7 G7 C`, `Fm C`, `Bb7 C`).

Al pie de esa columna está el **identificador de acordes**, que va al revés: marcas pulsaciones en un
mástil de 15 trastes y te dice qué acorde forman. Funciona sin escribir nada en el buscador, y está
siempre a la vista — no se abre ni se cierra, así que nunca empuja lo que estabas leyendo.

Los nombres de acorde del resto de la app llevan ahí: al pulsar cualquiera, su primera
posición de la base de datos se carga en el mástil. Se carga siempre lo que
pone escrito, no la forma del tooltip — en la pestaña de cejilla el tooltip enseña la forma
transpuesta que se toca, y nombrarla daría el acorde equivocado.

Las grafías van con sostenidos, como se leen en guitarra: `C#` y no `Db`, `Eb` y no `D#`. Hay tres
respuestas posibles a "cómo se escribe este sonido" y la app las tiene separadas a propósito, porque
son preguntas distintas: `NOTES` en `notes.js` nombra notas sueltas y fundamentales de acorde, `KEYS`
nombra tonalidades (`Db` mayor y no `C#` mayor, que tendría siete sostenidos), y la grafía con la que
indexa la base de datos de diagramas es cosa suya y no sale de `guitar.js`. Que hoy dos de ellas
coincidan es casualidad, no motivo para fundirlas: cuando compartían tabla, una progresión escrita en
`Db` se anunciaba como "C# mayor".

## Transponer

Bajo la progresión hay dos botones `−1 / +1` y un selector de tono: la progresión entera pasa a
sonar en otro tono, que es lo que se pide cuando una canción no entra en la voz. No hay estado
nuevo: transponer reescribe el campo de progresión y relanza el análisis, así que el tono queda en
el hash de la URL y de ahí salen gratis la persistencia al recargar, el botón atrás como deshacer y
un enlace compartible que ya lleva el tono elegido.

La transposición va **por intervalo y no por semitonos**, que es lo que hace que cada tono se
escriba como se escribe: a Lab mayor salen `Ab Fm Db Eb` (con `Db`, no `C#`) y a Si mayor
`B G#m E F#` (con `G#m`, no `Abm`). El bajo se mueve con la fundamental, así que `C/E` sube una
segunda mayor a `D/F#`. Los diagramas no se enteran: `findShape` busca por sonido, así que un `Db`
encuentra las posiciones de `C#`.

Los doce tonos del selector son los que escribe un guitarrista (`Db` y no `C#`), y solo se aplica a
la progresión: las reglas y la pestaña de cejilla siguen generando nombres con la grafía de la base
de datos, así que en tonos con bemoles alguna sugerencia suelta puede salir con sostenido.

Transponer también cambia por completo la pestaña de **Cejilla**: al cambiar de tono cambian las
cuerdas al aire que caen sobre cada acorde, así que la misma progresión en otro tono ofrece
extensiones distintas. Es otra palanca para buscar texturas, no solo para cantantes.

## Reglas implementadas

Adornar el acorde:

| Regla | Ejemplo |
|-------|---------|
| Séptima diatónica | `C → Cmaj7`, `Am → Am7`, y `G → G7` si es el V |
| Sexta | `C → C6`, `Am → Am6` |
| Novena | `C → Cadd9`, `Am7 → Am9`, `Cmaj7 → Cmaj9` |
| Suspensión sus2 | `C → Csus2` |
| Tensión del dominante | `G7 → G13` |
| Dominante alterado | `G7 → G7#9`, y `7b9` si resuelve a menor |

Cambiarlo por otro:

| Regla | Ejemplo |
|-------|---------|
| Sustitución de tritono | `G7 → Db7` |
| Relativo mayor/menor | `C → Am`, `Am → C` |
| Mediante | `C → Em` |
| Intercambio modal | `F → Fm` |
| Dominante sin fundamental | `G7 → Bm7b5` |
| Disminuido dominante | `G7 → Bdim7` |

Añadir acordes delante o alrededor:

| Regla | Ejemplo |
|-------|---------|
| Dominante secundario | `Dm → A7 Dm` |
| Inserción ii-V | `G7 → Dm7 G7` |
| ii-V secundario | `C → Dm7 G7 C`, `Am → Bm7b5 E7 Am` |
| Aproximación cromática | `C → C#7 C` |
| Dominante de puerta trasera | `C → Bb7 C` |
| Subdominante menor | `C → Fm C` |
| Retardo sus4 | `C → Csus4 C`, `G7 → G7sus4 G7` |
| Disminuido de paso (tono entero, arriba o abajo) | `C Dm → C C#dim7 Dm`, `Am G → Am Abdim7 G` |
| Paso diatónico (saltos de tercera) | `C Em → C Dm Em`, `Am F → Am G F` |
| Línea cromática interna | `Am → Am AmMaj7 Am7 Am6` |
| Línea hacia el IV | `C F → C Cmaj7 C7 F` |

La tonalidad mayor se estima automáticamente a partir de la progresión (se muestra en el resultado) y es
la que usan el paso diatónico y la séptima diatónica.

Todo cifrado que sale de una regla tiene posiciones en la base de datos de guitarra, así que cualquier
sugerencia se puede ver dibujada y abrir en el mástil. Hay un test que lo comprueba.

## Cejilla: cómo suena al aire

La pestaña **Cejilla** responde a dos preguntas por cada posición de cejilla, y en ese orden. Se
enseñan las tres cejillas que más resuenan; el resto sale dosificado con el botón **«ver otra
cejilla»**, que en cada pulsación saca la siguiente del ranking, dice cuántas quedan y se va con la
última — el ranking propone, pero a lo mejor la canción pide justo la cejilla que no ganó.

Arriba, **cómo se toca**: el arreglo que más resuena detrás de esa cejilla, con un diagrama por
acorde y la cuenta de lo que se gana. Para `C Am F G` la mejor sale con cejilla en el traste 5, donde
la progresión se toca con formas de G6, Em7, Cadd9 y Dsus2 — **14 cuerdas al aire y 11 notas que no
se mueven** entre acordes, frente a las 10 y 7 de tocarla sin cejilla. Al pulsar cualquier acorde del
arreglo se abre en el mástil **con su cejilla puesta**: se dibuja la barra en el traste que toque, las
cuerdas que solo pisa ella se ven como cuerdas al aire y detrás de la cejilla no se puede pisar nada.
Así la figura del mástil es la misma que la del diagrama, y el nombre sigue siendo el que suena de
verdad (ese `C6` con cejilla en 5 son las notas 8 7 5 5 5 5, no un G6).

Debajo, **qué color da**: todas las extensiones que esa cejilla pone a tu alcance gracias a las
cuerdas al aire, las haya elegido el arreglo o no. Es el menú para trastear, y sigue siendo cálculo
puro: qué cuerda al aire cae sobre qué extensión de cada acorde.

Las dos mitades comparten una sola ordenación, la del arreglo, porque es la que sabe si algo se puede
tocar de verdad.

**Cómo se busca el arreglo.** Es el mismo camino mínimo **y el mismo sistema de costes** que usa la
rearmonización, con su preset de máxima resonancia:
cada acorde ofrece sus adornos (add9, sus2, 6, maj7, m7… los de la columna *Adornar*, que cambian el
color pero no la función) y cada adorno sus digitaciones de la base de datos, y se paga por lo que se
pierde de resonancia. Vale una cuerda al aire, vale más una nota que no se mueve —misma cuerda, mismo
traste que en el acorde anterior—, y vale el doble si esa nota quieta era una cuerda al aire: en
guitarra eso no es que la nota se comparta, es que sigue sonando sola mientras la mano se va a otro
sitio. Hay un peaje pequeño por adornar, para que a igualdad de resonancia gane el acorde tal como lo
escribiste, y otro por saltar de posición con la mano.

Solo se admiten adornos a propósito: sustituir el acorde por otro o meterle acordes delante ya es
rearmonizar, y para eso está su pestaña. Y las formas se filtran por dónde caen de verdad en el
mástil, que detrás de una cejilla en el 7 un traste 6 de la forma es el 13 real.

## Rearmonizar la progresión entera

La pestaña de **Sustituciones** da opciones sueltas: para cuatro acordes ya son medio centenar de
sugerencias independientes, y montar el arreglo queda de tu parte. **Rearmonizar** hace ese trabajo:
elige unas cuantas que encajen entre sí y devuelve la progresión completa, tocable de principio a fin.

El criterio para que encajen lo pone un **sistema de costes con pesos**: una sola función mide lo
que pasa entre dos digitaciones —movimiento de cada voz, la voz de arriba, notas quietas, notas
comunes, voces que aparecen o desaparecen, saltos grandes, cuerdas al aire, desplazamiento de la
mano— y cada **versión es un vector de pesos** sobre ella. Tres persiguen la voz de arriba
(descendente, ascendente, nota pedal) y otras tres priorizan otra cosa: **movimiento mínimo** (cada
voz va a lo que tiene más cerca), **máxima continuidad** (lo compartido se queda sonando donde está)
y **máxima resonancia** (mandan las cuerdas al aire, el mismo criterio que la pestaña de cejilla).
Ninguna se presenta como la correcta: cada tarjeta enseña los mismos números —cuerdas al aire, notas
comunes, semitonos de movimiento entre voces— para poder compararlas, y si dos versiones acaban en
el mismo arreglo se enseña una sola vez.

El movimiento entre dos digitaciones se mide **emparejando las voces de forma óptima**: con las
notas ordenadas de grave a agudo, el emparejamiento de movimiento mínimo nunca cruza voces, así que
se encuentra con un alineamiento donde una voz que aparece o desaparece cuenta como cambio
estructural, no como salto.

Cada criterio cambia qué acordes salen y con qué digitación. Para `C Am F G7` la versión
descendente propone `C Amadd9 F G7`, con la voz de arriba en `C → B → A → G`: la novena entra
precisamente porque su `B` completa la bajada. La de movimiento mínimo propone `C Am Fmaj7 G13`,
que cruza la progresión entera moviendo 7 semitonos en total, y la de máxima continuidad descubre
sola el cliché de línea `C · Am AmMaj7 Am7 Am6 · F · G7`, con 14 notas comunes.

Es un camino mínimo (Viterbi) sobre un grafo por capas: cada hueco de la progresión ofrece varios
acordes, cada acorde varias digitaciones de la base de datos, y el coste de encadenar dos lo pone el
vector de pesos de cada versión. Sobre eso mandan tres reglas de sentido común:

- El **primer acorde no se toca**, que es el que planta la tonalidad.
- No se admiten dos acordes iguales seguidos si el original tenía movimiento ahí: eso no es
  rearmonizar, es quedarse sin un acorde.
- Hay **presupuesto de cambios** (un tercio de la progresión). Sin tope, un `Fm` prestado en el sitio
  justo deja de ser un hallazgo y se convierte en otra canción. Se cuenta en medios: adornar un acorde
  gasta la mitad que cambiarlo por otro, porque no lo es.

Al pulsar cualquier acorde del arreglo se abre en el analizador **esa digitación concreta**, no la
primera de la base de datos, que es justamente la que hace la línea.

## Afinaciones: qué preparación le sienta mejor

La pestaña **Afinaciones** deja que las afinaciones compitan por tu progresión: las cinco con
nombre (estándar, Drop D, DADGAD, Open G, Open D) más la personalizada si la has creado en el
analizador. Para cada una busca el mejor arreglo con el mismo camino mínimo resonante de la
cejilla y los mismos adornos, y como el preset y la progresión son los mismos en todas, **los
costes por fin son comparables**: las tarjetas van ordenadas por coste total y la primera es la
afinación que más le resuena a lo que has escrito. La estándar compite como una más — cuando gana,
te ahorra reafinar.

Las digitaciones no salen de la base de datos, que solo sabe de estándar: las produce un
**generador de digitaciones** (`generate.js`) que busca por ventanas de cuatro trastes formas
tocables — al menos cuatro cuerdas, solo notas del acorde, la fundamental siempre, el bajo
fundamental o quinta, mudas solo en los extremos, y cuatro dedos con la cejilla contando como uno.
En estándar encuentra solas las formas de toda la vida, que es el test que lo mantiene honesto.

Cada tarjeta lleva un desplegable **«probar con cejilla»** que añade la cejilla como dimensión del
setup: prueba esa afinación con cejilla del 1 al 5 y enseña las tres que más resuenan. Para
`D G A D` gana Open D con `D · Gsus2 · A6 · Dmaj7` y 19 cuerdas al aire, frente a las 10 de la
estándar pelada.

Al pulsar cualquier acorde, el analizador se pone en ese setup entero —afinación y cejilla— y
enseña la digitación sonando lo que dice la tarjeta. Ojo al solape con la pestaña Cejilla:
«estándar + cejilla 2» aquí y «cejilla en 2» allí pueden dar arreglos distintos, porque esta
pestaña usa digitaciones generadas y aquella las formas curadas de la base de datos. Son dos
preguntas distintas: qué es posible si preparas el instrumento, contra cómo se toca con las formas
que ya conoces.

## Identificar un acorde desde el mástil

En el **identificador de acordes** hay un mástil de 15 trastes donde cada cuerda suena una sola nota:
al pulsar un traste la nota se mueve ahí, al volver a pulsar donde ya estaba la cuerda se apaga, y la
columna a la izquierda de la cejuela alterna al aire y muda (×).

El mástil tiene **selector de afinación**: las cinco con nombre y una **personalizada** que se
edita cuerda a cuerda (cada una en una octava alrededor de la estándar), hereda la afinación que
estuviera puesta —elegir Open G y de ahí retocar es justo cómo se inventa una afinación— y
sobrevive a recargas. Cambiarla renombra lo que suena, no lo que está marcado: las mismas seis
cuerdas al aire son `Dsus4` en DADGAD y `G/D` en Open G. Cargar un acorde desde otra pestaña
devuelve el mástil a estándar, salvo que venga de Afinaciones, que trae la suya puesta.

Cada nota lleva su nombre escrito dentro, la fundamental va en otro color para localizarla en el
mástil, y a la derecha de cada cuerda aparece el papel que juega esa nota en el acorde (`1`, `3`,
`b7`, `11`…). Las lecturas posibles aparecen siempre bajo el mástil, con la activa resaltada.

Las mismas notas tienen **un nombre por cada una que tomes como fundamental**, y todos son correctos:
se ofrece una lectura por nota, ordenadas por lo probable que es que sea la que tenías en mente
(fundamental en el bajo, cifrado corriente y sin alteraciones de más). Al pulsar cualquiera de las
otras lecturas pasa a ser la principal y el mástil se reetiqueta con sus grados. La nota más grave la
pone la cuerda que suena, no la lectura, así que las que no la tienen por fundamental salen como
inversión: `Emb6/G`.

**Dos notas ya son acorde.** La quinta justa es el acorde de quinta de toda la vida (`C5`) y la
tercera es la que decide el carácter, así que se nombran igual, diciendo lo que no suena para no
prometer notas que no están: `C(no5)`, `Cm(no5)`, `Csus4(no5)`. Las sextas son esas mismas terceras
vistas desde la otra nota y salen solas: `C-A` da `C6(no3,no5)` leyendo desde C y `Am(no5)` desde A,
y lo que decide cuál va primera es cuál quede en el bajo. Con una sola nota no hay nada que nombrar.

**Acordes a los que no les suena la fundamental.** En cuanto hay un bajo, la guitarra deja de tocar
la fundamental y se queda con lo que define el acorde, así que `B-D-F` no es solo un `Bdim`: es el
`G7` sin el `G`. Bajo las lecturas corrientes aparece un grupo aparte, **Sin la fundamental**, que
prueba como fundamental las notas que *no* suenan. Solo pasan las que dejan un cifrado corriente y
con notas guía —3ª y 7ª, que son las que hacen echar de menos una fundamental—; sin ese filtro cada
acorde arrastraría una docena de lecturas rebuscadas, que es lo que vuelve inútil una lista. Y van
siempre detrás de las lecturas cuya fundamental está pisada, que son las notas que de verdad tienes
puestas.

Con dos notas no se especula: la fundamental ausente sería una de las dos que faltan de cuatro, más
suposición que dato. La excepción es el tritono, que no puede ser otra cosa que la 3ª y la 7ª de un
dominante, así que `B-F` sí da `G7/B` y `C#7/B`.

Los cifrados no salen del diccionario de tonal, que solo conoce 106 tipos y deja sin nombre casi
todo lo que no es un acorde de manual. Se componen intervalo a intervalo (`spell` en `identify.js`):
tercera, quinta, séptima y sexta se consumen primero y lo que sobra se cuelga como tensión, leída
según haya séptima o no — el mismo Ab sobre C es `b6` en una tríada y `b13` en un dominante.

| Pulsaciones | Lectura |
|-------------|---------|
| `× 3 2 0 1 0` | `C` |
| `0 3 2 0 1 0` | `C/E` (inversión) |
| `× 3 2 0 3 0` | `Cadd9` |
| `3 2 0 0 0 1` | `G7` |
| `× 3 5 × × ×` | `C5` |
| `× 3 2 × × ×` | `C(no5)`, la tercera sola |
| `× × × 4 3 1` | `Bdim`, y `G7/B` sin la fundamental |
| `3 3 2 4 0 0` | `Cmaj7/G`, y también `G6/11`, `Emb6/G` y `Bsus4b6b9/G` |

## Buscar canciones («…o tráela de una canción»)

Escribe título e intérprete y la app saca las progresiones de la transcripción de acordes
mejor votada de Ultimate Guitar, separadas por partes (`[Intro]`, `[Verse]`, `[Chorus]`…).
Cada parte tiene un botón «Usar» que la convierte en la progresión actual y un «Guardar» que la
manda al cancionero.

El autocompletado del buscador va directo a UG, que sirve su endpoint de sugerencias con CORS
abierto. La búsqueda y la descarga del tab no: UG no manda `Access-Control-Allow-Origin` y tiene
fichadas las IPs de los proxys CORS públicos (allorigins y codetabs devuelven 522, corsproxy.io
403). Por eso hay un proxy propio, `proxy-worker.js`: un Cloudflare Worker de 20 líneas que solo
acepta URLs de `ultimate-guitar.com` y las reenvía con user-agent de navegador.

Ya está desplegado en `https://jangle-proxy.jangle.workers.dev` (plan gratuito, 100.000
peticiones/día), y es lo que usa `PROXY` en `song.js`. Para trabajar contra una copia local del
worker no hace falta tocar el código: `localStorage.proxy` manda sobre la constante.

El worker solo atiende a la propia app: mira el `Origin` y deja pasar `sanhuaaan.github.io` y
cualquier puerto de `localhost`; al resto, y a quien no manda `Origin` —una navegación pegando la
URL en la barra, o un `curl` pelado—, les responde `403`. No es una barrera de seguridad, que esa
cabecera se falsifica en un segundo, sino lo que evita que el worker termine siendo el proxy CORS
gratuito de terceros y se coma la cuota. Y acota a la cuenta más que al repo: `Origin` es un
dominio y no una ruta, así que otra página publicada en `sanhuaaan.github.io` pasaría igual. Si
publicas Jangle en otro sitio, añade su origen a `ALLOWED_ORIGIN` en `proxy-worker.js`.

```bash
# levantar el worker en local, en http://localhost:8787
npx wrangler dev proxy-worker.js
# y en la consola del navegador:
#   localStorage.proxy = "http://localhost:8787"

# volver a desplegar tras cambiarlo
npx wrangler deploy proxy-worker.js --name jangle-proxy --compatibility-date 2026-08-17
```

Los datos salen del JSON incrustado en `div.js-store[data-content]` de las páginas de UG, que no
tiene API oficial: si rediseñan la web, `song.js` dejará de parsear. Los tests con fixture marcan
el punto exacto de la rotura.

## Guardar canciones («…o tráela de tu cancionero»)

Una canción es un puñado de partes, y cada parte una progresión. Se guardan desde los dos sitios
donde aparecen: el botón **Guardar** que lleva cada parte de una transcripción de Ultimate Guitar, y
el formulario del cancionero, que guarda con nombre lo que haya escrito arriba. Cada parte guardada
es un chip con su nombre: pulsarlo la sube al campo de progresión (los acordes asoman al posar el
ratón, y la × la quita), y de ahí sigue el camino de siempre: la
progresión se escribe en el hash de la URL y es el hash lo que pinta. El cancionero no es una segunda
fuente de verdad, solo otra manera de rellenar ese campo.

**Todo vive en el `localStorage` del navegador**, bajo la clave `jangle.songs`. No hay servidor ni
cuentas: la app es estática y lo único que hay detrás es el proxy, que no guarda nada. El precio es
que el cancionero no viaja de un dispositivo a otro y se lo lleva un borrado de datos del sitio
(Safari, además, desaloja el almacenamiento tras unos días sin visitar la página). De eso se encargan
**Descargar cancionero** y **Cargar cancionero**, que son a la vez la copia de seguridad, el paso a
otro dispositivo y la manera de pasárselo a alguien. Cargar **funde, no reemplaza**: se pueden juntar
varios ficheros y cargar el propio dos veces no cambia nada.

```json
{
  "version": 1,
  "songs": [
    {
      "song": "Let It Be",
      "artist": "The Beatles",
      "key": "C",
      "url": "https://tabs.ultimate-guitar.com/…",
      "sections": [
        { "name": "Verse", "chords": ["C", "G", "Am", "F"] },
        { "name": "Chorus", "chords": ["Am", "G", "F", "C"] }
      ]
    }
  ]
}
```

Sin ids y sin fechas, a propósito. La identidad de una canción es intérprete + título, así que
guardar dos veces la misma no duplica, y exportar dos veces el mismo cancionero da el mismo fichero
—que es lo que permite llevarlo en git y que el diff diga algo—. También se edita a mano sin tener
que inventarse identificadores: `artist`, `key` y `url` son opcionales, `name` sale «Progresión» si
falta, y una lista pelada de canciones, sin el envoltorio `{version, songs}`, se carga igual.

Lo que no se entiende se descarta **contándolo**, no en silencio: una canción sin título o sin
partes, y cualquier parte con algún acorde que tonal no sepa leer (la misma criba que se aplica a las
transcripciones de UG, aquí para que un fichero de fuera no cuele progresiones que reventarían al
usarlas). Dos partes con la misma progresión son la misma parte aunque las llamen distinto, igual que
al leer una transcripción se funden `Verse 1` y `Verse 2`. Y **quitar la última parte se lleva la
canción**: una canción sin progresiones no es nada que se pueda enseñar.

Lo que no hace: editar una parte guardada en el sitio. Se carga con «Usar», se retoca arriba y se
vuelve a guardar; el formulario queda apuntando a ella —con su intérprete y su enlace— así que es un
par de clics.

En el repo hay uno guardado, `songbook.json`, como copia de seguridad. La app no lo carga sola: se
importa con «Cargar cancionero», como cualquier otro.

## Pedir una progresión común («…o pide una común»)

Las pestañas consumen una progresión; quien compone no la tiene todavía. «Una común» abre un
diálogo con tono, largo (cuatro o tres acordes) y un mando de común a rara, y devuelve seis
progresiones para empezar de una e irla alterando en las pestañas. Pulsar una la sube al campo y
sigue el camino de siempre.

Salen de dos sitios, y ninguno sobra:

- **El tomo.** `progressions.json` trae las progresiones que más canciones llevan en De Chordis
  Mysteriis (el catálogo del hilo 4 de `MEJORAS.md`, hoy guardado): 4.611 firmas de cuatro
  acordes y 1.633 de tres con al menos cien canciones cada una, con sus totales. La firma es
  invariante a transposición (semitonos sobre el primer acorde y familia), así que se realiza en
  el tono pedido; el mando pesa cada firma por `total^(1 − rareza)`, de lo más común a pesar
  todas igual, y como la cola es larguísima, eso es la rareza. Lo construye `progressions.mjs`
  desde el índice publicado, sin reconectar nada.
- **La guitarra.** De las veinticuatro sorteadas se enseñan las seis que más dan de sí: las de
  más cuerdas al aire por acorde en el mejor arreglo con el preset resonante de Rearmonizar.
  Medido antes de hacerlo: la frecuencia y la resonancia van poco de la mano (correlación de
  rango 0,1–0,45 según el tono), y por eso hace falta la criba.

Lo que hay que saber:

- **La realización va con lo que la app lee.** De los doce arranques posibles se elige el que
  `detectKey` lee en el tono pedido, para que la tarjeta y la columna digan lo mismo. Como la
  app solo sabe de tonalidades mayores, `I ♭VII IV I` sale como `V IV I V`, y un bucle eólico
  (`Em C D Em`) se realiza en su relativo mayor. La grafía la da el tono: en Mi, `G#m`, no `Abm`.
- **Los tonos menores están, a la manera de la app.** «En Em» es «en Sol alrededor del Em»:
  solo firmas que arrancan en menor, realizadas con el i en la tónica, y solo si la app las lee
  en el relativo mayor —la mitad de ellas, el 63% por canciones—. Las dóricas y parecidas
  (`Em A Em A`) la app las lee en Re, y decir «en Em» sería mentir, así que no salen. Los grados
  van en menor: `Em C D Em` es `i VI VII i`. Si lo escrito arranca en el relativo menor de su
  tono, el diálogo ya lo ofrece en menor.
- La familia suspendida de la firma no distingue sus2 de sus4: sale sus2, y Sustituciones lo
  cambia. Las de quinta no tienen digitación en la base de datos y se descartan. Las firmas de
  una sola fundamental (`G G7 G Gsus4`) son un acorde adornado, no una progresión, y no salen.
- **Otra parte de la que hay.** Con una progresión en el campo, el diálogo ofrece también otra
  parte de la misma canción: el mismo sorteo, quedándose solo con las que comparten algún acorde
  con la que hay (sin contar el color: `Cmaj7` y `C` son el mismo), arrancan en otro y no son el
  mismo bucle girado. Es lo barato que hace que un estribillo suene a estribillo de esa estrofa;
  lo caro sería mirar qué otras partes llevan las canciones del tomo que tienen ésta.
- El fichero se pide la primera vez que se abre el diálogo (124 KB, 31 comprimido). Sin las
  posiciones de guitarra no hay criba y las seis van por frecuencia.
- Los datos vienen de Chordonomicon (CC BY-NC 4.0) por De Chordis Mysteriis; solo se guardan
  firmas y recuentos.

## Lo que hay guardado y no está puesto

En [`archived/`](archived/) vive un **catálogo propio de 385.664 canciones** con sus progresiones
por partes —[De Chordis Mysteriis](https://github.com/sanhuaaan/de-chordis-mysteriis), publicado y
en pie—, el módulo que lo lee y la tubería que lo fabrica desde
[Chordonomicon](https://huggingface.co/datasets/ailsntua/Chordonomicon). Con eso la app llegó a
buscar canciones sin depender de Ultimate Guitar y a responder la pregunta al revés —en qué
canciones suena la progresión que tienes escrita, en cualquier tono—, en una pestaña que se llamaba
«Dónde suena».

**No está puesto.** Probado en uso, saber que tu progresión suena en 24.190 canciones no dice nada
de tu progresión, y la lista que salía no llevaba a ninguna parte. Está guardado entero y sigue
pasando los tests; el porqué y cómo se vuelve a conectar están en
[`archived/README.md`](archived/README.md), y la versión de la app con todo enchufado, en la rama
`catalogo`.

## Stack

- Vanilla JS (módulos ES), sin build ni framework.
- [tonal.js](https://github.com/tonaljs/tonal) para parsing y teoría musical, cargada vía import map desde esm.sh.
- [@tombatossals/chords-db](https://github.com/tombatossals/chords-db) (JSON desde jsdelivr) para posiciones de guitarra; diagramas dibujados como SVG propio.
- Un Cloudflare Worker de 20 líneas como proxy de Ultimate Guitar. No hay nada más detrás.

## Tests

```bash
npm install
npm test
```

Los tests (`test.js`) cubren el parser y cada regla con `node --test`.

## Hilos abiertos

Las ideas que salieron trabajando y quedaron apuntadas en [MEJORAS.md](MEJORAS.md): afinar los
nombres de la pestaña de cejilla (el caso `m13`, que es correcto pero la base de datos de diagramas no
indexa) y llevar el generador de digitaciones también a la pestaña Cejilla en estándar, donde la base
de datos limita a cuatro posiciones por acorde. Ahí está también, con sus medidas, lo que dio de sí
el catálogo antes de guardarlo.
