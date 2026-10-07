# Auditoría técnica Holistor — 07/10/2026

**Alcance:** producción y TEST (n8n Cloud `fede123.app.n8n.cloud`, GitHub Pages `Fedee17/holistor-uploader`, planillas y Drive), con foco en todo lo trabajado entre el 01/10 y el 07/10.
**Reglas respetadas:** no se publicó ninguna versión de n8n, no se hizo ningún commit ni push, no se movió ni borró ningún archivo de Drive, no se escribió en planillas de producción, no se ejecutó el workflow de PRODUCCIÓN. Toda prueba funcional se hizo sobre el workflow de TEST (`eXg4n80ds0N6rWlD`). La clave de acceso no aparece en este documento, en los parches ni en el script de prueba.
**Estado del repositorio al cierre:** `HEAD = 2bbd1fc` en `main`; working tree limpio salvo la carpeta `audit-2026-10-07/` (sin trackear). Nada de lo que hay en esa carpeta está aplicado.

---

## 1. Resumen en 5 líneas

1. **Producción está en un estado inconsistente:** la página de GitHub Pages (`bcae97b`, en vivo) ya usa el backend nuevo (`rechazado`, `pdfs_drive`, `reintentar_pdfs`, limpieza de Entrada), pero en n8n ese backend es un **borrador sin publicar** (`versionId 51839856` ≠ `activeVersionId c0b5050f`). Durante esta sesión informé "ya está en producción" y era falso.
2. El borrador de producción tiene **dos defectos que impiden publicarlo tal cual**: `Filtrar Reintento` sin `alwaysOutputData` (un reintento que no encuentra archivos deja la corrida colgada) y `Responder OK` sin `rechazado`/`mensaje` (la página reintenta 4 veces un PDF rechazado y muestra un error genérico).
3. En la página hay **4 defectos chicos y verificables**: bug de `reintentar()` todavía vivo en TEST, cartel "Reprocesar todas (N)" que cuenta duplicadas del lote en ambos entornos, `window._ultimoEstado` sin asignar en producción (link "Ver en Drive" inerte) y etiqueta "(.xlsx)" desactualizada.
4. Las pruebas en TEST pasaron 5 de 6; la restante **confirmó una condición de carrera real en el candado** `PROCESOS_ACTIVOS`: dos `holistor-procesar` del mismo cliente disparados con 1,7 s de diferencia fueron aceptados los dos (ejecuciones `36257` y `36258`). Esto estaba ya señalado como riesgo en el informe del 24/09 y la migración a Sheets no lo cerró.
5. Lo que **no es nuevo** y ya estaba documentado como pendiente (reintentos Gemini, reset global, rendimiento) sigue sin resolverse en producción; **ClickUp no tiene ninguna tarea de octubre** y los 5 documentos del Proyecto están desactualizados desde el 05/10.

---

## 2. Tabla de hallazgos

Severidad: **B** = bloqueante (no publicar sin esto), **I** = importante, **M** = menor.

