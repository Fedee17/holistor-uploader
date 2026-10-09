# AUDITORÍA INTEGRAL — HOLISTOR PRN GENERATOR (v51) — 16/09/2026

> **ESTADO AL 17/09/2026** — Este informe es el diagnóstico original del 16/09 y se conserva sin cambios como referencia. Lo que pasó después:
> - **Resueltos y confirmados**: H-01, H-02, H-03 (más el cruce completo contra el desglose de ARCA del 17/09), H-04, H-05, H-06 (por tandas de 40 en la página; el `executionTimeout` no se puede subir: 2400 s es el máximo de la instancia), H-07 (provisorio: 51/52/53 quedan fallidas), H-08, H-09, H-10, S-01 (clave en los 10 webhooks + origen restringido; falta `holistor-reset` con parámetros obligatorios), S-03 (`cellFormat: RAW`), D-01 (para filas nuevas), U-01 (candado, `request_id` por corrida, cartel con `en_prn`, errores persistentes). Detalle versión por versión en `claude/pendiente-publicar-pagina-y-clave.md`.
> - **Pendientes, todos cargados en ClickUp (lista "Desarrollo y Automatización", 17/09)**: P-01, P-02, P-03, limpieza de staticData, U-02, S-02, D-02, `holistor-reset` sin parámetros, las 48 filas con total como fecha, `"1.250"`, desborde silencioso, códigos 63/81, NC negativa, `Analyze document` sin límites, emisor vacío / nueva en FALLOS, `moneyNumLocal` con `$`, repositorio público / login / cuenta de servicio, mes anterior por defecto (menor, sin tarea propia).
> - **Documentación**: los cuatro archivos de conocimiento del Proyecto quedaron actualizados el 17/09.

**Alcance auditado:** workflow n8n `r9H4ufyAu1ndyFN5` (versión activa `1187cb07`, autoguardada hoy 17:14 UTC), página `holistor-uploader` (commit `39f225d`), las seis hojas del spreadsheet `15-YOBXv0…`, y la ejecución real de hoy (`26163`, cliente FRANK NADIA, período 2026-08, 46 archivos). El padre-hijo y el sistema de balances quedaron fuera.

**Método:** lectura completa de los 130 nodos (los 50 Code nodes exportados uno por uno), traza de conexiones, lectura línea por línea de `index.html`, exportación completa del spreadsheet (2.155 filas de REGISTRO_ESPERADO), análisis del historial de ejecuciones, y un banco de 31 pruebas locales que corren el código **real** de `Generar PRN` (no una copia) con casos controlados. Cada hallazgo indica la evidencia concreta que lo sostiene.

**Nota sobre la versión:** la ejecución de hoy corrió con la versión `fc49a265` (v54). A las 17:14 hubo un autoguardado desde la interfaz que agregó, en `Acumular PRN`, la protección `_prevEstado !== 'al_prn'` en la rama `ya_procesada`. Ese cambio corrige exactamente la falla que se describe en H-01, pero **todavía no fue probado con una corrida real**.

---

## 0. Resumen ejecutivo

