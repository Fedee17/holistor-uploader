#!/usr/bin/env node
// Automated test for the "escaneo" popup (manejarResultadoEscaneo /
// mostrarCartelEscaneo / sendFlush) in index.html and index-test.html.
//
// Approach: load the real file as a file:// page in a headless Chromium
// (Playwright), intercept the n8n webhook calls at the network layer
// (page.route) so nothing ever leaves the machine, drive the real in-page
// functions (manejarResultadoEscaneo, onClienteChange, actualizarPeriodo,
// sendFlush -- all plain top-level `function` declarations, so they are
// reachable as window.<name>()), and inspect both the real DOM the app
// builds (#modalEscaneoFondo, #btnEscaneoSi, #btnEscaneoNo) and the bodies
// of the intercepted fetch calls.
//
// Run with:  node audit-2026-10-07/test-escaneo-popup.mjs
// (requires the globally installed `playwright` package and the chromium
// browser already present at $PLAYWRIGHT_BROWSERS_PATH -- both already set
// up in this sandbox; do NOT run `playwright install`.)

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// playwright is only installed globally (npm -g) in this sandbox, not in the
// repo's own node_modules -- resolve it explicitly against the global prefix.
const require = createRequire(import.meta.url);
const globalNodeModules = execSync('npm root -g').toString().trim();
const playwrightEntry = require.resolve('playwright', { paths: [globalNodeModules] });
const playwrightModule = await import(playwrightEntry);
const { chromium } = playwrightModule.default ?? playwrightModule;

const TARGETS = ['index.html', 'index-test.html'];

const FAKE_TOKEN = 'test-token-automatizado';
const FAKE_CLIENTE = { cuit: '20111111111', nombre: 'Cliente De Prueba' };

let totalPass = 0;
let totalFail = 0;
const results = [];

function ok(desc) { totalPass++; results.push({ pass: true, desc }); console.log(`  [PASS] ${desc}`); }
function fail(desc, detail) { totalFail++; results.push({ pass: false, desc, detail }); console.log(`  [FAIL] ${desc}${detail ? ' -- ' + detail : ''}`); }
function assert(cond, desc, detail) { if (cond) ok(desc); else fail(desc, detail); }

async function withPage(fileName, fn) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Any window.prompt()/confirm() (token prompt, "¿limpiar cola?", etc.)
    // is auto-accepted with a fixed token so the app never blocks on a
    // real dialog in headless mode.
    page.on('dialog', async (d) => {
      try {
        if (d.type() === 'prompt') await d.accept(FAKE_TOKEN);
        else await d.accept();
      } catch (e) { /* ignore */ }
    });

    const capturedProcesar = [];
    const capturedAlerts = []; // filled via page.exposeFunction, see below

    await page.exposeFunction('__reportAlert', (msg, type) => {
      capturedAlerts.push({ msg, type });
    });

    // Network-level mock: nothing reaches fede123.app.n8n.cloud (it's also
    // blocked by the sandbox egress proxy, confirmed separately with a 403).
    await page.route('https://fede123.app.n8n.cloud/webhook/**', async (route) => {
      const url = route.request().url();
      const postData = route.request().postData();
      if (url.includes('holistor-clientes')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([FAKE_CLIENTE]) });
      }
      if (url.includes('holistor-procesar')) {
        capturedProcesar.push({ url, postData });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, listo: false }) });
      }
      if (url.includes('holistor-candado')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ bloqueado: false }) });
      }
      // Generic harmless default for anything else this page's init code
      // might call (holistor-estado polling, holistor-proveedores, etc.)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    const fileUrl = 'file://' + path.join(REPO_ROOT, fileName);
    await page.goto(fileUrl, { waitUntil: 'load' });

    // Let initApp() (DOMContentLoaded) finish: token prompt answered,
    // loadClientes() resolved and populated the <select>.
    await page.waitForFunction(() => {
      const sel = document.getElementById('selCliente');
      return sel && !sel.disabled && sel.options.length > 1;
    }, { timeout: 15000 });

    // Monkey-patch the global `showAlert` so we can observe its calls from
    // Node. showAlert is a top-level `function` declaration -> it is a
    // plain, reassignable property of `window`, and every other function in
    // the page (manejarResultadoEscaneo included) looks it up dynamically
    // through the shared global scope, so overriding window.showAlert here
    // is visible to all of them.
    await page.evaluate(() => {
      const orig = window.showAlert;
      window.showAlert = function (msg, type, sinPopup) {
        window.__reportAlert(String(msg), String(type));
        return orig.call(this, msg, type, sinPopup);
      };
    });

    // Select the (mocked) client and confirm the default período (set by
    // initApp from today's date) is in place -- both required by
    // validarPrecondiciones() before sendFlush() will do anything.
    await page.evaluate((cuit) => {
      const sel = document.getElementById('selCliente');
      sel.value = cuit;
      window.onClienteChange();
      window.actualizarPeriodo();
    }, FAKE_CLIENTE.cuit);

    await fn({ page, capturedProcesar, capturedAlerts });
    await context.close();
  } finally {
    await browser.close();
  }
}

