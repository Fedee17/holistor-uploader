// ──────────────────────────────────────────────────────────────────────────────
// WEBHOOKS (sin entornos - solo producción)
// ──────────────────────────────────────────────────────────────────────────────
const BASE_WEBHOOK = 'https://fede123.app.n8n.cloud/webhook';
const WEBHOOK = {
  upload:    () => BASE_WEBHOOK + '/holistor-upload',
  procesar:  () => BASE_WEBHOOK + '/holistor-procesar',
  verificar: () => BASE_WEBHOOK + '/holistor-verificar',
  estado:    () => BASE_WEBHOOK + '/holistor-estado',
  clientes:  () => BASE_WEBHOOK + '/holistor-clientes',
  registro:  () => BASE_WEBHOOK + '/holistor-registro',
  reset:     () => BASE_WEBHOOK + '/holistor-reset'
};

const DRIVE_INDEX_DELAY_MS = 6000;
const FETCH_TIMEOUT_MS = 90000;
const POLLING_INTERVAL_MS = 5000;
const POLLING_TIMEOUT_MS = 15 * 60 * 1000;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function fetchConTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function jsonSeguro(res) {
  try { return await res.json(); } catch(e) { return {}; }
}

function periodoStr() {
  return periodo ? `${periodo.anio}-${String(periodo.mes).padStart(2,'0')}` : '';
}

// ──────────────────────────────────────────────────────────────────────────────
// STATE
// ──────────────────────────────────────────────────────────────────────────────
let periodo = null;
let forzarReproceso = false;
let clienteSeleccionado = null;
let _archivoExcelPendiente = null;
let registroSubido = false;
let archivosFallidos = [];
let files = [];
let history = [];
let uploading = false;
let subidos = 0;
let errores = 0;
let pollingInterval = null;
let pollingTimeoutMax = null;
const BATCH_FRONTEND_SIZE = 100;

// ──────────────────────────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────────────────────────
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function pluralizar(count, singular, plural = singular + 's') {
  return count === 1 ? singular : plural;
}

function getStats() {
  const stats = { pending: 0, done: 0, error: 0 };
  files.forEach(f => {
    if (f.status === 'pending') stats.pending++;
    else if (f.status === 'done') stats.done++;
    else if (f.status === 'error') stats.error++;
  });
  return stats;
}

function cacheElementos(ids) {
  const cache = {};
  ids.forEach(id => {
    cache[id] = document.getElementById(id);
  });
  return cache;
}

// Cache de elementos usados frecuentemente
const ezCache = cacheElementos(['ezTitle', 'ezSub', 'ezAction']);
const statsCache = cacheElementos(['statCola', 'statSubidos', 'statErrores']);

// ──────────────────────────────────────────────────────────────────────────────
// ALERTS
// ──────────────────────────────────────────────────────────────────────────────
function showAlert(msg, type) {
  const el = document.getElementById('alert');
  const icons = { success:'circle-check', error:'alert-circle', info:'info-circle', warn:'alert-triangle' };
  el.className = 'alert a-' + type;
  el.innerHTML = `<i class="ti ti-${icons[type]||'info-circle'}"></i><span>${msg}</span>`;
  el.style.display = 'flex';
  if (type !== 'info') setTimeout(() => el.style.display = 'none', 6000);
}

// ──────────────────────────────────────────────────────────────────────────────
// CLIENTES
// ──────────────────────────────────────────────────────────────────────────────
const CLIENTES_CACHE_KEY = 'holistor_clientes_v3';
const CLIENTES_CACHE_TTL = 5 * 60 * 1000;

async function loadClientes(forzar = false) {
  const sel = document.getElementById('selCliente');
  const hint = document.getElementById('clienteHint');
  sel.disabled = true;

  if (!forzar) {
    try {
      const cached = sessionStorage.getItem(CLIENTES_CACHE_KEY);
      if (cached) {
        const { ts, data } = JSON.parse(cached);
        if (Date.now() - ts < CLIENTES_CACHE_TTL) {
          poblarSelectClientes(sel, data);
          sel.disabled = false;
          hint.textContent = '';
          hint.className = 'field-hint';
          return;
        }
      }
    } catch(e) {}
  }

  sel.innerHTML = '<option value="">— Cargando… —</option>';
  try {
    const res = await fetchConTimeout(WEBHOOK.clientes(), {}, 30000);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const lista = await res.json();
    if (!Array.isArray(lista) || !lista.length) throw new Error('Lista vacía');
    const listaValida = lista.filter(c => 
      c && String(c.cuit||'').replace(/[^0-9]/g,'').length >= 8 && String(c.nombre||'').trim()
    );
    if (!listaValida.length) throw new Error('Lista sin clientes válidos');
    try { sessionStorage.setItem(CLIENTES_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: listaValida })); } catch(e) {}
    poblarSelectClientes(sel, listaValida);
    sel.disabled = false;
    hint.textContent = '';
    hint.className = 'field-hint';
  } catch(e) {
    sel.innerHTML = '<option value="">— Error al cargar —</option>';
    sel.disabled = false;
    hint.className = 'field-error';
    hint.innerHTML = 'No se pudo cargar la lista. <a href="#" onclick="loadClientes(true);return false;" style="color:inherit;text-decoration:underline;">Reintentar</a>';
  }
}

