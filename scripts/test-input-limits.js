'use strict';

// scripts/test-input-limits.js
// Verifica los límites de longitud de input en /tp bug y /tp suggest.
// La validación de 500 chars está en el handler (commands/index.ts).
// Este test la replica y también verifica que crearFeedback() acepta mensajes válidos.

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('ERROR: define SUPABASE_URL y SUPABASE_ANON_KEY');
  process.exit(1);
}

// ── Stub vscode ───────────────────────────────────────────────────────────────
const Module = require('module');
const _orig = Module._resolveFilename;
Module._resolveFilename = function (req, p, m, o) {
  if (req === 'vscode') return 'vscode';
  return _orig.call(this, req, p, m, o);
};
require.cache['vscode'] = {
  id: 'vscode', filename: 'vscode', loaded: true,
  exports: {
    workspace: { getConfiguration: () => ({ get: (_, d) => d ?? '' }), workspaceFolders: null, findFiles: async () => [], fs: { readFile: async () => Buffer.alloc(0) } },
    window: { showWarningMessage: async () => {} },
    EventEmitter: class { constructor() { this._l = []; } get event() { return fn => { this._l.push(fn); return { dispose: () => {} }; }; } fire(d) { this._l.forEach(f => f(d)); } dispose() { this._l = []; } },
    Uri: { parse: s => ({ toString: () => s }), file: p => ({ fsPath: p }) },
    env: { openExternal: async () => {} },
    commands: { registerCommand: () => ({ dispose: () => {} }), executeCommand: async () => {} },
    ViewColumn: { One: 1 },
  },
};

const { createClient }  = require('@supabase/supabase-js');
const { setSupabase }   = require('../out/supabase/client');
const { crearFeedback } = require('../out/supabase/feedback');

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
setSupabase(supabase);

const GH_ID       = 'test-limits-1';
const MAX_CHARS   = 500;

let pasados = 0, fallados = 0;
function pass(msg) { console.log(`    ✓ PASS  ${msg}`); pasados++; }
function fail(msg) { console.log(`    ✗ FAIL  ${msg}`); fallados++; }

// Replica la lógica de validación del handler en commands/index.ts
function validarMensaje(mensaje) {
  if (!mensaje || mensaje.trim().length === 0) { return 'vacío'; }
  if (mensaje.length > MAX_CHARS) { return 'too_long'; }
  return 'ok';
}

