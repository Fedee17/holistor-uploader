# Avance del trabajo autónomo — Holistor PRN Generator (Estudio Riorda)

Archivo de avance. Lo escribe Claude Code en cada paso. Estados posibles de cada tarea:
`pendiente` · `en curso` · `hecha` · `bloqueada-esperando-al-usuario`.
Regla: nada se marca `hecha` sin evidencia real anotada acá (id de ejecución, versión de n8n, commit, filas de la hoja).

Última actualización: 2026-10-09 (tarde) — arranque.

## Cómo retomar si se corta la sesión
Frase exacta: "Retomá el trabajo autónomo de Holistor: leé claude/10_avance_autonomo.md y seguí desde la primera tarea que no esté hecha, aplicando la sección 1 del brief (leer 2_, 3_, 5_, 9_ y 9b_ primero)".

## Dónde están las cosas
- Documentos del Proyecto (copia del zip del 09/10): carpeta `claude/` de este repo. Fuente de verdad del estudio: el Proyecto de Claude.ai; copiar allá lo que se cambie acá.
- Respaldos de n8n "antes de tocar": `scratchpad/n8n-backups/` de la sesión (no van al repo por tamaño e IDs); también quedan las versiones en el historial de n8n (punto de vuelta atrás anotado en cada tarea).
- PRODUCCIÓN n8n `r9H4ufyAu1ndyFN5` — versión activa al arrancar: `0872aba4` (09/10 13:59 UTC). TEST `eXg4n80ds0N6rWlD` — `5debc5f6` (09/10 13:40 UTC).
- Repo `Fedee17/holistor-uploader`, `main` al arrancar: `b5653ee`.

## Tareas

| # | Tarea | Estado | Último paso | Siguiente paso | Evidencia |
|---|---|---|---|---|---|
| 1 | Documentos del Proyecto al día (09/10) | hecha | Verificado por grep y contra el workflow bajado: los seis docs ya tenían INP, b5653ee e Indexar Registro 0872aba4 | — | Commit de este paso; `Indexar Registro` l.105-111 idéntico PROD/TEST; nota en 2_ y 7_; `pendiente-publicar…` l.46 marcada como superada |
| 2 | Hallazgos 2 y 3 del 24/09 (ClickUp 86e3myeyw) | pendiente | ClickUp confirmado: coincide con el informe | Diseño comparado (3 opciones) → TEST → prueba con 2 clientes y sondeo | — |
| 3 | "cliente ?" en Generar PRN | pendiente | Origen localizado: `_cuitRefGuard` cae en '?' sin cuitClienteRef/cuitClienteArchivo | Cambio mínimo en TEST + corrida real | — |
| 4 | Carrera del candado (H-04) | pendiente | — | Tarea ClickUp + alternativa liviana | — |
| 5 | Separadores del prompt PROD = TEST | pendiente | Diff conocido: líneas 379 y 440 del prompt | Alinear con objeto completo | — |
| 6 | ClickUp 86e3n0qjn / 86e3myf0r / 86e3myezh | pendiente | — | Análisis con datos reales | — |
| 7 | Pruebas con datos reales (flete, centavos, Omitidas) | pendiente | — | Buscar material | — |
| 8 | Limpieza final (PR #2, ejecuciones, borradores) | pendiente | — | — | — |

## Registro de pasos (más nuevo arriba)
- 2026-10-09 tarde — Paso 0: carpeta `claude/` creada con los 11 documentos del zip; este archivo creado. Respaldos de PROD y TEST bajados (ver "Dónde están las cosas").

## PREGUNTAS PARA FEDERICO
(ninguna todavía)

## ACCIONES QUE TIENE QUE HACER FEDERICO
- Borrar desde `farmando@` los dos PRN de prueba de la carpeta de PRN de producción: `ACTIS_BEATRIZ_202609_20261009_142420.prn` y `SUC_DE_CASTELLANO_202608_20261009_145021.prn` (pendiente desde el 09/10, ya documentado en 9b_).
- Cambiar la clave de acceso (se usó para pruebas).
- Decidir el PR #2 (obsoleto): recomendación de Claude Code = cerrar sin merge.