function poblarSelectClientes(sel, lista) {
  const frag = document.createDocumentFragment();
  const def = document.createElement('option');
  def.value = '';
  def.textContent = '— Seleccionar cliente —';
  frag.appendChild(def);
  for (const c of lista) {
    const opt = document.createElement('option');
    opt.value = escapeHtml(c.cuit);
    opt.dataset.nombre = escapeHtml(c.nombre);
    opt.textContent = escapeHtml(c.nombre);
    frag.appendChild(opt);
  }
  sel.replaceChildren(frag);
}

// ──────────────────────────────────────────────────────────────────────────────
// CLIENTE CHANGE
// ──────────────────────────────────────────────────────────────────────────────
function onClienteChange() {
  const sel = document.getElementById('selCliente');
  const opt = sel.options[sel.selectedIndex];
  const pdfsEnCola = files.filter(f => f.status === 'pending').length;
  
  if (pdfsEnCola > 0) {
    const ok = confirm(`Hay ${pdfsEnCola} PDF${pluralizar(pdfsEnCola, '', 's')} en cola. ¿Limpiar y cambiar?`);
    if (!ok) {
      sel.value = clienteSeleccionado?.cuit || '';
      return;
    }
    files = files.filter(f => f.status !== 'pending');
    renderQueue();
  }
  
  if (sel.value) {
    clienteSeleccionado = { cuit: sel.value, nombre: opt.dataset.nombre };
    if (_archivoExcelPendiente) {
      const f = _archivoExcelPendiente;
      _archivoExcelPendiente = null;
      handleExcelFile(f);
    }
    document.getElementById('clienteHint').textContent = `CUIT: ${sel.value}`;
    document.getElementById('clienteHint').className = 'field-hint';
  } else {
    clienteSeleccionado = null;
    document.getElementById('clienteHint').textContent = '';
  }
  resetRegistro();
}

// ──────────────────────────────────────────────────────────────────────────────
// PROCESO Y RESET
// ──────────────────────────────────────────────────────────────────────────────
async function resetProceso() {
  if (!confirm('¿Liberar el proceso bloqueado?')) return;
  try {
    const cuit = clienteSeleccionado?.cuit || '';
    const per = periodo ? `${periodo.anio}-${String(periodo.mes).padStart(2,'0')}` : '';
    const res = await fetchConTimeout(WEBHOOK.reset(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente_cuit: cuit, periodo: per })
    }, 30000);
    const data = await jsonSeguro(res);
    if (data.ok) {
      showAlert(`Proceso liberado. Ya podés procesar de nuevo.`, 'success');
      stopPolling();
      document.getElementById('estadoProceso').style.display = 'none';
    }
  } catch(e) {
    showAlert('No se pudo conectar con n8n.', 'error');
  }
}

