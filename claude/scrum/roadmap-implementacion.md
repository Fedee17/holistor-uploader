# Implementación de Scrum en Estudio Riorda — Roadmap y decisiones

Documento vivo. Se va actualizando a medida que avanzamos fase por fase en la implementación de Scrum transversal al estudio. Última actualización: 17/09/2026 (solo la nota sobre el conector de ClickUp; el resto sigue al 25/08/2026).

## Por qué no es Scrum "de manual"

Gran parte del trabajo del estudio tiene fecha límite fija impuesta por AFIP/organismos, no por el equipo. Un sprint cerrado se rompe apenas aparece un vencimiento en medio. Se adapta el framework: se mantiene la estructura (roles, tablero, reuniones cortas, retro), pero el contenido se separa en trabajo con fecha fija (entra por prioridad, no compite por puntos) y trabajo de proyecto/mejora (se planifica sprint a sprint de forma clásica).

## Fase 0 — Diagnóstico (completada)

- Equipo total: 8 personas. 7 del lado contable/impositivo (Cynthia Lamberti, Franco, Pia, Ema, Gisella, Graciela, y una séptima persona) + 1 del lado desarrollo/automatización (el usuario que conduce esta implementación).
- **Nota de nombres**: hay dos personas llamadas Cynthia en el estudio — Cynthia Lamberti (parte de este equipo de 8) y Cynthia Molinelli (aparece en el catálogo de clientes, no es del equipo contable operativo para efectos de este proyecto). Cuando este documento dice "Cynthia" a secas, se refiere a **Lamberti**.
- **Diego (Jurídica/Financiera) y Vero (Jurídica/Gestión Automotor)**: son jefes del estudio. Por el momento no entran en el equipo operativo de 8 personas que hace el trabajo día a día, pero sí tienen un rol activo en Scrum: son el **Product Owner** (ver Fase 1) — deciden prioridades en conjunto.
- Coordinación hoy: pasa 100% por el usuario. Objetivo explícito: dejar de ser cuello de botella.
- Más de 90 clientes activos. Reparto real hoy: mixto — cada contador/a tiene su cartera fija, pero además se delegan tareas puntuales entre ellos de forma verbal/informal. Riesgo de malentendido: la delegación informal no queda registrada en ningún lado.

## Fase 1 — Estructura de equipos y roles (completada, con un cambio el 25/08)

- Un solo equipo Scrum (8 personas, un solo tablero).
- **Product Owner**: **Vero y Diego, en conjunto**. No forman parte del equipo operativo de 8 personas — su única función en Scrum es priorizar.
- **Scrum Master: sin asignar todavía, a propósito.** Se había pre-asignado a Pia en una versión anterior; el usuario pidió explícitamente sacarla (25/08) — **el equipo va a elegir a la persona en la propia reunión de lanzamiento**, no viene decidido de antemano. La presentación ya refleja esto ("Scrum Master — a definir hoy"). Sigue siendo un rol part-time, compatible con las tareas habituales de quien lo tome.
- El usuario participa como desarrollador dentro del mismo equipo, reportando como cualquier otro miembro una vez terminado el piloto.
- **Nota sobre lenguaje en materiales de cara al equipo**: por pedido explícito del usuario, no se usa la palabra "contadores" ni se clasifica al resto del equipo por puesto de trabajo en la presentación, para evitar conflicto interno.

## Fase 2 — Herramienta y tablero en ClickUp (en curso)

- **Herramienta: ClickUp** (gratis, sin límite de usuarios, tareas recurrentes nativas — se cambió de la decisión original, Asana, que solo es gratis hasta 2 usuarios).
- **Cuenta y tablero: creados por el usuario.** Workspace con un Espacio ("Espacio del equipo [ES]") y, dentro, una carpeta "Proyectos" con tres listas:
  1. **Vencimientos e Impuestos** — tareas recurrentes mensuales por cliente. **Las 390 obligaciones ya están cargadas.**
  2. **Pedidos Puntuales de Clientes** — vacía a propósito: son consultas/urgencias que se cargan sobre la marcha, no por adelantado.
  3. **Desarrollo y Automatización** — **confirmado el 25/08 (consultado en vivo vía el conector de ClickUp)**: los 12 pendientes técnicos del CSV ya están cargados (la mayoría marcados "completado"), y además el usuario ya sumó por su cuenta otras 10 tareas reales de Holistor (ej. bug de "Procesar ahora" ignorando "Forzar reprocesamiento", una consulta a soporte por códigos de Recibo C que no se leen bien en la importación, marcada urgente). Esta lista ya está en uso activo, no solo cargada una vez. Al 17/09/2026 tiene 98 tareas (74 anteriores + 24 cargadas ese día con los arreglos y pendientes de la auditoría de Holistor).
