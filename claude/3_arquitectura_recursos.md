# ARQUITECTURA Y RECURSOS — HOLISTOR PRN GENERATOR

## Arquitectura del sistema

| Componente | Tecnología | Detalle |
|---|---|---|
| Frontend | HTML + JS estático | GitHub Pages: `https://fedee17.github.io/holistor-uploader/` (repositorio `Fedee17/holistor-uploader`, hoy público — pendiente pasarlo a privado) |
| Backend | n8n Cloud | `https://fede123.app.n8n.cloud` — workflow `r9H4ufyAu1ndyFN5`, versión publicada `0872aba4` (09/10/2026; anteriores `fd4297c6`, `c7fef1b4`, `7ab9d651`), 152 nodos, `executionTimeout` 2400 s (máximo de la instancia) |
| IA | Google Gemini | Extracción de datos de PDFs vía API — modelo `gemini-2.5-flash` para la lectura completa, `gemini-2.5-flash-lite` para la lectura liviana |
| Almacenamiento | Google Drive + Sheets | Carpetas y spreadsheets fijos |
| Contabilidad | Holistor IVA Registración | Importa archivos `.prn` de ancho fijo |

## Recursos fijos — IDs y rutas

**Google Drive:**
- Carpeta entrada PDFs: `1OMpYkZOwbWNS5-HN6drA49IdjAec9taM`
- Carpeta procesados: `1xpANQS9b_somOKnTLqRatnK11QJGbf0x`
- Carpeta PRN generados: `13AYcXdOvrPJJUwa-yEM0tEjnp7gCT73O`
- Carpeta raíz Riorda Proceso: `10wXbM6fK7T1Ksg3oaIeKHc9rlMPGrcAc`

Dueño de los archivos: quien los sube (la cuenta `farmando@` sube desde la página; el conector de Drive de `driorda@` puede copiar esos archivos pero no moverlos — "The caller does not have permission"). Los PRN generados también pertenecen a `farmando@`: `driorda@` no puede borrarlos (los PRN de prueba hay que borrarlos desde `farmando@`). `driorda@` sí puede copiar y mandar a la papelera los archivos que él mismo creó (por ejemplo, copias de PDF para pruebas).

**Google Sheets** (spreadsheet único `15-YOBXv0Sinrdr0SUZvaY_rBTHb8CVoKRxftX7uwCUU`, siete hojas):
- `CLIENTES` — catálogo de clientes del estudio. Tiene un CUIT cargado dos veces (20224230649) — pendiente dejar uno.
- `REGISTRO_ESPERADO` — comprobantes esperados según ARCA, por cliente/período. Columnas (17, en orden): `periodo, cliente_cuit, clave, cuit_emisor, tipo_cod, pto_vta, numero_hasta, total, denominacion_emisor, fecha, estado, procesada_en, motivo_fallo, tipo_cambio, moneda, desglose_alicuotas, huella_sha256`
  - **Es solo-agregar**: recargar el Excel de un período ya cargado inserta filas nuevas y deja las viejas (decisión del 17/09). `Indexar Registro` une los duplicados por clave (procesada > fallida > pendiente) y conserva el desglose entre ellos. FRANK NADIA agosto 2026 tiene 464 filas para 229 comprobantes.
  - **`desglose_alicuotas` (desde 17/09/2026)**: guarda el desglose completo de importes de ARCA por comprobante, como JSON: `{"alicuotas":[{"alic":"21","neto":41037.33,"iva":8617.84}, …],"neto_total":…,"no_gravado":…,"exento":…,"otros_tributos":…,"total_iva":…,"total":…}`. Lo arma la página desde el Excel de Mis Comprobantes (campo `desglose_arca` en el body de `holistor-registro`); en n8n los nodos lo normalizan al nombre interno `desglose_arca` (`Comparar Registro`, `Preparar Filas Nuevas`, `Indexar Registro`) y `Generar PRN` lo usa para cruzar lo extraído por Gemini. Filas cargadas antes de esa fecha lo tienen vacío: para que un período viejo tenga desglose hay que volver a subir su Excel. Es `''` cuando ARCA no informa detalle (facturas B/C, comprobantes solo con total).
  - `total` tiene cuatro representaciones históricas (texto con punto, texto con `$` y coma de miles, número, y **48 filas guardadas como fecha** por el formato automático de Google). Desde el 16/09 todos los appends escriben en crudo (`cellFormat: RAW`), así que no aparecen filas nuevas mal; las 48 viejas están pendientes de corregir a mano.
