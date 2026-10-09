# ESPECIFICACIÓN DEL FORMATO .PRN — HOLISTOR

## Reglas generales (críticas)

- Archivo texto de ancho fijo, líneas **exactamente 240 caracteres**, terminadas en CRLF (la última línea del archivo no lleva CRLF final y Holistor la acepta: verificado el 30/09/2026, la vista previa de importación mostró las 10 líneas). El header también 240 chars.
- **El archivo `.prn` NUNCA lleva una línea de encabezado con nombres de columna** — Holistor solo acepta líneas de datos.
- Encoding latin-1/cp1252.
- `NUNCA` usar `trimEnd()` — corta los espacios de relleno. Usar `.substring(0, 240).padEnd(240)`.
- La parte entera de los importes va sin separadores de miles, decimales con coma: `1234567,89`.
- Cód. NG/EX: exactamente `"NGC"` (no gravado/impuesto interno) o `"EXC"` (exento).
- PDFs prefijados con CUIT: `{cuit}__{nombre_original}.pdf` (evita mezcla entre clientes).
- **Punto de venta (`pto_vta`) siempre a 5 dígitos con ceros a la izquierda** (ej. `01138`, no `1138`).

## Posiciones de campos (1-indexed)

`fecha_em` 1-10 · `fecha_rec` 12-21 · `cpbte` 23-24 · `tipo` 28 · `pto_vta` 32-36 · `numero` 37-44 · `denominacion` 49-84 · `tipo_doc` 88-89 · `CUIT` 92-102 · `cond_fisc` 141-142 · `cod_neto` 145-147 · `neto_gravado` 149-159 · `alic` 161-166 · `IVA` 168-178 · `credito` 180-190 · `cod_ngex` 191-193 · `imp_ngex` 195-205 · `cod_percep` 206-209 · `monto_percep` 211-221 · `pcia_pr` 222-223 · `total` 225-235

`pcia_pr` debe estar **siempre** en la línea principal L1, no solo cuando hay retenciones.

Validado el 16/09/2026 con un validador de posiciones sobre 23 líneas reales y 31 del banco de pruebas: todas las posiciones correctas, importes alineados a la derecha, `pto_vta` a 5 dígitos, `numero` a 8, sin línea de encabezado.

---

## ⚠️ CORRECCIÓN DE FONDO SOBRE EL CAMPO `cpbte` (posiciones 23-24)

Confirmada directo con soporte técnico de Holistor el 27/08/2026. Las posiciones 23-24 **no llevan el código numérico de AFIP** (01, 11, 15, etc.) — llevan la **categoría de la Tabla de Conversión de Comprobantes propia de Holistor**: `F` (Factura), `C` (Nota de Crédito), `D` (Nota de Débito), `RE` (Recibo), `FM`/`DM`/`CM` (variantes FCE/MiPyME). La letra (A/B/C/E) sigue yendo en la posición 28, sin cambios — es la combinación de las dos (categoría + letra) la que Holistor usa por dentro para calcular su propio número interno (001, 011, etc.); nosotros nunca mandamos ese número.

**Tabla de mapeo completa (AFIP → categoría Holistor):**

| Código AFIP | Categoría Holistor | Letra |
|---|---|---|
| 01, 06, 11, 19 | `F` | A, B, C, E |
| 02, 07, 12, 20 | `D` | A, B, C, E |
| 03, 08, 13, 21 | `C` | A, B, C, E |
| 04, 09, 15 | `RE` | A, B, C |
| 201, 206, 211 | `FM` | A, B, C |
| 202, 207, 212 | `DM` | A, B, C |
| 203, 208, 213 | `CM` | A, B, C |
| 51, 52, 53 (ex Factura M) | *sin categoría confirmada con Holistor* — **desde el 16/09/2026 la factura queda fallida con motivo** ("cpbte 51/52/53 sin categoría Holistor confirmada") en vez de salir con las posiciones 23-24 en blanco. Hay 6 comprobantes reales de este tipo en REGISTRO_ESPERADO (4 tipo 51, 2 tipo 53). Pendiente confirmar con soporte si van como `F`/`C` con letra A. | — |

El `tipo_cod` que viene de ARCA se usa **completo** (tres cifras para FCE); hasta el 16/09 se recortaba a dos dígitos y una FCE 201 salía como `F` en vez de `FM` (y además se reprocesaba en la corrida siguiente porque la clave interna no coincidía con la de ARCA).