| N.º | Dónde | Evidencia | Sev. | Corrección mínima propuesta | Cómo verificar |
|---|---|---|---|---|---|
| **H-01** | n8n PROD `r9H4ufyAu1ndyFN5`: borrador sin publicar mientras la página en vivo ya lo asume | `get_workflow_details`: `versionId = 51839856`, `activeVersionId = c0b5050f` (publicada 06/10 13:42 UTC, autosave, sin documentar). Historial: 5 versiones del 07/10 sin publicar (`07131d06`, `c4645c81`, `61869523`, `cb7ba6c5`, `51839856`). Página: commit `bcae97b` en `main` (GitHub Pages sirve `main`), que usa `data.rechazado` (`index.html:2577`), `reintentar_pdfs` (`index.html:3005`) y `pdfs_drive` (`index.html:2201`). Regla incumplida: `2_workflow_estado.md` — "Guardar por API deja un BORRADOR; no está en producción hasta publicar". | **B** | Publicar el borrador **después** de aplicar H-02 y H-03 (ver plan §5). Alternativa si no se quiere publicar hoy: `git checkout c2fbefe -- index.html` y push (vuelve la página al comportamiento anterior; `index.html@c2fbefe == index.html@78589ea`, diff vacío). | `get_workflow_details` → `versionId == activeVersionId`. Prueba de humo §5.3. |
| **H-02** | n8n PROD borrador, nodo `Filtrar Reintento` | Diff de versión `51839856` vs TEST `ff84f7da`: en TEST el nodo tiene `alwaysOutputData: true`; en el borrador PROD **no**. El nodo siguiente `Filtrar Por Cliente` nunca corre con 0 ítems de entrada (patrón documentado en `5_patrones_tecnicos.md`). Verificado también por lectura directa del borrador. | **B** | `update_workflow` op `setNodeSettings` sobre `Filtrar Reintento` con `alwaysOutputData: true` — detalle exacto en `01-n8n-produccion-propuesta.md §1A`. | Después de publicar: `holistor-procesar` con `reintentar_pdfs: ["no-existe.pdf"]` → la corrida cierra limpia (`listo`), no queda `procesando`. En TEST ya pasa así: ejecución `36251`. |
| **H-03** | n8n PROD borrador, nodo `Responder OK` (webhook upload) | Expresión PROD: `={{ JSON.stringify($json.error ? { ok: false, error: $json.error } : { ok: true }) }}`. TEST devuelve además `rechazado: true` y `mensaje`. La página (`index.html:2577`) solo corta los reintentos si `data.rechazado === true` (`index.html:2590` `if (_claveRechazada \|\| err.rechazado === true) break;`); sin ese campo reintenta hasta 4 veces y muestra `HTTP ...`/error genérico. Matiz: PROD **sí** devuelve `ok:false` + `error`, no un 200 "pelado". | **B** | Reemplazar la expresión por la de TEST — `01-n8n-produccion-propuesta.md §1B`. | Subir un `.pdf` de 132 bytes que no es PDF → un solo intento, popup con el mensaje del servidor. En TEST ya pasa así: ejecución `36221`. |
| **H-04** | Candado `PROCESOS_ACTIVOS` (ambos entornos): condición de carrera | TEST, ejecuciones `36257` y `36258` (mismo CUIT/período, disparadas con 1,7 s de diferencia): **ambas** devolvieron `proceso_ya_activo: false` y ambas corrieron. Causa: leer-y-luego-escribir en Sheets sin exclusión (`Leer PROCESOS_ACTIVOS` → `Evaluar Candado` → `Registrar PROCESO_ACTIVO`); la segunda lee antes de que la primera escriba. Mismo riesgo señalado en `8_informe_pruebas_de_ruptura_2026-09-24.md` hallazgo 1 para staticData; la migración a Sheets lo redujo pero no lo eliminó. | **I** | No hay corrección mínima en Sheets: hace falta una escritura atómica (Data Table de n8n con clave única, o un `appendOrUpdate` seguido de **releer** y abortar si la fila no es la propia por `execution_id`). Hoy la única defensa real es la página (botón deshabilitado + `state.inFlight`, `index.html:3213`). | Repetir las dos ejecuciones encadenadas en TEST con la corrección → la segunda tiene que devolver `proceso_ya_activo: true`. |
| **H-05** | n8n PROD publicado y borrador: `¿Reset con clave?` sin rama global; `Forzar Reset Proceso` genera clave `"\|"` | PROD: `¿Reset con clave?` solo tiene cableada la salida 0; faltan los nodos `Leer PROCESOS_ACTIVOS (Reset Global)`, `Preparar Liberación Global`, `Liberar Todos PROCESOS_ACTIVOS` que sí existen en TEST `ff84f7da`. En PROD `Forzar Reset Proceso` arma `process_key = cuit + "\|" + periodo` sin validar vacíos → `"\|"` es truthy → `appendOrUpdate` escribe una fila basura (la fila `"\|"` existe en la planilla de TEST, pestaña `PROCESOS_ACTIVOS`; en PROD no hay ninguna hoy). Ya registrado como ClickUp `86e3adayb` (17/09) e informe 24/09 hallazgo 11. | **I** | Portar los 3 nodos y la lógica de `Forzar Reset Proceso` de TEST — `01-n8n-produccion-propuesta.md §1D` y parche `01c-n8n-Forzar_Reset_Proceso.prod-vs-test.diff`. | `holistor-reset` con cuerpo vacío → `ok:false` sin fila nueva; con clave global → libera todas sin fila `"\|"`. En TEST: ejecución `36271` (reset global, sin fila basura). |
| **H-06** | n8n TEST (y PROD si se porta H-05): `Responder Reset` responde antes de liberar | TEST ejecución `36271`: la respuesta HTTP dice `liberados: 0` aunque la rama global liberó filas después. El nodo `Responder Reset` está antes de `Liberar Todos PROCESOS_ACTIVOS` en el flujo. | **M** | Mover `Responder Reset` después del nodo de Sheets, o responder sin contar (`ok:true`). | Reset global en TEST → la respuesta trae el conteo real. |
| **H-07** | n8n: `Verif FALLO HOT` → `Bucle` (PROD) vs `Move file` (TEST) | Diff `51839856` vs `ff84f7da`: en PROD, si falla `Guardar Linea PRN (Hot)`, el ítem vuelve al bucle sin moverse a Procesados; en TEST se mueve igual. Detalle en `01-n8n-produccion-propuesta.md §1C`. | **I** | Recablear la salida de `Verif FALLO HOT` a `Move file` como en TEST. | Simular fallo del nodo HOT en TEST (desconectando credencial) → el PDF igual termina en Procesados. **No ejecutado** (habría que romper la credencial de TEST a propósito). |
| **H-08** | n8n PROD: reintentos de Gemini y `gemini_no_disponible` sin portar | PROD `Analyze document`: `maxTries: null`; `Analyze document (Ligero)`: `retryOnFail: false`. TEST: `retryOnFail: true, maxTries: 5, waitBetweenTries: 5000`. `Marcar Error Gemini` PROD siempre escribe `gemini_sin_texto` (TEST distingue `gemini_no_disponible`). Prompt PROD 27.857 caracteres vs TEST 29.055 (regla de línea de flete). **Ya documentado** como "pendiente de pasar a producción" en `2_workflow_estado.md` (05/10). | **I** (decisión del estudio) | Parches `01d-n8n-Marcar_Error_Gemini.prod-vs-test.diff`, `01e-n8n-Analyze_document.prompt.prod-vs-test.diff`; ops en `01-n8n-produccion-propuesta.md §1E/§1F`. | Después de portar: `get_workflow_details` del nodo → `maxTries: 5`. Comportamiento con Gemini caído: no reproducible a voluntad. |
| **H-09** | Página TEST `index-test.html:2139–2141`: `reintentar()` manda lista vacía | `archivosFallidos = [];` (línea 2139) se ejecuta **antes** de que `.map()` lea los nombres → `sendFlush(true, false, [])` → el backend no sabe qué reintentar. En PROD está arreglado (`index.html:2128` captura `nombresReintentar` antes de vaciar; línea 2134 lo pasa). Bug introducido por esta sesión al arreglar solo en PROD (`bcae97b`) sin portar a TEST. | **I** (TEST) | Parche `02-frontend-test-reintentar-lista-vacia.diff`. | Playwright `test-escaneo-popup.mjs` (ya cubre el flujo) o manual en TEST: "Reintentar" tras una fallida → la ejecución recibe `reintentar_pdfs` con nombres. |
| **H-10** | Páginas PROD y TEST: cartel "Reprocesar todas (N)" cuenta duplicadas del lote | `manejarResultadoEscaneo` define `repetidas = yaProcesadas.length` (`index.html:2888` / `index-test.html:2888`), pero `mostrarCartelEscaneo` recalcula `repetidas = todas.length` (`index.html:2917` / `index-test.html:2917`) donde `todas` incluye `duplicadasLote`. Playwright: con 3 ya procesadas + 2 duplicadas el botón dice "(5)" cuando el servidor va a reprocesar 3. Introducido por esta sesión (`c2fbefe` → `bcae97b`). | **M** | Parches `03a-…-prod` y `03b-…-test` (introducen `totalFilas`/`repetidas`/`resto` separados). | `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node audit-2026-10-07/test-escaneo-popup.mjs` → el caso "duplicadas no cuentan" pasa a verde. |
| **H-11** | Página PROD: `window._ultimoEstado` nunca se asigna → "Ver en Drive" inerte | `index.html:2201` lee `window._ultimoEstado.pdfs_drive`, pero no existe ninguna asignación `window._ultimoEstado = data` en `index.html` (grep: 0 resultados). En TEST sí: `index-test.html:1756` (commit `2bbd1fc`). Al portar a PROD (`bcae97b`) se portó el lector pero no el escritor. | **M** | Parche `04-frontend-prod-ultimoEstado-ver-en-drive.diff`. Requiere además H-01 publicado (el backend publicado `c0b5050f` no devuelve `pdfs_drive`). | Factura fallida en PROD → el link "Ver en Drive" abre el PDF. |
| **H-12** | Página PROD: etiqueta "(.xlsx)" cuando ya acepta CSV | `index.html:216` dice "(.xlsx)"; el input acepta `.xlsx,.xls,.csv` y `validarArchivoExcel` admite `/\.(xlsx\|xls\|csv)$/i` (portados en `bcae97b`). TEST ya dice "(.xlsx o .csv)" (`index-test.html:219`). | **M** | Parche `05-frontend-prod-etiqueta-xlsx-csv.diff`. | Visual. |
| **H-13** | Página (ambas): `data.mensaje` del servidor se inyecta sin escapar en el popup | `index.html:3041` y `index-test.html:3041`: `showAlert(data.mensaje \|\| …, 'warn')` → `mostrarAlertaPopup` arma `<span>${msg}</span>` (`index.html:609`). Hoy `Evaluar Candado` no incluye `cliente_nombre` en el mensaje (verificado por grep en ambos workflows), así que **no hay vector activo**; pero la planilla de TEST tiene una fila `\|0-13` con `cliente_nombre = <img src=x onerror=alert(1)>` que muestra que el dato entra sin filtrar. Requiere la clave para explotarse. | **M** | Escapar `msg` con `textContent` o un `escapeHtml` antes de interpolar en `mostrarAlertaPopup`. | Forzar un `mensaje` con `<b>` desde TEST → se ve literal, no en negrita. |
| **H-14** | Drive PROD, carpeta Entrada `1OMpYkZOwbWNS5-HN6drA49IdjAec9taM`: 6 archivos residuales | Listado 07/10: `20372852756__texto_disfrazado.pdf` (132 bytes, 07/10 14:18 — archivo de prueba hecho en producción), `20372852756__img_t260930082257_n1.pdf` (ya procesado; quedó porque PROD publicado no limpia Entrada), 4 PDFs de ACTIS BEATRIZ con nombre repetido `FC-3106-00035948.pdf`. | **I** (operativo) | Decidir manualmente archivo por archivo **antes** de publicar H-01 (el backend nuevo los va a borrar/mover solo). No se tocó nada. | Entrada PROD vacía o solo con facturas que de verdad hay que procesar. |
| **H-15** | Planilla PROD `PROCESOS_ACTIVOS`: 9 de 10 filas en `liberado` | `liberado` solo lo escribe `Liberar PROCESO_ACTIVO (Reset)` (botón manual "Liberar proceso"); el cierre normal escribe `listo` (`Liberar PROCESO_ACTIVO`). → el botón se usó ≥ 9 veces. **No verificado** quién ni cuándo (la hoja no guarda esa información). 0 filas `procesando`, sin filas basura. | **M** (señal) | Ninguna sobre datos. Agregar columna `liberado_por`/`liberado_en` si se quiere trazabilidad. | — |
| **H-16** | Documentación y ClickUp desactualizados | ClickUp: ninguna tarea creada en octubre (`clickup_filter_tasks`); `2_workflow_estado.md` del 05/10 ya decía "ClickUp no registra nada del trabajo del 30/09 al 05/10: cargarlo". Los 5 documentos del Proyecto no mencionan: versiones `c0b5050f`/`51839856`, limpieza de Entrada, `Validar Subida`, `reintentar_pdfs`, `pdfs_drive`, soporte CSV, carrusel de errores, ni este informe. | **I** (proceso) | Lista de tareas y puntos de documentación en §6. | — |