- `PROVEEDORES` — maestro de proveedores curado a mano. Columnas (encabezado de producción verificado el 30/09/2026): `cuit, denominacion, pcia_pr, cod_neto, cond_fisc, cod_ngex_override, forzar_rubro`. `forzar_rubro` = `SI` hace que el `cod_neto` cargado mande siempre sobre lo que lea Gemini (ver `4_especificacion_holistor_prn.md`); `cod_ngex_override` es por proveedor.
- `PROVEEDORES_PENDIENTES` — cola de auditoría de proveedores nuevos detectados. Columnas: `fecha_detectado, cuit, denominacion, pcia_pr, cod_neto, cond_fisc, cod_ngex_override, cliente_cuit, periodo, origen, estado, sync_solicitado_en, queue_key`. **Los encabezados reales tienen un espacio al final** (`"cuit "`, `"estado "`, …); el append mapea por nombre exacto — pendiente corregirlos.
- `FALLOS` — facturas que no pudieron procesarse, con motivo. Columnas: `periodo, cliente_cuit, pdf_nombre, motivo, fecha_detectado, estado`
- `PRN_LINEAS` — una fila por factura con su línea del PRN (`Guardar Linea PRN (Hot)` escribe durante el bucle; `Cargar PRN_LINEAS Proceso` la lee entera al arrancar). **Sí tiene uso**: rubro heredado para ND/NC que referencian una factura anterior. Ver la especificación del PRN.
- `PROCESOS_ACTIVOS` (desde el 01/10/2026) — candado compartido entre sesiones: una fila por cliente+período. Columnas: `process_key` (`CUIT|AAAA-MM`), `run_id`, `cliente_nombre`, `iniciado_en` (ISO, UTC), `estado` (`procesando` / `listo` / `liberado`), `tipo` (`escaneo` / `real`). La escriben `Registrar PROCESO_ACTIVO` (al aceptar un pedido), `Liberar PROCESO_ACTIVO` (al cerrar) y `Liberar PROCESO_ACTIVO (Reset)` (botón "Liberar proceso"); la leen `Resetear Estado` y `Evaluar Candado`. Una fila `procesando` de menos de 45 minutos bloquea otro pedido del mismo cliente/período. Existe en la planilla de producción y en la de TEST, con la misma estructura. Una fila vieja en `procesando` (corrida cortada) deja de bloquear sola a los 45 minutos; mientras tanto se libera con "Liberar proceso" o editando el `estado` a mano. Detalle y límites en `2_workflow_estado.md`.

Spreadsheet legacy separado (PRN/Holistor viejo): `1XLaoaZBgRbuT490gFP2yVxh3Bn3vVSVrJN0ahwyQSEo` — no confundir con el activo.

**Ambiente de PRUEBA (desde el 21/09/2026) — separado por completo de producción:**
- Flujos n8n: `Holistor PRN Generator - TEST` (ID `eXg4n80ds0N6rWlD`, copia del v51) y `Holistor PRN Consolidar - TEST` (ID `aDXJv3zqw7pkIHEs`). Webhooks con sufijo `-test`: `holistor-upload-test`, `holistor-procesar-test-v51` (no `holistor-procesar-test`: ese path ya lo usa el prototipo `Holistor Padre - TEST Etapa 2` y n8n no deja publicar dos webhooks con el mismo path+método), `holistor-verificar-test`, `holistor-estado-test`, `holistor-clientes-test`, `holistor-registro-test`, `holistor-reset-test`, `holistor-sync-proveedores-pendientes-test`, `holistor-proveedores-test`, `holistor-auditoria-test`, `holistor-prn-consolidar-test`. Misma clave `Holistor Token` y mismo origen permitido.
- Planilla: copia `TEST — Holistor Datos (planilla)`, ID `1A59nWiE_NwsC_PlC01Qp88DQ_UJsTa6uQLgq_WjdAE0` (mismos gid de pestañas que la original — confirmado con una corrida real; REGISTRO_ESPERADO = gid `1626651838`). Es una foto del 21/09 15:14 UTC: lo que se procese en producción después no está acá y viceversa.
- Drive: carpeta `TEST — Holistor` (`1Wj81Lo5RCXfzYnDAd-_LkuSiAOQSBh4x`) dentro de "Riorda Proceso": `Entrada` `1k6RnkHSoJtlfqG5f93gHwBVbV4ibdTyr` · `Procesados` `1PAWTMriFEu_V5mzFsLnMbynIfFEf3ogk` · `PRN generados` `1xE8r0Rb5Adw-t4HdidiNu_ya-cG520Pe`.
- Página: `test.html` en el mismo repositorio `Fedee17/holistor-uploader` (cartel rojo "Ambiente de PRUEBA", título `[TEST]`, claves de sessionStorage `holistor_token_v1_test` / `holistor_clientes_v3_test` / `holistor_proveedores_v3_test` para no mezclar con la página real en la misma pestaña). Se deriva de `index.html` cambiando solo título, cartel, webhooks y claves.
- Regla de trabajo: todo cambio se aplica y prueba primero acá con un cliente real; a producción pasa recién después, con respaldo previo del flujo real.
- Estado al 09/10/2026 (ver detalle en `2_workflow_estado.md` y `claude/9_` / `claude/9b_`): TEST y producción tienen los mismos 152 nodos y los mismos parámetros salvo los IDs propios de cada ambiente (comprobado el 08/10; única diferencia de contenido: dos separadores decorativos del prompt de Gemini, cosmético). Versión activa de TEST: `5debc5f6` (anterior `86388b33`). Webhook de TEST para el candado: `holistor-candado-test`. Páginas de prueba: `index-test.html` (la anterior `test.html` quedó reemplazada). Carpeta de Entrada de TEST: `1k6RnkHSoJtlfqG5f93gHwBVbV4ibdTyr`; `1PAWTMriFEu_V5mzFsLnMbynIfFEf3ogk` es la de **Procesados** (no confundirlas al copiar PDF de prueba).

