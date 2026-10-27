#!/usr/bin/env node
// Automated test for the uploader page (index.html and index-test.html):
//  (a)(b)(c) the "escaneo" popup: manejarResultadoEscaneo / mostrarCartelEscaneo / sendFlush
//  (d)       HTML escaping of server-supplied messages in the three alerts that show them
//            (audit finding H-13) -- and that the two alerts that *intentionally* contain
//            <br>/<b> keep rendering them as HTML.
//
// Approach: load the real file as a file:// page in a headless Chromium (Playwright),
// intercept the n8n webhook calls at the network layer (page.route) so nothing ever
// leaves the machine, drive the real in-page functions (plain top-level `function`
// declarations, reachable as window.<name>()), and inspect the real DOM the app builds.
//
// Two modes:
//   default                 -> runs against the files in the repo root (unpatched) and
//                              asserts the CURRENT behaviour, including the two known
//                              defects (finding H-10 inflated count, H-13 unescaped message).
//   HOLISTOR_EXPECT_PATCHED=1 -> asserts the FIXED behaviour. Point HOLISTOR_DIR at a
//                              directory holding copies of both files with the patches
//                              02..06 applied (never the repo working tree itself).
//
// Run with:
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node audit-2026-10-07/test-escaneo-popup.mjs
//   HOLISTOR_DIR=/path/to/patched HOLISTOR_EXPECT_PATCHED=1 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
//     node audit-2026-10-07/test-escaneo-popup.mjs
// (requires the globally installed `playwright` package and the chromium browser already
// present at $PLAYWRIGHT_BROWSERS_PATH; do NOT run `playwright install`.)

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const TARGET_DIR = process.env.HOLISTOR_DIR ? path.resolve(process.env.HOLISTOR_DIR) : REPO_ROOT;
const EXPECT_PATCHED = process.env.HOLISTOR_EXPECT_PATCHED === '1';

const require = createRequire(import.meta.url);
const globalNodeModules = execSync('npm root -g').toString().trim();
const playwrightEntry = require.resolve('playwright', { paths: [globalNodeModules] });
const playwrightModule = await import(playwrightEntry);
const { chromium } = playwrightModule.default ?? playwrightModule;

const TARGETS = ['index.html', 'index-test.html'];

// Everything below is synthetic. No real client, token or document id appears here.
const FAKE_TOKEN = 'test-token-automatizado';
const FAKE_CLIENTE = { cuit: '20111111111', nombre: 'Cliente De Prueba' };
const FAKE_PDF = { name: 'factura_prueba.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% archivo de prueba, no es una factura real\n') };

let totalPass = 0;
let totalFail = 0;

function ok(desc) { totalPass++; console.log(`  [PASS] ${desc}`); }
function fail(desc, detail) { totalFail++; console.log(`  [FAIL] ${desc}${detail ? ' -- ' + detail : ''}`); }
function assert(cond, desc, detail) { if (cond) ok(desc); else fail(desc, detail); }

