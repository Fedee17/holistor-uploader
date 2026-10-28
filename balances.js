// ============================================================
// Balances Bancarios — lógica de la página
// Todo el código de este archivo usa nombres con prefijo
// "balances" para no chocar nunca con el JS de Holistor.
// ============================================================

const BALANCES_URL_BASE = 'https://fede123.app.n8n.cloud/webhook';

// Tiempos del seguimiento y de los pedidos (fáciles de cambiar acá)
// Cada consulta de balances-estado cuenta como una ejecución de n8n: se consulta rápido al
// principio y después más espaciado.
const BALANCES_POLLING_RAPIDO_MS = 3000;              // espera entre consultas durante los primeros instantes
const BALANCES_POLLING_RAPIDO_DURANTE_MS = 30 * 1000; // cuánto dura ese ritmo rápido, desde que arranca el seguimiento
const BALANCES_POLLING_LENTO_MS = 10 * 1000;          // espera entre consultas pasado ese tiempo
const BALANCES_ESTADO_LIMITE_PEDIDO_MS = 30 * 1000;   // límite de cada consulta de estado
// Espera después de cada fallo seguido, antes de reintentar. Al fallo número (largo + 1) se rinde.
const BALANCES_REINTENTOS_ESPERA_MS = [5 * 1000, 15 * 1000, 40 * 1000];
const BALANCES_RETRY_AFTER_MAXIMO_MS = 60 * 1000;     // tope de la espera pedida por el servidor (429/503 con Retry-After)
const BALANCES_TIMEOUT_MINIMO_MS = 5 * 60 * 1000;     // tiempo máximo de seguimiento, como mínimo
const BALANCES_TIMEOUT_POR_PDF_MS = 60 * 1000;        // minutos extra de seguimiento por cada PDF subido
const BALANCES_LIMITE_RESET_MS = 60 * 1000;
const BALANCES_LIMITE_UPLOAD_MS = 180 * 1000;
const BALANCES_LIMITE_PROCESAR_MS = 60 * 1000;

// Estado en memoria de esta pestaña (se pierde al recargar, es normal)
const balancesEstado = {
  clientes: [],           // [{cliente, bancos: [...]}, ...]
  archivos: [],           // File[] elegidos por el usuario, pendientes de procesar
  ultimoProceso: null,    // {cliente, totalPdfs} del último proceso iniciado, para poder volver a consultar su estado
};

// ------------------------------------------------------------
// Referencias a elementos del DOM (se buscan una sola vez al cargar)
// ------------------------------------------------------------

const el = {
  selectCliente: document.getElementById('balances-select-cliente'),
  bancosHabilitados: document.getElementById('balances-bancos-habilitados'),
  btnMostrarAlta: document.getElementById('balances-btn-mostrar-alta'),

  seccionAlta: document.getElementById('balances-seccion-alta'),
  altaCliente: document.getElementById('balances-alta-cliente'),
  altaBanco: document.getElementById('balances-alta-banco'),
  btnConfirmarAlta: document.getElementById('balances-btn-confirmar-alta'),
  btnCancelarAlta: document.getElementById('balances-btn-cancelar-alta'),
  altaMensaje: document.getElementById('balances-alta-mensaje'),

  zonaDrop: document.getElementById('balances-zona-drop'),
  inputArchivos: document.getElementById('balances-input-archivos'),
  listaArchivos: document.getElementById('balances-lista-archivos'),
  btnProcesar: document.getElementById('balances-btn-procesar'),

  seccionEstado: document.getElementById('balances-seccion-estado'),
  barraProgreso: document.getElementById('balances-barra-progreso-relleno'),
  estadoTexto: document.getElementById('balances-estado-texto'),

  seccionResultados: document.getElementById('balances-seccion-resultados'),
  resultadoResumen: document.getElementById('balances-resultado-resumen'),
  resultadoAvisos: document.getElementById('balances-resultado-avisos'),
  resultadoFallos: document.getElementById('balances-resultado-fallos'),
  btnReconsultar: document.getElementById('balances-btn-reconsultar'),
  btnNuevaCarga: document.getElementById('balances-btn-nueva-carga'),
};

// ------------------------------------------------------------
// Paso 1: cargar la lista de clientes desde el webhook
// ------------------------------------------------------------