function toggleForzar() {
  forzarReproceso = document.getElementById('chkForzar').checked;
  if (forzarReproceso) {
    showAlert('Modo forzar activo: los archivos serán resubidos y reprocesados.', 'warn');
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// EXCEL / REGISTRO ARCA
// ──────────────────────────────────────────────────────────────────────────────
function resetRegistro() {
  registroSubido = false;
  const zone = document.getElementById('excelZone');
  zone.classList.remove('loaded','highlight');
  const xBtn = zone.querySelector('.ez-remove');
  if (xBtn) xBtn.remove();
  ezCache.ezTitle.textContent = 'Arrastrá el Excel de ARCA o hacé clic';
  ezCache.ezSub.textContent = 'Necesario para la conciliación de comprobantes';
  ezCache.ezAction.textContent = 'Seleccionar';
  document.getElementById('excelInput').value = '';
  document.getElementById('registryWarn').style.display = 'none';
}

function focusExcelZone() {
  document.getElementById('registryWarn').style.display = 'none';
  const zone = document.getElementById('excelZone');
  zone.classList.add('highlight');
  zone.scrollIntoView({ behavior:'smooth', block:'center' });
  setTimeout(() => zone.classList.remove('highlight'), 3000);
  document.getElementById('excelInput').click();
}

function procesarSinRegistro() {
  document.getElementById('registryWarn').style.display = 'none';
  startUpload();
}

function validarArchivoExcel(file) {
  if (!file || (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls'))) {
    showAlert('El registro debe ser .xlsx de ARCA', 'error');
    return false;
  }
  return true;
}

function validarPrecondiciones() {
  if (!clienteSeleccionado) {
    showAlert('Seleccioná el cliente primero', 'warn');
    const sel = document.getElementById('selCliente');
    if (sel) { sel.scrollIntoView({ behavior:'smooth', block:'center' }); sel.focus(); }
    return false;
  }
  if (!periodo) {
    showAlert('Seleccioná el período antes', 'warn');
    return false;
  }
  return true;
}

function mostrarCargando(zone, file) {
  ezCache.ezTitle.textContent = escapeHtml(file.name);
  ezCache.ezSub.textContent = 'Leyendo comprobantes…';
  ezCache.ezAction.textContent = '';
}

async function guardarRegistroEnN8n(zone, registros, receptorCuit) {
  registroSubido = true;
  zone.classList.add('loaded');
  const existingBtn = zone.querySelector('.ez-remove');
  if (!existingBtn) {
    const xBtn = document.createElement('button');
    xBtn.className = 'ez-remove';
    xBtn.innerHTML = '<i class="ti ti-x"></i>';
    xBtn.onclick = (e) => { e.stopPropagation(); resetRegistro(); };
    zone.appendChild(xBtn);
  }
  ezCache.ezSub.textContent = `${registros.length} comprobantes · Guardando…`;
  document.getElementById('registryWarn').style.display = 'none';

  const periodoStr = `${periodo.anio}-${String(periodo.mes).padStart(2,'0')}`;
  try {
    const resReg = await fetchConTimeout(WEBHOOK.registro(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cliente_cuit: clienteSeleccionado.cuit, periodo: periodoStr, registros })
      });

    if (resReg.ok) {
      const estadoTexto = 'Registro guardado ✓';
      ezCache.ezSub.textContent = `${registros.length} comprobantes · ${estadoTexto}`;
      showAlert(`${registros.length} ${pluralizar(registros.length, 'comprobante', 'comprobantes')} guardados.`, 'success');
    } else {
      ezCache.ezSub.textContent = `⚠ Error HTTP ${resReg.status}`;
      showAlert('Error al guardar en n8n. Intentá de nuevo.', 'warn');
    }
  } catch(err) {
    const esTimeout = err.name === 'AbortError';
    ezCache.ezSub.textContent = esTimeout ? '⚠ Timeout' : '⚠ Error de red';
    showAlert(esTimeout ? 'Timeout en n8n' : `Error: ${err.message}`, 'warn');
  }
}

async function handleExcelFile(file) {
  if (!validarArchivoExcel(file)) return;
  
  if (!clienteSeleccionado) {
    _archivoExcelPendiente = file;
    showAlert('El Excel se guardará automáticamente cuando selecciones cliente', 'warn');
    document.getElementById('excelZone').classList.add('highlight');
    setTimeout(() => document.getElementById('excelZone').classList.remove('highlight'), 3000);
    return;
  }
  
  if (!periodo) {
    showAlert('Seleccioná el período antes', 'warn');
    return;
  }
  
  const zone = document.getElementById('excelZone');
  mostrarCargando(zone, file);

  let registros, receptorCuit;
  try {
    ({ registros, receptorCuit } = await parsearRegistroARCA(file));
  } catch(err) {
    ezCache.ezSub.textContent = 'Error: ' + err.message;
    showAlert('Error al leer Excel: ' + err.message, 'error');
    return;
  }

  const cuitLimpio = clienteSeleccionado.cuit.replace(/[^0-9]/g,'').padStart(11,'0');
  if (receptorCuit !== cuitLimpio) {
    ezCache.ezSub.textContent = `CUIT mismatch`;
    showAlert(`CUIT ${receptorCuit} ≠ ${clienteSeleccionado.cuit}`, 'error');
    return;
  }

  await guardarRegistroEnN8n(zone, registros, receptorCuit);
}

// ──────────────────────────────────────────────────────────────────────────────
// XLSX PARSING
// ──────────────────────────────────────────────────────────────────────────────
async function cargarXLSX() {
  if (typeof XLSX !== 'undefined') return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = res;
    s.onerror = () => rej(new Error('No se pudo cargar XLSX'));
    document.head.appendChild(s);
  });
}

