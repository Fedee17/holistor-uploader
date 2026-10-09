# Diseño — estado de la corrida fuera de la memoria de n8n (hallazgos 2 y 3 del 24/09)

Fecha: 09/10/2026. Autor: Claude Code (trabajo autónomo). Tarea ClickUp: 86e3myeyw. Estado: **propuesta implementada primero en TEST** (ver `10_avance_autonomo.md` para la evidencia).

## El problema, con el código real en la mano

- `$getWorkflowStaticData('global')` es una **copia por ejecución**: cada ejecución arranca con lo guardado, trabaja sobre su copia y al terminar guarda la copia **entera** (probado el 24/09, ejecuciones 29622/29623 y corridas A/B).
- **Hallazgo 3 (la página no ve el avance)**: `Preparar Respuesta Estado` lee solo `sd.procesos[key]`. Mientras la corrida está viva, lo guardado es lo de la corrida anterior (`procesando:false` + `ultimo_resultado`), así que responde ese resultado viejo con `desde_cache:true` (línea 75-77 del nodo) y la página lo ignora (`index-test.html` l.1808). El `progreso` que arma `Acumular PRN` (`p.facturas_procesadas`, función `recalcProgreso`) nunca llega a la página hasta que la ejecución termina.
- **Hallazgo 2 (dos clientes se pisan)**: la corrida A (cliente 1) termina después que la B (cliente 2) y guarda su copia de `sd`, que no tiene (o tiene vieja) la clave de B. La página de B pasa a recibir `{listo:false, procesando:false}` (nodo, línea 7-9) y queda en "Demorado", aunque el PRN de B está en Drive y las hojas se actualizaron.

## Tres opciones comparadas

| | (a) pestaña nueva `PROCESOS` con todo el estado | (b) Data Table de n8n | (c) **elegida**: progreso + resultado final en la fila existente de `PROCESOS_ACTIVOS` |
|---|---|---|---|
| Qué guarda | Todo `sd.procesos[key]` (registroMap incluido) por fila | Ídem, en tabla interna de n8n | Solo lo que la página necesita: `hechos`, `total`, `fase`, `actualizado_en`, `progreso_run_id`, `resultado_json` (el mismo objeto que hoy devuelve `listo:true`) |
| Nodos a tocar | ~15 (todos los que escriben `sd.procesos`) | ~15 | 5 nuevos + 1 modificado (`Preparar Respuesta Estado`) |
| Costo por factura | 1 escritura grande (registroMap de cientos de filas → lento y cerca del límite de 50.000 caracteres por celda) | 1 escritura | 1 escritura chica (~1 s; `Guardar Linea PRN (Hot)` ya cuesta 1,8 s) |
| Riesgo | Alto: reescribe el corazón del workflow (101 KB de `Generar PRN` leen `sd`) | Alto + sin experiencia previa en el proyecto (la instancia no tiene ninguna Data Table creada, comprobado el 09/10) | Bajo: `sd` sigue siendo la fuente para el procesamiento; la hoja es la fuente **para la página** |
| Visibilidad para el estudio | Sí (planilla) | No (solo desde n8n) | Sí (misma pestaña que el candado) |
| Cubre hallazgo 3 | Sí | Sí | Sí: `Estado` lee la fila viva y devuelve `procesando:true` + `progreso` real |
| Cubre hallazgo 2 | Sí | Sí | Sí para la página: el resultado final queda en la fila con su `run_id`; si `sd` lo perdió, `Estado` lo devuelve desde la hoja. **No** evita que `sd` de A pise el de B (eso solo afecta a lo que ya terminó, y la página ya no lo necesita) |

Por qué (c): usa la pieza que ya funciona en tiempo real (`PROCESOS_ACTIVOS`, 4 filas en TEST, ~10 en producción; `appendOrUpdate` por `process_key` ya lo usan 3 nodos), no toca el bucle de lectura ni `Generar PRN`, y se puede volver atrás quitando 5 nodos.

## Cambios en el workflow (TEST primero)

1. **`Preparar Progreso`** (Code) entre `Acumular PRN` y `¿Tiene Linea PRN?`: arma `{process_key, progreso_run_id, hechos: p.facturas_procesadas, total: p.facturas_total, fase, actualizado_en}` leyendo `sd.procesos[key]` (ya actualizado por `Acumular PRN` en la misma ejecución). Un ítem por ítem.
2. **`Actualizar Progreso`** (Google Sheets `appendOrUpdate`, `autoMapInputData`, `matchingColumns: process_key`, `cellFormat RAW`, 2 reintentos × 2 s, `onError: continueRegularOutput`): escribe esas 6 columnas en la fila del candado. Las columnas nuevas se crean solas (`handlingExtraData: insertInNewColumn`); no hay que tocar la planilla a mano.
3. **`Restaurar Ítem Acumulado`** (Code): devuelve `$('Acumular PRN').all()` (json + binario) para que `¿Tiene Linea PRN?` siga leyendo `$json._tiene_linea` como hoy.
4. **`Leer PROCESOS_ACTIVOS (Estado)`** (Sheets read, `alwaysOutputData`, 2 × 1 s, `continueRegularOutput`) entre `Webhook Estado` y `Preparar Respuesta Estado`.
5. **`Preparar Respuesta Estado`** (modificado): la consulta se toma de `$('Webhook Estado')`; con la fila de la hoja:
   - fila `procesando` de menos de 45 min y (`sd` sin proceso, o `procesando !== true`, o `run_id` distinto) → `{listo:false, procesando:true, run_id, progreso:{procesadas, total}, fase, desde_hoja:true}` (**hallazgo 3**);
   - fila `listo`/`liberado` con `resultado_json` cuyo `run_id` coincide, y `sd` sin ese resultado (clave perdida o de otra corrida) → el resultado guardado, con `desde_hoja:true` y sin `desde_cache` (**hallazgo 2**);
   - en cualquier otro caso, la lógica actual sin cambios (incluido el read-and-reset).
6. **`Preparar Resultado Hoja`** (Code) + **`Guardar Resultado Hoja`** (Sheets `appendOrUpdate`, autoMap) después de `Liberar PROCESO_ACTIVO`: guardan `resultado_json` (el mismo objeto que `Preparar Respuesta Estado` arma al primer `listo:true`, con `run_id`), recortado si supera 45.000 caracteres (primero se saca `conciliacion.registro_no_procesadas`, después `resultados_por_pdf`; queda `resultado_recortado:true`).

Lo que NO cambia: `Resetear Estado`, `Registrar PROCESO_ACTIVO`, `Liberar PROCESO_ACTIVO`, `Generar PRN`, `Acumular PRN`, la página.

## Prueba prevista en TEST
1. Un cliente, 2-3 PDF copiados a Entrada de TEST: sondear `holistor-estado-test` cada 5 s durante la corrida → tiene que devolver `procesando:true` y `progreso.procesadas` subiendo (hoy devuelve el resultado anterior con `desde_cache`).
2. Dos clientes a la vez (`execute_workflow` ×2 con PDF de dos clientes): al terminar la corrida que termine última, `holistor-estado-test` del otro cliente tiene que devolver su resultado (`listo:true`, `run_id` correcto, `desde_hoja:true`), no `{listo:false, procesando:false}`.
3. Vuelta atrás: versión anterior de TEST `5debc5f6`.