async function balancesCargarClientes() {
  el.selectCliente.innerHTML = '<option value="">Cargando clientes…</option>';

  try {
    const resp = await fetch(`${BALANCES_URL_BASE}/balances-clientes`);
    if (!resp.ok) throw new Error('El servidor respondió con un error');
    const data = await resp.json();

    balancesEstado.clientes = data.clientes || [];

    if (balancesEstado.clientes.length === 0) {
      el.selectCliente.innerHTML = '<option value="">No hay clientes cargados todavía</option>';
      return;
    }

    el.selectCliente.innerHTML = '<option value="" disabled selected hidden>Elegí un cliente</option>' +
      balancesEstado.clientes
        .map(c => `<option value="${balancesEscapar(c.cliente)}">${balancesEscapar(c.cliente)}</option>`)
        .join('');

  } catch (err) {
    el.selectCliente.innerHTML = '<option value="">No se pudo cargar la lista</option>';
    console.error('Error cargando clientes:', err);
  }
}

// Escapa texto para que no rompa el HTML si un nombre de cliente
// tuviera caracteres especiales (< > & " ' etc.), también dentro de atributos
function balancesEscapar(texto) {
  const d = document.createElement('div');
  d.textContent = texto;
  return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Cuando cambia el cliente elegido, mostramos qué bancos tiene habilitados
// y habilitamos/deshabilitamos el botón de procesar según haya archivos.
el.selectCliente.addEventListener('change', () => {
  const nombre = el.selectCliente.value;
  const info = balancesEstado.clientes.find(c => c.cliente === nombre);

  el.bancosHabilitados.textContent = info
    ? `Bancos habilitados: ${info.bancos.join(', ')}`
    : '';

  el.btnProcesar.disabled = balancesEstado.archivos.length === 0 || !el.selectCliente.value;
});

// ------------------------------------------------------------
// Formulario de alta de cliente/banco
// ------------------------------------------------------------

el.btnMostrarAlta.addEventListener('click', () => {
  el.seccionAlta.hidden = false;
  el.altaMensaje.textContent = '';
  el.altaMensaje.className = 'balances-nota';
});

el.btnCancelarAlta.addEventListener('click', () => {
  el.seccionAlta.hidden = true;
  el.altaCliente.value = '';
  el.altaBanco.value = '';
});

el.btnConfirmarAlta.addEventListener('click', async () => {
  const cliente = el.altaCliente.value.trim();
  const banco = el.altaBanco.value;

  if (!cliente) {
    balancesMostrarMensajeAlta('Escribí el nombre del cliente.', 'error');
    return;
  }
  if (!banco) {
    balancesMostrarMensajeAlta('Elegí un banco.', 'error');
    return;
  }

  el.btnConfirmarAlta.disabled = true;
  balancesMostrarMensajeAlta('Guardando…', 'nota');

  try {
    const resp = await fetch(`${BALANCES_URL_BASE}/balances-agregar-cliente-banco`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente, banco }),
    });
    const data = await resp.json();

    if (!data.ok) {
      balancesMostrarMensajeAlta(data.error || 'No se pudo guardar.', 'error');
      return;
    }

    balancesMostrarMensajeAlta(data.mensaje, data.yaExistia ? 'alerta' : 'exito');

    // Refrescamos la lista de clientes para que el nuevo aparezca en el desplegable
    await balancesCargarClientes();
    el.selectCliente.value = cliente;
    el.selectCliente.dispatchEvent(new Event('change'));

    if (!data.yaExistia) {
      el.altaCliente.value = '';
      el.altaBanco.value = '';
    }

  } catch (err) {
    balancesMostrarMensajeAlta('No se pudo conectar con el servidor.', 'error');
    console.error('Error agregando cliente/banco:', err);
  } finally {
    el.btnConfirmarAlta.disabled = false;
  }
});

function balancesMostrarMensajeAlta(texto, tipo) {
  el.altaMensaje.textContent = texto;
  el.altaMensaje.className = tipo === 'error' ? 'balances-mensaje balances-mensaje-error'
    : tipo === 'exito' ? 'balances-mensaje balances-mensaje-exito'
    : tipo === 'alerta' ? 'balances-mensaje balances-mensaje-alerta'
    : 'balances-nota';
}

