# REGISTRO — cambios del 09/10/2026 (modo estricto con registro guardado y desplegable de la página)

Este archivo **corrige y complementa** a `7_registro_cambios_auditoria.md`, `3_arquitectura_recursos.md` y `2_workflow_estado.md`. Continúa en `claude/9b_pruebas_produccion_y_ajustes_2026-10-09.md`. Actualizado el 09/10/2026 (mediodía).

## Qué cambió

**1. Modo estricto "no en ARCA" ahora también con el registro guardado (n8n, nodo `Indexar Registro`)**
- Antes: `tiene_registro` valía `true` solo si el Excel de ARCA se subía en esa misma sesión. Sin Excel en la sesión, una factura que no figuraba en ARCA entraba igual al PRN (agujero encontrado en la prueba 3 del 09/10).
- Ahora: `Indexar Registro` pone `p.tiene_registro = true` también cuando el registro guardado en `REGISTRO_ESPERADO` (o el caché de ARCA) para ese cliente/período tiene filas. Entonces `Generar PRN` aplica el modo estricto: factura que no figura en ARCA → `no_en_arca` (no entra al PRN, el PDF no se mueve de Entrada) o `otro_cliente` (omitida del PRN) si el receptor parece de otro cliente.
- Código agregado, justo antes de `sd.procesos[key] = p;`: `const totalKeys = Object.keys(p.registroMap).length; if (totalKeys > 0) p.tiene_registro = true;`. En `Generar PRN` la condición es `registroTieneEntradas = (p_pto.tiene_registro === true) && Object.keys(regMap).length > 0`.
- **Reemplaza** la definición anterior de `tiene_registro` ("solo cuando el Excel se cargó en esa corrida"). Queda cerrado el pendiente "modo estricto siempre que haya registro". `3_arquitectura_recursos.md` ya tiene la definición nueva.
- Versiones: TEST `5debc5f6` (anterior `86388b33`). PRODUCCIÓN `0872aba4-21ef-45ad-8fa7-1f2edfb0fbe7` (anterior `fd4297c6`, punto de vuelta atrás). Comparado en producción contra el respaldo: solo cambió `Indexar Registro`; el código es idéntico al de TEST.
- Dato: las filas de `REGISTRO_ESPERADO` solo se crean al cargar el Excel de ARCA (camino `Webhook Registro → Comparar Registro → Preparar Filas Nuevas → Insertar Registro Nuevo`). Una factura que no está en el registro nunca queda marcada "procesada", así que nunca dispara el cartel de "ya procesada".
- Comentario viejo de `Generar PRN` ("estricto SOLO si el usuario cargó ARCA en ESTA corrida") quedó desactualizado; no se tocó (el nodo tiene 101 KB).

**2. Página (`index.html` producción; TEST con los mismos cambios)**
- Commit `6c0c713` (producción; TEST `dd96b0a`, `850bf48`, `267b419`, `91258bc`): el desplegable "En el PRN, pero no figuran en ARCA" (antes "fuera de ARCA") se muestra solo si trae facturas; aviso rojo cuando corresponde. "Omitidas del PRN — no figuran en ARCA" se oculta cuando el contador es 0. Un lote donde todas las facturas son de otro cliente ya no deja la página en "Procesando…": `_tieneContenido` cuenta `data.otro_cliente`. Se agregó `_registroEnviadoUltimo`.
- Commit `97f0036` (TEST y producción): la etiqueta de estado `no_en_arca` pasó de "fuera de ARCA" a "no figura en ARCA".
- Commits `6aa415e` (producción) / `f438c4c` (TEST) y `b5653ee` (producción) / commit equivalente de TEST: ver `claude/9b_pruebas_produccion_y_ajustes_2026-10-09.md`.

## Pruebas en TEST (Aragno Gustavo y Frank Nadia, 09/10)
- Sin Excel y con factura que figura en ARCA: entra al PRN. Con registro guardado y factura que no figura: queda afuera. Lote solo de otro cliente: la página termina sola.

## Corrida real en PRODUCCIÓN (09/10, ACTIS BEATRIZ 2026-09, 522 comprobantes en el registro, sin Excel en la sesión)
- A) 2 facturas ya procesadas (07/10) + 1 de otro cliente (Castellano): el cartel de reproceso aparece, con "Solo las nuevas" la factura ajena queda omitida ("otro cliente") y la página termina ("Proceso terminado SIN generar PRN"). OK.
- B) 1 factura de Actis de otro período, que no está en el registro de 2026-09: no entra al PRN; aparece en "Omitidas del PRN — no figuran en ARCA (1)" y en "Facturas que requieren carga manual"; el PDF queda en Entrada. OK (esto es lo que antes entraba al PRN).
- C) Reprocesar 1 factura que sí figura en ARCA (FC 3106-00036329): PRN `ACTIS_BEATRIZ_202609_20261009_142420.prn`, 1 línea de 240 caracteres, total 538007,16 = ARCA, 1 conciliada. OK.
- Residuos: ese PRN de 1 línea es de prueba (no importar; borrar desde `farmando@`). Las copias de PDF de prueba se borraron de Drive.
- Segundo cliente probado el mismo día (SUC. DE CASTELLANO): ver `claude/9b_...`.

## Pendientes menores (estado al mediodía del 09/10)
- Motivo de `otro_cliente` con "cliente ?" **desde el servidor** (`Generar PRN`, `cuitClienteRef` fuera de alcance): la página ya lo reemplaza por el CUIT elegido; el nodo no se tocó.
- "Omitidas del PRN" con Excel real de ARCA cargado en la sesión: probado en TEST solo con un Excel ficticio de 1 fila; falta con uno real.
- Limpiar en TEST los PRN/PDF de Aragno 2026-09 (ClickUp 86e3myezh) y las filas de prueba del registro de TEST.
- Borrar desde `farmando@` los dos PRN de prueba de la carpeta de PRN de producción (Actis y Castellano).
- Cambiar la clave de acceso (se usó para pruebas).
- Resueltos durante el día: texto del mensaje "Cargá el Excel de ARCA y reprocesá" (ahora dice que no figuran en ARCA y que se cargue el Excel actualizado), panel de progreso trabado en "Escaneando…" con la carpeta de entrada vacía, y rubro de AGROSINSACATE (ver `claude/9b_...`).