### Hipótesis del pedido de auditoría — veredicto

| Hipótesis | Veredicto | Hallazgo |
|---|---|---|
| 1. Borrador de PROD sin publicar; la página ya lo asume | **Confirmada.** El matiz "c0b5050f es idéntica a 274b6922" **no se verificó** (no hice el diff entre esas dos versiones). | H-01 |
| 2. `Responder OK` devuelve 200 sin `rechazado` | **Parcialmente confirmada:** devuelve `ok:false` + `error`, pero no `rechazado`/`mensaje`; el efecto en la página es el descripto. | H-03 |
| 3. `Filtrar Reintento` sin `alwaysOutputData` cuelga el reintento | **Confirmada** por lectura del borrador. No se probó en PROD (prohibido); en TEST, con el flag, cierra limpio (`36251`). | H-02 |
| 4. Reset global sin portar y fila `"\|"` | **Confirmada.** | H-05 |
| 5. Reintentos Gemini / `gemini_no_disponible` / flete sin portar | **Confirmada**, pero **no es hallazgo nuevo**: estaba en `2_workflow_estado.md` como decisión pendiente. | H-08 |
| 6. `Verif FALLO HOT` cableado distinto | **Confirmada.** | H-07 |
| 7. Bug de `reintentar()` | **Confirmada solo en TEST**; PROD está arreglado. | H-09 |
| 8. Conteo del cartel incluye duplicadas | **Confirmada** en ambos entornos, demostrada con Playwright. | H-10 |
| 9. Un operador puede liberar el proceso de otro | **Confirmada por diseño** (`Liberar proceso` no comprueba quién lo inició; TEST ejecución `36276` liberó la fila `procesando` de la ejecución en curso `36275`). Agravada por H-05 en PROD (reset sin cliente). | H-05/H-15 |
| 10. `mensaje` sin escapar | **Confirmada**, idéntica en PROD y TEST, sin vector activo hoy. | H-13 |

