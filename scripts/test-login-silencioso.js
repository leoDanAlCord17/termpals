'use strict';
// scripts/test-login-silencioso.js
// Verifica que los módulos de auth y estado exportan las funciones esperadas.
// No puede probar el keychain real fuera de VS Code.

// ── Stub vscode ────────────────────────────────────────────────────────────
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
    ExtensionContext: class {},
    SecretStorage: class {},
  },
};

let pasados = 0, fallados = 0;
function pass(msg) { console.log(`    ✓ PASS  ${msg}`); pasados++; }
function fail(msg) { console.log(`    ✗ FAIL  ${msg}`); fallados++; }

async function main() {
  console.log('\nTermPals — Test: exports de auth/github y state');
  console.log('─'.repeat(56));

  // ── Test 1: auth/github exports ───────────────────────────────────────────
  console.log('\n  Test 1 — exports de out/auth/github:');
  let githubMod;
  try {
    githubMod = require('../out/auth/github');
    pass('módulo cargado sin errores');
  } catch (err) {
    fail(`fallo al cargar módulo: ${err.message}`);
    process.exit(1);
  }

  for (const fn of ['guardarToken', 'obtenerTokenGuardado', 'eliminarToken',
                    'intentarLoginSilencioso', 'obtenerPerfilGithub',
                    'iniciarLoginGithub', 'manejarCallback']) {
    if (typeof githubMod[fn] === 'function') {
      pass(`${fn} exportado`);
    } else {
      fail(`${fn} NO exportado (tipo: ${typeof githubMod[fn]})`);
    }
  }

  // ── Test 2: supabase/consentimientos exports ──────────────────────────────
  console.log('\n  Test 2 — exports de out/supabase/consentimientos:');
  let consMod;
  try {
    consMod = require('../out/supabase/consentimientos');
    pass('módulo cargado sin errores');
  } catch (err) {
    fail(`fallo al cargar módulo: ${err.message}`);
    process.exit(1);
  }

  for (const fn of ['obtenerVersionActiva', 'registrarConsentimiento']) {
    if (typeof consMod[fn] === 'function') {
      pass(`${fn} exportado`);
    } else {
      fail(`${fn} NO exportado`);
    }
  }

  // ── Test 3: state exports ─────────────────────────────────────────────────
  console.log('\n  Test 3 — exports de out/state:');
  let stateMod;
  try {
    stateMod = require('../out/state');
    pass('módulo cargado sin errores');
  } catch (err) {
    fail(`fallo al cargar state: ${err.message}`);
    process.exit(1);
  }

  for (const fn of ['getConsentimientoPendiente', 'setConsentimientoPendiente',
                    'getEsperandoConfirmacionDelete', 'setEsperandoConfirmacionDelete',
                    'setUsuarioActual', 'getUsuarioActual', 'cargarSesion']) {
    if (typeof stateMod[fn] === 'function') {
      pass(`${fn} exportado`);
    } else {
      fail(`${fn} NO exportado`);
    }
  }

  // ── Test 4: consentimientoPendiente empieza en null ───────────────────────
  console.log('\n  Test 4 — consentimientoPendiente inicializa en null:');
  const inicial = stateMod.getConsentimientoPendiente();
  if (inicial === null) {
    pass('getConsentimientoPendiente() === null (valor inicial correcto)');
  } else {
    fail(`valor inicial incorrecto: ${JSON.stringify(inicial)}`);
  }

  stateMod.setConsentimientoPendiente({ acepta_perfil: true, acepta_stack: true, acepta_readme: false, acepta_matching: true });
  const guardado = stateMod.getConsentimientoPendiente();
  if (guardado && guardado.acepta_readme === false && guardado.acepta_matching === true) {
    pass('setConsentimientoPendiente/get roundtrip correcto (acepta_readme=false preservado)');
  } else {
    fail(`roundtrip incorrecto: ${JSON.stringify(guardado)}`);
  }

  stateMod.setConsentimientoPendiente(null);
  if (stateMod.getConsentimientoPendiente() === null) {
    pass('setConsentimientoPendiente(null) limpia correctamente');
  } else {
    fail('no se limpió a null');
  }

  // ── Resultado ─────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(56));
  const total = pasados + fallados;
  console.log(`  ${pasados}/${total} PASS${fallados > 0 ? `  (${fallados} FAIL)` : ''}`);
  console.log(`  resultado final: ${fallados === 0 ? '✓ PASS' : '✗ FAIL'}\n`);
  process.exit(fallados === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('\nError fatal:', err.message);
  process.exit(1);
});