- **Columnas del tablero: configuradas por el usuario** en las tres listas: Pendiente → En curso → Esperando al cliente/tercero → En revisión → Hecho.
- Conector de ClickUp a Claude: conectado.
- **Limitación observada con el conector de ClickUp (25/08)**: la creación de tareas (`clickup_create_task`) tuvo un límite de uso bajo — se agotó dos veces después de un puñado de llamadas, con esperas de ~24 horas cada vez. Por eso la carga masiva de tareas se resolvió con **CSV + importación nativa de ClickUp**. **Actualización 17/09**: ese día se crearon 24 tareas seguidas vía el conector sin toparse con el límite, así que la carga de a decenas parece viable de nuevo; para cientos, seguir prefiriendo el CSV.
- **"Pago realizado" — formas de reflejarlo en el tablero (opciones dadas al usuario el 25/08, todavía sin decidir cuál usar):**
  1. **Campo personalizado tipo Desplegable** (recomendado): un campo "Pago realizado" en la lista "Vencimientos e Impuestos" con opciones `No aplica` / `Pendiente de pago` / `Pagado`. Se puede mostrar como columna en la vista de tabla o como etiqueta de color en la tarjeta, sin necesidad de abrir la tarea — mantiene el estado visible de un vistazo. Sirve además como filtro (ej. "mostrarme todo lo que está Pendiente de pago").
  2. **Campo personalizado tipo Casilla (Checkbox)**: más simple de crear, pero solo da dos estados (marcado / sin marcar) — no permite distinguir "no corresponde pago" de "todavía no pagó", que es una distinción real (hay vencimientos sin importe a pagar). Se puede compensar dejando la casilla vacía = no aplica, pero es menos claro para quien mira el tablero por primera vez.
  3. **Ítem dentro de un checklist de la tarjeta**: por ejemplo, un checklist "Presentado" + "Pagado" dentro de cada tarea. Mantiene el detalle a nivel tarea, pero no se ve desde la vista de lista/tablero sin entrar a cada tarjeta — rompe el principio de "ver el estado real de un vistazo" que se busca con Scrum.
  4. **Etiqueta (tag)**: por ejemplo, una etiqueta "pago-pendiente" que se agrega y saca a mano. Rápido de usar, pero las etiquetas en ClickUp son de texto libre y no fuerzan un único valor por tarea — alguien podría dejar dos etiquetas contradictorias sin que el sistema avise.
  5. **Columna extra en el tablero** (ej. separar "En revisión" en "En revisión — presentado" y "En revisión — pagado"): **no recomendado**. Mezclaría dos cosas distintas en una sola columna (el estado de avance de la tarea, y el estado del pago), y complicaría innecesariamente el tablero de 5 columnas ya definido.

  La recomendación sigue siendo la opción 1 (Desplegable) por ser la única que combina: un solo valor por tarea, visible sin abrir la tarjeta, y compatible con la definición de "Terminado" de dos caminos (ver Fase 4). El usuario todavía no la creó.
- **Pendiente**: invitar al resto del equipo (a definir quién toma el rol de Scrum Master, más Cynthia Lamberti, Gisella, Graciela, Franco) a ClickUp. Hoy el workspace solo tiene un miembro (el usuario). Sin esto, el "Responsable" de cada tarea sigue siendo solo texto en la descripción, no una asignación real de ClickUp — por esto se sacó del todo la idea de graficar "tareas por responsable" en la presentación (ver más abajo).

### Manejo de trabajo no estimable (desarrollo)

Reservar **un tercio del tiempo del desarrollador** para imprevistos de Holistor, sin comprometerlo a trabajo planeado. Etiquetas en el tablero: "Planeado" vs. "Imprevisto Holistor".

## Fase 3 — Backlog inicial (carga completada — quedan confirmaciones del usuario)

**390 obligaciones reales cargadas en ClickUp**, cubriendo 77 clientes distintos, en 24 categorías de obligación. Monotributo es la categoría más frecuente (77 de 390) porque agrupa cuatro tareas mensuales por cliente (facturación, control, VEP, recategorización).

**Categorías nuevas de obligación: confirmadas por el usuario.** Las 9 categorías agregadas (Ganancias y Bienes Personales, Monotributo, Régimen de información SICORE/SIRE/SIRCAR, Autónomos, Empleada doméstica, Régimen de combustibles, Planes de pago, Reportes a terceros, Bienes Personales DDJJ) quedan confirmadas como parte del catálogo real.

