// ============================================================
// Tabla de Datos — dashboard de items por mes, por cliente
// Prefijo "tabla" en todo lo propio de esta página, para no
// chocar con balances.js ni con el JS de Holistor.
// ============================================================

const TABLA_URL_BASE = 'https://fede123.app.n8n.cloud/webhook';

const el = {
  selectCliente: document.getElementById('tabla-select-cliente'),
  leyenda: document.getElementById('tabla-leyenda'),
  seccionEstado: document.getElementById('tabla-seccion-estado'),
  estadoTexto: document.getElementById('tabla-estado-texto'),
  seccionTabla: document.getElementById('tabla-seccion-tabla'),
  tituloCliente: document.getElementById('tabla-titulo-cliente'),
  tarjetas: document.getElementById('tabla-tarjetas'),
  detalle: document.getElementById('tabla-detalle'),
};

// Lo que se está mostrando: períodos y cuentas del cliente elegido, y qué cuenta está elegida (índice o null)
const tablaEstado = {
  periodos: [],
  cuentas: [],
  seleccion: null,
  pedido: 0, // número del último pedido, para ignorar respuestas viejas si cambian de cliente rápido
};

function tablaEscapar(texto) {
  const d = document.createElement('div');
  d.textContent = texto;
  return d.innerHTML;
}

// ------------------------------------------------------------
// Cargar clientes (mismo webhook que usa balances.html)
// ------------------------------------------------------------

async function tablaCargarClientes() {
  el.selectCliente.innerHTML = '<option value="" disabled selected hidden>Cargando clientes…</option>';

  try {
    const resp = await fetch(`${TABLA_URL_BASE}/balances-clientes`);
    if (!resp.ok) throw new Error('El servidor respondió con un error');
    const data = await resp.json();
    const clientes = data.clientes || [];

    if (clientes.length === 0) {
      el.selectCliente.innerHTML = '<option value="" disabled selected hidden>No hay clientes cargados</option>';
      return;
    }

    el.selectCliente.innerHTML = '<option value="" disabled selected hidden>Elegí un cliente</option>' +
      clientes.map(c => `<option value="${tablaEscapar(c.cliente)}">${tablaEscapar(c.cliente)}</option>`).join('');

  } catch (err) {
    el.selectCliente.innerHTML = '<option value="" disabled selected hidden>No se pudo cargar la lista</option>';
    console.error('Error cargando clientes:', err);
  }
}

el.selectCliente.addEventListener('change', () => {
  const cliente = el.selectCliente.value;
  if (cliente) tablaCargarDashboard(cliente);
});

// ------------------------------------------------------------
// Cargar y renderizar el dashboard del cliente elegido
// ------------------------------------------------------------

async function tablaCargarDashboard(cliente) {
  const numeroPedido = ++tablaEstado.pedido;

  el.seccionTabla.hidden = true;
  el.seccionEstado.hidden = false;
  el.estadoTexto.textContent = 'Cargando datos…';
  el.estadoTexto.className = 'balances-nota';
  el.leyenda.textContent = '';

  try {
    const resp = await fetch(`${TABLA_URL_BASE}/balances-dashboard?cliente=${encodeURIComponent(cliente)}`);
    if (!resp.ok) throw new Error('El servidor respondió con un error');
    const data = await resp.json();
    if (numeroPedido !== tablaEstado.pedido) return; // ya eligieron otro cliente

    if (!data.filas || data.filas.length === 0) {
      el.estadoTexto.textContent = `${cliente} todavía no tiene resúmenes procesados.`;
      return;
    }

    tablaRenderizar(data);
    el.seccionEstado.hidden = true;
    el.seccionTabla.hidden = false;

  } catch (err) {
    if (numeroPedido !== tablaEstado.pedido) return;
    el.estadoTexto.textContent = 'No se pudieron cargar los datos.';
    el.estadoTexto.className = 'balances-mensaje balances-mensaje-error';
    console.error('Error cargando dashboard:', err);
  }
}

// ------------------------------------------------------------
// Formateo de importes (es-AR, dos decimales)
// ------------------------------------------------------------

const tablaFormateador = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Importe de una celda de la tabla: cero = "–" gris, negativo en rojo con "−" adelante
function tablaCelda(valor) {
  const n = Number(valor) || 0;
  if (Math.abs(n) < 0.005) return '<span class="tabla-cero">–</span>';
  if (n < 0) return `<span class="tabla-negativo">−${tablaFormateador.format(-n)}</span>`;
  return tablaFormateador.format(n);
}