---

## 3. No pude verificar

- **Si `c0b5050f` (publicada) es idéntica a `274b6922`** (la que el documento del 05/10 daba como activa). Es un autosave del 06/10 13:42 UTC sin registro de quién lo hizo ni por qué. Se puede resolver con `get_workflow_versions_diff` entre ambas antes de publicar.
- **Quién y cuándo usó "Liberar proceso"** las ≥ 9 veces que muestran las filas `liberado` de producción.
- **El comportamiento real del borrador de PROD** (H-02, H-03, H-07): está prohibido ejecutar producción. Las afirmaciones se basan en lectura del JSON del workflow y en el comportamiento equivalente observado en TEST.
- **Fallo real de Gemini** (H-08) y **fallo real de `Guardar Linea PRN (Hot)`** (H-07): no son reproducibles a voluntad sin romper credenciales.
- **Concurrencia real desde dos navegadores** (H-04): la prueba se hizo con dos `execute_workflow` encadenados desde una sola sesión (1,7 s de diferencia). Es suficiente para demostrar la carrera, no para medir su ventana exacta.
- **El link "Ver en Drive" en el navegador** del usuario: el sandbox no tiene salida HTTP a `fede123.app.n8n.cloud` ni a Pages (403 del proxy); la prueba de Playwright mockea `fetch`. Lo que sí se verifica es que la página construye el `href` desde `pdfs_drive`.
- **El contenido de los 4 PDFs de ACTIS BEATRIZ** en Entrada de PROD (si son 4 facturas distintas con el mismo nombre o el mismo archivo 4 veces): no se descargaron.