// mocks: { procesar(postData) -> body, candado() -> body, upload() -> body }
async function withPage(fileName, fn, mocks = {}) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    page.on('dialog', async (d) => {
      try { if (d.type() === 'prompt') await d.accept(FAKE_TOKEN); else await d.accept(); } catch (e) { /* ignore */ }
    });

    const capturedProcesar = [];
    const capturedAlerts = [];
    await page.exposeFunction('__reportAlert', (msg, type) => { capturedAlerts.push({ msg, type }); });

    const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    await page.route('**/webhook/**', async (route) => {
      const url = route.request().url();
      const postData = route.request().postData();
      if (url.includes('holistor-clientes')) return route.fulfill(json([FAKE_CLIENTE]));
      if (url.includes('holistor-procesar')) {
        capturedProcesar.push({ url, postData });
        return route.fulfill(json(mocks.procesar ? mocks.procesar(postData) : { ok: true, listo: false }));
      }
      if (url.includes('holistor-candado')) return route.fulfill(json(mocks.candado ? mocks.candado() : { bloqueado: false }));
      if (url.includes('holistor-upload')) return route.fulfill(json(mocks.upload ? mocks.upload() : { ok: true }));
      return route.fulfill(json({ ok: true }));
    });

    await page.goto('file://' + path.join(TARGET_DIR, fileName), { waitUntil: 'load' });
    await page.waitForFunction(() => {
      const sel = document.getElementById('selCliente');
      return sel && !sel.disabled && sel.options.length > 1;
    }, { timeout: 15000 });

    await page.evaluate(() => {
      const orig = window.showAlert;
      window.showAlert = function (msg, type, sinPopup) {
        window.__reportAlert(String(msg), String(type));
        return orig.call(this, msg, type, sinPopup);
      };
    });

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
    const data = { nuevas_en_escaneo: [], ya_procesadas: [{ emisor: 'Proveedor A', procesada_en: '2026-10-01T10:00:00Z' }], duplicados_en_lote: [] };
    await page.evaluate((d) => window.manejarResultadoEscaneo(d), data);
    assert(!!(await page.$('#modalEscaneoFondo')), 'modal #modalEscaneoFondo appears');
    const siText = ((await page.textContent('#btnEscaneoSi').catch(() => null)) || '').trim();
    const noText = ((await page.textContent('#btnEscaneoNo').catch(() => null)) || '').trim();
    assert(noText === 'No, dejar así', 'btnEscaneoNo label is "No, dejar así"', `got "${noText}"`);
    assert(siText === 'Sí, reprocesar', 'btnEscaneoSi label is "Sí, reprocesar"', `got "${siText}"`);
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
    const nuevasN = 2, repetidasM = 3;
    const data = {
      nuevas_en_escaneo: Array.from({ length: nuevasN }, (_, i) => ({ pdf: `nueva_${i}.pdf` })),
      ya_procesadas: Array.from({ length: repetidasM }, (_, i) => ({ emisor: `Proveedor ${i}`, procesada_en: '2026-10-01T10:00:00Z' })),
      duplicados_en_lote: [],
    };
    await page.evaluate((d) => window.manejarResultadoEscaneo(d), data);
    const noText = ((await page.textContent('#btnEscaneoNo').catch(() => null)) || '').trim();
    const siText = ((await page.textContent('#btnEscaneoSi').catch(() => null)) || '').trim();
    assert(noText === `Solo las nuevas (${nuevasN})`, `btnEscaneoNo label is "Solo las nuevas (${nuevasN})"`, `got "${noText}"`);
    assert(siText === `Reprocesar todas (${nuevasN + repetidasM})`, `btnEscaneoSi label is "Reprocesar todas (${nuevasN + repetidasM})"`, `got "${siText}"`);
    await page.click('#btnEscaneoNo');
    await page.waitForTimeout(150);
    assert(capturedProcesar.length === 1, 'one POST fired after "Solo las nuevas"', `got ${capturedProcesar.length}`);
    assert(lastForzar(capturedProcesar) === false, '"Solo las nuevas" -> sendFlush(false,false) -> forzar:false');
    await page.evaluate((d) => window.manejarResultadoEscaneo(d), data);
    await page.click('#btnEscaneoSi');
    await page.waitForTimeout(150);
    assert(capturedProcesar.length === 2, 'a second POST fired after "Reprocesar todas"', `got ${capturedProcesar.length}`);
    assert(lastForzar(capturedProcesar) === true, '"Reprocesar todas" -> sendFlush(true,false) -> forzar:true');
  });
}