// Importe con símbolo de moneda, para el saldo de la tarjeta
function tablaDinero(valor, moneda) {
  const n = Number(valor) || 0;
  const simbolo = moneda === 'USD' ? 'US$' : '$';
  if (n < 0) return `<span class="tabla-negativo">−${simbolo} ${tablaFormateador.format(-n)}</span>`;
  return `${simbolo} ${tablaFormateador.format(n)}`;
}

// ------------------------------------------------------------
// Armar las cuentas: una por banco + cuenta + moneda, con su neto por mes y sus saldos
// ------------------------------------------------------------

function tablaClaveBanco(banco) {
  const limpio = String(banco || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return ['galicia', 'macro', 'nacion', 'santander', 'credicoop'].includes(limpio) ? limpio : null;
}

function tablaArmarCuentas(data) {
  const porClave = new Map();

  for (const fila of data.filas) {
    const clave = `${fila.banco}||${fila.cuenta}||${fila.moneda}`;
    if (!porClave.has(clave)) {
      porClave.set(clave, { banco: fila.banco, cuenta: fila.cuenta, moneda: fila.moneda, filas: [], saldos: {} });
    }
    porClave.get(clave).filas.push(fila);
  }

  // Saldos por cuenta (puede no venir si el servidor es viejo)
  for (const c of (data.cuentas || [])) {
    const cuenta = porClave.get(`${c.banco}||${c.cuenta}||${c.moneda}`);
    if (cuenta) cuenta.saldos = c.saldos || {};
  }

  const cuentas = [...porClave.values()].sort((a, b) =>
    String(a.banco).localeCompare(String(b.banco), 'es') || String(a.cuenta).localeCompare(String(b.cuenta), 'es', { numeric: true }));

  // Neto del mes = suma de los valores de las filas de esa cuenta
  for (const cuenta of cuentas) {
    cuenta.neto = {};
    for (const p of data.periodos) {
      cuenta.neto[p.key] = cuenta.filas.reduce((suma, f) => suma + (Number(f.valores && f.valores[p.key]) || 0), 0);
    }
  }
  return cuentas;
}

// Índice del último período con saldo guardado para la cuenta (-1 si no tiene ninguno)
function tablaUltimoPeriodoConSaldo(cuenta, periodos) {
  for (let i = periodos.length - 1; i >= 0; i--) {
    const s = cuenta.saldos[periodos[i].key];
    if (s && s.final !== null && s.final !== undefined) return i;
  }
  return -1;
}

function tablaSaldoFinal(cuenta, key) {
  const s = cuenta.saldos[key];
  return s && s.final !== null && s.final !== undefined ? Number(s.final) : null;
}

// ------------------------------------------------------------
// Dibujar: tarjetas arriba, detalle de la cuenta elegida abajo
// ------------------------------------------------------------

function tablaRenderizar(data) {
  el.tituloCliente.textContent = data.cliente;
  tablaEstado.periodos = data.periodos;
  tablaEstado.cuentas = tablaArmarCuentas(data);
  tablaEstado.seleccion = null;

  const hayUsd = tablaEstado.cuentas.some(c => c.moneda === 'USD');
  const primero = data.periodos[0].label;
  const ultimo = data.periodos[data.periodos.length - 1].label;
  el.leyenda.textContent = `${hayUsd ? 'Importes en la moneda de cada cuenta' : 'Importes en pesos'} · períodos de ${primero} a ${ultimo}`;

  el.tarjetas.innerHTML = tablaEstado.cuentas.map((cuenta, i) => tablaHtmlTarjeta(cuenta, i)).join('');
  el.tarjetas.querySelectorAll('.tabla-tarjeta').forEach(tablaActivarTarjeta);
  tablaMostrarDetalle();
}

function tablaChip(cuenta) {
  const clave = tablaClaveBanco(cuenta.banco);
  const color = clave ? `var(--tabla-${clave})` : 'var(--tabla-acento)';
  return `<span class="tabla-chip" style="--c:${color}">${tablaEscapar(cuenta.banco)}</span>`;
}

function tablaColorBarras(cuenta) {
  const clave = tablaClaveBanco(cuenta.banco);
  return clave ? `var(--tabla-${clave})` : 'var(--tabla-acento)';
}

// Gráfico de barras: una por período, alto = neto del mes (arriba si es positivo, abajo y en rojo si es negativo).
// Sobre cada barra va un rectángulo transparente que detecta el mouse.
function tablaHtmlGrafico(cuenta, periodos, indiceResaltado) {
  const valores = periodos.map(p => cuenta.neto[p.key]);
  const maximo = Math.max(1, ...valores.map(Math.abs));
  const ancho = 300;
  const alto = 46;
  const anchoBarra = ancho / valores.length;

  const barras = valores.map((v, i) => {
    const h = Math.abs(v) / maximo * (alto / 2 - 3);
    const y = v >= 0 ? alto / 2 - h : alto / 2;
    const relleno = v < 0 ? 'var(--tabla-negativo)' : tablaColorBarras(cuenta);
    return `<rect data-barra="1" x="${i * anchoBarra + 7}" y="${y}" width="${Math.max(anchoBarra - 14, 1)}" height="${Math.max(h, v === 0 ? 0 : 1.5)}" rx="2" fill="${relleno}" opacity="${i === indiceResaltado ? 1 : 0.55}"/>`;
  }).join('');
  const zonas = valores.map((_, i) =>
    `<rect class="tabla-zona" data-i="${i}" x="${i * anchoBarra}" y="0" width="${anchoBarra}" height="${alto}" fill="transparent"/>`).join('');

  return `<svg class="tabla-grafico" viewBox="0 0 ${ancho} ${alto}" preserveAspectRatio="none" role="img" aria-label="Neto por período">` +
    `<line x1="0" x2="${ancho}" y1="${alto / 2}" y2="${alto / 2}" stroke="var(--balances-color-borde)" stroke-width="1"/>${barras}${zonas}</svg>`;
}

// Etiqueta y número grande para un período (o el último con saldo, si indice es -1)
function tablaHtmlSaldo(cuenta, periodos, indice) {
  if (indice < 0) {
    return { etiqueta: 'Saldo final', numero: '<span class="tabla-numero-grande tabla-sin-dato">sin dato</span>' };
  }
  const periodo = periodos[indice];
  const saldo = tablaSaldoFinal(cuenta, periodo.key);
  return {
    etiqueta: `Saldo final ${periodo.label.toLowerCase()}`,
    numero: saldo === null
      ? '<span class="tabla-numero-grande tabla-sin-dato">sin dato</span>'
      : `<span class="tabla-numero-grande">${tablaDinero(saldo, cuenta.moneda)}</span>`,
  };
}

function tablaHtmlTarjeta(cuenta, i) {
  const periodos = tablaEstado.periodos;
  const porDefecto = tablaUltimoPeriodoConSaldo(cuenta, periodos);
  const saldo = tablaHtmlSaldo(cuenta, periodos, porDefecto);
  const resaltada = porDefecto >= 0 ? porDefecto : periodos.length - 1;

  return `
    <button type="button" class="tabla-tarjeta" data-i="${i}" aria-pressed="false">
      <span class="tabla-fila-flex">${tablaChip(cuenta)}<span class="tabla-moneda">${tablaEscapar(cuenta.moneda)}</span></span>
      <span class="tabla-meta">Cuenta ${tablaEscapar(cuenta.cuenta)}</span>
      <span>
        <span class="tabla-etiqueta-chica">${saldo.etiqueta}</span><br>
        ${saldo.numero}
      </span>
      ${tablaHtmlGrafico(cuenta, periodos, resaltada)}
      <span class="tabla-fila-flex tabla-meta"><span>${cuenta.filas.length} conceptos</span><span class="tabla-accion">Ver detalle</span></span>
    </button>
  `;
}

// Clic para elegir la cuenta y mouse sobre las barras para ver el saldo de cada mes
function tablaActivarTarjeta(boton) {
  const cuenta = tablaEstado.cuentas[Number(boton.dataset.i)];
  const periodos = tablaEstado.periodos;
  const etiqueta = boton.querySelector('.tabla-etiqueta-chica');
  const barras = boton.querySelectorAll('rect[data-barra]');
  const porDefecto = tablaUltimoPeriodoConSaldo(cuenta, periodos);
  const resaltadaPorDefecto = porDefecto >= 0 ? porDefecto : periodos.length - 1;

  const mostrar = (indiceSaldo, indiceBarra) => {
    const saldo = tablaHtmlSaldo(cuenta, periodos, indiceSaldo);
    etiqueta.textContent = saldo.etiqueta;
    etiqueta.nextElementSibling.nextElementSibling.outerHTML = saldo.numero;
    barras.forEach((barra, j) => barra.setAttribute('opacity', j === indiceBarra ? 1 : 0.55));
  };

  boton.querySelectorAll('.tabla-zona').forEach(zona => {
    const i = Number(zona.dataset.i);
    zona.addEventListener('pointerenter', () => mostrar(i, i));
    zona.addEventListener('pointerleave', () => mostrar(porDefecto, resaltadaPorDefecto));
  });

  boton.addEventListener('click', () => {
    const indice = Number(boton.dataset.i);
    tablaEstado.seleccion = tablaEstado.seleccion === indice ? null : indice;
    tablaMostrarDetalle();
  });
}

// Marca la tarjeta elegida y arma el panel de abajo (sin volver a dibujar las tarjetas, para no perder el foco)
function tablaMostrarDetalle() {
  const elegida = tablaEstado.seleccion;

  el.tarjetas.querySelectorAll('.tabla-tarjeta').forEach(boton => {
    const esta = Number(boton.dataset.i) === elegida;
    boton.setAttribute('aria-pressed', String(esta));
    boton.querySelector('.tabla-accion').textContent = esta ? 'Ocultar detalle' : 'Ver detalle';
  });

  if (elegida === null) {
    el.detalle.innerHTML = '<div class="tabla-vacio">Elegí una cuenta para ver el detalle mes a mes.</div>';
    return;
  }

  const cuenta = tablaEstado.cuentas[elegida];
  el.detalle.innerHTML = `
    <div class="tabla-panel">
      <div class="tabla-panel-cabeza">
        ${tablaChip(cuenta)}
        <span class="tabla-panel-cuenta">Cuenta ${tablaEscapar(cuenta.cuenta)}</span>
        <span class="tabla-moneda">${tablaEscapar(cuenta.moneda)}</span>
      </div>
      ${tablaHtmlTabla(cuenta)}
    </div>
  `;
}

function tablaHtmlTabla(cuenta) {
  const periodos = tablaEstado.periodos;
  const ultimo = periodos.length - 1;
  const claseActual = i => (i === ultimo ? ' tabla-col-actual' : '');

  const encabezado = periodos.map((p, i) => `<th class="${claseActual(i).trim()}">${tablaEscapar(p.label)}</th>`).join('');

  const cuerpo = cuenta.filas.map(fila => {
    const celdas = periodos.map((p, i) =>
      `<td class="tabla-importe${claseActual(i)}">${tablaCelda(fila.valores && fila.valores[p.key])}</td>`).join('');
    return `<tr><td class="tabla-col-etiqueta">${tablaEscapar(fila.item)}</td>${celdas}<td class="tabla-importe tabla-col-total">${tablaCelda(fila.total)}</td></tr>`;
  }).join('');

  const netos = periodos.map((p, i) =>
    `<td class="tabla-importe${claseActual(i)}">${tablaCelda(cuenta.neto[p.key])}</td>`).join('');
  const saldos = periodos.map((p, i) => {
    const saldo = tablaSaldoFinal(cuenta, p.key);
    return `<td class="tabla-importe${claseActual(i)}">${saldo === null ? '<span class="tabla-sin-dato">sin dato</span>' : tablaCelda(saldo)}</td>`;
  }).join('');

  return `
    <div class="tabla-scroll">
      <table id="tabla-datos-tabla">
        <thead><tr><th class="tabla-col-etiqueta">Concepto</th>${encabezado}<th class="tabla-col-total">Total</th></tr></thead>
        <tbody>${cuerpo}</tbody>
        <tfoot>
          <tr><td class="tabla-col-etiqueta">Neto por mes</td>${netos}<td class="tabla-importe tabla-col-total"></td></tr>
          <tr><td class="tabla-col-etiqueta">Saldo final</td>${saldos}<td class="tabla-importe tabla-col-total"></td></tr>
        </tfoot>
      </table>
    </div>
  `;
}

// ------------------------------------------------------------
// Arranque
// ------------------------------------------------------------

tablaCargarClientes();