---

## 4. Qué está bien, con evidencia

- **Candado antes de subir y flujo de clave vencida** en la página: idénticos en `index.html` y `index-test.html`. `fetchConTimeout` marca `_claveRechazada` ante 401/403 (`index.html:407–422`); `subirUnPDF` corta los reintentos (`index.html:2590`); `startUpload` consulta `proceso_ya_activo` antes de subir (`index.html:2623` en adelante, `3040`); un solo cartel por lote (`_ultimoRechazoProceso`, `index.html:3035`).
- **Validación de entrada en `Resetear Estado`** del borrador PROD y de TEST: CUIT solo dígitos (11), mes 1–12, año numérico. TEST ejecución `36221`: pedido inválido rechazado con `ok:false`, **sin fila** en `PROCESOS_ACTIVOS` (cerraba el hallazgo 8 del informe del 24/09).
- **Carpeta sin archivos del cliente**: TEST ejecución `36224` cierra limpio (`20085974344|2026-10` → `listo`), sin ítem vacío a Gemini ni `desconocido: fallida` (cerraba el hallazgo 5 del 24/09).
- **Reintento de fallidas** con nombres que existen: TEST ejecución `36236` encontró 1/88 archivos en Procesados y solo procesó ese.
- **Repetida ya procesada con `forzar:false`**: TEST ejecución `36280` → coincidencia por huella, sin llamada a Gemini, sin línea PRN, cierre limpio, y la limpieza de Entrada corre (TEST Entrada quedó vacía).
- **Reset global en TEST**: ejecución `36271` libera todo sin fila `"|"`.
- **Sintaxis de ambos `<script>`**: parsean sin error (Node `--check` sobre el bloque extraído) y los 32 casos de Playwright pasan en los dos archivos (`audit-2026-10-07/README.md`).
- **Los 5 parches de frontend aplican limpio**: `git apply --check` OK sobre `HEAD 2bbd1fc` para `02`, `03a`, `03b`, `04`, `05`.
- **La limpieza de Entrada portada al borrador PROD** (`¿Modo escaneo (sin mover)?`, `¿Repetida (eliminar)?`, `Eliminar Repetido`, `Verif Eliminar`, `¿Eliminó bien?`) es **byte-idéntica** a TEST (verificado nodo por nodo en `07131d06`).
- **`Buscar en Procesados (reintento)`** en borrador PROD: credencial `TbgO6CY61dSlSX0Y` ("Google Drive account 3"), carpeta Procesados `1xpANQS9b_somOKnTLqRatnK11QJGbf0x`, `retryOnFail 3×3000`, `alwaysOutputData: true` — coincide con TEST salvo por la observación de reintentos fuera del estándar 5×5000 (`01-n8n-produccion-propuesta.md §1G`).
- **Planilla PROD `PROCESOS_ACTIVOS`**: 0 filas `procesando`, 0 filas basura; `Liberar PROCESO_ACTIVO` escribe `listo`, `Registrar PROCESO_ACTIVO` escribe `procesando` (grep sobre el JSON del workflow).
- **Workflow TEST**: `versionId == activeVersionId == ff84f7da` (155 nodos). Lo que se probó es lo que está publicado.