| # | Severidad | Hallazgo | Dónde |
|---|---|---|---|
| H-01 | **CRÍTICA** (ocurrió hoy) | Corrida con 46 archivos (23 facturas subidas dos veces) generó las 23 líneas PRN y después las **descartó**: PRN vacío, pero REGISTRO_ESPERADO quedó marcado `procesada` con huella y los PDFs se movieron a Procesados. Las 23 facturas de FRANK NADIA 2026-08 hoy están "hechas" para el sistema y **no existen en ningún PRN**. | `Acumular PRN` (parche aplicado 17:14 sin probar) + `Preparar Actualizacion Estado` |
| H-02 | **CRÍTICA** | El estado `procesada` en REGISTRO_ESPERADO se escribe **aunque el PRN no se haya guardado**. Cualquier falla de cierre (Drive 403, PRN vacío, etc.) deja facturas invisibles para siempre salvo `forzar` + resubida. | `Preparar Actualizacion Estado` |
| S-01 | **CRÍTICA** (privacidad) | Los 10 webhooks no tienen ninguna autenticación y aceptan cualquier origen. Sin credenciales se obtiene la lista de los 43 clientes con CUIT, y el libro de compras completo de cualquier cliente (229 comprobantes con proveedor, importes y líneas PRN). Verificado con un `curl`. | Todos los `Webhook *` |
| H-03 | **ALTA** (silenciosa) | La "corrección por total de ARCA" recalcula neto e IVA desde el total cuando Gemini difiere >0,5 %, **ignorando exentos, percepciones y segunda alícuota**. En una factura con exento inventa un neto gravado y un IVA que no existen, y como fuerza el total al de ARCA, la conciliación la muestra como "conciliada". | `Generar PRN` líneas 692-740 |
| H-04 | **ALTA** (silenciosa) | Factura en USD que Gemini ya devolvió en pesos se vuelve a multiplicar por el tipo de cambio (total ×1.427). El fix documentado en la tabla de errores ("no convertir si el total ya coincide con ARCA") **no está en el código desplegado**. | `Generar PRN` líneas 640-681 |
| H-05 | **ALTA** (silenciosa) | `toArray()` recibe `iva_adicional` como objeto `{neto_2, alic_2, iva_2}` y devuelve los tres valores sueltos: la segunda alícuota **se pierde sin aviso** (una línea en vez de dos). Es el caso exacto para el que se escribió. | `Generar PRN` línea 257 |
| H-06 | **ALTA** | Un lote grande no cabe en una ejecución: 28 s por factura reales × 100 facturas = 47 min, y el workflow tiene `executionTimeout: 2400` (40 min). La página muestra "lotes de 100" pero nunca parte el lote. Techo práctico hoy: ~80 facturas por corrida. | settings del workflow + `BATCH_FRONTEND_SIZE` sin uso |
| H-07 | **ALTA** | Comprobantes 51/52/53 (ex Factura M) salen con la categoría Holistor **en blanco** (posiciones 23-24). Hay 6 filas reales con tipo 51/53 en REGISTRO_ESPERADO. Holistor las rechaza o las carga mal. | `Generar PRN` `CATEGORIA_HOLISTOR_POR_CPBTE` |
| H-08 | MEDIA (latente) | Con ARCA cargado, el `tipo_cod` de ARCA se trunca a 2 dígitos: una FCE 201 pasa a "01" → categoría `F` en vez de `FM`, y la clave interna deja de coincidir con la de ARCA (la factura no queda `procesada` y se reprocesa en la corrida siguiente). Todavía no hay FCE en la hoja. | `Generar PRN` línea 582 |
| H-09 | MEDIA | Si Gemini deja `numero_hasta` vacío, la clave anti-duplicado usa `0` y **la segunda factura del mismo proveedor y punto de venta se descarta como "mismo lote"**. El prompt de reintento devuelve `numero_hasta: ""` como plantilla. | `Generar PRN` línea 1148 |
| H-10 | MEDIA | `Actualizar Huella Factura` no tiene `continueOnFail`: un 403 transitorio de Sheets ahí corta el cierre a mitad de camino (facturas sin marcar, FALLOS sin escribir, proceso zombie). | nodo `Actualizar Huella Factura` |
| P-01 | ALTA (rendimiento/costo) | La lectura liviana (`Analyze document Ligero`) acertó la clave en **1 de 23 facturas** hoy (lee mal el punto de venta). Cuesta 4 s por factura (14 % del tiempo) y no detecta duplicados en la práctica. | `Analyze document Ligero` + `Calcular Clave Temprana` |
| P-02 | MEDIA (costo) | Cada sondeo de estado es una ejecución de n8n: 5 s de intervalo × 11 min = 130 ejecuciones por corrida, además de los 46 `verificar` en paralelo al agregar archivos. Hoy hubo ~1.100 ejecuciones en un día de trabajo; el plan de n8n Cloud se cobra por ejecuciones. | frontend `POLLING_INTERVAL_MS` + `addFilesInner` |
| P-03 | MEDIA | `Guardar Linea PRN (Hot)` escribe una fila en PRN_LINEAS por factura (1,8 s cada una, 41 s de la corrida) y `Cargar PRN_LINEAS Proceso` lee la hoja entera al arrancar. La documentación dice que PRN_LINEAS "no tiene uso real"; hoy se usa solo para el rubro de ND/NC referenciadas. | nodos PRN_LINEAS |
| D-01 | MEDIA (datos) | 48 filas de REGISTRO_ESPERADO tienen el total guardado **como fecha** (Google interpretó "7311.02" como febrero del año 7311). Hoy no rompe porque el formato de celda reproduce el texto original, pero es un campo numérico corrupto. | `Insertar Registro Nuevo` (USER_ENTERED) |
| D-02 | BAJA | CLIENTES tiene el CUIT 20224230649 dos veces (DON LORENZO / MARCHISIO MARCELO). 38 claves físicamente duplicadas en REGISTRO_ESPERADO. | hojas |
| U-01 | MEDIA (uso) | Tras un PRN exitoso, la página **bloquea** cualquier segunda corrida del mismo cliente/período hasta apretar "Liberar proceso" (mensaje que además sugiere una casilla "Forzar" que ya no existe). Procesar dos tandas del mismo mes es el caso de uso normal del estudio. | candado v19 del frontend |
| U-02 | MEDIA (accesibilidad) | Sin `label for`, sin `aria-*`, zonas de arrastre no operables por teclado, modal sin foco atrapado, `alert()`/`confirm()` nativos, avisos de error que desaparecen a los 6 s. | `index.html` |

Además hay 14 hallazgos menores y de documentación desactualizada listados por sección.

---

## 1. Análisis de código y calidad interna

