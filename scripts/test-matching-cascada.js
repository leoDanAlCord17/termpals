'use strict';
// Test de matching en cascada.
// El caller usa github_id con timestamp para evitar descartados acumulados
// entre ejecuciones (el DELETE vía anon key falla silenciosamente por RLS).

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

const { createClient }       = require('@supabase/supabase-js');
const { setSupabase }        = require('../out/supabase/client');
const { buscarMatch }        = require('../out/supabase/usuarios');
const { precargarDescartes } = require('../out/supabase/descartados');

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
setSupabase(supabase);

const PREFIX  = 'test-cascada-';
const RUN_TS  = Date.now();  // sufijo único por ejecución

// ── Helpers ───────────────────────────────────────────────────────────────────
let pasados = 0, fallados = 0;
function pass(msg) { console.log(`    ✓ PASS  ${msg}`); pasados++; }
function fail(msg) { console.log(`    ✗ FAIL  ${msg}`); fallados++; }

async function crearUsuario(tag, busca) {
  const github_id    = `${PREFIX}${tag}-${RUN_TS}`;
  const github_login = `cascada-${tag}-${RUN_TS}`;
  const { data, error } = await supabase
    .from('usuarios')
    .upsert({
      github_id,
      github_login,
      nombre_usuario:         github_login,
      estatus:                true,
      busca,
      conversacion_activa_id: null,
      searches_hoy:           0,
      ultima_busqueda_en:     null,
    }, { onConflict: 'github_id' })
    .select('id, busca, github_login')
    .single();
  if (error) throw new Error(`upsert ${tag}: ${error.message}`);
  return data;
}

// Añade IDs a descartados del caller en DB y recarga session cache.
async function excluir(callerId, ids) {
  for (const id of ids) {
    if (!id) continue;
    const { error } = await supabase
      .from('descartados')
      .insert({ usuario_id: callerId, descartado_id: id });
    // ignorar duplicados; lanzar otros errores
    if (error && !error.message.includes('duplicate') && !error.message.includes('unique')) {
      console.warn(`    warn: descartados insert (${id}): ${error.message}`);
    }
  }
  await precargarDescartes(callerId);
}

// ══════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('\nTermPals — Test: matching en cascada');
  console.log('─'.repeat(54));
  console.log(`  run_id: ${RUN_TS}\n`);

  let caller, u2net, u3ambas, u4colab, caller2;

  // ── Crear usuarios únicos para esta ejecución ────────────────────────────
  process.stdout.write('  creando usuarios de prueba... ');
  caller  = await crearUsuario('caller', 'networking');  // fresh caller (no discards)
  u2net   = await crearUsuario('net',    'networking');
  u3ambas = await crearUsuario('ambas',  'ambas');
  u4colab = await crearUsuario('colab',  'colaborar');
  console.log('OK');

  // ── Catalogar todos los demás (reales + cascada de runs anteriores) ──────
  const { data: todosVisibles } = await supabase
    .from('usuarios')
    .select('id, busca, github_login')
    .eq('estatus', true)
    .is('conversacion_activa_id', null)
    .neq('id', caller.id);

  const misTesting = new Set([u2net.id, u3ambas.id, u4colab.id]);
  const otros = (todosVisibles ?? []).filter(u => !misTesting.has(u.id));

  const otrosNet   = otros.filter(u => u.busca === 'networking').map(u => u.id);
  const otrosAmbas = otros.filter(u => u.busca === 'ambas').map(u => u.id);
  const otrosResto = otros.filter(u => u.busca !== 'networking' && u.busca !== 'ambas').map(u => u.id);

  console.log(`  (${otros.length} otro(s) visible(s): red=${otrosNet.length} ambas=${otrosAmbas.length} resto=${otrosResto.length})\n`);

  // ── Escenario 1: nivel 'exacto' ──────────────────────────────────────────
  console.log('  Escenario 1 — hay match networking exacto (u2net disponible):');
  const r1 = await buscarMatch(caller.id, 'networking');
  if (!r1)                             fail('devolvió null, esperaba exacto');
  else if (r1.nivelMatch !== 'exacto') fail(`nivelMatch="${r1.nivelMatch}", esperaba "exacto"`);
  else                                 pass(`nivelMatch="exacto"  @${r1.usuario.github_login}`);

  // ── Escenario 2: nivel 'ambas' ───────────────────────────────────────────
  // Excluir u2net + todos los otros networking → solo ambas y colaborar visibles
  console.log('\n  Escenario 2 — sin networking → cae a ambas:');
  await excluir(caller.id, [u2net.id, ...otrosNet]);
  const r2 = await buscarMatch(caller.id, 'networking');
  if (!r2)                             fail('devolvió null, esperaba ambas');
  else if (r2.nivelMatch !== 'ambas')  fail(`nivelMatch="${r2.nivelMatch}", esperaba "ambas"`);
  else                                 pass(`nivelMatch="ambas"   @${r2.usuario.github_login}`);

  // ── Escenario 3: nivel 'cualquiera' ─────────────────────────────────────
  // Excluir u3ambas + todos los otros ambas → solo colaborar visible
  console.log('\n  Escenario 3 — sin ambas → cae a cualquiera:');
  await excluir(caller.id, [u3ambas.id, ...otrosAmbas]);
  const r3 = await buscarMatch(caller.id, 'networking');
  if (!r3)                                 fail('devolvió null, esperaba cualquiera');
  else if (r3.nivelMatch !== 'cualquiera') fail(`nivelMatch="${r3.nivelMatch}", esperaba "cualquiera"`);
  else                                     pass(`nivelMatch="cualquiera"  @${r3.usuario.github_login}`);

  // ── Escenario 4: null ────────────────────────────────────────────────────
  // Excluir u4colab + todos los otros restantes → nadie disponible
  console.log('\n  Escenario 4 — nadie disponible → null:');
  await excluir(caller.id, [u4colab.id, ...otrosResto]);
  const r4 = await buscarMatch(caller.id, 'networking');
  if (r4 !== null) fail(`esperaba null, obtuvo @${r4.usuario.github_login} (${r4.nivelMatch})`);
  else             pass('devuelve null correctamente');

  // ── Escenario 5: caller2 con busca='ambas' ve u3ambas como exacto ────────
  console.log('\n  Escenario 5 — caller con busca=ambas, hay otro ambas (u3) disponible:');
  caller2 = await crearUsuario('caller2', 'ambas');
  // caller2 tiene session vacía; u3ambas no está en sus discards
  const r5 = await buscarMatch(caller2.id, 'ambas');
  if (!r5)                             fail('devolvió null, esperaba exacto');
  else if (r5.nivelMatch !== 'exacto') fail(`nivelMatch="${r5.nivelMatch}", esperaba "exacto"`);
  else                                 pass(`nivelMatch="exacto" (ambas→ambas)  @${r5.usuario.github_login}`);

  // ── Resultado ─────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(54));
  const total = pasados + fallados;
  console.log(`  ${pasados}/${total} PASS${fallados > 0 ? `  (${fallados} FAIL)` : ''}`);
  console.log(`  resultado final: ${fallados === 0 ? '✓ PASS' : '✗ FAIL'}\n`);
  console.log('  (nota: usuarios test-cascada-* acumulan en DB — limpiar con limpiar-seed.js)\n');

  process.exit(fallados === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('\nError fatal:', err.message);
  process.exit(1);
});