---

## 5. Plan de publicación ordenado (propuesta; nada de esto está hecho)

### 5.1 Checklist previo

1. **Backup**: exportar el JSON de la versión publicada `c0b5050f` y del borrador `51839856` (desde el historial de n8n) y guardarlos fuera del repo.
2. **Nadie con el editor de n8n PROD abierto** en otra pestaña (un autosave ajeno pisaría el borrador, como pasó el 06/10 13:42).
3. **`PROCESOS_ACTIVOS` PROD sin filas `procesando`** (hoy: 0). Si hay una, esperar a que termine o liberarla a propósito.
4. **Entrada PROD (H-14)**: decidir los 6 archivos a mano. Mínimo: borrar `20372852756__texto_disfrazado.pdf` (es una prueba). Para los 4 de ACTIS BEATRIZ, confirmar si son 4 facturas o 1 repetida antes de que el backend nuevo los procese/borre solo.
5. Confirmar la versión del documento `2_workflow_estado.md` que se va a actualizar al terminar (§6).

### 5.2 Orden y por qué

**Primero n8n, después la página.** La página en vivo (`bcae97b`) ya depende del backend nuevo; cada hora que pasa con `c0b5050f` publicada es una hora en que un PDF rechazado se reintenta 4 veces y "Ver en Drive"/reintentar no funcionan. Publicar n8n no rompe la página vieja (los campos nuevos son aditivos).

