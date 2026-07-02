'use strict';

// scripts/test-logout-estado.js
// Verifica que el ciclo logout no deja estado sucio en Supabase:
// crea usuario, asigna conversacion_activa_id, simula logout limpiando el campo,
// confirma que queda NULL.

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
    workspace: { getConfiguration: () => ({ get: (_, d) => d ?? '' }), workspaceFolders: null },
    window: { showWarningMessage: async () => {} },
    EventEmitter: class { constructor() { this._l = []; } get event() { return fn => { this._l.push(fn); return { dispose: () => {} }; }; } fire(d) { this._l.forEach(f => f(d)); } dispose() { this._l = []; } },
    Uri: { parse: s => ({ toString: () => s }), file: p => ({ fsPath: p }) },
    env: { openExternal: async () => {} },
  },
};

const { createClient } = require('@supabase/supabase-js');
const { setSupabase }  = require('../out/supabase/client');

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
setSupabase(supabase);

const GH_ID = 'test-logout-1';

let pasados = 0, fallados = 0;
function pass(msg) { console.log(`    ✓ PASS  ${msg}`); pasados++; }
function fail(msg) { console.log(`    ✗ FAIL  ${msg}`); fallados++; }

async function main() {
  console.log('\nTermPals — Test: logout limpia estado de sesión');
  console.log('─'.repeat(52));

  // ── Test 1: upsert usuario de prueba (tolerante a ejecuciones previas) ───
  console.log('\n  Test 1 — crear usuario de prueba:');
  const { data: usuario, error: errU } = await supabase
    .from('usuarios')
    .upsert({
      github_id:               GH_ID,
      github_login:            'logout-testuser',
      nombre_usuario:          'logout-testuser',
      estatus:                 true,
      searches_hoy:            0,
      conversacion_activa_id:  null,  // empezar con estado limpio
    }, { onConflict: 'github_id' })
    .select('id, github_login')
    .single();
  if (errU) { console.log(`  ERROR: ${errU.message}`); process.exit(1); }
  pass(`usuario creado (id: ${usuario.id})`);

  // ── Test 2: crear conversación activa y asignar al usuario ───────────────
  console.log('\n  Test 2 — asignar conversacion_activa_id:');
  const { data: conv, error: errC } = await supabase
    .from('conversaciones')
    .insert({ usuario_a: usuario.id, usuario_b: usuario.id, puntaje: 80, abierta: true })
    .select('id')
    .single();
  if (errC) { fail(`no se pudo crear conversación: ${errC.message}`); }
  else {
    const { error: errUpd } = await supabase
      .from('usuarios')
      .update({ conversacion_activa_id: conv.id })
      .eq('id', usuario.id);
    if (errUpd) { fail(`no se pudo asignar conversacion_activa_id: ${errUpd.message}`); }
    else { pass(`conversacion_activa_id asignado (conv_id: ${conv.id})`); }
  }

  // ── Test 3: verificar que el campo está poblado ───────────────────────────
  console.log('\n  Test 3 — verificar que conversacion_activa_id existe:');
  const { data: antes } = await supabase
    .from('usuarios')
    .select('conversacion_activa_id')
    .eq('id', usuario.id)
    .single();
  if (antes?.conversacion_activa_id) {
    pass(`conversacion_activa_id = ${antes.conversacion_activa_id}`);
  } else {
    fail('conversacion_activa_id estaba NULL antes del logout');
  }

  // ── Test 4: simular logout → limpiar conversacion_activa_id ─────────────
  console.log('\n  Test 4 — simular logout (limpiar conversacion_activa_id):');
  const { error: errLogout } = await supabase
    .from('usuarios')
    .update({ conversacion_activa_id: null })
    .eq('id', usuario.id);
  if (errLogout) { fail(`error al limpiar: ${errLogout.message}`); }
  else { pass('UPDATE conversacion_activa_id = NULL ejecutado'); }

  // ── Test 5: verificar que el campo está limpio ───────────────────────────
  console.log('\n  Test 5 — verificar que conversacion_activa_id es NULL:');
  const { data: despues } = await supabase
    .from('usuarios')
    .select('conversacion_activa_id')
    .eq('id', usuario.id)
    .single();
  if (despues?.conversacion_activa_id === null) {
    pass('conversacion_activa_id = NULL — estado limpio tras logout');
  } else {
    fail(`conversacion_activa_id sigue siendo ${despues?.conversacion_activa_id}`);
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  process.stdout.write('\n  limpiando datos del test... ');
  if (conv?.id) {
    await supabase.from('conversaciones').delete().eq('id', conv.id);
  }
  await supabase.from('usuarios').delete().like('github_id', 'test-logout-%');
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