**Vigilante del flujo de producción (desde el 22/09/2026):** workflow `Holistor - Vigilante del flujo de producción` (ID `il3NDjTi8CA4UD9s`, publicado). Cada 5 minutos consulta por la API de n8n si `r9H4ufyAu1ndyFN5` está publicado; si está apagado lo vuelve a publicar (última versión guardada) y avisa por email a `driorda@riordayasociados.com.ar`; si no puede consultar, avisa. Nodos: `Cada 5 minutos → Consultar estado del flujo (n8n API, get) → Interpretar estado (Code) → Esta apagado? → [sí] Volver a publicar (n8n API, activate) → Avisar: estaba apagado (Gmail) · [no] No se pudo consultar? → [sí] Avisar: no pude consultar (Gmail)`. Credenciales: `n8n API Riorda` (ID `jVWxlui37XfC1rJX`, tipo n8nApi, base URL `https://fede123.app.n8n.cloud/api/v1`) y `Gmail Riorda` (ID `vDecoDbQoIz8ppJu`, gmailOAuth2). Para probarlo sin tocar producción: apuntar temporalmente los dos nodos n8n al flujo de prueba, despublicarlo, ejecutar a mano, y volver a apuntar (hecho el 22/09; funcionó).

**Excel "Mis Comprobantes Recibidos" de ARCA** (lo que la página lee): 30 columnas, encabezados en la fila 2, datos desde la fila 3. Índices 0-based: 0 Fecha · 1 Tipo (`"1 - Factura A"`) · 2 Punto de Venta · 3 Número Desde · 4 Número Hasta · 5 Cód. Autorización · 6 Tipo Doc. Emisor · 7 Nro. Doc. Emisor · 8 Denominación Emisor · 9 Tipo Doc. Receptor · 10 Nro. Doc. Receptor · 11 Tipo Cambio · 12 Moneda · 13 Neto Grav. IVA 0% · 14 IVA 2,5% · 15 Neto Grav. IVA 2,5% · 16 IVA 5% · 17 Neto Grav. IVA 5% · 18 IVA 10,5% · 19 Neto Grav. IVA 10,5% · 20 IVA 21% · 21 Neto Grav. IVA 21% · 22 IVA 27% · 23 Neto Grav. IVA 27% · 24 Neto Gravado Total · 25 Neto No Gravado · 26 Op. Exentas · 27 Otros Tributos · 28 Total IVA · 29 Imp. Total. Verificado con un archivo real el 17/09/2026. ARCA calcula el neto a partir del IVA, por eso difiere del PDF en 1-2 centavos; "Otros Tributos" es la suma de percepciones sin discriminar código.