// ------------------------------------------------------------
// Carga de archivos (drag & drop + selector)
// ------------------------------------------------------------

el.zonaDrop.addEventListener('click', () => el.inputArchivos.click());

el.zonaDrop.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' || ev.key === ' ') {
    ev.preventDefault();
    el.inputArchivos.click();
  }
});

el.inputArchivos.addEventListener('change', () => {
  balancesAgregarArchivos(el.inputArchivos.files);
  el.inputArchivos.value = ''; // permite volver a elegir el mismo archivo si lo saca y lo vuelve a poner
});

el.zonaDrop.addEventListener('dragover', (ev) => {
  ev.preventDefault();
  el.zonaDrop.classList.add('balances-dropzone-activa');
});

el.zonaDrop.addEventListener('dragleave', () => {
  el.zonaDrop.classList.remove('balances-dropzone-activa');
});

el.zonaDrop.addEventListener('drop', (ev) => {
  ev.preventDefault();
  el.zonaDrop.classList.remove('balances-dropzone-activa');
  balancesAgregarArchivos(ev.dataTransfer.files);
});

function balancesAgregarArchivos(fileList) {
  for (const archivo of fileList) {
    if (archivo.type !== 'application/pdf') continue; // ignora lo que no sea PDF, sin avisar (son pocos casos, no vale la pena un mensaje)

    const yaEstaba = balancesEstado.archivos.some(a => a.name === archivo.name && a.size === archivo.size);
    if (yaEstaba) continue;

    balancesEstado.archivos.push(archivo);
  }
  balancesRenderizarListaArchivos();
}

function balancesQuitarArchivo(indice) {
  balancesEstado.archivos.splice(indice, 1);
  balancesRenderizarListaArchivos();
}

function balancesRenderizarListaArchivos() {
  el.listaArchivos.innerHTML = balancesEstado.archivos
    .map((archivo, i) => `
      <li>
        <span>${balancesEscapar(archivo.name)}</span>
        <button type="button" class="balances-archivo-quitar" data-indice="${i}" aria-label="Quitar ${balancesEscapar(archivo.name)}">✕</button>
      </li>
    `).join('');

  el.listaArchivos.querySelectorAll('.balances-archivo-quitar').forEach(boton => {
    boton.addEventListener('click', () => balancesQuitarArchivo(Number(boton.dataset.indice)));
  });

  el.btnProcesar.disabled = balancesEstado.archivos.length === 0 || !el.selectCliente.value;
}

// ------------------------------------------------------------
// Convertir un archivo a base64 (lo que espera n8n)
// ------------------------------------------------------------

function balancesArchivoABase64(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => {
      // readAsDataURL devuelve algo como "data:application/pdf;base64,JVBERi0..."
      // n8n solo necesita la parte de después de la coma
      const base64 = lector.result.split(',')[1];
      resolve(base64);
    };
    lector.onerror = () => reject(new Error(`No se pudo leer el archivo ${archivo.name}`));
    lector.readAsDataURL(archivo);
  });
}

// ------------------------------------------------------------
// Pedido con límite de tiempo. Si leerJson es true, la lectura del cuerpo
// también cuenta dentro del límite. Devuelve { resp, data }: data es null
// si la respuesta no era JSON válido (o si no se pidió leerlo).
// ------------------------------------------------------------

