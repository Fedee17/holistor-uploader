# Informe — pruebas de ruptura operativa (24/09/2026)

Ambiente: **solo PRUEBA** (workflow `eXg4n80ds0N6rWlD`, planilla y carpetas de TEST). Producción no se tocó.
Alcance: acciones que puede hacer un operador desde la página + pedidos armados a mano a los webhooks (con la clave).
Método: lectura del código real de la página y del workflow, y después ejecución real de cada escenario mirando las ejecuciones de n8n, la planilla y Drive.

---

## Resumen — qué se rompió y qué no

| # | Escenario | Resultado | Gravedad |
|---|---|---|---|
| 1 | Dos "Procesar" del mismo cliente casi al mismo tiempo (1 s y 12 s de diferencia) | **Los tres pedidos fueron aceptados.** Ni el freno de 8 s ni el "hay un proceso corriendo" frenaron nada. | **Alta** |
| 2 | Dos clientes distintos procesando a la vez | **El que termina último borra el estado del otro.** El cliente B quedó como si nunca hubiera corrido. | **Alta** |
| 3 | Progreso durante la corrida | La página no ve el avance real hasta que la corrida termina (siempre devuelve el resultado anterior con `desde_cache`). | Media (solo visual) |
| 4 | Cargar el Excel de ARCA sin filas nuevas (recargar el mismo) | **Agrega una fila vacía a REGISTRO_ESPERADO cada vez** (solo período y CUIT). Es el origen de las filas "casi vacías" que vimos en producción. | Media |
| 5 | "Procesar" con la carpeta de Entrada vacía | Tarda 55 s de más (4 reintentos de descarga sobre un archivo que no existe), manda a Gemini un ítem vacío y deja `desconocido: fallida` en el estado. | Media |
| 6 | Subir un archivo que no es PDF (texto con nombre `.pdf`, o un `.txt`) | Se acepta y se guarda en Entrada. La corrida lo marca "fallida / cargar manual" sin romperse, pero **queda en Entrada para siempre** y se vuelve a mandar a Gemini en cada corrida del cliente. | Media |
| 7 | Subir un PDF sin indicar cliente | Se acepta y queda en Drive como `sincuit__…`, que nadie procesa nunca. | Baja |
| 8 | "Procesar" sin cliente ni período, o con mes 13 / año "abc" | Se acepta, crea procesos con claves `|0-00` y `…|0-13` y corre las lecturas de planillas. No hace daño, pero no valida nada. | Baja |
| 9 | Registro ARCA con período "agosto" en vez de `2026-08` | Se acepta y se inserta la fila con ese período (después nunca se encuentra). Solo por pedido directo: la página siempre manda el formato correcto. | Baja |
| 10 | Cambiar de cliente o período **mientras** se procesa | Los controles se vuelven a habilitar apenas terminan las subidas. Si se cambia el cliente, la página empieza a consultar el estado del cliente nuevo y pierde el resultado del que estaba corriendo; con un lote de más de 40 PDF, la segunda tanda se subiría con el CUIT del cliente nuevo. (Leído en el código; no ejecutado.) | Media |
| 11 | "Liberar proceso" sin cliente seleccionado (pedido directo con cuerpo vacío) | Libera **todos** los procesos de todos los clientes. | Baja (necesita la clave) |
| — | Sin clave / clave incorrecta | Rechazado (403). Correcto. |  |
| — | Verificar con más de 500 firmas, sin cuerpo, con lista mal armada, o con una firma real pero de otro cliente | Rechazado o devuelto vacío, sin mezclar clientes. Correcto. |  |
| — | Registro ARCA sin CUIT, vacío o con filas basura | Rechazado / 0 filas. Correcto (salvo la fila vacía del punto 4). |  |
| — | Consolidar sin IDs o con el ID de un PDF en vez de un PRN | Rechazado con mensaje claro (líneas que no miden 240). Correcto. |  |
| — | PDF repetido en el lote / PDF ya procesado | Detectado por firma de contenido, no se vuelve a leer. Correcto. |  |

---

## Hallazgo principal — cómo guarda n8n el estado de las corridas (explica 1, 2, 3 y 11)

