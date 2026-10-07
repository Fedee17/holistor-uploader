# Propuesta de cambios en n8n PRODUCCIÓN (`r9H4ufyAu1ndyFN5`) — NO APLICADA

Auditoría 2026-10-07. Todo lo de abajo son **propuestas**: ninguna se aplicó ni se publicó.
Cada bloque trae (1) qué cambia, (2) la evidencia, (3) las operaciones exactas de
`update_workflow` listas para pegar, y (4) cómo verificar después.

Convención: "borrador" = `versionId` `51839856` (guardado 07/10 15:16 UTC);
"publicado" = `activeVersionId` `c0b5050f` (06/10 13:42 UTC). Las propuestas se aplican
sobre el borrador; nada llega a los usuarios hasta que alguien publique.

---

## 1A — `Filtrar Reintento`: falta `alwaysOutputData: true` (BLOQUEANTE antes de publicar)

**Qué pasa.** Es un nodo filtro (puede devolver 0 ítems si ningún nombre pedido en
`reintentar_pdfs` existe en Procesados). Sin `alwaysOutputData`, n8n no ejecuta el nodo
siguiente (`Filtrar Por Cliente`) con 0 ítems de entrada, la cadena se corta y el proceso
queda `procesando` en PROCESOS_ACTIVOS hasta el timeout de 45 min. Regla propia del
proyecto (`5_patrones_tecnicos.md`): "alwaysOutputData necesario en nodos de filtro".