function parsearRegistroARCA(file) {
  return new Promise((resolve, reject) => {
    cargarXLSX().then(() => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type:'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:null, raw:false });
        
        if (rows.length < 3) throw new Error('Archivo vacío');

        const headers = (rows[1] || []).map(h => String(h||'').trim().toLowerCase());
        const receptoresSet = new Set();
        
        for (let i = 2; i < rows.length; i++) {
          const r = rows[i];
          if (!r || r[0] === null) continue;
          const rc = String(r[10]||'').replace(/[^0-9]/g,'').padStart(11,'0');
          if (rc && rc !== '00000000000') receptoresSet.add(rc);
        }
        
        if (receptoresSet.size > 1) {
          reject(new Error(`Múltiples receptores: ${[...receptoresSet].join(', ')}`));
          return;
        }
        
        const receptorCuit = receptoresSet.size === 1 ? [...receptoresSet][0] : '00000000000';
        const registros = [];
        const periodoMM = String(periodo.mes).padStart(2,'0');
        const periodoYY = String(periodo.anio);
        
        for (let i = 2; i < rows.length; i++) {
          const r = rows[i];
          if (!r || r[0] === null) continue;

          const tipoCod = String(r[1]||'').split(' - ')[0].trim();
          const cuitEm = String(r[7]||'').replace(/[^0-9]/g,'').padStart(11,'0');
          const ptoVta = String(r[2]||'');
          const numHasta = String(r[4]||'');
          const clave = `${cuitEm}-${parseInt(tipoCod)||0}-${parseInt(ptoVta)||0}-${parseInt(numHasta)||0}`;

          registros.push({
            clave,
            cuit_emisor: cuitEm,
            tipo_cod: tipoCod,
            pto_vta: ptoVta,
            numero_hasta: numHasta,
            total: String(r[29]||''),
            denominacion_emisor: String(r[8]||''),
            fecha: String(r[0]||''),
            estado: 'pendiente'
          });
        }
        
        if (!registros.length) throw new Error('Sin comprobantes');
        resolve({ registros, receptorCuit });
      } catch(err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('No se pudo leer archivo'));
    reader.readAsArrayBuffer(file);
    }).catch(reject);
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// SUBIR Y PROCESAR
// ──────────────────────────────────────────────────────────────────────────────
function handleSubir() {
  if (!clienteSeleccionado) {
    showAlert('Seleccioná cliente', 'warn');
    return;
  }
  const pending = files.filter(f => f.status === 'pending');
  const duplicates = files.filter(f => f.status === 'duplicate');
  
  if (!pending.length && !duplicates.length) {
    showAlert('No hay archivos', 'warn');
    return;
  }
  
  if (!pending.length && duplicates.length > 0) {
    duplicates.forEach(f => { f.status = 'pending'; });
    renderQueue();
  }
  
  if (!registroSubido) {
    document.getElementById('registryWarn').style.display = 'block';
    return;
  }
  
  startUpload();
}

// ──────────────────────────────────────────────────────────────────────────────
// POLLING
// ──────────────────────────────────────────────────────────────────────────────
function stopPolling() {
  if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
  if (pollingTimeoutMax) { clearTimeout(pollingTimeoutMax); pollingTimeoutMax = null; }
}

function iniciarPolling() {
  stopPolling();
  mostrarEstadoProceso('procesando');
  files.forEach(f => { if (f.status === 'done') f.status = 'en_cola'; });
  renderQueue();
  
  pollingTimeoutMax = setTimeout(() => {
    if (pollingInterval) {
      stopPolling();
      showAlert('Procesamiento tardando demasiado. Recargá si el PRN está en Drive.', 'warn');
      mostrarEstadoProceso('listo', []);
    }
  }, POLLING_TIMEOUT_MS);

  pollingInterval = setInterval(async () => {
    try {
      const cuit = clienteSeleccionado?.cuit || '';
      const per = periodo ? `${periodo.anio}-${String(periodo.mes).padStart(2,'0')}` : '';
      const res = await fetchConTimeout(`${WEBHOOK.estado()}?cliente_cuit=${encodeURIComponent(cuit)}&periodo=${encodeURIComponent(per)}`, {}, 30000);
      if (!res.ok) return;
      const data = await jsonSeguro(res);
      if (!data) return;
      
      if (data.listo === true) {
        stopPolling();
        mostrarEstadoProceso('listo', data.fallidos);
        if (data.fallidos && data.fallidos.length > 0) mostrarFallidos(data.fallidos);
        if (data.conciliacion) mostrarConciliacion(data.conciliacion);
        files = files.filter(f => !['done','en_cola','al_prn'].includes(f.status));
        renderQueue();
      } else if (data.archivos_estado || data.progreso) {
        if (data.archivos_estado && Object.keys(data.archivos_estado).length > 0) {
          aplicarEstadosArchivos(data.archivos_estado);
        }
        if (data.progreso) {
          const { procesadas, total } = data.progreso;
          actualizarProgresoProceso(procesadas, total);
        }
      }
    } catch(e) { console.warn('Polling error:', e); }
  }, POLLING_INTERVAL_MS);
}

function aplicarEstadosArchivos(estados) {
  let actualizado = false;
  files.forEach(f => {
    const nombreBase = f.name.replace(/^\d{11}__/, '');
    const nuevoEstado = estados[f.name] || estados[nombreBase];
    if (nuevoEstado && f.status !== nuevoEstado && !['pending','error'].includes(f.status)) {
      f.status = nuevoEstado;
      actualizado = true;
    }
  });
  if (actualizado) renderQueue();
}

function actualizarProgresoProceso(procesadas, total) {
  const el = document.getElementById('_epMsg');
  if (!el) return;
  if (total > 0) {
    el.textContent = `${procesadas}/${total} al PRN…`;
  } else if (procesadas > 0) {
    el.textContent = `${procesadas} agregada${procesadas !== 1 ? 's' : ''} al PRN…`;
  }
}

function mostrarEstadoProceso(estado, fallidos) {
  const el = document.getElementById('estadoProceso');
  if (!el) return;
  
  if (estado === 'procesando') {
    el.style.display = 'flex';
    el.className = 'alert a-info';
    const rp = document.getElementById('resetPanel');
    if (rp) rp.style.display = 'block';
    el.innerHTML = '<i class="ti ti-loader" style="font-size:16px;margin-top:1px;flex-shrink:0;animation:spin 1s linear infinite;"></i><span id="_epMsg"></span>';
    document.getElementById('_epMsg').textContent = 'Procesando…';
  } else if (estado === 'listo') {
    el.style.display = 'flex';
    el.className = 'alert a-success';
    el.innerHTML = '<i class="ti ti-circle-check" style="font-size:16px;margin-top:1px;flex-shrink:0;"></i><span id="_epMsg"></span>';
    const rp = document.getElementById('resetPanel');
    if (rp) rp.style.display = 'none';
    const nf = fallidos && fallidos.length > 0;
    document.getElementById('_epMsg').textContent = nf
      ? `✓ PRN generado. ${fallidos.length} ${pluralizar(fallidos.length, 'error', 'errores')}.`
      : '✓ PRN listo. Podés importarlo en Holistor.';
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// CONCILIACIÓN
// ──────────────────────────────────────────────────────────────────────────────
function mostrarConciliacion(concil) {
  const card = document.getElementById('cardConciliacion');
  if (!concil) { card.style.display = 'none'; return; }
  card.style.display = 'block';
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const pr = concil.procesadas_registradas || [];
  const pnr = concil.procesadas_no_registro || [];
  const rnp = concil.registro_no_procesadas || [];

  document.getElementById('concilContent').innerHTML = [
    buildConcilSection('ok', 'circle-check', 'Procesadas y en registro', pr, 'ok'),
    buildConcilSection('warn', 'alert-triangle', 'Procesadas pero NO en registro', pnr, 'warn'),
    buildConcilSection('err', 'circle-x', 'En registro pero NO procesadas', rnp, 'err'),
  ].join('');

  document.querySelectorAll('#concilContent .concil-head').forEach(h => {
    const body = h.nextElementSibling;
    const count = parseInt(h.querySelector('.concil-badge')?.textContent || '0');
    if (count > 0) { h.classList.add('open'); body.classList.add('open'); }
    h.addEventListener('click', () => { h.classList.toggle('open'); body.classList.toggle('open'); });
  });
}

function buildConcilSection(type, icon, title, items, style) {
  const rows = items.slice(0, 150).map(it => `
    <div class="concil-row">
      <span class="concil-key">${escapeHtml(it.clave||'')}</span>
      <span class="concil-denom">${escapeHtml(it.denominacion||it.denominacion_emisor||'')}</span>
      <span class="concil-total">${escapeHtml(it.total||'')}</span>
    </div>`).join('');
  const extra = items.length > 150
    ? `<div style="text-align:center;padding:8px;font-size:11px;color:#999;">…y ${items.length-150} más</div>` : '';

  return `
    <div class="concil-section">
      <div class="concil-head">
        <i class="ti ti-${icon} concil-icon ci-${style}"></i>
        <span class="concil-title">${escapeHtml(title)}</span>
        <span class="concil-badge cb-${style}">${items.length}</span>
        <i class="ti ti-chevron-down concil-toggle"></i>
      </div>
      <div class="concil-body">${items.length ? rows + extra : '<div class="empty" style="padding:1rem;">Sin elementos</div>'}</div>
    </div>`;
}

// ──────────────────────────────────────────────────────────────────────────────
// FALLIDOS
// ──────────────────────────────────────────────────────────────────────────────
async function reintentar() {
  if (!archivosFallidos.length) return;
  document.querySelectorAll('#cardFallidos button').forEach(b => b.disabled = true);
  showAlert('Reintentando fallidas…', 'info');
  try {
    document.getElementById('cardFallidos').style.display = 'none';
    archivosFallidos = [];
    await sendFlush();
  } catch(e) {
    showAlert('Error al reintentar.', 'error');
  } finally {
    document.querySelectorAll('#cardFallidos button').forEach(b => b.disabled = false);
  }
}

function mostrarFallidos(fallidos) {
  if (!fallidos || !fallidos.length) return;
  archivosFallidos = fallidos;
  document.getElementById('cardFallidos').style.display = 'block';
  document.getElementById('listFallidos').innerHTML = fallidos.map(nombre => `
    <div class="history-item">
      <i class="ti ti-file-type-pdf" style="font-size:15px;color:#c5221f;flex-shrink:0;"></i>
      <span class="history-name">${escapeHtml(nombre)}</span>
      <span class="badge b-error">error</span>
    </div>`).join('');
}

// ──────────────────────────────────────────────────────────────────────────────
// STATS / QUEUE / HISTORY
// ──────────────────────────────────────────────────────────────────────────────
function updateStats() {
  const stats = getStats();
  statsCache.statCola.textContent = stats.pending;
  statsCache.statSubidos.textContent = subidos;
  statsCache.statErrores.textContent = errores;
}

function renderQueue() {
  const q = document.getElementById('queue');
  if (!files.length) { q.style.display = 'none'; updateStats(); return; }
  q.style.display = 'block';
  const pending = files.filter(f => f.status === 'pending').length;
  document.getElementById('queueLabel').textContent = `${files.length} ${pluralizar(files.length, 'archivo', 'archivos')} — ${pending} pendiente${pending!==1?'s':''}`;
  
  if (pending > 0) {
    const lotes = Math.ceil(pending / BATCH_FRONTEND_SIZE);
    document.getElementById('loteInfo').style.display = 'block';
    document.getElementById('loteInfoText').textContent = `${lotes} ${pluralizar(lotes, 'lote', 'lotes')} de ${BATCH_FRONTEND_SIZE} facturas`;
  } else {
    document.getElementById('loteInfo').style.display = 'none';
  }
  
  const labels = {
    pending:'pendiente', uploading:'verificando', done:'listo', error:'error',
    duplicate:'existe', en_cola:'cola', procesando:'procesando…',
    al_prn:'al PRN ✓', fallida:'error'
  };
  document.getElementById('fileList').innerHTML = files.map((f,i) => `
    <div class="file-item">
      <i class="ti ti-file-type-pdf" style="font-size:16px;color:#c5221f;flex-shrink:0;"></i>
      <span class="file-name">${escapeHtml(f.name)}</span>
      <span class="file-size">${(f.size/1024).toFixed(0)} KB</span>
      <span class="badge b-${f.status}">${labels[f.status]}</span>
      ${['pending','duplicate'].includes(f.status)?`<button class="btn-remove" onclick="removeFile(${i})"><i class="ti ti-x"></i></button>`:''}
    </div>`).join('');
  updateStats();
}

function renderHistory() {
  const el = document.getElementById('historyList');
  if (!history.length) {
    el.innerHTML = '<div class="empty"><i class="ti ti-inbox"></i>Todavía no se subieron archivos</div>';
    return;
  }
  el.innerHTML = history.map(h => `
    <div class="history-item">
      <i class="ti ti-file-type-pdf" style="font-size:15px;color:#c5221f;flex-shrink:0;"></i>
      <span class="history-name">${escapeHtml(h.name)}</span>
      <span class="history-time">${h.time}</span>
      <span class="badge ${h.ok?'b-done':'b-error'}">${h.ok?'subido':'error'}</span>
    </div>`).join('');
}

// ──────────────────────────────────────────────────────────────────────────────
// VERIFICAR DUPLICADO Y AGREGAR ARCHIVOS
// ──────────────────────────────────────────────────────────────────────────────
async function verificarDuplicado(nombre) {
  try {
    const cuit = clienteSeleccionado?.cuit || '';
    if (!cuit) return false;
    const res = await fetchConTimeout(WEBHOOK.verificar(), {
      method:'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, cliente_cuit: cuit })
    }, 45000);
    if (!res.ok) return 'error';
    const data = await jsonSeguro(res);
    return data.existe === true;
  } catch(e) { return 'error'; }
}

async function addFiles(newFiles) {
  const pdfs = Array.from(newFiles).filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
  if (!pdfs.length) { showAlert('Solo PDFs', 'error'); return; }

  // Si todavía no hay cliente, no se puede verificar duplicado con el prefijo CUIT.
  // Los agregamos como pendientes y se subirán cuando el usuario elija cliente.
  if (!clienteSeleccionado || forzarReproceso) {
    pdfs.forEach(f => files.push({ name: f.name, size: f.size, file: f, status: 'pending' }));
    renderQueue();
    if (!clienteSeleccionado) showAlert('Seleccioná cliente antes de subir; la verificación de duplicados se hará al procesar.', 'warn');
    return;
  }

  const tempItems = pdfs.map(f => ({ name: f.name, size: f.size, file: f, status: 'uploading', _temp: true }));
  tempItems.forEach(t => files.push(t));
  renderQueue();

  const CONCURRENCY_VERIF = 10;
  const resultados = new Array(pdfs.length);
  let nextIdx = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY_VERIF, pdfs.length) }, async () => {
    while (true) {
      const i = nextIdx++;
      if (i >= pdfs.length) break;
      resultados[i] = await verificarDuplicado(pdfs[i].name);
    }
  }));

  pdfs.forEach((f, i) => {
    const item = tempItems[i];
    item.status = resultados[i] === true ? 'duplicate' : resultados[i] === 'error' ? 'error' : 'pending';
    delete item._temp;
  });
  renderQueue();
}

