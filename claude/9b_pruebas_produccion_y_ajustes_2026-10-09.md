# 09/10/2026 (tarde) — Ajustes de textos, pruebas en producción con un segundo cliente y rubro de AGROSINSACATE

Complementa `claude/9_cambios_2026-10-09_modo_estricto.md`. Actualizado el 09/10/2026 (mediodía), después de cerrar todo el trabajo del día.

## Cambios de la página
- **Mensajes (TEST `f438c4c`, producción `6aa415e`)**: cuando no entra ninguna factura por no figurar en ARCA, ahora dice "No se generó PRN: N factura(s) no figuran en ARCA. Cargalas a mano en Holistor, o si ya figuran en ARCA, subí de nuevo el Excel actualizado y reprocesá." (antes decía "Cargá el Excel de ARCA y reprocesá", aunque el registro ya estuviera guardado). En el estado del proceso: "no figuran en ARCA (no entran al PRN)".
- **Motivo "cliente ?"**: la página reemplaza "cliente ?" por el CUIT elegido en el selector (`mostrarOtroCliente`). El servidor (`Generar PRN`) sigue mandando "?" en `cliente_cuit` y en el motivo: no se tocó el nodo (101 KB) para no arriesgar el resto por un texto. Verificado en producción con Castellano.
- **Panel de progreso con carpeta vacía (producción `b5653ee`, TEST commit equivalente)**: cuando no hay PDF de ese cliente y período, el panel ya no queda en "Escaneando… 65 %": termina en "Sin facturas — La carpeta de entrada no tiene PDFs de este cliente y período" al 100 %. Verificado en producción con Actis S.R.L.

## Pruebas
- TEST con Excel de ARCA cargado en la sesión (Excel de prueba de 1 fila, ficticio; Actis 2026-09 y Aragno 2026-09): la factura que no figura queda en "Omitidas del PRN — no figuran en ARCA (1)" y en "carga manual"; el desplegable "En el PRN, pero no figuran" no aparece; mensaje nuevo visible. OK. Quedaron filas de prueba en el registro de TEST de cada uno de esos dos períodos.
- PRODUCCIÓN, segundo cliente SUC. DE CASTELLANO 2026-08 (sin Excel en la sesión): reprocesar 1 factura que figura en ARCA → PRN `SUC_DE_CASTELLANO_202608_20261009_145021.prn`, 1 línea de 240 caracteres, total 100137,69 igual a ARCA, 1 conciliada; factura de otro cliente → omitida con el CUIT correcto en el motivo. OK. Ese PRN de 1 línea es de prueba: no importar y borrar desde `farmando@`.
- Con Actis (PRN de prueba `ACTIS_BEATRIZ_202609_20261009_142420.prn`) y con Castellano, el estado de la página de ese cliente/período queda mostrando la última corrida de prueba.
- Solo dos clientes probados en producción (Actis Beatriz y Suc. de Castellano).

## Rubro de AGROSINSACATE S.A. (CUIT 30708943467) — resuelto
- Con Castellano apareció en "Discrepancias con PROVEEDORES": PROVEEDORES decía FLT y Gemini leyó INP (se usó INP). **Causa**: era una carga vieja de PROVEEDORES. El estudio la cambió a `cod_neto = INP` (fila 220, 09/10 12:10) porque el proveedor produce y comercializa alimentos para animales, nutrición y sanidad animal, y además premoldeados de hormigón (desde pileta bebedero o tubo para alcantarilla hasta macetas); `forzar_rubro` queda vacío.
- Cómo se decide el rubro: en facturas y NC lo decide Gemini factura por factura y PROVEEDORES es el respaldo; en ND gana PROVEEDORES; con `forzar_rubro = SI` manda siempre PROVEEDORES. ND/NC que referencian una factura anterior heredan el rubro de esa factura (guardada en `PRN_LINEAS`). Las discrepancias se avisan sin bloquear.
- Datos históricos en `PRN_LINEAS`: la factura 0007-00014148 salió FLT en las tres corridas (es un flete real, $827.591,67); la NC 0007-00009445 salió INP. La factura que la NC referencia (A 0007-00013000, 13/07) no está en `PRN_LINEAS`, así que no se pudo comprobar la herencia de rubro con este caso.
- Lo que muestra el caso: un proveedor puede facturar fletes y también productos; por eso no corresponde `forzar_rubro`. Relacionado con la regla de flete (ClickUp 86e3myex7), que sigue sin prueba con una factura de flete real en producción.

## Lecciones de las pruebas con el navegador automático (para repetirlas)
- El selector de mes de la página usa valores **sin cero** (`9`, no `09`).
- Los textos de los botones del cartel de reproceso cambian según el caso: lote mixto "Reprocesar todas (N)" / "Solo las nuevas (N)"; solo ya procesadas "Sí, reprocesar" / "No, dejar así". Buscar por coincidencia parcial.
- Carpeta de **Entrada** de TEST: `1k6RnkHSoJtlfqG5f93gHwBVbV4ibdTyr`. La `1PAWTMriFEu_V5mzFsLnMbynIfFEf3ogk` es la de **Procesados**: copiar PDF ahí hace que el escaneo diga "no hay facturas".
- Los PDF de prueba se copian dentro de Drive con el prefijo `CUIT__nombre.pdf`. Un PDF de prueba de otro receptor sale como `otro_cliente`, no como `no_en_arca`: para probar `no_en_arca` hay que usar una factura del mismo cliente de otro período.
- La clave de sesión de la página es `holistor_token_v1` (producción) y `holistor_token_v1_test` (TEST).
- Después de empujar un commit a GitHub Pages, el despliegue tarda entre 20 y 70 segundos en verse en línea.

## Pendientes
- Cambiar la clave de acceso.
- Borrar desde `farmando@` los dos PRN de prueba de la carpeta de PRN de producción.
- Limpiar en TEST: PRN/PDF de Aragno 2026-09 y las filas de prueba del registro (Aragno y Actis 2026-09), ClickUp 86e3myezh.
- Probar "Omitidas del PRN" con un Excel real de ARCA.
- Texto "cliente ?" en `Generar PRN` (servidor), sin arreglar.
