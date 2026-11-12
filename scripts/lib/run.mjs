// Shared helpers for the Node build scripts. No dependencies.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const WEB = join(ROOT, 'apps', 'web');
export const OUT = join(WEB, 'out');
export const GENERATED = join(WEB, 'src', 'generated');

const bin = (...parts) => join(ROOT, 'node_modules', ...parts);
export const TSX = bin('tsx', 'dist', 'cli.mjs');
export const NEXT = bin('next', 'dist', 'bin', 'next');
export const TSC = bin('typescript', 'bin', 'tsc');

/** Loads KEY=value pairs from a .env file into process.env without overriding what is set. */
export function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

/** Reads .env.local then .env from the repo root (the same order Next uses). */
export function loadEnv() {
  loadEnvFile(join(ROOT, '.env.local'));
  loadEnvFile(join(ROOT, '.env'));
}

/** Runs a Node script to completion. Exits the process if it fails. */
export function runNode(label, args, options = {}) {
  const started = Date.now();
  console.log(`\n> ${label}`);
  const result = spawnSync(process.execPath, args, {
    cwd: options.cwd ?? ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...options.env },
  });
  if (result.status !== 0) {
    console.error(`x ${label} failed (exit ${result.status ?? result.signal})`);
    if (options.allowFail) return false;
    process.exit(result.status ?? 1);
  }
  console.log(`ok ${label} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  return true;
}

export const runTsx = (label, script, args = [], options = {}) =>
  runNode(label, [TSX, '--tsconfig', join(WEB, 'tsconfig.json'), script, ...args], options);

/** Starts a long-running Node process and prefixes nothing: output goes straight through. */
export function startNode(args, options = {}) {
  return spawn(process.execPath, args, {
    cwd: options.cwd ?? ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...options.env },
  });
}
