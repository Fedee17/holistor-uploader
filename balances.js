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
const BALANCES_ESPERA_SUBIDA_MS = 15 * 1000;          // tope para que el servidor confirme que guardó los PDFs subidos
const BALANCES_ESPERA_SUBIDA_CONSULTA_MS = 500;       // cada cuánto se consulta mientras se espera esa confirmación

// Estado en memoria de esta pestaña (se pierde al recargar, es normal)
const balancesEstado = {
  clientes: [],           // [{cliente, bancos: [...]}, ...]
  archivos: [],           // File[] elegidos por el usuario, pendientes de procesar
  ultimoProceso: null,    // {cliente, totalPdfs} del último proceso iniciado, para poder volver a consultar su estado
  archivosCorrida: [],    // File[] de la última corrida, para poder reenviar uno protegido sin que lo vuelvan a elegir
};

// Códigos de fallo que devuelve balances-estado cuando un PDF está protegido
const BALANCES_CODIGO_PDF_CON_CLAVE = 'PDF_CON_CLAVE';
const BALANCES_CODIGO_CLAVE_INCORRECTA = 'CLAVE_INCORRECTA';
// Código de fallo cuando "procesar" no encontró ningún PDF subido (no corresponde a un archivo en particular)
const BALANCES_CODIGO_SIN_PDFS = 'SIN_PDFS';

// Bancos que el sistema sabe leer (los únicos que acepta el servidor al dar de alta)
const BALANCES_BANCOS = ['Galicia', 'Macro', 'Nación', 'Santander', 'Credicoop'];

// ------------------------------------------------------------
// Referencias a elementos del DOM (se buscan una sola vez al cargar)
// ------------------------------------------------------------