### 1.1 Lo que está bien (y conviene no tocar)
- La disciplina de `sd.procesos[key] = p` está aplicada en todos los Code nodes que escriben estado (verificado en los 50).
- `continueOnFail`/`onError: continueRegularOutput` está en todos los nodos de Drive, Sheets y Gemini **salvo uno** (H-10).
- Las condiciones IF que evalúan errores usan `=== true` o `!!` explícito; las que comparan booleanos usan el tipo Boolean (el único con `version: 2` y `singleValue` incoherente es `Hay fallos?`, funciona igual).
- `Generar PRN` no reasigna ninguna `const`; las variables de respaldo tienen chequeo `typeof` (fix v51). El harness lo confirma: 31 casos ejecutados sin `ReferenceError`.
- `Convertir Restantes` codifica en latin-1 y `sanitizeLatin1` neutraliza saltos de línea, tabs y caracteres fuera de latin-1 (probado con emoji y comillas tipográficas: la línea sigue midiendo 240).

### 1.2 Defectos de código (con evidencia)

**H-03 — Corrección por total de ARCA (`Generar PRN` 692-740).** Lógica actual: si `|total_gemini − total_arca| / total_arca > 0,5 %`, y `neto × (1+alic) ≈ total_arca` mantiene el neto y hace `IVA = total_arca − neto`; si no, `neto = total_arca / (1+alic)` e `IVA = resto`. El cálculo nunca suma exentos, no gravados, percepciones ni `iva_adicional`. Prueba 13 del harness (factura real de Monroe con exento 350.907,81 y percepción 860,16; total Gemini 390.000 vs ARCA 386.461,19): el código convirtió neto 28.672,08 → **319.389,41** e IVA 6.021,14 → **67.071,78**, dejó el exento y la percepción, y forzó el total a 386.461,19. La línea suma 738.000 y Holistor la acepta igual porque los campos son independientes. Prueba 14 (factura 100 % exenta con `alic: "0"`): `parseFloat("0") || 21` toma 21 % y **fabrica** neto 82.644,63 e IVA 17.355,37 en una factura sin IVA. Esto viola la regla del proyecto "validación sin auto-corrección silenciosa": la corrección solo es aritmética exacta cuando la factura tiene un único componente.
*Fix:* aplicar la corrección solo cuando `conceptos_ngex`, `retenciones` e `iva_adicional` están vacíos **y** `alic > 0`; en cualquier otro caso no tocar los importes y marcar `total_a_revisar` con la diferencia (la conciliación ya tiene esa categoría).

**H-04 — Doble conversión USD (`Generar PRN` 640-681).** `_conversionAplicada = _tc > 1 && _tc < 1000000` se aplica siempre que hay tipo de cambio. La tabla de errores documenta el fix "no convertir de nuevo si el total ya coincide con ARCA en pesos (±1 %)", pero ese chequeo no existe en el código desplegado (probablemente pisado por un guardado manual, el riesgo que ya está documentado). Prueba 12: Gemini devolvió 399.560,00 (ya en pesos, igual al ARCA) y el PRN salió con **570.172.120,00**. La conciliación lo marcaría "total a revisar", pero la línea ya está en el archivo.
*Fix:* antes de convertir, si `|total_gemini − total_arca| / total_arca ≤ 1 %` no convertir (y registrar advertencia "ya venía en pesos").

**H-05 — `toArray` (`Generar PRN` 257).** `if (typeof v === 'object') return Object.values(v)`. Con `{neto_2:'52.946,25', alic_2:'10,5', iva_2:'5.559,36'}` devuelve `['52.946,25','10,5','5.559,36']`; el bucle de líneas extra hace `tramo.neto_2` sobre strings → `undefined` → `continue`. Prueba 10: una línea en vez de dos, sin error ni advertencia. El caso documentado ("iva_adicional llegó como objeto… normalizar con toArray") queda sin cubrir; solo funcionaría si Gemini devolviera `{"0": {...}}`.
*Fix:* `if (typeof v === 'object') return (('neto_2' in v) || ('codigo' in v) || ('codigo_percep' in v)) ? [v] : Object.values(v);`

**H-07 — cpbte 51/52/53.** `CATEGORIA_HOLISTOR_POR_CPBTE` no los mapea → `categoriaHolistor = ''` y la línea se emite igual (prueba 7: posiciones 23-24 en blanco, `error: undefined`). REGISTRO_ESPERADO tiene 4 comprobantes tipo 51 y 2 tipo 53 reales. Decisión pendiente con Holistor (¿van como `F`/`C` con letra A?). Mientras tanto, emitir una línea con categoría vacía contradice "marcar fallido, nunca auto-corregir".
*Fix inmediato:* si `categoriaHolistor === ''` → fallida con motivo "cpbte 51/52/53 sin categoría Holistor confirmada". *Fix de fondo:* confirmar la categoría con soporte de Holistor y agregarla a la tabla.

**H-08 — Truncamiento de `tipo_cod` (`Generar PRN` 582).** `d.cpbte = String(bestMatch.tipo_cod).replace(/\D/g,'').padStart(2,'0').slice(-2)`. Con ARCA `tipo_cod = 201` → `"01"`. Prueba 8: categoría `F` (debería ser `FM`), `_dedup_cpbte = 1`, `_v51_clave = …-1-3106-4625` mientras la clave de ARCA es `…-201-3106-4625` → la conciliación no la encuentra, no se marca `procesada`, y en la próxima corrida la clave temprana tampoco coincide → **se reprocesa y se duplica en el PRN siguiente**. El comentario de la línea 831 ("sin truncar a 2 caracteres, los códigos FCE tienen 3 dígitos") muestra que la intención ya era esa.
*Fix:* `.padStart(2,'0')` sin `.slice(-2)` (y lo mismo en `recuperarDesdeRegistroLocal`, línea 408).