**Nota operativa importante**: el **Esquema de Holistor (la pantalla de posiciones Desde/Hasta) es una configuración por empresa** dentro de Holistor, no global. Una empresa nueva puede tener varios campos numéricos corridos una posición (bug de configuración de esa empresa puntual, no de nuestro código) — si reaparecen síntomas de "montos que no coinciden" con una empresa que nunca dio problemas antes, revisar el Esquema de esa empresa puntual con la función "Muestra Archivo" antes de sospechar de nuestro lado.

**Configuración de Holistor (en la app, no en el código)**: Codificación de Comprobantes: código `1` (sin cero a la izquierda), no `01`.


### Correcciones del Esquema de Holistor indicadas el 30/09/2026 (empresa AMBROSINO NAHUEL, PRN `AMBROSINO_NAHUEL_202609_20260930_124605.prn`)

Se revisó, campo por campo, el Esquema que tenía cargado el estudio contra lo que escribe `Generar PRN`, usando ese PRN de 10 líneas (todas de 240 caracteres; `neto + IVA = total` cierra en las 10, con una única diferencia de 1 centavo de redondeo del proveedor en BAUCLA 0006-00001813, que se respeta tal cual está en la factura). **El archivo estaba bien; tres campos del mapa de Holistor estaban mal puestos**:

| Campo del Esquema | Tenía | Tiene que ser | Por qué | Estado |
|---|---|---|---|---|
| Comprobante — Nombre | 23–23 | **23–24** | La categoría puede tener dos letras (`RE`, `FM`, `DM`, `CM`); con una sola posición una FCE (`FM`) se leería como `F` y un recibo como `R`. No se notaba porque las facturas comunes son `F`. | **Aplicada por el estudio (confirmado 05/10)** |
| Percepciones I.V.A. — Decimal | 219–222 | **220–221** | El monto de percepción ocupa 211–221 (entero 211–218, coma 219, decimales 220–221). 219–222 arrastraba la coma y el primer dígito de la provincia: con percepción, los centavos se leerían mal. Hoy no se notó porque las 10 facturas no tienen percepción. Retenciones — Decimal ya estaba bien (220–221). | **Aplicada por el estudio (confirmado 05/10)** |
| Provincia Ret./Perc. — Código | 221–222 | **222–223** | La provincia va siempre en 222–223 (también en las líneas extra del comprobante); 221 es el último decimal del monto de percepción y, vacío, mostraba un espacio. "Provincia — Código" ya estaba en 222–223. | **Aplicada por el estudio (30/09)** |

Los campos que arrancan una posición más adelante que el Esquema (nombre del proveedor 48–84 → el nuestro arranca en 49; tipo de documento 87–89 → 88; CUIT 91–102 → 92; condición fiscal del proveedor 140–142 → 141; tipo de movimiento 144–147 → 145) **funcionan bien así**: Holistor descarta el espacio inicial. Al mirar la vista previa de una sola línea, varios campos pueden mostrar el mismo valor por casualidad (el `80` aparecía en el decimal del IVA, del crédito fiscal y del total de la primera factura, y también como tipo de documento del proveedor, donde `80` es el código ARCA de CUIT): mirar otra línea antes de sospechar. Recordar que el Esquema es **por empresa**: estas correcciones hay que hacerlas en cada empresa donde se importe.

---

## Validación cpbte ↔ tipo (tabla completa)

| Tipo | Códigos válidos |
|---|---|
| A | 01 Factura · 02 ND · 03 NC · 04 Recibo · 51 Factura (leyenda retención, ex-M) · 52 ND · 53 NC · 201 FCE Factura · 202 FCE ND · 203 FCE NC |
| B | 06 Factura · 07 ND · 08 NC · 09 Recibo · 206 FCE Factura · 207 FCE ND · 208 FCE NC |
| C | 11 Factura · 12 ND · 13 NC · 15 Recibo · 211 FCE Factura · 212 FCE ND · 213 FCE NC |
| E | 19 · 20 · 21 (exportación) |

Si el cpbte extraído no está en la lista o es inconsistente con la letra: marcar fallido con motivo explícito, nunca auto-corregir.

Códigos que aparecen en REGISTRO_ESPERADO y **todavía no están en la tabla**: 63 (liquidación) y 81 (tique factura A). Si llega un PDF de esos, hoy sale "cpbte inválido" aunque el código existe en ARCA (pendiente en ClickUp).