El sistema guarda el estado de cada corrida (qué facturas van, cuáles fallaron, si terminó) en la "memoria del workflow" de n8n. Hasta hoy trabajábamos como si esa memoria fuera un lugar compartido que todas las ejecuciones ven en vivo. **Las pruebas muestran que no es así en n8n Cloud:** cada ejecución recibe una copia de esa memoria al arrancar, trabaja sobre su copia, y al terminar guarda su copia entera encima de lo que haya. Mientras una corrida está en curso, nadie ve lo que ella va escribiendo; y cuando termina, pisa todo lo que otras ejecuciones guardaron mientras tanto.

Evidencia real (ejecuciones de PRUEBA):

- `29622` (Castellano, 3 PDF, 19:05:56 → 19:07:06) y `29623` (mismo cliente, 1 s después): la segunda no vio el `procesando: true` de la primera, encontró los mismos 3 archivos, los dio por "ya procesados" y marcó el proceso como terminado a las 19:06:06. Desde ese momento la consulta de estado devolvía "listo" mientras la primera seguía leyendo con Gemini. El PRN real (3 líneas) apareció recién a las 19:07:06.
- Corrida A (Castellano, 19:09:52 → 19:11:05) y corrida B (cliente 99999999999, sin archivos, 19:10:00 → 19:10:55): B terminó y su resultado se vio a las 19:10:57; a las 19:11:09, después de que terminó A, **el proceso de B ya no existía** (`listo:false, procesando:false`). A guardó su copia, tomada a las 19:09:52, cuando B todavía no había arrancado.
- Durante toda la corrida A, la consulta de estado de A devolvió el resultado de la corrida anterior con `desde_cache: true`, nunca `procesando: true` ni el avance.

Consecuencias concretas:

1. **Los frenos contra doble disparo no frenan.** El de 8 segundos y el de "hay un proceso corriendo" leen la copia guardada, y la corrida en curso todavía no guardó nada. Solo detectan una corrida que quedó "colgada" de antes. Hoy lo único que evita el doble disparo es la propia página (botones deshabilitados). Dos pestañas, dos personas, o un "Procesar" desde otra computadora, disparan dos corridas reales sobre los mismos archivos.
2. **Dos clientes a la vez se pisan.** Si dos personas del estudio procesan clientes distintos al mismo tiempo, el que termina último borra el resultado del otro. La página del primero puede quedar esperando hasta el tiempo máximo y terminar en "Liberar proceso", con el PRN generado en Drive pero sin cartel de resultado.
3. **Lo que se guarda con "Guardar Linea PRN (Hot)" y en REGISTRO_ESPERADO sí persiste**, porque va a la planilla, no a la memoria de n8n. Por eso los PRN de las corridas pisadas existen igual en Drive.
4. Con dos corridas "Reprocesar todas" al mismo tiempo sobre el mismo cliente, las dos leerían con Gemini y las dos escribirían líneas en PRN_LINEAS → líneas duplicadas. **No se ejecutó** (para no duplicar filas en la planilla de prueba); se deduce del código, queda como probable.

Qué NO se puede afirmar: si esto es por el modo en que n8n Cloud ejecuta los workflows o por una configuración de la instancia. No hay acceso a eso desde acá; se puede consultar a n8n junto con lo de los reinicios del 22/09.

---

## Detalle de los otros hallazgos

**4. Fila vacía por cada recarga del Excel.** En `Preparar Filas Nuevas`, cuando no hay filas nuevas se emite un ítem marcador (`_no_registro_rows: true`) y ese ítem entra igual a `Insertar Registro Nuevo`, que lo agrega como fila con solo `periodo` y `cliente_cuit` (confirmado en la ejecución `29610` y en la planilla de PRUEBA: filas 2520–2524). En producción son las filas 2520–2521 y 3032–3033 de Castellano. No rompen la conciliación (se saltean por no tener clave), pero ensucian la hoja y confunden. Fix chico: que el marcador no llegue al nodo de inserción.