**Evidencia.** Borrador de producción: nodo `Filtrar Reintento` sin la clave
`alwaysOutputData` (ausente → false). TEST: `"alwaysOutputData": true` desde su primera
versión (`13936e8f`, 07/10 12:35 UTC). El diff de la versión `51839856` ("Reintentar PDFs
puntuales + validar CUIT/mes/año", 07/10 15:16 UTC) muestra el nodo agregado solo con
`parameters.jsCode`: la bandera se perdió en el port TEST→PROD hecho por esta misma
sesión. Matiz honesto: `Filtrar Por Cliente` sí tiene `alwaysOutputData` en ambos
ambientes, pero eso solo ayuda si ese nodo llega a ejecutarse; con 0 ítems de entrada
no se ejecuta. No se pudo verificar en caliente (prohibido ejecutar producción; TEST
tiene la bandera y no reproduce el fallo).

```json
[
  { "type": "setNodeSettings", "nodeName": "Filtrar Reintento",
    "settings": { "alwaysOutputData": true } }
]
```

**Verificar.** `get_workflow_details` → el nodo muestra `"alwaysOutputData": true`.
Prueba en TEST ya hecha (ver sección C del informe): reintento sin coincidencias cierra
limpio.

---

## 1B — `Responder OK`: devolver `rechazado` y `mensaje` (BLOQUEANTE antes de publicar)

**Qué pasa.** `Validar Subida` rechaza PDFs inválidos con `{rechazado:true, error,
mensaje:'Subida rechazada: …'}`, pero `Responder OK` de producción solo devuelve
`{ok:false, error}`. La página (`index.html` línea ~2577) decide "rechazo definitivo, no
reintentar" con `data.rechazado === true` y muestra `data.mensaje`: en producción ambos
llegan `undefined`, así que un archivo vacío se reintenta 4 veces (5/15/40 s, ~1 min) y el
cartel dice "HTTP 200" en vez del motivo. Corrección al hallazgo del usuario: NO devuelve
un 200 vacío — devuelve `ok:false` + `error`; lo que falta son los dos campos.

**Evidencia.**
- PROD `Responder OK.responseBody`:
  `={{ JSON.stringify($json.error ? { ok: false, error: $json.error } : { ok: true }) }}`
- TEST `Responder OK.responseBody`:
  `={{ JSON.stringify($json.error ? { ok: false, rechazado: $json.rechazado === true, error: $json.error, mensaje: $json.mensaje || $json.error } : { ok: true }) }}`

```json
[
  { "type": "setNodeParameter", "nodeName": "Responder OK", "path": "/responseBody",
    "value": "={{ JSON.stringify($json.error ? { ok: false, rechazado: $json.rechazado === true, error: $json.error, mensaje: $json.mensaje || $json.error } : { ok: true }) }}" }
]
```

**Verificar.** Subir un `.pdf` de 0 bytes desde la página real: un solo cartel con
"Subida rechazada: el archivo está vacío…", sin reintentos en el log, y el archivo NO
aparece en Entrada.

---

## 1C — Conexión `Verif FALLO HOT → Move file` (IMPORTANTE)

**Qué pasa.** En producción, una factura que falla por el camino "FALLO HOT" vuelve al
`Bucle` sin moverse: el PDF queda en Entrada. Como el reintento de fallidas busca solo en
Procesados (`Buscar en Procesados (reintento)`, ver 1E), esa factura no se puede
reintentar con el botón. En TEST ya está conectado a `Move file`.

**Evidencia.** `connections["Verif FALLO HOT"]`: PROD → `Bucle`; TEST → `Move file`.
`Move file` en PROD recibe de `Fallo en PRN?`, `¿Repetida (eliminar)?`, `¿Eliminó bien?`
solamente.

```json
[
  { "type": "removeConnection", "source": "Verif FALLO HOT", "sourceIndex": 0, "target": "Bucle", "targetIndex": 0 },
  { "type": "addConnection",    "source": "Verif FALLO HOT", "sourceIndex": 0, "target": "Move file", "targetIndex": 0 }
]
```
(`Move file → Verif Move → Bucle` ya existe: la vuelta al bucle se mantiene.)

**Verificar.** En una corrida con una factura que falle en `Generar PRN`, el PDF termina
en Procesados y figura en FALLOS; "Reintentar fallidas" lo encuentra.

---

## 1D — Reset global sin fila basura `"|"` (IMPORTANTE; resuelve ClickUp `86e3adayb`)

**Qué pasa.** "Liberar proceso" sin cliente ni período: `Forzar Reset Proceso` de
producción arma `key = cuit + '|' + per` = `"|"` (string no vacío), así que `key ||
'todos'` sigue siendo `"|"`; `¿Reset con clave?` (`key !== 'todos'`) toma la rama normal y
`Liberar PROCESO_ACTIVO (Reset)` hace `appendOrUpdate` con `process_key = "|"` → fila
basura, y ningún candado real de la hoja se libera (los `procesando` siguen bloqueando
45 min). Es exactamente la fila `"|"` vacía que hoy existe en la planilla de TEST
(creada antes del fix del 06/10 en TEST). En producción la fila todavía no existe porque
nadie usó el botón sin cliente desde el 01/10.

**Evidencia.** `01c-n8n-Forzar_Reset_Proceso.prod-vs-test.diff` (código real de ambos
ambientes). `connections["¿Reset con clave?"]`: PROD solo salida 0 → `Liberar
PROCESO_ACTIVO (Reset)`; TEST salida 1 → `Leer PROCESOS_ACTIVOS (Reset Global) →
Preparar Liberación Global → Liberar Todos PROCESOS_ACTIVOS`. Los tres nodos no existen
en producción.

Operaciones (IDs de **producción**: planilla `15-YOBXv0Sinrdr0SUZvaY_rBTHb8CVoKRxftX7uwCUU`,
credencial Sheets `ypNqtAvtPxBxnlAI`; posiciones orientativas junto a `Liberar
PROCESO_ACTIVO (Reset)` que está en `[-266272, -2672]`):

```json
[
  { "type": "setNodeParameter", "nodeName": "Forzar Reset Proceso", "path": "/jsCode",
    "value": "<<jsCode de TEST, ver 01c; es idéntico salvo las líneas del diff>>" },
  { "type": "addNode", "node": { "name": "Leer PROCESOS_ACTIVOS (Reset Global)", "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.5, "position": [-266272, -2480],
      "parameters": { "documentId": { "__rl": true, "mode": "id", "value": "15-YOBXv0Sinrdr0SUZvaY_rBTHb8CVoKRxftX7uwCUU" }, "sheetName": { "__rl": true, "mode": "name", "value": "PROCESOS_ACTIVOS" }, "options": {} },
      "credentials": { "googleSheetsOAuth2Api": { "id": "ypNqtAvtPxBxnlAI", "name": "Google Sheets OAuth2 API" } } } },
  { "type": "setNodeSettings", "nodeName": "Leer PROCESOS_ACTIVOS (Reset Global)", "settings": { "alwaysOutputData": true, "onError": "continueRegularOutput", "retryOnFail": true, "maxTries": 3, "waitBetweenTries": 2000 } },
  { "type": "addNode", "node": { "name": "Preparar Liberación Global", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [-266048, -2480],
      "parameters": { "jsCode": "// (06/10/2026) 'Liberar proceso' sin cliente libera todos los procesos internos, pero\n// hasta ahora dejaba los candados de la hoja PROCESOS_ACTIVOS en 'procesando' (hasta 45\n// minutos). Acá se preparan las filas 'procesando' para pasarlas a 'liberado'.\nconst filas = $input.all().map(i => (i && i.json) || {}).filter(r => r && r.process_key);\nconst out = [];\nfor (const r of filas) {\n  if (String(r.estado || '').trim().toLowerCase() === 'procesando') {\n    out.push({ json: { process_key: String(r.process_key).trim(), estado: 'liberado' } });\n  }\n}\nreturn out; // sin filas 'procesando' no se escribe nada\n" } } },
  { "type": "addNode", "node": { "name": "Liberar Todos PROCESOS_ACTIVOS", "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.5, "position": [-265824, -2480],
      "parameters": { "operation": "appendOrUpdate", "documentId": { "__rl": true, "mode": "id", "value": "15-YOBXv0Sinrdr0SUZvaY_rBTHb8CVoKRxftX7uwCUU" }, "sheetName": { "__rl": true, "mode": "name", "value": "PROCESOS_ACTIVOS" }, "options": { "cellFormat": "RAW" },
        "columns": { "mappingMode": "defineBelow", "matchingColumns": ["process_key"], "value": { "process_key": "={{ $json.process_key }}", "estado": "={{ $json.estado }}" },
          "schema": [ {"id":"process_key","displayName":"process_key","type":"string","canBeUsedToMatch":true,"display":true,"required":false,"defaultMatch":false}, {"id":"run_id","displayName":"run_id","type":"string","canBeUsedToMatch":true,"display":true,"required":false,"defaultMatch":false}, {"id":"cliente_nombre","displayName":"cliente_nombre","type":"string","canBeUsedToMatch":true,"display":true,"required":false,"defaultMatch":false}, {"id":"iniciado_en","displayName":"iniciado_en","type":"string","canBeUsedToMatch":true,"display":true,"required":false,"defaultMatch":false}, {"id":"estado","displayName":"estado","type":"string","canBeUsedToMatch":true,"display":true,"required":false,"defaultMatch":false}, {"id":"tipo","displayName":"tipo","type":"string","canBeUsedToMatch":true,"display":true,"required":false,"defaultMatch":false} ] } },
      "credentials": { "googleSheetsOAuth2Api": { "id": "ypNqtAvtPxBxnlAI", "name": "Google Sheets OAuth2 API" } } } },
  { "type": "setNodeSettings", "nodeName": "Liberar Todos PROCESOS_ACTIVOS", "settings": { "onError": "continueRegularOutput", "retryOnFail": true, "maxTries": 3, "waitBetweenTries": 3000 } },
  { "type": "addConnection", "source": "¿Reset con clave?", "sourceIndex": 1, "target": "Leer PROCESOS_ACTIVOS (Reset Global)", "targetIndex": 0 },
  { "type": "addConnection", "source": "Leer PROCESOS_ACTIVOS (Reset Global)", "sourceIndex": 0, "target": "Preparar Liberación Global", "targetIndex": 0 },
  { "type": "addConnection", "source": "Preparar Liberación Global", "sourceIndex": 0, "target": "Liberar Todos PROCESOS_ACTIVOS", "targetIndex": 0 }
]
```

Observaciones: (a) `Preparar Liberación Global` devuelve `[]` cuando no hay filas
`procesando` y no tiene `alwaysOutputData` — es el último tramo (nada depende de él), así
que no cuelga nada; (b) `appendOrUpdate` con `matchingColumns` de texto es la operación
que `5_patrones_tecnicos.md` desaconseja en hojas grandes — PROCESOS_ACTIVOS tiene 10
filas, riesgo bajo, y es la misma operación que ya usan `Registrar PROCESO_ACTIVO` y
`Liberar PROCESO_ACTIVO (Reset)`.

**Verificar (en TEST ya probado, sección C).** Pedido a `holistor-reset` sin cuerpo: la
respuesta trae `key: 'todos'`, todas las filas `procesando` pasan a `liberado`, y NO
aparece una fila `"|"` nueva.

---

## 1E — Reintentos de Gemini 5×5 s + `gemini_no_disponible` (DECISIÓN PENDIENTE DEL ESTUDIO)

Esto ya figura como "pendiente de decidir si pasa a producción" en `2_workflow_estado.md`
(05/10): no es un hallazgo nuevo. Se incluye porque la pregunta fue "¿hay motivo técnico
para no portarlo?". Respuesta: **no se encontró ninguno** en el código ni en las notas de
los nodos; el mismo patrón 5×5 ya es el estándar de `Upload PDF a Drive` y `Move file` en
producción, y el comentario del nodo lo describe como corrección de un error del usuario
("no es un problema de la factura"), no como experimento. Costo declarado en el doc:
~20 s más para darse por fallida una factura que Gemini rechaza de verdad.

**Evidencia.** Ajustes actuales: `Analyze document` PROD `maxTries:null,
waitBetweenTries:null` (default n8n 3×1 s) vs TEST `5/5000`; `Analyze document Retry
JSON` igual; `Analyze document Ligero` PROD `retryOnFail:false` vs TEST `5/5000`.
`Marcar Error Gemini`: ver `01d-n8n-Marcar_Error_Gemini.prod-vs-test.diff` (PROD clasifica
todo como `gemini_sin_texto` → carga manual, incluso un 503 de Google).

```json
[
  { "type": "setNodeSettings", "nodeName": "Analyze document",            "settings": { "retryOnFail": true, "maxTries": 5, "waitBetweenTries": 5000 } },
  { "type": "setNodeSettings", "nodeName": "Analyze document Retry JSON", "settings": { "retryOnFail": true, "maxTries": 5, "waitBetweenTries": 5000 } },
  { "type": "setNodeSettings", "nodeName": "Analyze document Ligero",     "settings": { "retryOnFail": true, "maxTries": 5, "waitBetweenTries": 5000 } },
  { "type": "setNodeParameter", "nodeName": "Marcar Error Gemini", "path": "/jsCode",
    "value": "<<jsCode de TEST, ver 01d>>" }
]
```

---

## 1F — Regla de "línea de flete" en el prompt (DECISIÓN PENDIENTE DEL ESTUDIO)

También estaba como pendiente (4) en `2_workflow_estado.md` (caso DELYAR 0018-00030326,
salió `FLT` el 01/10 e `INA` el 02/10). TEST ya la tiene; producción no.
`01e-n8n-Analyze_document.prompt.prod-vs-test.diff`: 14 líneas agregadas / 4 modificadas,
largo 27.857 → 29.055 caracteres. Riesgo: el prompt "orienta, no garantiza" (regla del
proyecto desde el 17/09); un cambio de prompt debería validarse con las 23 facturas reales
del banco de pruebas antes de publicar. Operación: `setNodeParameter` sobre
`Analyze document` `/text` con el texto completo de TEST (guardar antes copia local del
prompt de producción — `5_patrones_tecnicos.md`: "el campo puede perderse del todo").

---

## 1G — Observación menor: reintentos de Drive fuera del estándar de la casa

`Eliminar Repetido` usa 2 × 2000 ms (intencional según historial de TEST v64: si no se
puede borrar, `¿Eliminó bien?` lo mueve a Procesados, así que no vale la pena esperar) y
`Buscar en Procesados (reintento)` 3 × 3000 ms; el estándar en `Upload PDF a Drive` /
`Move file` es 5 × 5000. Igual en PROD y TEST (no es error de port). Decisión de
estandarizar o dejar documentado.

---

## Orden sugerido si se aprueba todo

1. 1A y 1B (sin estos dos, publicar el borrador deja el reintento de fallidas colgable
   y los PDFs rechazados reintentándose 1 minuto con "HTTP 200").
2. 1C y 1D (coherencia del circuito de fallidas y del reset).
3. 1E / 1F solo si el estudio decide portarlos (1F con corrida del banco de pruebas antes).
4. Volver a bajar el workflow y comparar nodo por nodo contra TEST (mismo método de la
   auditoría) antes de publicar.