**H-09 — `numero_hasta` vacío (`Generar PRN` 1148 vs 1575/1635).** La clave de idempotencia usa `parseInt(d.numero_hasta||0)`; `_v51_clave` y `_dedup_num` usan `numero_hasta || numero_desde`. Prueba 16: `clavesVistasEnEsteRun = …-3106-0` vs `_v51_clave = …-3106-4625`. Prueba 17: dos facturas distintas (números 100 y 101) del mismo proveedor y PV con `numero_hasta` vacío → la segunda vuelve como `ya_procesada: true`, "Mismo comprobante ya incluido en este mismo lote". El prompt de reintento (`Analyze document Retry JSON`) entrega `"numero_hasta": ""` como plantilla, así que el caso es alcanzable.
*Fix:* una sola función `numeroCpbte(d)` = `numero_hasta || numero_desde` usada en las cuatro claves (1148, 1519, 1575, 1635).

**Otros defectos menores encontrados en el código**
- `fmtFecha` con fecha sin ceros (`"5/8/2026"`) escribe `5/8/2026␠␠` en el PRN cuando no hay ARCA (prueba 18). Fix: normalizar `d{1,2}/d{1,2}/d{4}`.
- `fmtNum` con un solo punto y tres decimales (`"1.250"`) lo trata como 1,25. Hoy termina en "fallida" por la validación IVA/neto > 50 % (prueba 2), no en un importe incorrecto, pero obliga a carga manual sin necesidad. Fix: un solo punto con exactamente 3 dígitos después y ninguna coma → miles (el prompt exige formato argentino).
- `fmtNum` con `maxWidth` recorta decimales y luego enteros **sin avisar** (prueba 4: `123456789,1`; con 10 dígitos enteros se pierden dígitos). Fix: si no entra en 11, fallida con motivo.
- `moneyNumLocal` no limpia `$` (`" $ 537,906.14 "`, formato real de 215 filas de la hoja) → `NaN` → la recuperación de CUIT por total no se activa para esas filas (prueba 31: la recuperación igual salió por número+tipo+PV). Fix: reusar `parseImporteNum`.
- `Marcar Como Nueva (Escaneo)` lee `$json.clave_temprana_emisor_actual`, campo que `Calcular Clave Temprana` nunca emite → el emisor en `nuevas_en_escaneo` siempre es `''`.
- En modo escaneo, dos archivos distintos del mismo comprobante quedan los dos como "nuevas" (la clave del lote solo se anota en `Generar PRN`, que en escaneo no corre). Cuenta de "nuevas" inflada en el cartel.
- `Analyze document` (lectura completa) tiene `options: {}`: sin `maxOutputTokens` (la documentación dice 8192) y sin límite de "pensamiento". Gemini 2.5 Flash con thinking activo explica parte de los 16 s promedio y 54 s máximo por factura.
- `Es proceso nuevo?` rama FALSE no conecta a nada (correcto, ya se respondió), pero conviene anotarlo en el canvas para que nadie lo "arregle".
- Varios Code nodes en modo "todos los items" usan `$input.item` (`Calcular Huella PDF`, `Marcar Error Gemini`, `Acumular PRN`). Funciona porque el Bucle entrega de a uno; si alguien cambia el tamaño del lote, se procesa solo el primero. Anotar o pasar a modo por item.
- `_alicNum = parseFloat(String(d.alic || '21')) || 21` convierte una alícuota `0` legítima en 21 (parte de H-03).
- `Preparar Actualizacion Estado` marca `fallida` desde `fallos_por_clave`, pero el estado `pendiente` nunca vuelve a `fallida`→`pendiente` cuando después se resuelve. Aceptable, pero documentar.

### 1.3 Documentación desactualizada (Proyecto)
- `3_arquitectura_recursos.md`: el webhook de proveedores es `holistor-proveedores` (no `-lista`); falta `holistor-auditoria`.
- `4_especificacion_holistor_prn.md` y `2_workflow_estado.md`: PRN_LINEAS **no** es residual: `Guardar Linea PRN (Hot)` escribe por factura y `Cargar PRN_LINEAS Proceso → Indexar PRN_LINEAS` corre en cada proceso (para el rubro de ND/NC referenciadas). El nodo `Leer PRN_LINEAS` huérfano ya no existe.
- `2_workflow_estado.md` → Proyectos futuros: "Procesar ahora debe pasar por el escaneo" ya está aplicado (`procesarAhoraConEspera` → `escanearYProcesar`); la casilla "Forzar" ya no está en la página.
- Tabla de errores: el fix de "importe ~1.428× en USD" figura como resuelto y no está en el código (H-04).
- El flujo del Bucle en la doc no incluye `¿Download OK? → Preparar Reintento Download → ¿Reintentos agotados? → Wait → Download file` (reintento con 2/8/32 s).
- `Analyze document` documentado con `maxOutputTokens: 8192`; el nodo real no lo tiene.