function lastForzar(capturedProcesar) {
  const last = capturedProcesar[capturedProcesar.length - 1];
  if (!last || !last.postData) return undefined;
  try { return JSON.parse(last.postData).forzar; } catch (e) { return undefined; }
}

async function runScenarioA(fileName) {
  console.log(`\n[${fileName}] Scenario (a): all-repeated batch, click "No, dejar así"`);
  await withPage(fileName, async ({ page, capturedProcesar }) => {
    const data = {
      nuevas_en_escaneo: [],
      ya_procesadas: [
        { emisor: 'Proveedor A', procesada_en: '2026-10-01T10:00:00Z' },
      ],
      duplicados_en_lote: [],
    };
    await page.evaluate((d) => window.manejarResultadoEscaneo(d), data);

    const modal = await page.$('#modalEscaneoFondo');
    assert(!!modal, 'modal #modalEscaneoFondo appears');

    const siText = (await page.textContent('#btnEscaneoSi').catch(() => null)) || '';
    const noText = (await page.textContent('#btnEscaneoNo').catch(() => null)) || '';
    assert(noText.trim() === 'No, dejar así', `btnEscaneoNo label is "No, dejar así"`, `got "${noText.trim()}"`);
    assert(siText.trim() === 'Sí, reprocesar', `btnEscaneoSi label is "Sí, reprocesar"`, `got "${siText.trim()}"`);

    await page.click('#btnEscaneoNo');
    await page.waitForTimeout(150);

    assert(capturedProcesar.length === 1, 'exactly one POST to holistor-procesar fired after clicking "No, dejar así"', `got ${capturedProcesar.length}`);
    const forzar = lastForzar(capturedProcesar);
    assert(forzar === false, 'sendFlush(false, false) -> POST body has forzar:false', `got forzar=${forzar}`);
  });
}

async function runScenarioB(fileName) {
  console.log(`\n[${fileName}] Scenario (b): mix of new + repeated, both buttons`);
  await withPage(fileName, async ({ page, capturedProcesar }) => {
    const nuevasN = 2;
    const repetidasM = 3;
    const data = {
      nuevas_en_escaneo: Array.from({ length: nuevasN }, (_, i) => ({ pdf: `nueva_${i}.pdf` })),
      ya_procesadas: Array.from({ length: repetidasM }, (_, i) => ({ emisor: `Proveedor ${i}`, procesada_en: '2026-10-01T10:00:00Z' })),
      duplicados_en_lote: [],
    };

    // --- First pass: verify labels, then click "Solo las nuevas" (forzar=false) ---
    await page.evaluate((d) => window.manejarResultadoEscaneo(d), data);
    let noText = ((await page.textContent('#btnEscaneoNo').catch(() => null)) || '').trim();
    let siText = ((await page.textContent('#btnEscaneoSi').catch(() => null)) || '').trim();
    assert(noText === `Solo las nuevas (${nuevasN})`, `btnEscaneoNo label is "Solo las nuevas (${nuevasN})"`, `got "${noText}"`);
    assert(siText === `Reprocesar todas (${nuevasN + repetidasM})`, `btnEscaneoSi label is "Reprocesar todas (${nuevasN + repetidasM})"`, `got "${siText}"`);

    await page.click('#btnEscaneoNo');
    await page.waitForTimeout(150);
    assert(capturedProcesar.length === 1, 'one POST fired after "Solo las nuevas"', `got ${capturedProcesar.length}`);
    let forzar = lastForzar(capturedProcesar);
    assert(forzar === false, '"Solo las nuevas" -> sendFlush(false,false) -> forzar:false', `got forzar=${forzar}`);

    // --- Second pass: re-trigger the same data, click "Reprocesar todas" (forzar=true) ---
    await page.evaluate((d) => window.manejarResultadoEscaneo(d), data);
    await page.click('#btnEscaneoSi');
    await page.waitForTimeout(150);
    assert(capturedProcesar.length === 2, 'a second POST fired after "Reprocesar todas"', `got ${capturedProcesar.length}`);
    forzar = lastForzar(capturedProcesar);
    assert(forzar === true, '"Reprocesar todas" -> sendFlush(true,false) -> forzar:true', `got forzar=${forzar}`);
  });
}