**Webhooks n8n (11, verificados en la versión publicada; el 11.º es el de candado, 01/10/2026):**
`holistor-upload` (POST) · `holistor-procesar` (POST; acepta `forzar` y `soloEscanear`) · `holistor-verificar` (POST; desde el 22/09 acepta `huellas: [...]` —todas las firmas en una llamada, máximo 500— y responde `resultados: { firma: {existe, clave, emisor, total, procesada_en} }`; el formato viejo `huella` sigue aceptado y responde además los campos sueltos al tope) · `holistor-estado` (GET) · `holistor-clientes` (GET) · `holistor-registro` (POST) · `holistor-reset` (POST; libera procesos zombie — desde el 08/10 **sin `cliente_cuit` o sin `periodo` responde `ok:false` y no toca nada**; con ambos libera solo ese proceso) · `holistor-sync-proveedores-pendientes` (POST) · `holistor-proveedores` (GET; en una nota anterior figuraba como `-lista`, el nombre real es este) · `holistor-auditoria` (POST)
`holistor-candado` (GET, desde el 01/10/2026; parámetros `cliente_cuit` y `periodo` en formato `AAAA-MM`): lee `PROCESOS_ACTIVOS` y responde `{ok, bloqueado, mensaje, segundos, tipo, run_id, iniciado_en, estado_fila}`. La página lo llama antes de subir PDFs. En TEST: `holistor-candado-test`. Mismo encabezado `X-Holistor-Token` y mismo origen permitido que el resto.

**Workflow aparte — `Holistor PRN Consolidar` (ID `AUG4DhSPrRGixwMl`, publicado 21/09/2026):** webhook `holistor-prn-consolidar` (POST, misma clave `Holistor Token`, mismo origen permitido). Recibe `{ cliente_cuit, cliente_nombre, periodo: 'AAAA-MM', prn_file_ids: [ids de Drive de los PRN por tanda] }` (máximo 20), baja cada PRN de Drive, comprueba que toda línea mida 240, las une con CRLF en latin-1 en el orden recibido y guarda `CLIENTE_PERIODO_FECHA_CONSOLIDADO.prn` en la carpeta de PRN. Responde `{ ok, prn_file_id, prn_file_name, lineas, archivos_unidos, detalle, avisos, mensaje }`; ante cualquier archivo que falle o una línea que no mida 240 responde `ok:false` con motivo y no guarda nada. Nodos: `Webhook Consolidar → Preparar Consolidado → ¿Pedido válido? → Bajar PRN Tanda → PRN a Base64 → Unir PRN → ¿Consolidado OK? → Guardar Consolidado en Drive → Responder Consolidado` (+ `Responder Error Consolidar`). Lo llama la página al terminar la última tanda cuando hubo 2 o más PRN.

Todos con Header Auth (credencial `Holistor Token`, encabezado `X-Holistor-Token`) y `Allowed Origins` = `https://fedee17.github.io` desde el 16/09/2026. Sin encabezado → 403. La clave no está en el repositorio ni en el chat; la página la pide una vez por sesión y la guarda en `sessionStorage` (`holistor_token_v1`).

**Google Drive credencial**: ID `TbgO6CY61dSlSX0Y` ("Google Drive account 3") — OAuth con acceso a "Mi unidad" completa (pendiente: cuenta de servicio limitada a las carpetas del sistema).
**Gemini credencial**: `fC6vP2oIvaSg54ib` ("Api Riorda Cristian") — pendiente confirmar que la clave está en nivel pago.
**Credencial vieja `Header Auth account`** (`x-goog-api-key`, Google): no se usa para los webhooks y no hay que tocarla.

---

## Stack tecnológico

**Lenguajes:** Python · JavaScript · TypeScript · Go · SQL · Bash
**Frameworks:** React · Next.js · FastAPI · Django · Node.js · Docker · PostgreSQL · Supabase · n8n · GitHub Pages
**IA y automatización:** Google Gemini API · n8n workflows · extracción y procesamiento de documentos · integración de APIs · Google Drive API · Google Sheets API

---

## STATICDATA SCOPING (crítico para concurrencia)

Cada proceso está scopeado por `cliente_cuit|periodo` en `sd.procesos[processKey]`. Nunca usar `staticData.X` directamente — siempre acceder vía `const p = getProceso(sd)` que retorna el objeto del proceso actual. Esto soporta múltiples usuarios simultáneos.

```javascript
function getProceso(sd) {
  if (!sd.procesos) sd.procesos = {};
  const key = __processKey();
  if (!key || !sd.procesos[key]) {
    return { /* objeto vacío como fallback */ };
  }
  return sd.procesos[key];
}
```