async function balancesFetchConLimite(url, opciones, limiteMs, leerJson = false) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), limiteMs);
  try {
    const resp = await fetch(url, { ...opciones, signal: ctrl.signal });
    let data = null;
    if (leerJson) {
      try {
        data = await resp.json();
      } catch (errJson) {
        if (errJson.name === 'AbortError') throw errJson;
        data = null;
      }
    }
    return { resp, data };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Se agotó el tiempo de espera del servidor.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------
// Procesar: reset → upload → procesar (async) → polling de estado
// ------------------------------------------------------------

el.btnProcesar.addEventListener('click', balancesProcesarTodo);

async function balancesProcesarTodo() {
  const cliente = el.selectCliente.value;
  if (!cliente || balancesEstado.archivos.length === 0) return;

  balancesMostrarSeccionEstado(true);
  balancesActualizarProgreso(10, 'Preparando…');

  let siguiendoEstado = false; // true cuando ya pasaron reset/upload/procesar y solo queda consultar el estado

  try {
    // 1. Reset del proceso de este cliente
    const { resp: respReset } = await balancesFetchConLimite(`${BALANCES_URL_BASE}/balances-reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente }),
    }, BALANCES_LIMITE_RESET_MS);
    if (!respReset.ok) {
      throw new Error(`No se pudo preparar el proceso: el servidor respondió con un error (código ${respReset.status}).`);
    }

    // 2. Convertir todos los PDFs a base64
    balancesActualizarProgreso(20, 'Leyendo los archivos…');
    const archivosBase64 = [];
    for (const archivo of balancesEstado.archivos) {
      const base64 = await balancesArchivoABase64(archivo);
      archivosBase64.push({ nombre: archivo.name, base64 });
    }

    // 3. Subir los PDFs
    balancesActualizarProgreso(35, 'Subiendo los resúmenes…');
    const { resp: respUpload, data: dataUpload } = await balancesFetchConLimite(`${BALANCES_URL_BASE}/balances-upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente, archivos: archivosBase64 }),
    }, BALANCES_LIMITE_UPLOAD_MS, true);
    if (!respUpload.ok || !dataUpload || !dataUpload.ok) {
      throw new Error((dataUpload && dataUpload.error) || 'No se pudieron subir los archivos.');
    }

    // 4. Disparar el procesamiento — responde al toque, sigue en segundo plano
    const { resp: respProcesar } = await balancesFetchConLimite(`${BALANCES_URL_BASE}/balances-procesar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente }),
    }, BALANCES_LIMITE_PROCESAR_MS);
    if (!respProcesar.ok) {
      throw new Error(`No se pudo iniciar el procesamiento: el servidor respondió con un error (código ${respProcesar.status}).`);
    }

    // 5. Polling contra balances-estado hasta que termine
    siguiendoEstado = true;
    balancesEstado.ultimoProceso = { cliente, totalPdfs: archivosBase64.length };
    balancesActualizarProgreso(40, 'Leyendo los resúmenes con IA…');
    await balancesSeguirProceso(cliente, archivosBase64.length);

  } catch (err) {
    balancesMostrarError(err);
    if (!siguiendoEstado) {
      // Falló antes de que el proceso arrancara: se puede volver a intentar
      el.btnProcesar.disabled = balancesEstado.archivos.length === 0 || !el.selectCliente.value;
    }
  }
}

// Espera el resultado y lo muestra. Si falla, el error lo maneja quien llama.
async function balancesSeguirProceso(cliente, totalPdfs) {
  const resultadoFinal = await balancesEsperarResultado(cliente, totalPdfs);
  balancesActualizarProgreso(100, 'Listo.');
  balancesMostrarResultado(resultadoFinal);
}

function balancesMostrarError(err) {
  balancesActualizarProgreso(100, '');
  balancesMostrarSeccionEstado(false);
  balancesMostrarSeccionResultados(true);
  el.resultadoResumen.innerHTML = `
    <div class="balances-mensaje balances-mensaje-error">
      No se pudo completar el proceso: ${balancesEscapar(err.message)}
    </div>
  `;
  el.resultadoAvisos.innerHTML = '';
  el.resultadoFallos.innerHTML = '';
  el.btnReconsultar.hidden = !err.puedeReconsultar; // se ofrece volver a consultar si falló el seguimiento (tiempo agotado o conexión perdida)
  console.error('Error procesando:', err);
}

// Segundos pedidos por el servidor en el encabezado Retry-After, en milisegundos (con tope).
// Solo vale para 429 y 503. Devuelve null si no hay encabezado o no se entiende.
// (Desde otro dominio el navegador solo deja leer este encabezado si el servidor lo expone con Access-Control-Expose-Headers.)
function balancesEsperaRetryAfter(resp) {
  if (resp.status !== 429 && resp.status !== 503) return null;
  const valor = resp.headers.get('Retry-After');
  if (!valor) return null;
  const segundos = Number(valor);
  const ms = Number.isFinite(segundos) ? segundos * 1000 : Date.parse(valor) - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.min(Math.max(ms, 0), BALANCES_RETRY_AFTER_MAXIMO_MS);
}

// Consulta balances-estado hasta que el proceso termine. La siguiente consulta
// se programa recién cuando termina la anterior (así nunca se superponen).
// Ritmo normal: cada BALANCES_POLLING_RAPIDO_MS durante BALANCES_POLLING_RAPIDO_DURANTE_MS desde que
// arranca el seguimiento y después cada BALANCES_POLLING_LENTO_MS. Tras un fallo (red, límite de
// tiempo, error HTTP o respuesta que no es JSON) reintenta esperando lo que dice
// BALANCES_REINTENTOS_ESPERA_MS (o el Retry-After del servidor) y se rinde al fallo seguido
// número (largo de esa lista + 1). Una consulta buena vuelve al ritmo normal. Corta si pasa el
// tiempo máximo (esperas incluidas), que es el mayor entre el mínimo y un tiempo por cada PDF subido.
function balancesEsperarResultado(cliente, totalPdfsSubidos) {
  const timeoutMs = Math.max(BALANCES_TIMEOUT_MINIMO_MS, totalPdfsSubidos * BALANCES_TIMEOUT_POR_PDF_MS);
  const inicio = Date.now();
  let fallosSeguidos = 0;

  return new Promise((resolve, reject) => {
    const consultar = async () => {
      let esperaPedidaMs = null; // espera pedida por el servidor (Retry-After) tras un fallo
      try {
        const { resp, data } = await balancesFetchConLimite(
          `${BALANCES_URL_BASE}/balances-estado?cliente=${encodeURIComponent(cliente)}`,
          {},
          BALANCES_ESTADO_LIMITE_PEDIDO_MS,
          true
        );
        if (!resp.ok) {
          const errHttp = new Error(`El servidor respondió con un error (código ${resp.status}).`);
          errHttp.esperaMs = balancesEsperaRetryAfter(resp);
          throw errHttp;
        }
        if (data === null) throw new Error('La respuesta del servidor no es válida.');

        fallosSeguidos = 0;

        if (data.total_pdfs > 0) {
          const porcentaje = 40 + Math.round((data.pdfs_procesados / data.total_pdfs) * 55);
          balancesActualizarProgreso(porcentaje, `Procesando resumen ${data.pdfs_procesados} de ${data.total_pdfs}…`);
        }

        if (data.listo) {
          resolve(data);
          return;
        }
      } catch (err) {
        fallosSeguidos++;
        esperaPedidaMs = (err.esperaMs ?? null);
        console.error(`Falló la consulta de estado (${fallosSeguidos} seguidas):`, err);
        if (fallosSeguidos > BALANCES_REINTENTOS_ESPERA_MS.length) {
          const errConexion = new Error('Se perdió la conexión mientras se consultaba el estado.');
          errConexion.puedeReconsultar = true;
          reject(errConexion);
          return;
        }
      }

      if (Date.now() - inicio > timeoutMs) {
        const errTimeout = new Error('El proceso está tardando demasiado. Probá consultar el estado más tarde.');
        errTimeout.puedeReconsultar = true;
        reject(errTimeout);
        return;
      }

      let esperaMs;
      if (fallosSeguidos > 0) {
        esperaMs = esperaPedidaMs ?? BALANCES_REINTENTOS_ESPERA_MS[fallosSeguidos - 1];
      } else {
        esperaMs = (Date.now() - inicio < BALANCES_POLLING_RAPIDO_DURANTE_MS) ? BALANCES_POLLING_RAPIDO_MS : BALANCES_POLLING_LENTO_MS;
      }
      setTimeout(consultar, esperaMs);
    };

    setTimeout(consultar, BALANCES_POLLING_RAPIDO_MS);
  });
}

function balancesMostrarSeccionEstado(mostrar) {
  el.btnReconsultar.hidden = true;
  el.seccionEstado.hidden = !mostrar;
  el.seccionResultados.hidden = true;
  el.btnProcesar.disabled = true;
}

function balancesActualizarProgreso(porcentaje, texto) {
  el.barraProgreso.style.width = `${porcentaje}%`;
  el.estadoTexto.textContent = texto;
}

function balancesMostrarSeccionResultados(mostrar) {
  el.seccionResultados.hidden = !mostrar;
  el.seccionEstado.hidden = true;
}

function balancesMostrarResultado(data) {
  balancesMostrarSeccionResultados(true);

  const huboFallos = (data.fallos || []).length > 0;
  const claseResumen = huboFallos ? 'balances-mensaje-alerta' : 'balances-mensaje-exito';

  el.resultadoResumen.innerHTML = `
    <div class="balances-mensaje ${claseResumen}">
      Se procesaron ${data.pdfs_procesados || 0} de ${data.total_pdfs || 0} resúmenes.
    </div>
  `;

  // Tipos de aviso según el comienzo del mensaje; los no reconocidos van a "otros" (nunca se descartan)
  const gruposAvisos = {
    totales: [],
    sinMovimientos: [],
    otros: [],
    reemplazados: []
  };
  (data.avisos || []).forEach(aviso => {
    const mensaje = String(aviso.mensaje || '').trim();
    let tipo = 'otros';
    if (mensaje.startsWith('Ya había un resumen cargado')) tipo = 'reemplazados';
    else if (mensaje.startsWith('Sin movimientos')) tipo = 'sinMovimientos';
    else if (mensaje.startsWith('Los totales impresos por el banco no coinciden')) tipo = 'totales';
    // Solo "totales que no coinciden" es de advertencia; el resto es informativo (fondo neutro, sin CSS nuevo)
    const atributosRenglon = tipo === 'totales'
      ? 'class="balances-mensaje balances-mensaje-alerta"'
      : 'class="balances-mensaje" style="background:var(--balances-color-fondo);color:var(--balances-color-texto);"';
    gruposAvisos[tipo].push(`
    <div ${atributosRenglon}>
      <strong>${balancesEscapar(aviso.archivo)}</strong> — ${balancesEscapar(aviso.banco)}, cuenta ${balancesEscapar(aviso.cuenta)} (${balancesEscapar(aviso.moneda)}): ${balancesEscapar(aviso.mensaje)}
    </div>
  `);
  });

  const renglonesFallos = (data.fallos || []).map(fallo => `
    <div class="balances-mensaje balances-mensaje-error">
      <strong>${balancesEscapar(fallo.archivo)}</strong>: ${balancesEscapar(fallo.motivo)}
    </div>
  `);

  el.resultadoFallos.innerHTML = balancesArmarDesplegable('⚠️ Problemas a revisar', renglonesFallos, 'balances-mensaje-error');
  el.resultadoAvisos.innerHTML =
    balancesArmarDesplegable('⚠️ Totales que no coinciden', gruposAvisos.totales, 'balances-mensaje-alerta') +
    balancesArmarDesplegable('Sin movimientos', gruposAvisos.sinMovimientos, '') +
    balancesArmarDesplegable('Otros avisos', gruposAvisos.otros, '') +
    balancesArmarDesplegable('Resúmenes reemplazados', gruposAvisos.reemplazados, '');
}

// Desplegable cerrado por defecto con el título y la cantidad. Sin renglones no se muestra nada.
function balancesArmarDesplegable(titulo, renglones, claseColor) {
  if (renglones.length === 0) return '';
  return `
    <details class="balances-desplegable">
      <summary class="balances-mensaje ${claseColor}" style="cursor:pointer;font-weight:600;">
        ${titulo} (${renglones.length})
      </summary>
      ${renglones.join('')}
    </details>
  `;
}

// ------------------------------------------------------------
// Volver a consultar el estado después de que se agotó el tiempo o se perdió la conexión
// (no sube ni procesa nada: solo retoma balances-estado)
// ------------------------------------------------------------

el.btnReconsultar.addEventListener('click', async () => {
  const proceso = balancesEstado.ultimoProceso;
  if (!proceso) return;

  balancesMostrarSeccionEstado(true);
  balancesActualizarProgreso(40, 'Consultando el estado…');

  try {
    await balancesSeguirProceso(proceso.cliente, proceso.totalPdfs);
  } catch (err) {
    balancesMostrarError(err);
  }
});

// ------------------------------------------------------------
// Volver a cargar más resúmenes sin recargar la página
// ------------------------------------------------------------

el.btnNuevaCarga.addEventListener('click', () => {
  balancesEstado.archivos = [];
  balancesRenderizarListaArchivos();
  el.seccionResultados.hidden = true;
  el.seccionEstado.hidden = true;
});

// ------------------------------------------------------------
// Arranque de la página
// ------------------------------------------------------------

balancesCargarClientes();