**5. Carpeta de Entrada vacía.** `Buscar_archivos` y `Filtrar Por Cliente` tienen "siempre devolver algo" activado (necesario para que el finalizador corra). El ítem vacío entra al bucle, `Download file` falla 4 veces con esperas de 2 / 8 / 32 s, y Gemini recibe un ítem sin archivo. La corrida tarda 55 s más y queda `archivos_estado: {desconocido: fallida}`. Ocurre cada vez que alguien aprieta "Procesar" sin PDF nuevos en Entrada (por ejemplo, después de una corrida completa). Fix chico: que el bucle salte los ítems sin `id`.

**6 y 7. Subidas sin validación en el servidor.** `Webhook Upload → Upload PDF a Drive` sube lo que llegue: sin CUIT (`sincuit__…`), sin extensión PDF, sin contenido PDF. La página filtra por extensión, pero cualquier pedido directo, o un archivo con extensión `.pdf` que no lo es, pasa. Los archivos fallidos quedan en Entrada y se vuelven a leer (y a cobrar) en cada corrida. Fix: rechazar en n8n si falta el CUIT o si los primeros bytes no son `%PDF`, y mover a una carpeta "Fallidos" lo que Gemini no pudo leer.

**10. Controles habilitados durante el procesamiento.** En `startUpload`, al terminar las subidas se ejecuta `uploading = false; setUploadControlsDisabled(false)` **antes** de disparar el escaneo y el procesamiento. La consulta de estado usa `clienteSeleccionado` y `periodo` en cada vuelta, así que un cambio de cliente redirige la consulta. Fix: mantener los controles deshabilitados hasta `_corridaTerminada()` (o bloquear solo cliente y período).

**8, 9 y 11. Validación de entrada en los webhooks.** `Resetear Estado`, `Comparar Registro` y `Forzar Reset Proceso` aceptan CUIT vacío, mes fuera de 1–12, año no numérico y período con cualquier texto. Y `holistor-reset` sin parámetros libera todos los procesos. Es acceso con clave, así que el riesgo es de error humano más que de ataque, pero cuesta poco cerrarlo: rechazar con `ok:false` si el CUIT no tiene 11 dígitos o el período no es `AAAA-MM`, y exigir cliente y período en el reset.

---

## Lo que quedó en PRUEBA para limpiar (no lo pude borrar: los archivos son de `farmando@` y la conexión de Drive es de `driorda@`)

- Carpeta Entrada de TEST: `20064273389__falso.pdf`, `20064273389__nota.txt`, `sincuit__falso.pdf` (borrar).
- REGISTRO_ESPERADO de TEST: fila 2525 (`PRUEBA ROMPER`, período `agosto`) y las filas vacías 2520–2524 (borrar).
- PRN de prueba en "PRN generados" de TEST: `SUC_DE_CASTELLANO_202608_20260924_190701.prn` y `…_191056.prn` (3 líneas cada uno, son válidos; se pueden borrar).
- Procesos fantasma en la memoria del workflow de TEST (`|0-00`, `20064273389|0-13`, `99999999999|2026-01`): inofensivos, se pisan solos.

---

## Recomendación de orden para arreglar

1. **Estado de corrida fuera de la memoria de n8n** (hallazgos 1, 2, 3). Es el único cambio de fondo. Opciones, de menor a mayor esfuerzo: (a) una pestaña `PROCESOS` en la planilla con una fila por cliente+período (estado, inicio, fin, resultado en JSON); cada nodo que hoy escribe en la memoria escribe ahí, y `Estado`/`Resetear Estado` la leen; (b) una tabla de datos de n8n (Data Table), mismo esquema, sin depender de Sheets. En los dos casos el freno de doble disparo pasa a funcionar de verdad y dos clientes a la vez dejan de pisarse. Conviene decidirlo antes de agregar más funciones sobre la memoria actual.
2. Bloquear cliente y período en la página hasta que termine la corrida (hallazgo 10). Cambio chico, probado en TEST primero.
3. Validaciones en `Webhook Upload` (CUIT y `%PDF`) y carpeta "Fallidos" (6 y 7).
4. Fila vacía en recarga del Excel (4) y salto del ítem vacío en el bucle (5).
5. Validaciones de entrada en procesar / registro / reset (8, 9, 11).