---

## 2. Pruebas funcionales (¿hace lo que debe?)

### 2.1 Corrida real de hoy (`26163`, 16:39–16:50 UTC) — H-01
- Entrada: 46 archivos en Drive = 23 facturas, cada una subida **dos veces con el mismo nombre**. 229 comprobantes ARCA cargados.
- Las primeras 23 pasaron huella → lectura liviana → lectura completa → `Generar PRN` produjo 23 líneas válidas (verifiqué las dos primeras posición por posición: 240 caracteres, categoría `F`, importes alineados a la derecha, `EXC` y `PI01` bien ubicados).
- Las 23 copias restantes dieron `huella_repetida_en_este_run: true` → `Marcar Ya Procesada por Huella` → `Acumular PRN` **sobrescribió** el estado `al_prn` de cada factura con `ya_procesada` (en la versión que corrió no existía la protección).
- `Armar PRN Final` vio `estados: {ya_procesada: 23}` → `tiene_lineas: false` → **no se guardó ningún PRN**.
- Pese a eso, `Preparar Actualizacion Estado` tomó `conciliacion.procesadas_registradas` (que `Generar PRN` llenó al generar cada línea) y escribió `procesada` + huella en las 23 filas (K1970:M1970, Q1970, …). Los 23 PDFs se movieron a Procesados.
- Consecuencia hoy: si se vuelven a subir esos PDFs, la huella los detecta como "ya procesadas"; si se usa `forzar`, la clave histórica se saltea y sí se regeneran. **Acción inmediata:** resubir las 23 facturas de FRANK NADIA 2026-08 con "Sí, reprocesar" (forzar) una vez validado el parche de `Acumular PRN`, o borrar la marca `procesada` de esas 23 filas.
- El parche de las 17:14 evita la sobrescritura, pero H-02 sigue abierto: el mismo escenario con cualquier otra causa de "PRN no guardado" vuelve a marcar `procesada`.

### 2.2 Flujos verificados por traza y por ejecuciones reales
| Flujo | Resultado |
|---|---|
| Upload → Drive con prefijo CUIT, `Responder OK` refleja error real | OK (24 subidas de hoy, 3-5 s c/u) |
| Registro ARCA → dedupe por firma → append | OK; pero D-01 (totales como fecha) por `USER_ENTERED` |
| Escaneo (`soloEscanear`) → cartel → corrida real | OK en traza; ver menor "nuevas infladas" y U-01 |
| Dedup por huella entre corridas y dentro del lote | OK (hoy detectó las 23 copias) |
| Dedup por clave temprana | **No funciona en la práctica** (P-01: 1/23 claves correctas) |
| Dedup por clave tras lectura completa (`Generar PRN` + `Acumular`) | OK, salvo H-09 |
| Reintento de descarga (2/8/32 s) y reintento de JSON Gemini con binario reenganchado | OK en traza |
| Cierre: FALLOS por `row_number`, resolución de FALLOS, estado en REGISTRO por `row_number` | OK (23/23 hoy) pero H-02 y H-10 |
| Sync de proveedores pendientes | OK (0 pendientes hoy; la hoja PROVEEDORES_PENDIENTES tiene encabezados con espacio final: `"cuit "`, `"estado "` — el append mapea por nombre exacto; hoy la hoja está vacía, así que no pude confirmar si escribe en la columna correcta) |
| Auditoría (`holistor-auditoria`) | OK |
| Polling read-and-reset + `ultimo_resultado` | OK |

### 2.3 Resultado del banco de pruebas local (`Generar PRN` real, 31 casos)
21 OK / 10 FAIL. Los FAIL son: H-03 (×2), H-04, H-05, H-07, H-08, H-09 (×2), fecha sin ceros, y `"1.250"`. El archivo `harness/tests.js` queda disponible para correr después de cada cambio del nodo (30 segundos, sin Gemini ni Sheets).

---

## 3. Rendimiento y carga (¿soportará el éxito?)

### 3.1 Perfil real de la corrida de hoy (649 s, 46 archivos, 23 lecturas completas)
| Etapa | Tiempo | % |
|---|---|---|
| `Analyze document` (Gemini completo) | 369 s (16 s prom., 54 s máx.) | 57 % |
| `Analyze document Ligero` | 92 s (4 s c/u) | 14 % |
| `Download file` (46) | 43 s | 7 % |
| `Guardar Linea PRN (Hot)` (23 appends) | 41 s | 6 % |
| `Move file` (23) | 35 s | 5 % |
| Escrituras de cierre en REGISTRO (46 PUT) | 14 s | 2 % |
| Lecturas iniciales (4 hojas + Drive) | 4 s | 1 % |
| Code nodes (todos) | ~35 s | 5 % |

**≈ 28 s por factura nueva.** Techo por ejecución: `executionTimeout: 2400` → ~85 facturas. La página no parte lotes (`BATCH_FRONTEND_SIZE` solo se usa para un cartel). Un cliente con 120 facturas en un mes hoy termina en un proceso cortado a los 40 min, con PDFs ya movidos y sin cierre (H-06).