⚠️ **Comprobante 51/52/53 (ex Factura M)**: además del código, el **receptor** de este comprobante está obligado por normativa a actuar como agente de retención de IVA y de Ganancias. El sistema solo procesa el dato, no calcula ni marca esta obligación — queda como decisión contable del estudio.

---

## Controles de importes (desde el 17/09/2026) — qué hace `Generar PRN` antes de escribir una línea

Estos controles son deterministas y viven en el código, no en el prompt de Gemini. Se agregaron después de comprobar que Gemini invierte gravado y exento en las facturas de Monroe Americana de forma no repetible (la misma factura sale bien en una corrida y mal en la siguiente).

1. **Cruce contra el desglose de ARCA (ex AFIP)**. Si la fila de ARCA del comprobante tiene desglose (columna `desglose_alicuotas` de REGISTRO_ESPERADO, cargado desde el Excel de Mis Comprobantes), y la fila cierra contra su propio total (±1 peso), y la factura es en pesos:
   - Por cada alícuota (0 / 2,5 / 5 / 10,5 / 21 / 27 %) se compara neto e IVA de Gemini contra ARCA con tolerancia ±5 pesos. Ante diferencia se toman los valores de ARCA (`neto_gravado`, `iva_liquidado`, `alic`, `iva_adicional`).
   - Exento (`EXC`) y no gravado (`NGC`): si los montos coinciden pero el código está cambiado, se recodifica; si el gravado se corrigió o Gemini no trajo ninguno, se reemplaza por lo de ARCA; en cualquier otro caso se deja lo de Gemini.
   - Total: si difiere de ARCA en más de 5 pesos, se toma el de ARCA.
   - Percepciones: **no se corrigen** (ARCA solo trae "Otros Tributos" sin código); si difieren, se deja un aviso.
   - Toda corrección queda registrada en `advertencias` como `Corregido con desglose ARCA (archivo — emisor): ...`.
2. **Alícuota**. Ya no se recalcula desde IVA/neto (eso inventaba 2,5 % o 0 %). Si hay una sola alícuota y el cociente IVA/neto no coincide con la etiqueta en más de 1 punto: si da exactamente una alícuota válida (±0,1), se corrige la etiqueta; si no, la factura queda **fallida** con motivo `IVA no coincide con neto × alícuota (...)`.
3. **Red de seguridad final**: `neto + IVA + adicionales + NG/EX + percepciones` tiene que dar el total con tolerancia máx(2 pesos, 0,5 %). Si no cierra, la factura queda **fallida** con motivo `Los importes no suman el total: ...`. Única excepción: si la suma cierra contra el total de ARCA, se toma ese total (aviso `Total corregido con ARCA`).
4. **Excepciones exactas que sí se auto-corrigen** (aritmética o regla fiscal objetiva, no inferencia): comprobante C de monotributista con neto/IVA en cero → el total es el neto; factura en USD que ya coincide con ARCA en pesos (±1 %) → no se vuelve a convertir; `tipo_cambio` corrompido por el bug conocido de formato → se reconstruye.

Facturas en dólares: el cruce por alícuota no se aplica (los importes de ARCA están en pesos al tipo de cambio de ARCA); solo corren los puntos 2 y 3.

**Corrección del 01/10/2026 sobre la frase anterior**: no es cierto que en las facturas en dólares los importes de ARCA estén en pesos. En el Excel de Mis Comprobantes, para un comprobante en moneda extranjera el "Imp. Total" viene **en la moneda original (USD)** y el tipo de cambio aparte, como dato informativo. El chequeo "el total de Gemini ya coincide con el de ARCA, entonces la factura ya está en pesos" asumía lo contrario y, para dólares, casi siempre se cumplía (ambos están en USD), por lo que **bloqueaba la conversión real**. Ahora ese chequeo solo corre cuando ARCA no confirma un tipo de cambio mayor a 1 (`_tcArca <= 1`); si ARCA lo confirma, se convierte con ese tipo de cambio. Sigue aplicando, sin cambios, el caso para el que se creó (16/09, auditoría H-04): un comprobante en pesos donde Gemini inventó un tipo de cambio que no corresponde. Caso real: ARAGNO GUSTAVO 2026-09, 4 facturas de Delyar en USD. **Confirmado el 05/10/2026 con los PRN reales**: las 4 salen en pesos, con el tipo de cambio de ARCA (1507,50 y 1513,50); ver `2_workflow_estado.md`.