**`__processKey()` centralizada**: una sola línea en cada nodo que la necesita — `function __processKey() { return String($('Resetear Estado').first().json.processKey || ''); }` — en vez de recalcularla. El dato real se calcula una sola vez, en `Resetear Estado` (campo `processKey` de su salida).

`getProceso` tiene 3 copias (no consolidado todavía) — menor prioridad porque necesita `sd` como parámetro, que cada nodo obtiene de forma independiente.

`staticData` **crece sin límite**: `sd.procesos` guarda `registroMap`, `resultados_por_pdf` y `ultimo_resultado` de cada cliente/período desde mayo, y `_registroArcaCacheByKey` guarda el Excel de ARCA entero por cliente/período. n8n serializa todo eso en cada ejecución que lo toca (incluidos los sondeos de estado). Pendiente en ClickUp: limpiar períodos viejos en `Resetear Estado`.

⚠️ **Riesgo operativo confirmado repetidas veces**: un guardado manual desde la UI de n8n, hecho desde una pestaña que tenía cargada una versión vieja del workflow, puede pisar cambios ya aplicados por API (pasó con el fix de USD, que hubo que reaplicar el 16/09). Antes de aplicar cambios grandes por API, confirmar que no hay ninguna pestaña del editor de n8n abierta con una versión desactualizada, y después de aplicar, bajar el nodo y comparar byte a byte.

### Campos clave dentro de `sd.procesos[key]` (referencia rápida)

- `forzar` — si `true`, saltea la comparación contra corridas anteriores (huella y clave). Nunca debe saltear la comparación dentro del mismo lote.
- `soloEscanear` — si `true`, ninguna factura llega a la lectura completa; todo se clasifica y se corta ahí.
- `registroMap` — mapa de claves ya procesadas históricamente, leído de `REGISTRO_ESPERADO` al arrancar el proceso. Cada entrada trae `row_number` y, si existe, `desglose_arca` (JSON del desglose ARCA, ver arriba).
- `tiene_registro` — `true` cuando hay registro de ARCA para el cliente/período: lo pone `Resetear Estado` si el Excel se subió en esa misma sesión, y desde el 09/10 también `Indexar Registro` cuando el `registroMap` (hoja `REGISTRO_ESPERADO` y/o caché de ARCA) tiene filas. Es lo que activa el modo estricto: una factura que no figura en el registro queda `no_en_arca` (error, el PDF no se mueve de Entrada) o `otro_cliente` (omitida del PRN) si el receptor parece de otro cliente. **Reemplaza** la definición anterior ("solo con Excel cargado en la corrida"). Dato: las filas de `REGISTRO_ESPERADO` solo se crean al cargar el Excel, así que una factura que no está en el registro nunca queda `procesada`.
- `prn_guardado` — `true` solo cuando `Confirmar PRN Guardado` verificó el archivo en Drive. Desde el 16/09 es condición para marcar `procesada` en la hoja.
- `clavesVistasEnEsteRun` — array de claves ya vistas dentro de la corrida actual (protección "mismo lote", nunca se saltea con forzar).
- `huellasVistasEnEsteRun` — mismo concepto pero por huella de archivo, calculado por `Calcular Huella PDF`.
- `ya_procesadas` / `ya_procesadas_pendientes` — facturas detectadas como ya hechas en una corrida anterior.
- `duplicados_en_lote` / `duplicados_en_lote_pendientes` — facturas detectadas como duplicadas dentro del mismo lote actual.
- `nuevas_en_escaneo` / `nuevas_en_escaneo_pendientes` — facturas genuinamente nuevas detectadas durante un escaneo (`soloEscanear: true`), sin haber pasado por la lectura completa.
- `lineas_finales_generadas` — cantidad de renglones de texto en el `.prn` final (una factura con doble alícuota cuenta 2).
- `facturas_finales_generadas` — cantidad de facturas distintas conciliadas (la cifra que hay que mostrarle al usuario, no la de arriba).
- `advertencias` — avisos de la corrida. Desde 17/09/2026 incluye `Corregido con desglose ARCA (...)` (qué importe se reemplazó y por cuál), `Aviso desglose ARCA (...)` (percepciones que no coinciden con "Otros Tributos"; no se corrigen) y `Total corregido con ARCA`. También aparece el ruido `[v45] esperando resultados_por_pdf`, que no indica problema (pendiente limpiarlo).