### 3.2 Concurrencia y cuota
- Prueba controlada: 10 pedidos simultáneos a `holistor-estado` → 0,9–2,3 s cada uno, sin errores. n8n Cloud limita las ejecuciones concurrentes por plan; hoy los 24 `holistor-verificar` en paralelo (uno por archivo al arrastrarlos) tardaron 5-8 s cada uno porque cada uno **lee la hoja REGISTRO_ESPERADO completa** (2.155 filas). Con 100 archivos son 100 lecturas completas en ráfaga: cuota de lectura de Sheets (60/min por usuario) y cola de n8n.
- Sondeo: 5 s fijos → 130 ejecuciones por corrida de 11 min; hoy ~1.100 ejecuciones. Dos usuarios procesando a la vez = 2 ejecuciones largas ocupadas + 2 × 12 sondeos/min.
- `staticData` crece sin límite: `sd.procesos[cliente|periodo]` guarda `registroMap` (cientos de filas), `resultados_por_pdf` con las líneas PRN y `ultimo_resultado` de **cada** cliente/período desde mayo, más `_registroArcaCacheByKey` (el Excel de ARCA entero por cliente/período). n8n serializa ese objeto en cada ejecución que lo toca. Con 100 clientes × 12 meses se vuelve el cuello de botella de cada sondeo.
- Gemini: 23 lecturas completas + 23 livianas por 23 facturas útiles; el Ligero no evitó ninguna lectura completa hoy.

### 3.3 Recomendaciones (de menor a mayor esfuerzo)
1. Subir `executionTimeout` a 3600 (máximo de Cloud) **y** partir lotes en la página: procesar de a 40-50 archivos por corrida, encadenando corridas (la lógica de huella/clave ya evita duplicar).
2. Sondeo adaptativo: 5 s los primeros 30 s, después 15 s (reduce ~65 % de ejecuciones sin perder respuesta).
3. `holistor-verificar`: aceptar un array de huellas en un solo pedido (una lectura de hoja por lote en vez de una por archivo).
4. Limpieza de `staticData`: en `Resetear Estado`, borrar `sd.procesos[k]` y `_registroArcaCacheByKey[k]` de períodos anteriores a N meses, y no guardar `linea_prn` completa dentro de `ultimo_resultado`.
5. Ligero: o mejorar el prompt (pedir "punto de venta" tal como aparece en `Nro: 0003106-00004625`, o extraerlo del nombre del archivo `FC-3106-00004625.pdf` antes de llamar a Gemini), o desactivarlo hasta medir >80 % de aciertos.
6. `Guardar Linea PRN (Hot)`: mover la escritura a PRN_LINEAS al cierre (una sola operación batch) o eliminarla y resolver el rubro de ND/NC leyendo REGISTRO_ESPERADO/PROVEEDORES.
7. Evaluar `thinkingBudget` bajo / `maxOutputTokens` en `Analyze document` (verificar primero qué opciones expone el nodo v1.2 para `resource: document`).

---

## 4. Seguridad y privacidad de datos (crítico)

### S-01 — Backend público sin autenticación
Verificado hoy sin ninguna credencial (`curl` desde fuera del estudio):
- `GET /webhook/holistor-clientes` → 43 clientes con nombre y CUIT.
- `GET /webhook/holistor-proveedores` → 240 CUITs de proveedores.
- `GET /webhook/holistor-estado?cliente_cuit=<cuit>&periodo=2026-08` → el resultado completo de la última corrida: 229 comprobantes de ARCA con proveedor, fecha e importe, más las 23 líneas PRN con neto, IVA, exentos y percepciones.
- `POST /webhook/holistor-reset` con cuerpo vacío libera **todos** los procesos activos de todos los clientes.
- `POST /webhook/holistor-registro` permite insertar filas arbitrarias en REGISTRO_ESPERADO (envenenar la conciliación); `holistor-upload` permite subir cualquier archivo al Drive del estudio; `holistor-procesar` dispara lecturas de Gemini (costo) a voluntad.
- CORS: `allowedOrigins: "*"`; el preflight desde `https://evil.example` responde `access-control-allow-origin: https://evil.example`.
- La URL del backend está en un repositorio **público** de GitHub (`Fedee17/holistor-uploader`) y en la página pública de GitHub Pages.

Esto expone datos alcanzados por el secreto fiscal y por la Ley 25.326 de cualquier cliente del estudio a quien conozca (o adivine) la URL.

*Fix recomendado (2-3 horas):* un token compartido. En n8n: credencial "Header Auth" (`X-Holistor-Token`) en los 10 nodos Webhook. En la página: al abrir, pedir la clave una vez (`prompt`/campo) y guardarla en `sessionStorage`; `fetchConTimeout` agrega el encabezado a todos los pedidos; los `OPTIONS` siguen funcionando (n8n los responde antes de validar). Restringir `allowedOrigins` a `https://fedee17.github.io`. Segundo paso (recomendado): mover la página a un hosting con acceso restringido (Cloudflare Access con login de Google del dominio del estudio) y hacer el repositorio privado.