function removeFile(idx) {
  files.splice(idx, 1);
  renderQueue();
}

function clearPending() {
  files = files.filter(f => f.status !== 'pending');
  renderQueue();
}

// ──────────────────────────────────────────────────────────────────────────────
// UPLOAD Y PROCESAMIENTO
// ──────────────────────────────────────────────────────────────────────────────
function setUploadControlsDisabled(disabled) {
  ['btnSubir', 'btnProcesar', 'selCliente', 'selMes', 'selAnio', 'chkForzar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
  });
}

async function subirUnPDF(item) {
  const fd = new FormData();
  fd.append('file', item.file, item.name);
  fd.append('cliente_cuit', clienteSeleccionado.cuit);
  fd.append('cliente_nombre', clienteSeleccionado.nombre || '');
  fd.append('mes', String(periodo.mes));
  fd.append('anio', String(periodo.anio));
  fd.append('periodo', periodoStr());

  const res = await fetchConTimeout(WEBHOOK.upload(), { method: 'POST', body: fd }, FETCH_TIMEOUT_MS);
  const data = await jsonSeguro(res);
  if (!res.ok || data.ok === false) {
    throw new Error(data.mensaje || `HTTP ${res.status}`);
  }
  return data;
}

async function startUpload() {
  if (uploading) return;
  if (!validarPrecondiciones()) return;

  // Los duplicados se pueden reprocesar si el usuario los deja en cola o activa forzar.
  files.forEach(f => { if (f.status === 'duplicate' && forzarReproceso) f.status = 'pending'; });
  const pending = files.filter(f => f.status === 'pending');
  if (!pending.length) {
    showAlert('No hay PDFs pendientes para subir.', 'warn');
    return;
  }

  uploading = true;
  setUploadControlsDisabled(true);
  showAlert(`Subiendo ${pending.length} ${pluralizar(pending.length, 'PDF', 'PDFs')}…`, 'info');

  for (const item of pending) {
    try {
      item.status = 'uploading';
      renderQueue();
      await subirUnPDF(item);
      item.status = 'done';
      subidos++;
      history.unshift({ name: item.name, ok: true, time: new Date().toLocaleTimeString() });
    } catch (err) {
      item.status = 'error';
      errores++;
      history.unshift({ name: item.name, ok: false, time: new Date().toLocaleTimeString() });
      const detalle = err.name === 'AbortError' ? 'timeout' : err.message;
      console.error('Error subiendo PDF', item.name, err);
      showAlert(`Error subiendo ${escapeHtml(item.name)}: ${escapeHtml(detalle)}`, 'error');
    }
    renderQueue();
    renderHistory();
  }

  uploading = false;
  setUploadControlsDisabled(false);
  updateStats();

  const subidosOk = files.some(f => f.status === 'done');
  if (!subidosOk) {
    showAlert('No se pudo subir ningún PDF. Revisá conexión o n8n.', 'error');
    return;
  }

  showAlert('PDFs subidos. Esperando indexación de Drive antes de procesar…', 'info');
  await sleep(DRIVE_INDEX_DELAY_MS);
  await sendFlush();
}

