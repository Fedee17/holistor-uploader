// Controles automáticos de cada pull request (y de cada cambio en main).
// Si algo falla, el control queda en rojo y el cambio no se puede juntar.
// Se corre igual en la PC con: node .github/controles.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import { execSync } from 'node:child_process';

const errores = [];
const archivos = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
const deTexto = archivos.filter(f => /\.(html|js|mjs|css|md|json|yml|yaml|txt)$/i.test(f));
const leer = f => fs.readFileSync(f, 'utf8');
const linea = (texto, pos) => texto.slice(0, pos).split('\n').length;

// 1. Sintaxis de JavaScript: archivos .js y bloques <script> sin src de cada .html.
function sintaxis(codigo, nombre, desdeLinea) {
  try { new vm.Script(codigo, { filename: nombre, lineOffset: desdeLinea - 1 }); }
  catch (e) { errores.push(`Sintaxis: ${nombre}: ${e.message}`); }
}
for (const f of archivos.filter(f => /\.(js|mjs)$/i.test(f) && !f.startsWith('.github/'))) sintaxis(leer(f), f, 1);
for (const f of archivos.filter(f => /\.html$/i.test(f))) {
  const t = leer(f);
  for (const m of t.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    sintaxis(m[1], f, linea(t, m.index));
  }
}

// 2. Claves que nunca pueden estar en el repositorio (es público).
//    Los patrones se arman por partes para que este archivo no se marque a sí mismo.
const claves = [
  ['una clave secreta de Supabase', new RegExp('sb_' + 'secret_')],
  ['una clave de servicio de Supabase', new RegExp('service' + '_role')],
  ['un token JWT', new RegExp('eyJhbGci' + 'OiJ')],
  ['una clave privada', new RegExp('BEGIN [A-Z ]*PRIVATE' + ' KEY')],
];
for (const f of deTexto) {
  const t = leer(f);
  for (const [nombre, re] of claves) {
    const m = t.match(re);
    if (m) errores.push(`Clave: ${f} línea ${linea(t, m.index)}: parece ${nombre}.`);
  }
}

// 3. Las páginas reales no pueden apuntar a prueba.
const reales = archivos.filter(f => /^(index\.html|balances\.(html|js)|tabla-datos\.(html|js))$/.test(f));
const deTest = [
  ['webhook de prueba', /\/[a-z0-9-]+-test(-v\d+)?(?=['"`/?])/],
  ['dirección local', /localhost|127\.0\.0\.1/],
  ['base Supabase de prueba', /pgjzscsobnrkewrdlwue/],
  ['marca [TEST]', /\[TEST\]/],
  ['barra de prueba', /test-banner/],
];
for (const f of reales) {
  const t = leer(f);
  for (const [nombre, re] of deTest) {
    const m = t.match(re);
    if (m) errores.push(`Prueba en página real: ${f} línea ${linea(t, m.index)}: ${nombre} ("${m[0]}").`);
  }
}

// 4. Archivos que no se suben nunca.
for (const f of archivos) {
  if (/(^|\/)CLAUDE\.md$/i.test(f)) errores.push(`Archivo prohibido en el repositorio: ${f}`);
  if (/(^|\/)\.env/i.test(f)) errores.push(`Archivo prohibido en el repositorio: ${f}`);
}

if (errores.length) {
  console.error(`Controles: ${errores.length} problema(s)\n- ` + errores.join('\n- '));
  process.exit(1);
}
console.log(`Controles OK: ${archivos.length} archivos revisados.`);
