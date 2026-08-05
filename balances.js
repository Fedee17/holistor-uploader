// ============================================================
// Balances Bancarios — lógica de la página
// Todo el código de este archivo usa nombres con prefijo
// "balances" para no chocar nunca con el JS de Holistor.
// ============================================================

const BALANCES_URL_BASE = 'https://fede123.app.n8n.cloud/webhook';

// Estado en memoria de esta pestaña (se pierde al recargar, es normal)
const balancesEstado = {
  clientes: [],           // [{cliente, bancos: [...]}, ...]
  archivos: [],           // File[] elegidos por el usuario, pendientes de procesar
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

    el.selectCliente.innerHTML = '<option value="">Elegí un cliente</option>' +
      balancesEstado.clientes
        .map(c => `<option value="${balancesEscapar(c.cliente)}">${balancesEscapar(c.cliente)}</option>`)
        .join('');

  } catch (err) {
    el.selectCliente.innerHTML = '<option value="">No se pudo cargar la lista</option>';
    console.error('Error cargando clientes:', err);
  }
}

// Escapa texto para que no rompa el HTML si un nombre de cliente
// tuviera caracteres especiales (< > & etc.)
function balancesEscapar(texto) {
  const d = document.createElement('div');
  d.textContent = texto;
  return d.innerHTML;
}

// Cuando cambia el cliente elegido, mostramos qué bancos tiene habilitados
el.selectCliente.addEventListener('change', () => {
  const nombre = el.selectCliente.value;
  const info = balancesEstado.clientes.find(c => c.cliente === nombre);

  if (!info) {
    el.bancosHabilitados.textContent = '';
    return;
  }

  el.bancosHabilitados.textContent = `Bancos habilitados: ${info.bancos.join(', ')}`;
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

// Si cambia el cliente elegido, también revisamos si corresponde habilitar el botón
el.selectCliente.addEventListener('change', () => {
  el.btnProcesar.disabled = balancesEstado.archivos.length === 0 || !el.selectCliente.value;
});

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
// Procesar: reset → upload → procesar → mostrar resultado
// ------------------------------------------------------------

el.btnProcesar.addEventListener('click', balancesProcesarTodo);

async function balancesProcesarTodo() {
  const cliente = el.selectCliente.value;
  if (!cliente || balancesEstado.archivos.length === 0) return;

  balancesMostrarSeccionEstado(true);
  balancesActualizarProgreso(10, 'Preparando…');

  try {
    // 1. Reset del proceso de este cliente
    await fetch(`${BALANCES_URL_BASE}/balances-reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente }),
    });

    // 2. Convertir todos los PDFs a base64
    balancesActualizarProgreso(25, 'Leyendo los archivos…');
    const archivosBase64 = [];
    for (const archivo of balancesEstado.archivos) {
      const base64 = await balancesArchivoABase64(archivo);
      archivosBase64.push({ nombre: archivo.name, base64 });
    }

    // 3. Subir los PDFs
    balancesActualizarProgreso(45, 'Subiendo los resúmenes…');
    const respUpload = await fetch(`${BALANCES_URL_BASE}/balances-upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente, archivos: archivosBase64 }),
    });
    const dataUpload = await respUpload.json();
    if (!dataUpload.ok) {
      throw new Error(dataUpload.error || 'No se pudieron subir los archivos.');
    }

    // 4. Procesar — esto puede tardar, cada PDF pasa por Gemini uno por vez
    balancesActualizarProgreso(60, 'Leyendo los resúmenes con IA… esto puede tardar un rato si hay varios PDFs.');
    const respProcesar = await fetch(`${BALANCES_URL_BASE}/balances-procesar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente }),
    });
    const dataProcesar = await respProcesar.json();

    balancesActualizarProgreso(100, 'Listo.');
    balancesMostrarResultado(dataProcesar);

  } catch (err) {
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
    console.error('Error procesando:', err);
  }
}

function balancesMostrarSeccionEstado(mostrar) {
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

  el.resultadoAvisos.innerHTML = (data.avisos || []).map(aviso => `
    <div class="balances-mensaje balances-mensaje-alerta">
      <strong>${balancesEscapar(aviso.archivo)}</strong> — ${balancesEscapar(aviso.banco)}, cuenta ${balancesEscapar(aviso.cuenta)} (${balancesEscapar(aviso.moneda)}): ${balancesEscapar(aviso.mensaje)}
    </div>
  `).join('');

  el.resultadoFallos.innerHTML = (data.fallos || []).map(fallo => `
    <div class="balances-mensaje balances-mensaje-error">
      <strong>${balancesEscapar(fallo.archivo)}</strong>: ${balancesEscapar(fallo.motivo)}
    </div>
  `).join('');
}

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