Alcance confirmado con datos reales: FRANK NADIA agosto 2026 (23 facturas, todas al 21 %, en pesos). Alícuotas mixtas todavía sin corrida real. Dólares: ARAGNO GUSTAVO 2026-09 fue la primera corrida real con USD y destapó el bug de conversión del 01/10 (corregido y confirmado con el PRN).

---

## Líneas extra del PRN — helper unificado (`lineaExtra`)

Segunda alícuota (`iva_adicional`), segundo concepto NG/EX, o segunda percepción, generan una línea adicional dentro del mismo comprobante. Estas líneas SIEMPRE llevan `cod_neto` (145-147) y `pcia_pr` (222-223) iguales a los de la línea principal, y los importes SIEMPRE alineados a la derecha (`'right'`), igual que en L1. Una sola función `lineaExtra(camposEspecificos)` arma la parte común; cada bloque solo aporta sus campos específicos.

`toArray()` envuelve en lista un objeto que ya es un tramo o concepto (tiene `neto_2`, `codigo` o `codigo_percep`); hasta el 16/09 devolvía sus valores sueltos y la segunda alícuota se perdía sin aviso.

**Los conceptos NG/EX no deben duplicar el neto de una línea `iva_adicional`**: Gemini suele duplicar el mismo valor entre `iva_adicional` y `conceptos_ngex` en su propia respuesta. Al armar los conceptos NG/EX, excluir cualquier monto que ya se haya asignado a una línea de `iva_adicional`.

---

## Códigos de rubro (cod_neto)

`ALQ` (alquileres) · `CBU` (compras de bienes de uso — maquinaria, vehículos, equipos) · `CGG` (gastos gravados — publicidad, papelería, varios) · `CMG` (compras gravadas mercadería — repuestos, insumos para reventa) · `CMP` (compras de materia prima) · `COM` (combustibles) · `ENG` (energía eléctrica) · `FLT` (fletes y transporte; **incluye el flete de granos** aunque la factura diga SOJA, MAÍZ o TRIGO — ver abajo) · `GB` (gastos bancarios — comisiones del banco) · `GF` (gastos financieros — intereses, cargos por financiación, recargos por mora; agregado el 30/09/2026, caso BAUCLA S.A.) · `HON` (honorarios profesionales) · `INA` (Insumos Agrícolas — semillas, fertilizantes, agroquímicos, fitosanitarios, herbicidas) · `INP` (Insumos Pecuarios — alimento balanceado, sanidad animal, vacunas, productos veterinarios) · `SEG` (seguros) · `SER` (servicios — internet, telefonía, agua, gas domiciliario)

`INA`/`INP` tienen prioridad sobre `CGG` y `CMG` cuando el insumo es específicamente agrícola o pecuario.

**Jerarquía de decisión de cod_neto:**

- **Orden real de decisión (leído en `Generar PRN` el 05/10/2026)**: **1.º** ND/NC que referencia una factura anterior → hereda el rubro de esa línea guardada · **2.º** proveedor con `forzar_rubro = SI` en PROVEEDORES → manda el rubro cargado, siempre; si Gemini leyó otro en una factura o NC, queda un aviso `rubro_forzado` en las discrepancias (en las ND no se avisa) · **3.º** Notas de Débito → PROVEEDORES · **4.º** Facturas y Notas de Crédito → Gemini, con PROVEEDORES de respaldo. La frase "Gemini decide siempre" de abajo vale solo para proveedores **sin** `forzar_rubro`.
- **Facturas y Notas de Crédito** (comprobante no es ND): Gemini decide SIEMPRE, leyendo la boleta puntual. PROVEEDORES solo se usa como respaldo si Gemini no extrajo nada. Si Gemini extrajo algo y PROVEEDORES tiene un valor distinto cargado, se respeta lo que dice Gemini para ESA factura, y se registra la discrepancia (tipo: `'rubro'`) para revisión manual — sin bloquear ni forzar nada.
- **Notas de Débito** (cpbte 02/07/12, o FCE 202/207/212): PROVEEDORES siempre gana. Gemini no tiene base real para decidir en estos comprobantes.
- **ND/NC que referencian una factura anterior**: heredan el rubro de la línea guardada de esa factura en PRN_LINEAS (ver abajo).
- **Proveedor nuevo sin nada cargado en PROVEEDORES**: Gemini decide libre, sin ningún aviso.