1. Aplicar al borrador PROD **§1A (H-02)** y **§1B (H-03)** con las ops exactas de `01-n8n-produccion-propuesta.md`. Si se aprueban, también §1C (H-07) y §1D (H-05) en el mismo lote.
2. Releer el borrador: `get_workflow_details` + diff contra `51839856` → solo tienen que cambiar los nodos tocados.
3. **Publicar** (`publish_workflow`). Anotar el nuevo `activeVersionId`.
4. Prueba de humo (§5.3).
5. Página, **TEST primero** (regla del estudio): aplicar `02` y `03b` a `index-test.html`, commit, probar en la página de test.
6. Página PROD: aplicar `03a`, `04`, `05` a `index.html`, commit, verificar que el deploy de Pages del commit termine en verde (un push posterior cancela el anterior: esperar).
7. Decisiones del estudio aparte: §1E/§1F (H-08) y H-13, H-04.

### 5.3 Prueba de humo posterior (producción, con un cliente real de bajo riesgo)

| Paso | Esperado |
|---|---|
| Subir un `.pdf` de 132 bytes que no es PDF | Un solo intento, popup con mensaje del servidor, no queda en Entrada |
| Subir una factura **ya procesada** con el lote | Cartel "¿Querés reprocesarlas?" → "No, dejar así" → la factura desaparece de Entrada (borrada o en Procesados), sin línea PRN nueva |
| "Liberar proceso" **sin cliente** seleccionado (solo si se portó §1D) | `ok:false`, sin fila `"\|"` en `PROCESOS_ACTIVOS` |
| "Reintentar" con una fallida real | La ejecución recibe `reintentar_pdfs` con el nombre; si no la encuentra, cierra en `listo` |
| Factura fallida en la lista | Link "Ver en Drive" abre el PDF (requiere parche `04`) |
| `PROCESOS_ACTIVOS` al final | La fila del cliente en `listo`, nada en `procesando` |

### 5.4 Cómo volver atrás

- **n8n**: `restore_workflow_version` a `c0b5050f` (o publicar esa versión desde el historial). Si se restaura, la página debe volver también (punto siguiente) o quedará otra vez adelantada.
- **Página**: `git checkout c2fbefe -- index.html && git commit && git push` (equivale a `78589ea`, diff vacío entre ambos; `index-test.html` no se toca). Esperar el deploy de Pages en verde.
- **Datos**: ninguna de las publicaciones escribe en planillas por sí sola; no hay nada que revertir en Sheets.

---

## 6. Documentación y ClickUp — qué falta cargar

**Tareas ClickUp a crear** (asignadas a Federico Armando, `farmando@riordayasociados.com.ar`; marcar "completado" las ya hechas):

1. *Publicar backend PROD con limpieza de Entrada, validación de subida, reintento de fallidas y `pdfs_drive`* — bloqueada por H-02/H-03. **Abierta.**
2. *`Filtrar Reintento` sin `alwaysOutputData` en PROD* — **abierta** (H-02).
3. *`Responder OK` sin `rechazado`/`mensaje` en PROD* — **abierta** (H-03).
4. *Condición de carrera en candado `PROCESOS_ACTIVOS`* — **abierta** (H-04), referenciar informe 24/09 hallazgo 1.
5. *Portar reset global a PROD* — actualizar `86e3adayb` con la referencia al parche `01c` (H-05).
6. *`Verif FALLO HOT → Move file` en PROD* — **abierta** (H-07).
7. *Decisión: portar reintentos Gemini 5×5 s, `gemini_no_disponible` y regla de flete* — **abierta, decisión del estudio** (H-08).
8. *Bug `reintentar()` en TEST* — **abierta** (H-09), parche `02`.
9. *Cartel "Reprocesar todas (N)" cuenta duplicadas* — **abierta** (H-10), parches `03a/03b`.
10. *`window._ultimoEstado` y etiqueta CSV en PROD* — **abierta** (H-11, H-12), parches `04/05`.
11. *Escapar `mensaje` en `mostrarAlertaPopup`* — **abierta** (H-13).
12. *Limpiar Entrada PROD (6 archivos)* — **abierta**, operativa (H-14).
13. *Trabajo 30/09–07/10 ya hecho* (clave vencida `78589ea`, carrusel `004c7c5`, cartel restaurado `c2fbefe`, port a PROD `bcae97b`, Ver en Drive `2bbd1fc`, backend TEST `ff84f7da`) — **completadas**, para que ClickUp refleje la realidad.