async function sendFlush() {
  if (!validarPrecondiciones()) return;

  try {
    const res = await fetchConTimeout(WEBHOOK.procesar(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        flush: true,
        mes: periodo.mes,
        anio: periodo.anio,
        periodo: periodoStr(),
        cliente_cuit: clienteSeleccionado.cuit,
        cliente_nombre: clienteSeleccionado.nombre || '',
        tiene_registro: registroSubido
      })
    }, FETCH_TIMEOUT_MS);
    const data = await jsonSeguro(res);

    if (!res.ok || data.ok === false) {
      throw new Error(data.mensaje || `HTTP ${res.status}`);
    }

    if (data.proceso_ya_activo === true) {
      showAlert(data.mensaje || 'Ya hay un proceso activo para este cliente y período.', 'warn');
    } else {
      showAlert('Procesamiento iniciado en n8n.', 'success');
    }
    iniciarPolling();
  } catch (err) {
    const detalle = err.name === 'AbortError' ? 'timeout al iniciar procesamiento' : err.message;
    showAlert(`No se pudo iniciar el procesamiento: ${escapeHtml(detalle)}`, 'error');
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// EVENTOS Y PERÍODO
// ──────────────────────────────────────────────────────────────────────────────
function actualizarPeriodo() {
  const mes = parseInt(document.getElementById('selMes').value);
  const anio = parseInt(document.getElementById('selAnio').value);
  if (mes && anio) {
    periodo = { mes, anio };
    document.getElementById('periodoInfo').textContent = `${mes}/${anio}`;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// INIT
// ──────────────────────────────────────────────────────────────────────────────
function initApp() {
  // Años
  const selAnio = document.getElementById('selAnio');
  const currentYear = new Date().getFullYear();
  for (let y = currentYear - 2; y <= currentYear + 1; y++) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    if (y === currentYear) opt.selected = true;
    selAnio.appendChild(opt);
  }

  loadClientes();

  // Drop zone - PDFs
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => addFiles(e.target.files));
  
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
    dropZone.addEventListener(evt, (e) => e.preventDefault());
  });
  dropZone.addEventListener('dragover', () => dropZone.classList.add('dragover'));
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    dropZone.classList.remove('dragover');
    addFiles(e.dataTransfer.files);
  });

  // Excel zone
  const excelZone = document.getElementById('excelZone');
  const excelInput = document.getElementById('excelInput');
  
  excelZone.addEventListener('click', () => {
    if (!registroSubido) excelInput.click();
  });
  excelInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleExcelFile(e.target.files[0]);
  });
  
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
    excelZone.addEventListener(evt, (e) => e.preventDefault());
  });
  excelZone.addEventListener('dragover', () => excelZone.classList.add('dragover'));
  excelZone.addEventListener('dragleave', () => excelZone.classList.remove('dragover'));
  excelZone.addEventListener('drop', (e) => {
    excelZone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleExcelFile(e.dataTransfer.files[0]);
  });

  // Período
  const today = new Date();
  document.getElementById('selMes').value = today.getMonth() + 1;
  document.getElementById('selAnio').value = today.getFullYear();
  actualizarPeriodo();
}


// Compatibilidad con handlers inline del HTML estático.
Object.assign(window, {
  loadClientes,
  onClienteChange,
  actualizarPeriodo,
  focusExcelZone,
  procesarSinRegistro,
  handleSubir,
  sendFlush,
  clearPending,
  toggleForzar,
  resetProceso,
  reintentar,
  removeFile
});

window.addEventListener('DOMContentLoaded', initApp);