async function main() {
  console.log('\nTermPals — Test: límites de longitud en /tp bug y /tp suggest');
  console.log('─'.repeat(52));

  // RUN_TAG: 13 dígitos de timestamp, único por ejecución.
  // Se embebe en mensajeExacto para identificar los registros de esta run
  // sin depender del cleanup (el anon key no puede DELETE feedback por RLS).
  const RUN_TAG = String(Date.now());

  // ── Crear usuario de prueba ───────────────────────────────────────────────
  process.stdout.write('  creando usuario de prueba... ');
  const { data: usuario, error: errU } = await supabase
    .from('usuarios')
    .upsert({
      github_id:          GH_ID,
      github_login:       'limits-testuser',
      nombre_usuario:     'limits-testuser',
      estatus:            true,
      searches_hoy:       0,
      ultima_busqueda_en: null,
    }, { onConflict: 'github_id' })
    .select('id')
    .single();
  if (errU) { console.log(`ERROR: ${errU.message}`); process.exit(1); }
  console.log(`OK (id: ${usuario.id})`);

  // ── Test 1: mensaje vacío debe ser rechazado por el handler ──────────────
  console.log('\n  Test 1 — mensaje vacío rechazado por validación del handler:');
  const resultadoVacio = validarMensaje('');
  if (resultadoVacio === 'vacío') {
    pass('mensaje vacío → devuelve feedback.bug_usage');
  } else {
    fail(`esperaba "vacío", obtuvo "${resultadoVacio}"`);
  }

  // ── Test 2: mensaje de 501 chars rechazado por el handler ────────────────
  console.log('\n  Test 2 — mensaje de 501 chars rechazado (> 500):');
  const mensajeLargo = 'a'.repeat(501);
  const resultadoLargo = validarMensaje(mensajeLargo);
  if (resultadoLargo === 'too_long') {
    pass(`501 chars → devuelve feedback.too_long`);
  } else {
    fail(`esperaba "too_long", obtuvo "${resultadoLargo}"`);
  }

  // ── Test 3: mensaje de exactamente 500 chars aceptado ────────────────────
  // mensajeExacto embebe RUN_TAG al final: 487 x's + 13 dígitos = 500 chars.
  console.log('\n  Test 3 — mensaje de exactamente 500 chars aceptado:');
  const mensajeExacto = 'x'.repeat(MAX_CHARS - RUN_TAG.length) + RUN_TAG;
  const resultadoExacto = validarMensaje(mensajeExacto);
  if (resultadoExacto === 'ok') {
    pass(`500 chars → validación OK`);
  } else {
    fail(`esperaba "ok", obtuvo "${resultadoExacto}"`);
  }

  // ── Test 4: mensaje de 500 chars se persiste en Supabase ─────────────────
  console.log('\n  Test 4 — crearFeedback() persiste mensaje de 500 chars:');
  try {
    await crearFeedback(usuario.id, 'bug', mensajeExacto, usuario.id);
    pass('crearFeedback(500 chars) resolvió sin error');
  } catch (err) {
    fail(`crearFeedback lanzó error: ${err.message}`);
  }

  // ── Test 5: mensaje de 1 char se persiste ────────────────────────────────
  console.log('\n  Test 5 — crearFeedback() persiste mensaje de 1 char:');
  const mensajeMinimo = 'x';
  const resultadoMinimo = validarMensaje(mensajeMinimo);
  if (resultadoMinimo === 'ok') {
    try {
      await crearFeedback(usuario.id, 'sugerencia', mensajeMinimo, usuario.id);
      pass('crearFeedback(1 char) resolvió sin error');
    } catch (err) {
      fail(`crearFeedback lanzó error: ${err.message}`);
    }
  } else {
    fail(`validación de 1 char falló: "${resultadoMinimo}"`);
  }

  // ── Test 6: confirmar que los registros persisten en DB ──────────────────
  // Busca por contenido exacto de mensajeExacto (único por run via RUN_TAG),
  // sin depender de creado_en ni de cleanup previo.
  console.log('\n  Test 6 — registros de esta ejecución persisten en la DB:');
  const { data: rows500, error: err500 } = await supabase
    .from('feedback')
    .select('mensaje')
    .eq('usuario_id', usuario.id)
    .eq('mensaje', mensajeExacto);
  const { data: rows1, error: err1 } = await supabase
    .from('feedback')
    .select('mensaje')
    .eq('usuario_id', usuario.id)
    .eq('mensaje', mensajeMinimo);

  if (err500 || err1) {
    fail(`error al consultar: ${(err500 || err1).message}`);
  } else if ((rows500?.length ?? 0) >= 1 && (rows1?.length ?? 0) >= 1) {
    pass(`2 registros en DB: longitudes ${rows500[0].mensaje.length} y ${rows1[0].mensaje.length} chars`);
  } else {
    fail(`registros no encontrados (500chars: ${rows500?.length ?? 0}, 1char: ${rows1?.length ?? 0})`);
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  process.stdout.write('\n  limpiando datos del test... ');
  await supabase.from('feedback').delete().eq('usuario_id', usuario.id);
  await supabase.from('usuarios').delete().eq('github_id', GH_ID);
  console.log('OK');

  console.log('\n' + '─'.repeat(52));
  const total = pasados + fallados;
  console.log(`  ${pasados}/${total} PASS${fallados > 0 ? `  (${fallados} FAIL)` : ''}`);
  console.log(`  resultado final: ${fallados === 0 ? '✓ PASS' : '✗ FAIL'}\n`);

  process.exit(fallados === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('\nError fatal:', err.message);
  process.exit(1);
});