async function runScenarioC(fileName) {
  console.log(`\n[${fileName}] Scenario (c): duplicadasLote present -- warn alert + repetidas mismatch (finding 8)`);
  await withPage(fileName, async ({ page, capturedAlerts }) => {
    const nuevasN = 1;
    const yaProcesadasM = 2;
    const duplicadasLoteK = 2;
    const data = {
      nuevas_en_escaneo: Array.from({ length: nuevasN }, (_, i) => ({ pdf: `nueva_${i}.pdf` })),
      ya_procesadas: Array.from({ length: yaProcesadasM }, (_, i) => ({ emisor: `Proveedor ${i}`, procesada_en: '2026-10-01T10:00:00Z' })),
      duplicados_en_lote: Array.from({ length: duplicadasLoteK }, (_, i) => ({ pdf: `dup_${i}.pdf` })),
    };

    await page.evaluate((d) => window.manejarResultadoEscaneo(d), data);
    await page.waitForTimeout(50);

    // (c-1) a separate 'warn' alert fired automatically for the in-lote duplicates.
    const warnAlert = capturedAlerts.find(a => a.type === 'warn' && /repetida/.test(a.msg));
    assert(!!warnAlert, `showAlert('warn', ...) fired for the ${duplicadasLoteK} in-batch duplicate(s)`, JSON.stringify(capturedAlerts));
    if (warnAlert) assert(warnAlert.msg.includes(String(duplicadasLoteK)), `warn alert text mentions the count (${duplicadasLoteK})`, warnAlert.msg);

    // (c-2) demonstrate audit finding 8: mostrarCartelEscaneo() recomputes its
    // own `repetidas` as yaProcesadas.length + duplicadasLote.length, while
    // manejarResultadoEscaneo()'s own `repetidas` (used for its own branching
    // and logging) is yaProcesadas.length only. The button label is built from
    // the *modal's* inflated number, so it numerically disagrees with what the
    // caller itself considers "repetidas".
    const callerRepetidas = yaProcesadasM;                      // manejarResultadoEscaneo's `repetidas`
    const modalRepetidas = yaProcesadasM + duplicadasLoteK;      // mostrarCartelEscaneo's own `repetidas`
    assert(callerRepetidas !== modalRepetidas, 'sanity: the two `repetidas` values actually differ in this scenario', `caller=${callerRepetidas} modal=${modalRepetidas}`);

    const siText = ((await page.textContent('#btnEscaneoSi').catch(() => null)) || '').trim();
    const expectedIfUsingModalRepetidas = `Reprocesar todas (${nuevasN + modalRepetidas})`;
    const expectedIfUsingCallerRepetidas = `Reprocesar todas (${nuevasN + callerRepetidas})`;
    assert(siText === expectedIfUsingModalRepetidas, `btnEscaneoSi uses the modal's own (inflated) repetidas -> "${expectedIfUsingModalRepetidas}"`, `got "${siText}"`);
    assert(siText !== expectedIfUsingCallerRepetidas, `btnEscaneoSi label therefore differs from what the caller's own repetidas (${callerRepetidas}) would produce ("${expectedIfUsingCallerRepetidas}")`, `got "${siText}"`);
  });
}

for (const fileName of TARGETS) {
  console.log(`\n================ ${fileName} ================`);
  try {
    await runScenarioA(fileName);
  } catch (e) {
    fail(`scenario (a) threw`, e.stack || String(e));
  }
  try {
    await runScenarioB(fileName);
  } catch (e) {
    fail(`scenario (b) threw`, e.stack || String(e));
  }
  try {
    await runScenarioC(fileName);
  } catch (e) {
    fail(`scenario (c) threw`, e.stack || String(e));
  }
}

console.log(`\n================ SUMMARY ================`);
console.log(`PASS: ${totalPass}  FAIL: ${totalFail}`);
if (totalFail > 0) process.exitCode = 1;