### S-02 — Datos en tránsito y en terceros
- Todos los PDFs de facturas y el Excel de ARCA (CUITs, importes, proveedores) van a n8n Cloud (UE) y a la API de Gemini con una clave personal de AI Studio ("Api Riorda Cristian"). Si esa clave está en el **nivel gratuito**, los términos de Google permiten usar el contenido para mejorar sus modelos y revisión humana. Verificar que el proyecto de Google Cloud de esa clave tenga facturación activa (nivel pago) o pasar a Vertex AI. No pude comprobarlo desde acá.
- Un solo OAuth de Google Drive/Sheets con acceso a "My Drive" completo (`driveId: My Drive`). Recomendable una cuenta de servicio con acceso solo a las carpetas y el spreadsheet del sistema.
- El spreadsheet contiene la contabilidad de compras de 17 clientes en una sola hoja compartida con el estudio; el sistema no distingue permisos por usuario (2-3 usuarios con el mismo poder).

### S-03 — Inyección y validación de entrada
- La página escapa HTML en todo lo que renderiza desde el backend (`escapeHtml` en listas, conciliación, avisos). No encontré XSS.
- `holistor-registro` no valida tipos: `registros` puede traer strings en `total` que Google interpreta (D-01) y fórmulas (`=IMPORTRANGE(...)`) que con `USER_ENTERED` **se ejecutan** en la hoja. Fix: `cellFormat: RAW` en `Insertar Registro Nuevo`, `Append FALLOS`, `Append FALLO HOT`, `Guardar Proveedor`, `Append PROVEEDORES_PENDIENTES`, `Guardar Linea PRN (Hot)`.
- `holistor-reset` sin parámetros libera todo: exigir `cliente_cuit` y `periodo`.

---

## 5. Validación estricta del archivo `.prn`
Validador de posiciones aplicado a las 23 líneas generadas hoy y a las 31 del harness:
- 240 caracteres exactos, `CRLF` entre líneas, latin-1 en la conversión a binario: **OK**.
- Posiciones 1-10 / 12-21 / 23-24 / 28 / 32-36 / 37-44 / 49-84 / 88-89 / 92-102 / 141-142 / 145-147 / 149-159 / 161-166 / 168-178 / 180-190 / 191-193 / 195-205 / 206-209 / 211-221 / 222-223 / 225-235: **OK**, importes alineados a la derecha, `pto_vta` a 5 dígitos, `numero` a 8, `pcia_pr` siempre en L1 y en líneas extra, `cod_neto` copiado a líneas extra.
- Categoría Holistor: `F/D/C/RE/FM/DM/CM` correctas para todos los códigos mapeados; **vacía para 51/52/53** (H-07).
- Importe negativo (NC mal leída): la línea sigue midiendo 240 pero lleva `-28672,08`; Holistor espera importes positivos en NC. Recomendable: valor absoluto + advertencia, o fallida.
- Overflow > 99.999.999,99: recorte silencioso (menor, sección 1.2).
- PRN_LINEAS tiene 32 celdas de 481 caracteres: son bloques de dos líneas unidas por `\n` (facturas con doble alícuota o dos NG/EX); es el diseño, no un error, pero ese `\n` dentro de una celda rompe cualquier lectura por líneas de esa hoja.
- No hay línea de encabezado en el archivo (correcto).

---

## 6. Datos (hojas)
- REGISTRO_ESPERADO: 2.155 filas, 17 clientes, 3 períodos. `total` tiene 4 representaciones: texto con punto (`99999.89`, 1.527), texto con `$` y coma de miles (`$ 537,906.14`, 215), número (365) y **fecha (48)**. Las 48 fechas vienen de `USER_ENTERED` con valores como `7311.02` → 01/02/7311. Hoy 8 de esas filas ya están `procesada`; el PRN salió bien porque el formato de fecha devuelve el mismo texto y la diferencia con Gemini quedó dentro de la tolerancia (`8457.09` vs `8457,90`). Es suerte, no diseño (prueba 15).
- `tipo_cod` presentes: 1, 2, 3, 6, 7, 8, 11, 13, 15, **51, 53**, 63, 81. Los 63 (liquidación) y 81 (tique factura A) no están en la tabla de validación del código: si llega un PDF de esos, "cpbte inválido: 81 no existe en AFIP" (existe).
- 38 claves duplicadas físicamente (misma clave, mismo cliente/período) por recargas del Excel con totales distintos; `Indexar Registro` se queda con la de mejor estado, OK.
- CLIENTES: CUIT 20224230649 repetido con dos nombres.
- PROVEEDORES_PENDIENTES: encabezados con espacio final en todas las columnas.
- FALLOS: 94 filas; motivos principales: 38 "no está en ARCA", 30 "Gemini no devolvió texto" (los de hoy coinciden con el nodo mal configurado que se restauró en v53/v54), 20 `Cannot access 'cuitEmFmt'` (24/08, ya corregido), 7 "binary file 'data'" (corregido con Reenganchar), 2 "Factura nueva detectada… modo escaneo" escritas como fallo (bug menor: una nueva en escaneo no es un fallo; revisar `Preparar FALLOS` con `fallidos` de una corrida de escaneo).

---