**Responsables de cartera completados automáticamente**: 21 clientes que habían quedado sin responsable se completaron cruzando con el archivo real del estudio (marcados en verde con comentario para verificar).

**Pendiente — 28 nombres de cliente sin match confiable**: quedaron en la hoja "Clientes por revisar" de `Backlog_Inicial_Estudio_Riorda_v2.xlsx`. Todavía sin confirmar por el usuario.

## Fase 4 — Ceremonias y cadencia (completada)

- **Duración del sprint: 4 semanas.**
- **Modalidad**: presencial en la oficina.
- **Calendario** (todos los lunes): Semana 1 Planificación (30-45 min, con Vero y Diego) → Semanas 2 y 3 Chequeo corto (15-20 min, sin ellos, + pregunta de mejora continua) → Semana 4 Revisión + Retrospectiva + Planificación del siguiente ciclo.
- **Qué se hace en cada tipo de reunión** (agregado a la presentación el 25/08, slide nueva):
  - *Planificación* (Semana 1): se repasa qué venció o vence en las próximas 4 semanas, Vero y Diego marcan prioridad, cada uno toma sus tareas, se arma el plan del ciclo.
  - *Chequeo corto* (Semanas 2 y 3): cada uno cuenta en una frase cómo viene, se avisa si algo se trabó, se resuelve o deriva ahí mismo, y se cierra con la pregunta rápida de mejora continua.
  - *Revisión + Retro + Planificación* (Semana 4): se mira el tablero completo (qué quedó realmente terminado), retro de qué funcionó y qué ajustar, y se arranca ahí mismo la planificación del ciclo siguiente.
- **Definición de "Terminado"** para vencimientos: sin importe a pagar → terminado al presentar; con importe a pagar → terminado recién cuando se confirma el pago (ver Fase 2 para las opciones de cómo reflejarlo en ClickUp).

## Presentación para el jefe y el equipo

`Scrum_Estudio_Riorda.pptx` — 22 diapositivas. Ronda de correcciones del 25/08:

- Se sacó a Pia como Scrum Master pre-asignado ("Scrum Master — a definir hoy": lo elige el equipo en la reunión).
- Se corrigió la diapositiva de categorías de obligación: antes decía "qué tipo de tarea pesa más hoy" sin explicar nada; ahora se llama "Qué categorías de obligación son las más frecuentes", con texto que explica qué mide cada barra y por qué Monotributo domina.
- Se eliminó por completo la diapositiva que mostraba tareas cargadas por responsable — no correspondía mostrarla porque las tareas todavía no están asignadas de verdad a cada persona en ClickUp (siguen como texto en la descripción, ver Fase 2).
- Se agregó una diapositiva nueva explicando en concreto qué se hace en cada una de las tres reuniones semanales (ver Fase 4).
- Validada (`validate.py` sin errores) y revisada visualmente diapositiva por diapositiva después del cambio.

**Objetivo y duración**: mostrar el modelo para poder implementarlo, 20-30 minutos.

## Fase 5 — Sprint piloto (pendiente, no arrancó)

## Fase 6 — Rollout completo y mejora continua (pendiente)

---

## PENDIENTES REALES A HOY (25/08/2026)

1. Elegir en la reunión quién toma el rol de Scrum Master (ya no viene pre-asignado).
2. Invitar al resto del equipo a ClickUp (Scrum Master elegido, Cynthia Lamberti, Gisella, Graciela, Franco). Hoy el workspace solo tiene un miembro (el usuario).
3. Una vez invitado el equipo, convertir el "Responsable" de texto en la descripción a asignación real de ClickUp en las tareas ya cargadas.
4. Confirmar los 28 nombres de cliente dudosos en la hoja "Clientes por revisar" del Excel.
5. Decidir y crear la forma de reflejar "Pago realizado" en ClickUp — recomendado: Campo personalizado tipo Desplegable (ver Fase 2 para las 5 opciones evaluadas con sus tradeoffs). No creado todavía.
6. Arrancar la Fase 5 (sprint piloto) una vez resuelto lo anterior.

## Nota operativa — límite de uso del conector de ClickUp

La creación de tareas (`clickup_create_task`) tuvo un límite de uso bajo el 25/08 (se agotó dos veces con esperas de ~24 horas). El 17/09 se crearon 24 tareas seguidas sin problema. Para cargas de cientos de tareas, preferir el patrón CSV + importación nativa de ClickUp; para decenas, el conector alcanza. Las lecturas (filtrar/consultar tareas) no mostraron límite hasta ahora.