async function runScenarioC(fileName) {
  console.log(`\n[${fileName}] Scenario (c): duplicadasLote present -- warn alert + button count (finding H-10)`);
  await withPage(fileName, async ({ page, capturedAlerts }) => {
    const nuevasN = 1, yaProcesadasM = 2, duplicadasLoteK = 2;
    const data = {
      nuevas_en_escaneo: Array.from({ length: nuevasN }, (_, i) => ({ pdf: `nueva_${i}.pdf` })),
      ya_procesadas: Array.from({ length: yaProcesadasM }, (_, i) => ({ emisor: `Proveedor ${i}`, procesada_en: '2026-10-01T10:00:00Z' })),
      duplicados_en_lote: Array.from({ length: duplicadasLoteK }, (_, i) => ({ pdf: `dup_${i}.pdf` })),
    };
    await page.evaluate((d) => window.manejarResultadoEscaneo(d), data);
    await page.waitForTimeout(50);

    const warnAlert = capturedAlerts.find(a => a.type === 'warn' && /repetida/.test(a.msg));
    assert(!!warnAlert, `showAlert('warn', ...) fired for the ${duplicadasLoteK} in-batch duplicate(s)`, JSON.stringify(capturedAlerts));
    if (warnAlert) assert(warnAlert.msg.includes(String(duplicadasLoteK)), `warn alert text mentions the count (${duplicadasLoteK})`, warnAlert.msg);

    // The server reprocesses nuevas + ya_procesadas only; in-batch duplicates are discarded.
    const correct = `Reprocesar todas (${nuevasN + yaProcesadasM})`;
    const inflated = `Reprocesar todas (${nuevasN + yaProcesadasM + duplicadasLoteK})`;
    const siText = ((await page.textContent('#btnEscaneoSi').catch(() => null)) || '').trim();
    if (EXPECT_PATCHED) {
      assert(siText === correct, `[patched] btnEscaneoSi counts only nuevas + ya_procesadas -> "${correct}"`, `got "${siText}"`);
    } else {
      assert(siText === inflated, `[unpatched] btnEscaneoSi still counts in-batch duplicates -> "${inflated}" (finding H-10 reproduced)`, `got "${siText}"`);
      assert(siText !== correct, `[unpatched] ...and therefore differs from the correct "${correct}"`, `got "${siText}"`);
    }
  });
}

// ---- Scenario (d): HTML escaping of server-supplied messages (finding H-13) ----
const INJ = '<b id="inyectado">INYECTADO</b>';

async function alertSpanHtml(page) {
  return page.evaluate(() => { const s = document.querySelector('#alert span'); return s ? s.innerHTML : null; });
}
async function popupSpanHtml(page) {
  return page.evaluate(() => { const s = document.querySelector('#alertaPopupFondo span'); return s ? s.innerHTML : null; });
}
async function queueOnePdf(page) {
  await page.setInputFiles('#fileInput', [FAKE_PDF]);
  await page.waitForTimeout(100);
}
async function makeStartUploadFast(page) {
  // Both are plain top-level function declarations -> reassignable via window.
  await page.evaluate(() => {
    window.sleep = () => Promise.resolve();
    window.calcularEsperaIndexacion = () => 0;
  });
}

async function runScenarioD1(fileName) {
  console.log(`\n[${fileName}] Scenario (d1): holistor-procesar answers proceso_ya_activo with HTML in 'mensaje' (line ~3041)`);
  await withPage(fileName, async ({ page }) => {
    await page.evaluate(() => window.sendFlush(false, false));
    await page.waitForTimeout(200);
    const html = await alertSpanHtml(page);
    assert(html !== null && /INYECTADO/.test(html), 'the top alert shows the server message', `got ${JSON.stringify(html)}`);
    const rendered = await page.$('#alert #inyectado');
    if (EXPECT_PATCHED) {
      assert(!rendered, '[patched] the <b> from the server is NOT rendered as an element', html);
      assert(html.includes('&lt;b id="inyectado"&gt;INYECTADO&lt;/b&gt;'), '[patched] the <b> from the server is shown as literal text', html);
    } else {
      assert(!!rendered, '[unpatched] the <b> from the server IS rendered as an element (finding H-13 reproduced)', html);
    }
  }, { procesar: () => ({ ok: true, proceso_ya_activo: true, mensaje: `Lo está procesando ${INJ} desde otra sesión.` }) });
}

