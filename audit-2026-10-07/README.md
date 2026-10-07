# Escaneo popup test (audit 2026-10-07)

Automated test for the scan-result popup in `index.html` / `index-test.html`:
`manejarResultadoEscaneo(data)` -> `mostrarCartelEscaneo(nuevas, yaProcesadas, duplicadasLote)`
-> the `#modalEscaneoFondo` / `#btnEscaneoSi` / `#btnEscaneoNo` DOM -> `sendFlush(forzar, soloEscanear)`.

## What it does

Loads the **real, unmodified** `index.html` (and `index-test.html`) as a local
`file://` page in headless Chromium via Playwright. No source file is edited.

- Network is mocked with Playwright's `page.route()` at the browser's network
  layer, matching `https://fede123.app.n8n.cloud/webhook/**`. Nothing ever
  reaches the real n8n backend (which is also blocked by this sandbox's
  egress proxy anyway). `holistor-clientes` returns one fake client so the
  dropdown can be populated; `holistor-procesar` POST bodies are captured
  (url + raw postData) for assertions and answered with `{ok:true}`; every
  other endpoint gets a harmless generic `{ok:true}`.
- `window.prompt()`/`confirm()` dialogs (the access-token prompt, the
  "¿limpiar cola?" confirm) are auto-accepted so the headless run never
  blocks.
- The app's own top-level `function` declarations (`manejarResultadoEscaneo`,
  `onClienteChange`, `actualizarPeriodo`, `showAlert`, ...) are, by plain JS
  semantics, reassignable properties of `window` (unlike its top-level `let`
  state variables, e.g. `clienteSeleccionado`/`periodo`, which live in a
  separate lexical scope and are **not** reachable via `window.x`). The test
  exploits exactly that: it calls `window.manejarResultadoEscaneo(data)`
  directly with hand-built scan results, sets the client via the real
  `onClienteChange()` after writing to the real `<select>`, and overrides
  `window.showAlert` to record every call (then forwards to the original) so
  alerts can be asserted on.
- It then inspects the real DOM the app builds (button ids/labels) and
  drives real clicks (`page.click('#btnEscaneoSi' | '#btnEscaneoNo')`), and
  checks the intercepted `holistor-procesar` POST body's `forzar` field to
  confirm which `sendFlush(forzar, ...)` call actually happened.

This turned out to be entirely practical with Playwright; jsdom was not
needed (the full page loads and runs cleanly standalone as a `file://` page
once network + dialogs are stubbed — there was no large tangle of
interdependent globals that made a real-browser load impractical).

## What it checks

- **(a) All-repeated batch** (`nuevas_en_escaneo` empty, `ya_procesadas` has
  items): modal appears, buttons read "No, dejar así" / "Sí, reprocesar",
  clicking "No, dejar así" fires exactly one `holistor-procesar` POST with
  `forzar:false` (i.e. `sendFlush(false, false)`).
- **(b) Mix of new + repeated**: buttons read "Solo las nuevas (N)" /
  "Reprocesar todas (N+M)"; clicking "Solo las nuevas" yields `forzar:false`,
  clicking "Reprocesar todas" (on a fresh popup instance) yields
  `forzar:true`.
- **(c) `duplicadasLote` present**: confirms a separate `showAlert(..., 'warn')`
  call fires automatically for the in-batch duplicates (independent of the
  modal), and demonstrates **audit finding 8** directly: with
  `ya_procesadas.length = 2` and `duplicados_en_lote.length = 2`,
  `manejarResultadoEscaneo`'s own `repetidas` is `2` (`yaProcesadas.length`
  only, per its source), while `mostrarCartelEscaneo` independently
  recomputes `repetidas = yaProcesadas.length + duplicadasLote.length = 4`
  and uses *that* number for the "Reprocesar todas" button — so the button
  reads "Reprocesar todas (5)" (1 nueva + 4) instead of the "(3)" (1 nueva +
  2) that the caller's own count would produce. The test asserts the button
  text equals the inflated value and explicitly differs from the
  caller-consistent value.

## How to run

```
cd /home/user/holistor-uploader
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node audit-2026-10-07/test-escaneo-popup.mjs
```

(`playwright` is only installed globally in this sandbox, not in the repo's
own `node_modules` — the script resolves it against `npm root -g` itself, so
no extra install step or `playwright install` is needed/should be run.)

The script runs all three scenarios against both `index.html` and
`index-test.html` (6 scenario-runs, 32 individual assertions total) and exits
non-zero if anything fails.

## Last real run (2026-10-07)

```
PASS: 32  FAIL: 0
```

All 32 assertions passed on both `index.html` and `index-test.html`,
including the finding-8 mismatch demonstration in scenario (c) (both files
produce the same "(5)" vs "(3)" discrepancy).