## 7. Usabilidad y accesibilidad
- **U-01 Candado post-PRN.** Tras "PRN listo", el interceptor de `fetch` y el capturador de clics bloquean "Subir y procesar" para el mismo cliente/período con un `alert()` que dice "Usá Forzar o Liberar proceso" (la casilla Forzar no existe). Procesar una segunda tanda del mismo mes obliga a "Liberar proceso" (que además resetea el estado del backend). Fix: el candado debe bloquear solo mientras `inFlight`; el estado `finalizado` no debe impedir una corrida nueva (el backend ya protege contra duplicados por huella y clave).
- El `request_id` se genera una vez por pestaña y se reutiliza en todas las corridas (`state.requestId = state.requestId || …`): el chequeo `data.run_id !== __holistorActiveRunId` nunca distingue corridas. Regenerar por corrida.
- Cartel de éxito: "✓ PRN listo · N facturas" usa `facturas_finales_generadas = conciliadas.length`: sin ARCA o con totales "a revisar" muestra menos facturas de las que tiene el archivo (o ninguna). Usar `en_prn`.
- Avisos de error (`showAlert` tipo error/warn) desaparecen a los 6 s: un error de subida puede no llegar a leerse. Mantener los de error hasta que el usuario los cierre.
- El período por defecto es el mes actual; el estudio carga el mes anterior. Proponer el mes anterior por defecto (y el aviso de "Excel de otro mes" ya existe).
- Accesibilidad: 0 `label for`, 0 `aria-*`, 0 `role`, 0 `tabindex`; las zonas de arrastre no reciben foco ni Enter (en `balances.js` sí está hecho); el modal de escaneo no atrapa el foco ni cierra con Escape; `alert()`/`confirm()` nativos ×3; texto `#666`/12 px en varios paneles (contraste al límite). Ninguno bloquea el uso con mouse, pero excluyen teclado y lectores de pantalla.
- La página carga íconos y fuentes desde CDN; sin conexión al CDN, `cargarXLSX` ya tiene timeout de 15 s (bien).

---

## 8. Plan de corrección propuesto (orden sugerido)

**Bloque A — hoy, backend (n8n), 6 cambios chicos, un solo nodo cada uno**
1. `Preparar Actualizacion Estado`: marcar `procesada` solo si `p.prn_guardado === true`; si no, dejar `pendiente` y agregar advertencia (cierra H-02 y protege H-01).
2. `Actualizar Huella Factura`: `onError: continueRegularOutput` (H-10).
3. `Generar PRN` línea 257 `toArray` (H-05).
4. `Generar PRN` línea 582 y 408: quitar `.slice(-2)` (H-08).
5. `Generar PRN`: clave única `numeroCpbte(d)` en 1148/1519/1575/1635 (H-09).
6. `Generar PRN`: `categoriaHolistor === ''` → fallida con motivo (H-07, provisorio).

**Bloque B — esta semana, backend, cambios de lógica que conviene probar con una corrida real**
7. Corrección por total de ARCA solo para facturas de un único componente y `alic > 0`; en el resto, `total_a_revisar` (H-03).
8. No reconvertir USD si el total ya coincide con ARCA (H-04).
9. `cellFormat: RAW` en los 6 nodos de append (D-01, S-03).
10. `executionTimeout` 3600 + partición de lotes en la página (H-06).

**Bloque C — seguridad (frontend + n8n juntos, requiere desplegar la página)**
11. Token compartido en encabezado + `allowedOrigins` restringido + `holistor-reset` con parámetros obligatorios (S-01).
12. Verificar nivel de la clave de Gemini (S-02).

**Bloque D — rendimiento y uso**
13. Sondeo adaptativo, `verificar` por lote, limpieza de `staticData`, decidir Ligero, PRN_LINEAS al cierre (P-01/02/03).
14. Candado post-PRN, `request_id` por corrida, cartel con `en_prn`, errores persistentes, mes anterior por defecto (U-01).
15. Accesibilidad básica: `label for`, `role="button"` + `tabindex` + Enter en zonas de arrastre, modal con foco y Escape, reemplazar `alert/confirm`.

**Acción operativa inmediata:** las 23 facturas de FRANK NADIA 2026-08 están marcadas `procesada` sin PRN. Después del bloque A, resubirlas y elegir "Sí, reprocesar".

---

## 9. Qué NO cubre esta auditoría
- No corrí Gemini con PDFs reales nuevos (no hacía falta para los hallazgos y evita gasto); la variabilidad del modelo queda medida solo por la corrida de hoy.
- No probé el import del `.prn` en Holistor (no tengo el programa); la validación de posiciones es contra la especificación del Proyecto.
- No hice una prueba de carga destructiva sobre `holistor-procesar` (cada disparo consume Gemini y escribe en las hojas); la prueba de concurrencia fue sobre `holistor-estado` (16 pedidos).
- No auditar el padre-hijo ni balances bancarios (fuera de alcance acordado).
- El banco de pruebas cubre `Generar PRN`; `Acumular PRN`, `Finalizar PRN Unico` y `Armar PRN Final` se verificaron por traza y contra la ejecución real, no con harness.