const el = {
  selectCliente: document.getElementById('balances-select-cliente'),
  bancosHabilitados: document.getElementById('balances-bancos-habilitados'),
  btnAltaCliente: document.getElementById('balances-btn-alta-cliente'),
  btnAltaBanco: document.getElementById('balances-btn-alta-banco'),

  altaCliente: document.getElementById('balances-alta-cliente'),
  altaNombre: document.getElementById('balances-alta-nombre'),
  altaClienteBancos: document.getElementById('balances-alta-cliente-bancos'),
  btnConfirmarCliente: document.getElementById('balances-btn-confirmar-cliente'),
  btnCancelarCliente: document.getElementById('balances-btn-cancelar-cliente'),

  altaBanco: document.getElementById('balances-alta-banco'),
  altaBancoCliente: document.getElementById('balances-alta-banco-cliente'),
  altaBancoChips: document.getElementById('balances-alta-banco-chips'),
  altaBancoBancos: document.getElementById('balances-alta-banco-bancos'),
  btnConfirmarBanco: document.getElementById('balances-btn-confirmar-banco'),
  btnCancelarBanco: document.getElementById('balances-btn-cancelar-banco'),

  altaMensaje: document.getElementById('balances-alta-mensaje'),

  zonaDrop: document.getElementById('balances-zona-drop'),
  inputArchivos: document.getElementById('balances-input-archivos'),
  listaArchivos: document.getElementById('balances-lista-archivos'),
  btnProcesar: document.getElementById('balances-btn-procesar'),
  listaCabecera: document.getElementById('balances-lista-cabecera'),
  contadorArchivos: document.getElementById('balances-contador-archivos'),
  btnQuitarTodos: document.getElementById('balances-btn-quitar-todos'),

  seccionEstado: document.getElementById('balances-seccion-estado'),
  estadoSubtitulo: document.getElementById('balances-estado-subtitulo'),
  barraProgreso: document.getElementById('balances-barra-progreso-relleno'),
  estadoTexto: document.getElementById('balances-estado-texto'),

  seccionResultados: document.getElementById('balances-seccion-resultados'),
  resultadoSubtitulo: document.getElementById('balances-resultado-subtitulo'),
  resultadoResumen: document.getElementById('balances-resultado-resumen'),
  resultadoAvisos: document.getElementById('balances-resultado-avisos'),
  resultadoFallos: document.getElementById('balances-resultado-fallos'),
  btnReconsultar: document.getElementById('balances-btn-reconsultar'),
  btnNuevaCarga: document.getElementById('balances-btn-nueva-carga'),

  dialogoClave: document.getElementById('balances-dialogo-clave'),
  dialogoForm: document.getElementById('balances-dialogo-form'),
  dialogoArchivo: document.getElementById('balances-dialogo-archivo'),
  dialogoInput: document.getElementById('balances-dialogo-clave-input'),
  dialogoMostrar: document.getElementById('balances-dialogo-mostrar'),
  dialogoMensaje: document.getElementById('balances-dialogo-mensaje'),
  dialogoDesbloquear: document.getElementById('balances-dialogo-desbloquear'),
  dialogoOmitir: document.getElementById('balances-dialogo-omitir'),
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

// Chip de banco con el color de cada banco (mismos tokens --tabla-* que la Tabla de datos).
// Un banco desconocido va con el color de acento.
function balancesClaveBanco(banco) {
  const limpio = String(banco || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return ['galicia', 'macro', 'nacion', 'santander', 'credicoop'].includes(limpio) ? limpio : null;
}

function balancesChipBanco(banco) {
  const clave = balancesClaveBanco(banco);
  const color = clave ? `var(--tabla-${clave})` : 'var(--tabla-acento)';
  return `<span class="tabla-chip" style="--c:${color}">${balancesEscapar(banco)}</span>`;
}

// Cuando cambia el cliente elegido, mostramos qué bancos tiene habilitados
// y habilitamos/deshabilitamos el botón de procesar según haya archivos.
el.selectCliente.addEventListener('change', () => {
  const nombre = el.selectCliente.value;
  const info = balancesEstado.clientes.find(c => c.cliente === nombre);

  el.bancosHabilitados.innerHTML = info
    ? '<span class="balances-nota">Bancos habilitados</span>' + info.bancos.map(balancesChipBanco).join('')
    : '';

  el.btnProcesar.disabled = balancesEstado.archivos.length === 0 || !el.selectCliente.value;

  // Si está abierto "Agregar banco a un cliente", se redibuja para el cliente nuevo
  if (!el.altaBanco.hidden) balancesRedibujarAltaBanco();
});

// ------------------------------------------------------------
// Alta de cliente / alta de banco a un cliente (un formulario por vez)
// ------------------------------------------------------------

el.btnAltaCliente.addEventListener('click', () => balancesAbrirAlta(el.altaCliente.hidden ? 'cliente' : null));
el.btnAltaBanco.addEventListener('click', () => balancesAbrirAlta(el.altaBanco.hidden ? 'banco' : null));
el.btnCancelarCliente.addEventListener('click', () => balancesAbrirAlta(null));
el.btnCancelarBanco.addEventListener('click', () => balancesAbrirAlta(null));

// Abre el formulario pedido ('cliente' o 'banco') y cierra el otro; con null cierra los dos. Siempre limpia.
function balancesAbrirAlta(cual) {
  el.altaCliente.hidden = cual !== 'cliente';
  el.altaBanco.hidden = cual !== 'banco';
  el.btnAltaCliente.setAttribute('aria-expanded', String(cual === 'cliente'));
  el.btnAltaBanco.setAttribute('aria-expanded', String(cual === 'banco'));
  balancesMostrarMensajeAlta('', 'nota');

  el.altaNombre.value = '';
  balancesDibujarCasillas(el.altaClienteBancos, 'balances-alta-cliente-banco', []);
  if (cual === 'banco') balancesRedibujarAltaBanco();

  if (cual === 'cliente') el.altaNombre.focus();
}

// Una casilla por banco de BALANCES_BANCOS. Los de `yaTiene` van tildados, deshabilitados y con "(ya habilitado)".
function balancesDibujarCasillas(contenedor, nombreGrupo, yaTiene) {
  contenedor.innerHTML = BALANCES_BANCOS.map(banco => {
    const ya = yaTiene.includes(banco);
    return `
      <label class="balances-banco${ya ? ' balances-banco-ya' : ''}">
        <input type="checkbox" name="${nombreGrupo}" value="${balancesEscapar(banco)}"${ya ? ' checked disabled' : ''}>
        ${balancesEscapar(banco)}${ya ? ' (ya habilitado)' : ''}
      </label>`;
  }).join('');
}

function balancesBancosTildados(contenedor) {
  return [...contenedor.querySelectorAll('input:not([disabled]):checked')].map(i => i.value);
}

// Para comparar nombres de cliente sin que importen mayúsculas ni espacios de más
function balancesNormalizarNombre(nombre) {
  return String(nombre || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function balancesBancosDe(cliente) {
  const info = balancesEstado.clientes.find(c => c.cliente === cliente);
  return info ? info.bancos : [];
}

// Redibuja "Agregar banco a un cliente" según el cliente elegido en el selector
function balancesRedibujarAltaBanco() {
  const cliente = el.selectCliente.value;
  const tiene = balancesBancosDe(cliente);
  const faltan = BALANCES_BANCOS.filter(b => !tiene.includes(b));

  el.altaBancoCliente.textContent = cliente || 'Elegí primero un cliente arriba';
  el.altaBancoChips.innerHTML = tiene.length
    ? tiene.map(balancesChipBanco).join('')
    : '<span class="balances-nota">Ninguno todavía</span>';
  balancesDibujarCasillas(el.altaBancoBancos, 'balances-alta-banco-banco', tiene);
  el.btnConfirmarBanco.disabled = !cliente || faltan.length === 0;

  // El aviso es de este cliente: al cambiar de cliente se saca o se vuelve a poner
  balancesMostrarMensajeAlta(cliente && faltan.length === 0 ? 'Este cliente ya tiene todos los bancos habilitados.' : '', 'alerta');
}

// Manda un pedido por banco, uno después del otro (el servidor guarda estado entre pedidos).
// Devuelve { guardados, yaEstaban, fallidos: [{banco, error}] }.
async function balancesAgregarBancos(cliente, bancos) {
  const resultado = { guardados: [], yaEstaban: [], fallidos: [] };
  for (const banco of bancos) {
    try {
      const resp = await fetch(`${BALANCES_URL_BASE}/balances-agregar-cliente-banco`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cliente, banco }),
      });
      const data = await resp.json();
      if (!data.ok) {
        resultado.fallidos.push({ banco, error: data.error || 'no se pudo guardar' });
      } else if (data.yaExistia) {
        resultado.yaEstaban.push(banco);
      } else {
        resultado.guardados.push(banco);
      }
    } catch (err) {
      console.error('Error agregando cliente/banco:', err);
      resultado.fallidos.push({ banco, error: 'no se pudo conectar con el servidor' });
    }
  }
  return resultado;
}

// Texto del error parcial: qué se guardó y qué no
function balancesTextoErrorParcial(resultado) {
  const partes = [];
  const ok = [...resultado.guardados, ...resultado.yaEstaban];
  if (ok.length) partes.push(`Se ${ok.length === 1 ? 'agregó' : 'agregaron'} ${ok.join(', ')}.`);
  resultado.fallidos.forEach(f => partes.push(`No se pudo agregar ${f.banco}: ${f.error}.`));
  return partes.join(' ');
}

el.btnConfirmarCliente.addEventListener('click', async () => {
  const cliente = el.altaNombre.value.trim();
  const bancos = balancesBancosTildados(el.altaClienteBancos);

  if (!cliente) {
    balancesMostrarMensajeAlta('Escribí el nombre del cliente.', 'error');
    el.altaNombre.focus();
    return;
  }
  if (bancos.length === 0) {
    balancesMostrarMensajeAlta('Tildá al menos un banco.', 'error');
    return;
  }
  const normalizado = balancesNormalizarNombre(cliente);
  if (balancesEstado.clientes.some(c => balancesNormalizarNombre(c.cliente) === normalizado)) {
    balancesMostrarMensajeAlta('Ese cliente ya existe. Usá «Agregar banco a un cliente».', 'error');
    return;
  }

  el.btnConfirmarCliente.disabled = true;
  el.btnCancelarCliente.disabled = true;
  balancesMostrarMensajeAlta('Guardando…', 'nota');

  const resultado = await balancesAgregarBancos(cliente, bancos);

  // Se refresca la lista para que el cliente nuevo aparezca en el desplegable y quede elegido
  await balancesCargarClientes();
  if (balancesEstado.clientes.some(c => c.cliente === cliente)) {
    el.selectCliente.value = cliente;
    el.selectCliente.dispatchEvent(new Event('change'));
  }

  el.btnConfirmarCliente.disabled = false;
  el.btnCancelarCliente.disabled = false;

  if (resultado.fallidos.length === 0) {
    balancesAbrirAlta(null);
    balancesMostrarMensajeAlta(`Cliente "${cliente}" agregado con ${[...resultado.guardados, ...resultado.yaEstaban].join(', ')}.`, 'exito');
  } else {
    balancesMostrarMensajeAlta(balancesTextoErrorParcial(resultado), 'error');
  }
});

el.btnConfirmarBanco.addEventListener('click', async () => {
  const cliente = el.selectCliente.value;
  if (!cliente) return;
  const bancos = balancesBancosTildados(el.altaBancoBancos);

  if (bancos.length === 0) {
    balancesMostrarMensajeAlta('Tildá al menos un banco.', 'error');
    return;
  }

  el.btnConfirmarBanco.disabled = true;
  el.btnCancelarBanco.disabled = true;
  balancesMostrarMensajeAlta('Guardando…', 'nota');

  const resultado = await balancesAgregarBancos(cliente, bancos);

  // Se refresca la lista manteniendo el cliente elegido; el change redibuja chips y casillas
  await balancesCargarClientes();
  el.selectCliente.value = cliente;
  el.selectCliente.dispatchEvent(new Event('change'));

  el.btnCancelarBanco.disabled = false;

  if (resultado.fallidos.length === 0) {
    // Un "ya estaba" no es error (puede pasar si dos personas cargan a la vez): se informa nomás
    const yaEstaban = resultado.yaEstaban.length ? ` (${resultado.yaEstaban.join(', ')} ya ${resultado.yaEstaban.length === 1 ? 'estaba' : 'estaban'})` : '';
    const tieneTodos = BALANCES_BANCOS.every(b => balancesBancosDe(cliente).includes(b));
    balancesMostrarMensajeAlta(
      `Listo: ${cliente} ahora tiene ${balancesBancosDe(cliente).join(', ')}${yaEstaban}.${tieneTodos ? ' Ya tiene todos los bancos habilitados.' : ''}`,
      'exito'
    );
  } else {
    balancesMostrarMensajeAlta(balancesTextoErrorParcial(resultado), 'error');
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

function balancesQuitarTodos() {
  balancesEstado.archivos = [];
  el.inputArchivos.value = ''; // para poder volver a elegir los mismos PDFs
  balancesRenderizarListaArchivos();
}

el.btnQuitarTodos.addEventListener('click', balancesQuitarTodos);

function balancesRenderizarListaArchivos() {
  const cantidad = balancesEstado.archivos.length;
  el.listaCabecera.hidden = cantidad === 0;
  el.contadorArchivos.innerHTML = `<span class="balances-num">${cantidad}</span> ${cantidad === 1 ? 'PDF cargado' : 'PDFs cargados'}`;

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

  balancesEstado.archivosCorrida = [...balancesEstado.archivos];

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

    // 3b. El "ok" de la subida llega antes de que el servidor termine de guardar los PDFs:
    // si se pide "procesar" enseguida puede encontrar 0 archivos. Se espera la confirmación.
    balancesActualizarProgreso(38, 'Confirmando la subida…');
    await balancesEsperarSubidaGuardada(cliente, archivosBase64.length);

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
  if (balancesEsResultadoSinPdfs(resultadoFinal)) {
    // El servidor no encontró los PDFs subidos: no hay nada procesado ni ningún archivo al que pedirle clave
    balancesMostrarSinPdfs(resultadoFinal);
    return;
  }
  balancesMostrarResultado(resultadoFinal);
  await balancesResolverPdfsConClave(cliente, resultadoFinal);
}

// Consulta el estado hasta que el servidor confirme que guardó los PDFs de la última subida
// (pdfs_en_memoria). Un fallo de red no corta la espera: se vuelve a consultar hasta el tope.
async function balancesEsperarSubidaGuardada(cliente, cantidad) {
  const inicio = Date.now();
  while (true) {
    try {
      const { resp, data } = await balancesFetchConLimite(
        `${BALANCES_URL_BASE}/balances-estado?cliente=${encodeURIComponent(cliente)}`,
        {},
        BALANCES_ESTADO_LIMITE_PEDIDO_MS,
        true
      );
      if (resp.ok && data && data.pdfs_en_memoria === cantidad) return;
    } catch (err) {
      console.error('Falló la consulta mientras se confirmaba la subida:', err.message);
    }
    if (Date.now() - inicio > BALANCES_ESPERA_SUBIDA_MS) {
      throw new Error('La subida no terminó de guardarse en el servidor. Esperá unos segundos y volvé a intentar.');
    }
    await new Promise(resolve => setTimeout(resolve, BALANCES_ESPERA_SUBIDA_CONSULTA_MS));
  }
}

// true si "procesar" corrió sin encontrar ningún PDF subido
function balancesEsResultadoSinPdfs(data) {
  return (data.total_pdfs || 0) === 0 && (data.fallos || []).some(f => f.codigo === BALANCES_CODIGO_SIN_PDFS);
}

// Un solo mensaje de alerta en vez de "0 de 0" y el desplegable de problemas. Los archivos siguen
// en la lista de la página, así que se vuelve a habilitar "Procesar" para reintentar sin elegirlos de nuevo.
function balancesMostrarSinPdfs(data) {
  balancesMostrarSeccionResultados(true);
  const fallo = (data.fallos || []).find(f => f.codigo === BALANCES_CODIGO_SIN_PDFS);
  el.resultadoSubtitulo.textContent = '';
  el.resultadoResumen.innerHTML = `
    <div class="balances-mensaje balances-mensaje-alerta">
      ${balancesEscapar(fallo.motivo || 'No se encontraron los archivos subidos en el servidor. Volvé a subirlos y procesá de nuevo.')}
    </div>
  `;
  el.resultadoFallos.innerHTML = '';
  el.resultadoAvisos.innerHTML = '';
  el.btnProcesar.disabled = balancesEstado.archivos.length === 0 || !el.selectCliente.value;
}

// ------------------------------------------------------------
// PDFs protegidos con contraseña: una ventana por archivo, de a una.
// La contraseña nunca se guarda: solo viaja en el cuerpo del pedido y se borra apenas se envía.
// ------------------------------------------------------------

async function balancesResolverPdfsConClave(cliente, data) {
  let actual = data;
  const yaVistos = new Set();

  for (const fallo of (data.fallos || [])) {
    if (fallo.codigo !== BALANCES_CODIGO_PDF_CON_CLAVE && fallo.codigo !== BALANCES_CODIGO_CLAVE_INCORRECTA) continue;

    const nombre = String(fallo.archivo || '').trim();
    if (yaVistos.has(nombre)) continue;
    yaVistos.add(nombre);

    const archivo = balancesEstado.archivosCorrida.find(a => a.name === nombre);
    if (!archivo) continue; // no está en memoria (por ejemplo, se recargó la página): queda en "Problemas a revisar"

    const nuevo = await balancesPedirClave(cliente, archivo, actual);
    if (nuevo) {
      actual = nuevo;
      balancesMostrarResultado(actual);
    }
  }
}

// Abre la ventana y espera. Devuelve el resultado combinado si se reenvió el archivo, o null si lo omitieron.
function balancesPedirClave(cliente, archivo, resultadoActual) {
  return new Promise(resolve => {
    let resultado = null;
    let enviando = false;

    el.dialogoArchivo.textContent = archivo.name;
    el.dialogoInput.value = '';
    el.dialogoInput.type = 'password';
    el.dialogoMostrar.checked = false;
    el.dialogoMensaje.innerHTML = '';
    el.dialogoDesbloquear.disabled = false;
    el.dialogoDesbloquear.textContent = 'Desbloquear';
    el.dialogoOmitir.disabled = false;

    const mostrarMensajeDialogo = texto => {
      el.dialogoMensaje.innerHTML = `<div class="balances-mensaje balances-mensaje-error">${balancesEscapar(texto)}</div>`;
    };

    const alEnviar = async ev => {
      ev.preventDefault();
      if (enviando) return;

      let clave = el.dialogoInput.value;
      el.dialogoInput.value = ''; // se borra del campo apenas se toma
      if (!clave) {
        el.dialogoInput.focus();
        return;
      }

      enviando = true;
      el.dialogoMensaje.innerHTML = '';
      el.dialogoDesbloquear.disabled = true;
      el.dialogoOmitir.disabled = true;
      el.dialogoDesbloquear.textContent = 'Desbloqueando…';

      try {
        const respuesta = await balancesReenviarConClave(cliente, archivo, clave);
        clave = ''; // se borra de la memoria
        const claveMala = (respuesta.fallos || []).some(f =>
          String(f.archivo || '').trim() === archivo.name &&
          (f.codigo === BALANCES_CODIGO_CLAVE_INCORRECTA || f.codigo === BALANCES_CODIGO_PDF_CON_CLAVE));

        if (claveMala) {
          mostrarMensajeDialogo('La contraseña es incorrecta. Probá de nuevo.');
        } else {
          resultado = balancesCombinarResultados(resultadoActual, respuesta, archivo.name);
          el.dialogoClave.close();
          return;
        }
      } catch (err) {
        clave = '';
        mostrarMensajeDialogo(`No se pudo desbloquear: ${err.message}`);
        console.error('Error reenviando el PDF protegido:', err.message);
      }

      enviando = false;
      el.dialogoDesbloquear.disabled = false;
      el.dialogoOmitir.disabled = false;
      el.dialogoDesbloquear.textContent = 'Desbloquear';
      el.dialogoInput.focus();
    };

    const alMostrar = () => { el.dialogoInput.type = el.dialogoMostrar.checked ? 'text' : 'password'; };
    const alOmitir = () => { if (!enviando) el.dialogoClave.close(); };
    const alCancelar = ev => { if (enviando) ev.preventDefault(); }; // Esc mientras se desbloquea no cierra
    const alCerrar = () => {
      el.dialogoForm.removeEventListener('submit', alEnviar);
      el.dialogoMostrar.removeEventListener('change', alMostrar);
      el.dialogoOmitir.removeEventListener('click', alOmitir);
      el.dialogoClave.removeEventListener('cancel', alCancelar);
      el.dialogoClave.removeEventListener('close', alCerrar);
      el.dialogoInput.value = '';
      el.dialogoInput.type = 'password';
      resolve(resultado);
    };

    el.dialogoForm.addEventListener('submit', alEnviar);
    el.dialogoMostrar.addEventListener('change', alMostrar);
    el.dialogoOmitir.addEventListener('click', alOmitir);
    el.dialogoClave.addEventListener('cancel', alCancelar);
    el.dialogoClave.addEventListener('close', alCerrar);

    el.dialogoClave.showModal();
    el.dialogoInput.focus();
  });
}

// Mismo camino de siempre (reset → subir → procesar → consultar estado), pero con un solo archivo y su clave.
async function balancesReenviarConClave(cliente, archivo, clave) {
  const { resp: respReset } = await balancesFetchConLimite(`${BALANCES_URL_BASE}/balances-reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cliente }),
  }, BALANCES_LIMITE_RESET_MS);
  if (!respReset.ok) {
    throw new Error(`el servidor respondió con un error (código ${respReset.status}).`);
  }

  const base64 = await balancesArchivoABase64(archivo);
  const cuerpoUpload = JSON.stringify({ cliente, archivos: [{ nombre: archivo.name, base64, clave }] });
  const { resp: respUpload, data: dataUpload } = await balancesFetchConLimite(`${BALANCES_URL_BASE}/balances-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: cuerpoUpload,
  }, BALANCES_LIMITE_UPLOAD_MS, true);
  if (!respUpload.ok || !dataUpload || !dataUpload.ok) {
    throw new Error((dataUpload && dataUpload.error) || 'No se pudo subir el archivo.');
  }

  // Misma espera que en el camino normal: que el servidor confirme que guardó el archivo antes de procesar
  await balancesEsperarSubidaGuardada(cliente, 1);

  const { resp: respProcesar } = await balancesFetchConLimite(`${BALANCES_URL_BASE}/balances-procesar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cliente }),
  }, BALANCES_LIMITE_PROCESAR_MS);
  if (!respProcesar.ok) {
    throw new Error(`el servidor respondió con un error (código ${respProcesar.status}).`);
  }

  const resultado = await balancesEsperarResultado(cliente, 1);
  if (balancesEsResultadoSinPdfs(resultado)) {
    // No se combina: ese fallo ("Todos los archivos") no corresponde a ningún PDF. La ventana queda abierta para reintentar.
    throw new Error('el servidor no recibió el archivo. Probá de nuevo.');
  }
  return resultado;
}

// Cada corrida reemplaza el estado del servidor, así que lo que ya se mostró se conserva acá:
// se saca lo viejo de ese archivo y se suma lo que devolvió el reintento.
function balancesCombinarResultados(anterior, reintento, nombre) {
  const esOtroArchivo = item => String(item.archivo || '').trim() !== nombre;
  const fallos = [...(anterior.fallos || []).filter(esOtroArchivo)];
  (reintento.fallos || []).forEach(nuevo => {
    const repetido = fallos.some(f => f.archivo === nuevo.archivo && f.motivo === nuevo.motivo);
    if (!repetido) fallos.push(nuevo);
  });
  const avisos = [...(anterior.avisos || []).filter(esOtroArchivo), ...(reintento.avisos || [])];
  const total = anterior.total_pdfs || 0;

  return {
    ...anterior,
    fallos,
    avisos,
    pdfs_procesados: fallos.length === 0 ? total : (anterior.pdfs_procesados || 0),
  };
}

function balancesMostrarError(err) {
  balancesActualizarProgreso(100, '');
  balancesMostrarSeccionEstado(false);
  balancesMostrarSeccionResultados(true);
  el.resultadoSubtitulo.textContent = '';
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
          balancesActualizarProgreso(porcentaje, 'Leyendo los resúmenes…', { hecho: data.pdfs_procesados, total: data.total_pdfs });
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

// `avance` (opcional): { hecho, total } para el subtítulo "Resumen N de M"; sin eso el subtítulo queda vacío
function balancesActualizarProgreso(porcentaje, texto, avance) {
  el.barraProgreso.style.width = `${porcentaje}%`;
  el.estadoTexto.textContent = texto;
  el.estadoSubtitulo.innerHTML = avance
    ? `Resumen <span class="balances-num">${Number(avance.hecho) || 0}</span> de <span class="balances-num">${Number(avance.total) || 0}</span>`
    : '';
}

function balancesMostrarSeccionResultados(mostrar) {
  el.seccionResultados.hidden = !mostrar;
  el.seccionEstado.hidden = true;
}

function balancesMostrarResultado(data) {
  balancesMostrarSeccionResultados(true);

  const huboFallos = (data.fallos || []).length > 0;

  // "Con problemas" = archivos distintos en la lista de fallos (no la cantidad de renglones)
  const totalPdfs = data.total_pdfs || 0;
  // "Hoja RESULTADOS" no es un PDF: no cuenta acá, pero su fallo se sigue mostrando en el desplegable
  const conProblemas = new Set(
    (data.fallos || []).map(fallo => String(fallo.archivo || '').trim()).filter(archivo => archivo !== 'Hoja RESULTADOS')
  ).size;
  const guardados = Math.max(totalPdfs - conProblemas, 0);
  let textoResumen;
  if (!huboFallos) {
    textoResumen = `Se procesaron ${data.pdfs_procesados || 0} de ${totalPdfs} resúmenes.`;
  } else if (conProblemas === 0) {
    const guardadosTexto = totalPdfs === 1 ? 'Se guardó 1 resumen' : `Se guardaron ${totalPdfs} resúmenes`;
    textoResumen = `${guardadosTexto}, pero hubo un problema al actualizar la hoja. Revisá el detalle.`;
  } else {
    textoResumen = `Se revisaron ${totalPdfs} resúmenes: ${guardados} ${guardados === 1 ? 'guardado' : 'guardados'}, ${conProblemas} ${conProblemas === 1 ? 'con problema' : 'con problemas'}.`;
  }

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
    // "Sin movimientos" se compacta por cuenta más abajo; acá se guarda el aviso tal cual
    if (tipo === 'sinMovimientos') { gruposAvisos.sinMovimientos.push(aviso); return; }
    // Cada renglón: nombre de archivo, chip del banco, cuenta y mensaje
    gruposAvisos[tipo].push(`
    <li>
      <span class="balances-archivo" title="${balancesEscapar(aviso.archivo)}">${balancesEscapar(aviso.archivo)}</span>
      <span>${balancesChipBanco(aviso.banco)} cuenta ${balancesEscapar(aviso.cuenta)} (${balancesEscapar(aviso.moneda)}) · ${balancesEscapar(aviso.mensaje)}</span>
    </li>
  `);
  });

  // "Sin movimientos": un renglón por cuenta (banco + cuenta + moneda) con la cantidad de resúmenes
  // y la lista de archivos; se agrupa acá, al pintar, sin guardar nada nuevo
  const renglonesSinMovimientos = balancesCompactarSinMovimientos(gruposAvisos.sinMovimientos);

  const renglonesFallos = (data.fallos || []).map(fallo => `
    <li>
      <span class="balances-archivo" title="${balancesEscapar(fallo.archivo)}">${balancesEscapar(fallo.archivo)}</span>
      <span>${balancesEscapar(fallo.motivo)}</span>
    </li>
  `);

  // Arriba: subtítulo con el texto de siempre y las tres cifras (número en fuente mono)
  el.resultadoSubtitulo.textContent = textoResumen;
  el.resultadoResumen.innerHTML = `
    <div class="balances-cifras">
      <div class="balances-cifra balances-cifra-exito"><div class="balances-cifra-etiqueta">Guardados</div><div class="balances-cifra-valor">${guardados}</div></div>
      <div class="balances-cifra balances-cifra-alerta"><div class="balances-cifra-etiqueta">Con problemas</div><div class="balances-cifra-valor">${conProblemas}</div></div>
      <div class="balances-cifra"><div class="balances-cifra-etiqueta">Reemplazados</div><div class="balances-cifra-valor">${gruposAvisos.reemplazados.length}</div></div>
    </div>
  `;

  el.resultadoFallos.innerHTML = balancesArmarDesplegable('Problemas a revisar', renglonesFallos, 'error', true);
  el.resultadoAvisos.innerHTML =
    balancesArmarDesplegable('Totales que no coinciden', gruposAvisos.totales, 'alerta') +
    balancesArmarDesplegable('Sin movimientos', renglonesSinMovimientos, 'info') +
    balancesArmarDesplegable('Otros avisos', gruposAvisos.otros, 'info') +
    balancesArmarDesplegable('Resúmenes reemplazados', gruposAvisos.reemplazados, 'info');
}

// Agrupa los avisos "Sin movimientos" por cuenta (clave banco|cuenta|moneda) y arma un renglón por cuenta.
// Orden: por banco y después por cuenta, según el orden en que vinieron los avisos.
// Debajo, los archivos de esa cuenta (los 3 primeros y "y N más"; completos en el `title` del renglón).
function balancesCompactarSinMovimientos(avisos) {
  const porBanco = new Map();
  avisos.forEach(aviso => {
    const banco = String(aviso.banco || '');
    const cuenta = String(aviso.cuenta || '');
    const moneda = String(aviso.moneda || '');
    if (!porBanco.has(banco)) porBanco.set(banco, new Map());
    const cuentas = porBanco.get(banco);
    const clave = `${banco}|${cuenta}|${moneda}`;
    if (!cuentas.has(clave)) cuentas.set(clave, { banco, cuenta, moneda, archivos: [] });
    cuentas.get(clave).archivos.push(String(aviso.archivo || ''));
  });

  const renglones = [];
  porBanco.forEach(cuentas => {
    cuentas.forEach(grupo => {
      const n = grupo.archivos.length;
      const cantidad = n === 1 ? 'en 1 resumen' : `en ${n} resúmenes`;
      const visibles = grupo.archivos.slice(0, 3).join(', ') + (n > 3 ? ` y ${n - 3} más` : '');
      const completos = grupo.archivos.join(', ');
      renglones.push(`
    <li class="balances-cuenta-compacta" title="${balancesEscapar(completos)}">
      <span>${balancesChipBanco(grupo.banco)} cuenta ${balancesEscapar(grupo.cuenta)} (${balancesEscapar(grupo.moneda)}) · sin movimientos ${cantidad}</span>
      <span class="balances-archivos-lista">${balancesEscapar(visibles)}</span>
    </li>
  `);
    });
  });
  return renglones;
}

// Desplegable con una etiqueta de color en el título y la cantidad. Cerrado por defecto salvo `abierto`.
// Sin renglones no se muestra nada.
function balancesArmarDesplegable(titulo, renglones, tono, abierto) {
  if (renglones.length === 0) return '';
  return `
    <details class="balances-desplegable"${abierto ? ' open' : ''}>
      <summary>
        <span class="balances-etiqueta balances-etiqueta-${tono}">${titulo}</span>
        <span class="balances-num">${renglones.length}</span>
      </summary>
      <ul>${renglones.join('')}</ul>
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
