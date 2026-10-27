# Auditoría 2026-10-07 — parches de frontend (NO aplicados) y prueba automatizada

Esta carpeta contiene **solo** lo que puede vivir en un repositorio público: parches `.diff`
para `index.html` / `index-test.html` y una prueba de Playwright que los verifica. No hay
IDs de planillas, carpetas de Drive, workflows, credenciales, claves ni nombres de clientes:
todo lo que necesita esos datos (informe completo, propuesta de n8n) se entregó por fuera.

Ninguno de los parches está aplicado en `main`. Se aplican con `git apply <archivo>` cuando
el estudio lo decida, **primero en `index-test.html`, después en `index.html`**.

| Parche | Archivo destino | Qué corrige |
|---|---|---|
| `02-frontend-test-reintentar-lista-vacia.diff` | `index-test.html` | `reintentar()` vaciaba `archivosFallidos` antes de leer los nombres → mandaba `reintentar_pdfs: []`. Ya estaba corregido en `index.html`. |
| `03a-frontend-prod-cartel-escaneo-duplicadas.diff` | `index.html` | El botón "Reprocesar todas (N)" contaba también las copias duplicadas dentro del lote, que el servidor descarta. |
| `03b-frontend-test-cartel-escaneo-duplicadas.diff` | `index-test.html` | Ídem. |
| `04-frontend-prod-ultimoEstado-ver-en-drive.diff` | `index.html` | Falta `window._ultimoEstado = data` (sí está en test): el link "Ver en Drive" queda inerte. Requiere que el backend devuelva `pdfs_drive`. |
| `05-frontend-prod-etiqueta-xlsx-csv.diff` | `index.html` | Etiqueta "(.xlsx)" → "(.xlsx o .csv)"; el input ya acepta CSV. |
| `06-frontend-ambas-escapar-mensaje-candado.diff` | ambos | El `mensaje` del servidor en la respuesta `proceso_ya_activo` se inyectaba sin escapar en el aviso. Se escapa **en el punto de inyección** (`escapeHtml(data.mensaje …)`), no dentro de `showAlert`, porque otros llamados le pasan HTML a propósito (`<br>`, `<b>`). |

Verificación de que aplican limpio: `for d in audit-2026-10-07/0*.diff; do git apply --check "$d"; done`.

## Prueba automatizada: `test-escaneo-popup.mjs`

Carga el archivo real como página `file://` en Chromium headless (Playwright), intercepta
**todas** las llamadas a `**/webhook/**` en la capa de red (nada sale de la máquina), y maneja
las funciones reales de la página (`manejarResultadoEscaneo`, `sendFlush`, `startUpload`, …).
Datos 100 % sintéticos: cliente de prueba, token falso, un PDF de prueba de 50 bytes.

Escenarios, cada uno contra `index.html` e `index-test.html`:

- **(a)** Lote todo repetido → modal con "No, dejar así" / "Sí, reprocesar"; "No, dejar así"
  dispara un único `holistor-procesar` con `forzar:false`.
- **(b)** Mezcla de nuevas y repetidas → "Solo las nuevas (N)" / "Reprocesar todas (N+M)";
  cada botón manda el `forzar` correcto.
- **(c)** Hay duplicadas dentro del lote → sale el aviso `warn` con la cantidad, y el botón
  "Reprocesar todas" cuenta **(N+M)**, no (N+M+K). Sin parchear, el test comprueba que el
  defecto se reproduce; parcheado, que está corregido.
- **(d1)** `holistor-procesar` responde `proceso_ya_activo` con `<b>` en `mensaje` → sin
  parchear el `<b>` se renderiza como elemento (defecto); parcheado se ve como texto literal.
- **(d2)** Candado bloqueado antes de subir → el mensaje del servidor se muestra escapado y
  el `<br>` propio de la página sigue siendo HTML.
- **(d3)** El servidor rechaza "procesar" con `proceso_ya_activo` después de subir → mensaje
  del servidor escapado; el `<b>no los vuelvas a subir</b>` y los `<br>` propios siguen siendo HTML.

### Cómo correrla

```bash
# Modo 1: contra los archivos del repo (sin parchear). Debe pasar y REPRODUCIR los defectos.
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node audit-2026-10-07/test-escaneo-popup.mjs

# Modo 2: contra copias con los parches 02..06 aplicados. Debe pasar con el comportamiento corregido.
mkdir -p /tmp/holistor-patched && cp index.html index-test.html /tmp/holistor-patched/
for d in audit-2026-10-07/0*.diff; do git apply --unsafe-paths --directory=/tmp/holistor-patched "$d"; done
HOLISTOR_DIR=/tmp/holistor-patched HOLISTOR_EXPECT_PATCHED=1 \
  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node audit-2026-10-07/test-escaneo-popup.mjs
```

`playwright` tiene que estar instalado globalmente (`npm root -g`) y Chromium presente en
`$PLAYWRIGHT_BROWSERS_PATH`; no correr `playwright install`.

### Última corrida real (2026-10-07)

```
Modo 1 (sin parchear, repo @ 2bbd1fc):  PASS: 54  FAIL: 0
Modo 2 (parcheado 02..06):              PASS: 54  FAIL: 0
```