**Cuándo usar `forzar_rubro = SI`**: cuando Gemini no puede acertar el rubro leyendo la factura, ya sea porque el rubro no está escrito en ella o porque cambia de una corrida a otra. Casos reales del 30/09/2026: **BAUCLA S.A.** (`GF`; Gemini le daba SER, GB o CGG a la misma factura según el día — la factura solo trae intereses y comisiones por descuento de cheques); y los **fleteros de granos** VIDELA (Rodrigo, Gonzalo, Lucas y Antonio) y BRASSIOLO (`FLT`; sus facturas dicen "SOJA", CTG, CPE y toneladas, sin la palabra "flete", y Gemini las tomaba por compra de granos → `CMG`). El prompt de Gemini tiene una regla para esos fleteros (precio por tonelada menor a $60.000 + CTG/CPE → `FLT`), pero **es una orientación, no un control** (ver "Regla del proyecto desde el 17/09" en `2_workflow_estado.md`): para un proveedor conocido, lo seguro es `forzar_rubro = SI`. Para la regla, lo que distingue un flete de una venta de granos es el precio: un flete cuesta del orden de $20.000 a $60.000 por tonelada; el grano vale muchas veces más.

**No usar `forzar_rubro` con un proveedor que factura cosas distintas según la factura.** Caso real: DELYAR vende insumos (`INA`), pero la factura 0018-00030326 cobra "FLETES - FERTILIZANTES x Kg." (`FLT`); forzar cualquiera de los dos rubros dejaría mal a una de las dos. En esos casos el rubro lo decide la lectura de cada factura (y el prompt), y hay que revisarlo.

---

## Códigos provincia Holistor (distinto a AFIP)

00 CABA · 01 Bs As · 02 Catamarca · 03 Córdoba · 04 Corrientes · 05 Entre Ríos · 06 Jujuy · 07 Mendoza · 08 La Rioja · 09 Salta · 10 San Juan · 11 San Luis · 12 Santa Fe · 13 Santiago del Estero · 14 Tucumán · 16 Chaco · 17 Chubut · 18 Formosa · 19 Misiones · 20 Neuquén · 21 La Pampa · 22 Río Negro · 23 Santa Cruz · 24 Tierra del Fuego · 90 Indeterminado. (No hay código 15.)

---

## MARCO CONTABLE E IMPOSITIVO ARGENTINO

**Comprobantes AFIP (tabla completa):**

- **Letra A**: 01 Factura · 02 ND · 03 NC · 04 Recibo · 51 Factura con leyenda "Operación Sujeta a Retención" (ex-Factura M) · 52 ND · 53 NC · 201 FCE Factura · 202 FCE ND · 203 FCE NC
- **Letra B**: 06 Factura · 07 ND · 08 NC · 09 Recibo · 206 FCE Factura · 207 FCE ND · 208 FCE NC
- **Letra C**: 11 Factura · 12 ND · 13 NC · 15 Recibo · 211 FCE Factura · 212 FCE ND · 213 FCE NC

FCE = Factura de Crédito Electrónica MiPyME (RG 4367).

**Aclaración importante**: el recuadro "CÓDIGO 01" que aparece en las facturas es la categoría de IVA del emisor (01 = Responsable Inscripto), NO el código AFIP del comprobante. El cpbte AFIP se determina por el título del documento combinado con su letra. Y ese código AFIP tampoco es lo que se escribe directo en el `.prn` — ver la corrección de fondo arriba.

**Alquiler de campo (arrendamiento rural) es Exento de IVA por ley** — confirmado con fuente oficial (art. 7º inciso h, punto 22 de la Ley de IVA). Aplica sin importar el monto, siempre que el inmueble sea rural y el destino sea explotación agropecuaria. Si el PDF de una factura de alquiler de campo muestra IVA en $0 pese a ser de un Responsable Inscripto, **no es un error de facturación** — es la exención aplicada correctamente. Corresponde clasificar el monto como `EXC` (código NG/EX), no como neto gravado. Pendiente: ajustar el prompt de Gemini para que reconozca "alquiler de campo"/"arrendamiento rural" como candidato a Exento por regla, en vez de depender de que la factura lo muestre bien desglosado.

**Nota abierta, sin resolver**: no hay un código de percepción confirmado para "Percepción de Ganancias" en el mapeo actual (solo PI01/PI02/PIBC/PCC para IVA/IIBB). Si aparece una factura real con este concepto, investigar el código correcto contra AFIP antes de inventarlo.

