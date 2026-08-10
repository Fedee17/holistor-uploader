// ============================================================
// Tabla de Datos — dashboard de items por mes, por cliente
// Prefijo "tabla" en todo lo propio de esta página, para no
// chocar con balances.js ni con el JS de Holistor.
// ============================================================

const TABLA_URL_BASE = 'https://fede123.app.n8n.cloud/webhook';

const el = {
  selectCliente: document.getElementById('tabla-select-cliente'),
  seccionEstado: document.getElementById('tabla-seccion-estado'),
  estadoTexto: document.getElementById('tabla-estado-texto'),
  seccionTabla: document.getElementById('tabla-seccion-tabla'),
  tituloCliente: document.getElementById('tabla-titulo-cliente'),
  thead: document.getElementById('tabla-datos-thead'),
  tbody: document.getElementById('tabla-datos-tbody'),
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
  el.seccionTabla.hidden = true;
  el.seccionEstado.hidden = false;
  el.estadoTexto.textContent = 'Cargando datos…';
  el.estadoTexto.className = 'balances-nota';

  try {
    const resp = await fetch(`${TABLA_URL_BASE}/balances-dashboard?cliente=${encodeURIComponent(cliente)}`);
    if (!resp.ok) throw new Error('El servidor respondió con un error');
    const data = await resp.json();

    if (!data.filas || data.filas.length === 0) {
      el.estadoTexto.textContent = `${cliente} todavía no tiene resúmenes procesados.`;
      return;
    }

    tablaRenderizar(data);
    el.seccionEstado.hidden = true;
    el.seccionTabla.hidden = false;

  } catch (err) {
    el.estadoTexto.textContent = 'No se pudieron cargar los datos.';
    el.estadoTexto.className = 'balances-mensaje balances-mensaje-error';
    console.error('Error cargando dashboard:', err);
  }
}

// ------------------------------------------------------------
// Formateo de montos: negativo en rojo, separador de miles/decimales ARS
// ------------------------------------------------------------

const tablaFormateador = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Devuelve { texto, esNegativo } — el llamador arma el <td> con la clase
// que corresponda (celda normal o celda de total, que llevan estilos
// distintos), en vez de que esta función arme el tag completo.
function tablaFormatearMonto(valor, moneda) {
  const numero = Number(valor) || 0;
  const simbolo = moneda === 'USD' ? 'US$' : '$';
  const texto = `${numero < 0 ? '-' : ''}${simbolo} ${tablaFormateador.format(Math.abs(numero))}`;
  return { texto, esNegativo: numero < 0 };
}

function tablaCeldaMonto(valor, moneda, claseExtra = '') {
  const { texto, esNegativo } = tablaFormatearMonto(valor, moneda);
  const clases = [claseExtra, esNegativo ? 'tabla-monto-negativo' : ''].filter(Boolean).join(' ');
  const claseAttr = clases ? ` class="${clases}"` : '';
  return `<td${claseAttr}>${texto}</td>`;
}

// ------------------------------------------------------------
// Armar la tabla: encabezado con los meses, filas agrupadas por
// banco + cuenta + moneda, con los items debajo de cada grupo.
// ------------------------------------------------------------

function tablaRenderizar(data) {
  el.tituloCliente.textContent = data.cliente;

  // --- Encabezado ---
  const columnasMeses = data.periodos.map(p => `<th>${tablaEscapar(p.label)}</th>`).join('');
  el.thead.innerHTML = `
    <tr>
      <th class="tabla-col-etiqueta">Item</th>
      ${columnasMeses}
      <th class="tabla-col-total">Total</th>
    </tr>
  `;

  // --- Agrupar filas por banco + cuenta + moneda, en el orden que ya vienen ---
  const grupos = [];
  let grupoActual = null;

  for (const fila of data.filas) {
    const claveGrupo = `${fila.banco}||${fila.cuenta}||${fila.moneda}`;
    if (!grupoActual || grupoActual.clave !== claveGrupo) {
      grupoActual = { clave: claveGrupo, banco: fila.banco, cuenta: fila.cuenta, moneda: fila.moneda, items: [] };
      grupos.push(grupoActual);
    }
    grupoActual.items.push(fila);
  }

  // --- Cuerpo de la tabla ---
  const filasHtml = [];
  const totalColumnas = data.periodos.length + 2; // etiqueta + meses + total

  for (const grupo of grupos) {
    filasHtml.push(`
      <tr class="tabla-fila-grupo">
        <td class="tabla-col-etiqueta" colspan="${totalColumnas}">
          ${tablaEscapar(grupo.banco)} — Cuenta ${tablaEscapar(grupo.cuenta)} (${tablaEscapar(grupo.moneda)})
        </td>
      </tr>
    `);

    for (const fila of grupo.items) {
      const celdasMeses = data.periodos
        .map(p => tablaCeldaMonto(fila.valores[p.key], grupo.moneda))
        .join('');
      const celdaTotal = tablaCeldaMonto(fila.total, grupo.moneda, 'tabla-col-total');
      filasHtml.push(`
        <tr>
          <td class="tabla-col-etiqueta tabla-item-nombre">${tablaEscapar(fila.item)}</td>
          ${celdasMeses}
          ${celdaTotal}
        </tr>
      `);
    }
  }

  el.tbody.innerHTML = filasHtml.join('');
}

// ------------------------------------------------------------
// Arranque
// ------------------------------------------------------------

tablaCargarClientes();
