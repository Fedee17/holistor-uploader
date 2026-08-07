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
    balancesActualizarProgreso(20, 'Leyendo los archivos…');
    const archivosBase64 = [];
    for (const archivo of balancesEstado.archivos) {
      const base64 = await balancesArchivoABase64(archivo);
      archivosBase64.push({ nombre: archivo.name, base64 });
    }

    // 3. Subir los PDFs
    balancesActualizarProgreso(35, 'Subiendo los resúmenes…');
    const respUpload = await fetch(`${BALANCES_URL_BASE}/balances-upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente, archivos: archivosBase64 }),
    });
    const dataUpload = await respUpload.json();
    if (!dataUpload.ok) {
      throw new Error(dataUpload.error || 'No se pudieron subir los archivos.');
    }

    // 4. Disparar el procesamiento — responde al toque, sigue en segundo plano
    await fetch(`${BALANCES_URL_BASE}/balances-procesar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente }),
    });

    // 5. Polling contra balances-estado hasta que termine
    balancesActualizarProgreso(40, 'Leyendo los resúmenes con IA…');
    const resultadoFinal = await balancesEsperarResultado(cliente);
    balancesActualizarProgreso(100, 'Listo.');
    balancesMostrarResultado(resultadoFinal);

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

// Consulta balances-estado cada 3 segundos hasta que el proceso termine.
// Corta también si pasan más de 5 minutos, para no quedar consultando para siempre
// si algo se cuelga del lado de n8n.
function balancesEsperarResultado(cliente) {
  const INTERVALO_MS = 3000;
  const TIMEOUT_MS = 5 * 60 * 1000;
  const inicio = Date.now();

  return new Promise((resolve, reject) => {
    const intervalo = setInterval(async () => {
      try {
        const resp = await fetch(`${BALANCES_URL_BASE}/balances-estado?cliente=${encodeURIComponent(cliente)}`);
        const data = await resp.json();

        if (data.total_pdfs > 0) {
          const porcentaje = 40 + Math.round((data.pdfs_procesados / data.total_pdfs) * 55);
          balancesActualizarProgreso(porcentaje, `Procesando resumen ${data.pdfs_procesados} de ${data.total_pdfs}…`);
        }

        if (data.listo) {
          clearInterval(intervalo);
          resolve(data);
          return;
        }

        if (Date.now() - inicio > TIMEOUT_MS) {
          clearInterval(intervalo);
          reject(new Error('El proceso está tardando demasiado. Probá consultar el estado más tarde.'));
        }
      } catch (err) {
        clearInterval(intervalo);
        reject(new Error('Se perdió la conexión mientras se consultaba el estado.'));
      }
    }, INTERVALO_MS);
  });
}