**Excel "Mis Comprobantes" de ARCA (columnas, base 0, encabezado en fila 2, datos desde fila 3)**: 13 Neto Grav. IVA 0 % · 14 IVA 2,5 % · 15 Neto 2,5 % · 16 IVA 5 % · 17 Neto 5 % · 18 IVA 10,5 % · 19 Neto 10,5 % · 20 IVA 21 % · 21 Neto 21 % · 22 IVA 27 % · 23 Neto 27 % · 24 Neto Gravado Total · 25 Neto No Gravado · 26 Op. Exentas · 27 Otros Tributos · 28 Total IVA · 29 Imp. Total. ARCA calcula el neto a partir del IVA, así que puede diferir en centavos del PDF; "Otros Tributos" es la suma de percepciones sin código. Cuatro comprobantes de FRANK NADIA agosto vienen sin detalle (todo en cero salvo el total): para esos no hay cruce.

---

## fmtNum — formato de importes (función crítica)

- Si tiene punto Y coma: el último separador es el decimal.
- Si solo tiene punto: si el último grupo tiene 3 dígitos y hay más de uno, es miles.
- Si solo tiene coma: misma lógica.
- Con 2+ puntos y el último grupo con menos de 3 dígitos (ej. `"8.805.62"`): los puntos anteriores son de miles, el último punto es decimal.
- La parte entera del PRN sale siempre sin separadores de miles: `1234567,89`.
- Para importes >99.999.999,99: pasar `maxWidth=11` para reducir decimales antes de truncar enteros.

**Dos casos conocidos sin arreglar (en ClickUp)**: `"1.250"` (un solo punto, tres dígitos después, sin coma) se interpreta como 1,25 en vez de 1.250 — hoy termina en fallida por la validación IVA/neto, no en un importe mal escrito, pero obliga a carga manual sin necesidad. Y si un importe no entra en los 11 caracteres del campo, `fmtNum` recorta decimales y después enteros **sin avisar**; debería quedar fallida con motivo.

**Importes negativos** (una NC leída como resta): la línea mide 240 pero lleva el signo menos; Holistor espera positivos. Sin decisión todavía (valor absoluto con aviso, o fallida) — en ClickUp.

---

## Fuente de datos para generación de PRN

`sd[lmKey]` es la fuente primaria (siempre completa, persiste aunque el nodo de Sheets falle). `Colapsar a Uno` conecta directo a `Armar PRN Final`; el nodo huérfano `Leer PRN_LINEAS` de versiones anteriores ya no existe.

**PRN_LINEAS sí tiene uso** (corrección de la auditoría del 16/09 a una nota anterior que la daba por residual): `Guardar Linea PRN (Hot)` escribe una fila por factura durante el bucle (1,8 s cada una) y `Cargar PRN_LINEAS Proceso → Indexar PRN_LINEAS` la lee entera al arrancar cada proceso. Su único uso real hoy es el rubro heredado de ND/NC que referencian una factura anterior. Detalle de formato: 32 celdas de esa hoja tienen 481 caracteres — son dos líneas del PRN unidas por `\n` (doble alícuota o dos NG/EX); es el diseño, pero ese salto de línea dentro de una celda rompe cualquier lectura por líneas de la hoja. Pendiente (P-03 en ClickUp): escribir al cierre en bloque, o resolver el rubro desde REGISTRO_ESPERADO/PROVEEDORES y eliminar la hoja.

## `Generar PRN` — nodo de ~1700 líneas, evaluado y NO partido

Se evaluó partirlo en nodos separados como parte de una auditoría de calidad de código. Conclusión tras revisar la evidencia real de bugs históricos: la mayoría de los bugs de este proyecto son del código propio, pero de tipos variados — no hay una sola causa estructural común que partir el nodo resuelva. Partir en más nodos de n8n también aumenta el riesgo de bugs de traspaso de datos entre nodos. Decisión: no tocar la arquitectura de `Generar PRN` sin una razón concreta y verificada de qué cambio puntual haría falta.

Desde el 16/09 existe un banco de pruebas local que corre el código **real** del nodo (bajado de n8n, no una copia) sin Gemini ni Sheets: 31 casos originales (29 pasan; los 2 que fallan son `"1.250"` y un cpbte 51 escrito para fallar), 15 casos del cruce con ARCA y una simulación con las 23 facturas reales de FRANK NADIA agosto con la salida real de Gemini. Correrlo después de cada cambio del nodo (30 segundos) y **siempre bajar el nodo de n8n y comparar byte a byte** antes de dar un cambio por aplicado.