async function runScenarioD2(fileName) {
  console.log(`\n[${fileName}] Scenario (d2): candado bloqueado before upload (line ~2647) -- escaped message + real <br>`);
  await withPage(fileName, async ({ page }) => {
    await queueOnePdf(page);
    await page.evaluate(() => window.startUpload());
    await page.waitForSelector('#alertaPopupFondo', { timeout: 5000 }).catch(() => null);
    const html = await popupSpanHtml(page);
    assert(html !== null, 'error popup appears', 'no #alertaPopupFondo');
    if (html === null) return;
    assert(!(await page.$('#alertaPopupFondo #inyectado')), 'server message is escaped (no <b> element from the server)', html);
    assert(html.includes('&lt;b id="inyectado"&gt;INYECTADO&lt;/b&gt;'), 'server message is shown as literal text', html);
    const brs = await page.$$eval('#alertaPopupFondo span br', els => els.length);
    assert(brs >= 1, `the page's own <br> is still rendered as HTML (${brs} <br>)`, html);
    assert(/No se subió ningún PDF/.test(html), "the page's own text follows the server message", html);
  }, { candado: () => ({ bloqueado: true, mensaje: `Lo procesa ${INJ} en otra sesión.` }) });
}

async function runScenarioD3(fileName) {
  console.log(`\n[${fileName}] Scenario (d3): server rejects 'procesar' with proceso_ya_activo after upload (line ~2781) -- escaped message + real <br>/<b>`);
  await withPage(fileName, async ({ page }) => {
    await makeStartUploadFast(page);
    await queueOnePdf(page);
    await page.evaluate(() => window.startUpload());
    await page.waitForFunction(() => {
      const s = document.querySelector('#alertaPopupFondo span');
      return s && /no los vuelvas a subir/.test(s.textContent || '');
    }, { timeout: 10000 }).catch(() => null);
    const html = await popupSpanHtml(page);
    assert(html !== null && /no los vuelvas a subir/.test(html), 'the "ya lo está procesando otra persona" popup appears', `got ${JSON.stringify(html)}`);
    if (!html) return;
    assert(!(await page.$('#alertaPopupFondo #inyectado')), 'server message is escaped (no <b> element from the server)', html);
    assert(html.includes('&lt;b id="inyectado"&gt;INYECTADO&lt;/b&gt;'), 'server message is shown as literal text', html);
    const ownBold = await page.$$eval('#alertaPopupFondo span b', els => els.map(e => e.textContent));
    assert(ownBold.includes('no los vuelvas a subir'), "the page's own <b> is still rendered as HTML", JSON.stringify(ownBold));
    const brs = await page.$$eval('#alertaPopupFondo span br', els => els.length);
    assert(brs >= 1, `the page's own <br> is still rendered as HTML (${brs} <br>)`, html);
  }, {
    candado: () => ({ bloqueado: false }),
    upload: () => ({ ok: true }),
    procesar: () => ({ ok: false, proceso_ya_activo: true, mensaje: `Ya corre ${INJ} para este cliente.` }),
  });
}

console.log(`Target dir: ${TARGET_DIR}   mode: ${EXPECT_PATCHED ? 'EXPECT PATCHED behaviour' : 'EXPECT CURRENT (unpatched) behaviour'}`);
for (const fileName of TARGETS) {
  console.log(`\n================ ${fileName} ================`);
  for (const [label, fn] of [['a', runScenarioA], ['b', runScenarioB], ['c', runScenarioC], ['d1', runScenarioD1], ['d2', runScenarioD2], ['d3', runScenarioD3]]) {
    try { await fn(fileName); } catch (e) { fail(`scenario (${label}) threw`, e.stack || String(e)); }
  }
}

console.log(`\n================ SUMMARY ================`);
console.log(`PASS: ${totalPass}  FAIL: ${totalFail}`);
if (totalFail > 0) process.exitCode = 1;