**`2_workflow_estado.md` — sección "Novedades" a agregar:**

- Versiones reales de n8n PROD al 07/10: publicada `c0b5050f` (autosave 06/10 13:42 UTC, origen desconocido), borrador `51839856` (5 versiones del 07/10 sin publicar) y la lista de nodos nuevos del borrador.
- TEST publicado `ff84f7da` (155 nodos).
- Página: commits `78589ea` → `2bbd1fc` con una línea por cada uno y qué quedó solo en TEST.
- Contratos nuevos de los webhooks: `holistor-upload` devuelve `rechazado`/`mensaje`; `holistor-procesar` acepta `reintentar_pdfs`; `holistor-estado` devuelve `pdfs_drive`.
- Hallazgos abiertos de esta auditoría (H-04 en particular) y el plan §5.
- Regla operativa nueva del estudio: **cambios primero en TEST, el usuario prueba, después PROD.**

**`3_arquitectura_recursos.md`:** agregar `Buscar en Procesados (reintento)` y el subgrafo de limpieza de Entrada al mapa de nodos; documentar la credencial `TbgO6CY61dSlSX0Y` en ese nodo.

**`5_patrones_tecnicos.md`:** agregar el patrón "al portar entre workflows, comparar `settings` del nodo (`alwaysOutputData`, `retryOnFail`, `onError`), no solo `parameters`" — es exactamente lo que falló en H-02.

---

## 7. Autocrítica de la sesión 01/10–07/10 (lo que esta auditoría encontró del propio trabajo)

- Informé "ya está en producción" tras guardar borradores de n8n sin publicar (H-01). La regla estaba escrita en la documentación del Proyecto.
- Al portar `Filtrar Reintento` de TEST a PROD se perdió `alwaysOutputData` (H-02): comparé parámetros, no `settings`.
- Arreglé `reintentar()` en PROD y no lo porté de vuelta a TEST (H-09), rompiendo la regla "TEST primero" que el estudio había pedido ese mismo día.
- Al restaurar el cartel (`c2fbefe`) introduje el desajuste de conteo (H-10) sin prueba automatizada; la prueba de Playwright que lo detecta se escribió recién en esta auditoría.
- Porté el lector de `pdfs_drive` a PROD sin el escritor (H-11).
- Hice una prueba con un PDF falso **en Entrada de producción** (`texto_disfrazado.pdf`, 07/10 14:18) en vez de en TEST (H-14).

---

## 8. Archivos de esta auditoría

| Archivo | Qué es | Estado |
|---|---|---|
| `AUDITORIA_2026-10-07.md` | Este informe | — |
| `README.md` | Cómo correr la prueba de Playwright y qué cubre | — |
| `test-escaneo-popup.mjs` | 32 casos sobre cartel de escaneo / carrusel / reintentar, mockeando `fetch` | 32/32 PASS en ambos HTML |
| `01-n8n-produccion-propuesta.md` | Ops exactas de `update_workflow` para §1A–§1G | No aplicado |
| `01c-…`, `01d-…`, `01e-…` `.diff` | Diferencias PROD vs TEST de `Forzar Reset Proceso`, `Marcar Error Gemini`, prompt de `Analyze document` | No aplicado |
| `02-frontend-test-reintentar-lista-vacia.diff` | H-09 | `git apply --check` OK |
| `03a-…prod` / `03b-…test` `.diff` | H-10 | `git apply --check` OK |
| `04-frontend-prod-ultimoEstado-ver-en-drive.diff` | H-11 | `git apply --check` OK |
| `05-frontend-prod-etiqueta-xlsx-csv.diff` | H-12 | `git apply --check` OK |

Ninguno está commiteado. Para dejarlos en la rama `auditoria-2026-10-07` sin tocar `main`: `git checkout -b auditoria-2026-10-07 && git add audit-2026-10-07 && git commit` — solo si el usuario lo pide.
