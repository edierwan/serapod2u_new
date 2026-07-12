#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// free-port.js — predev guard
// Safely kills dev processes on dev port. Refuses to kill infra.
// Cross-platform: Windows + macOS + Linux.
// ═══════════════════════════════════════════════════════════
'use strict';

const { execSync } = require('child_process');

const PORT = process.env.PORT || 3000;
const IS_WIN = process.platform === 'win32';

// Patterns considered safe dev processes
const SAFE = ['node', 'nodemon', 'tsx', 'next', 'server.js', 'vite', 'esbuild'];
// Patterns that are never safe to kill
const UNSAFE = ['docker', 'nginx', 'caddy', 'cloudflared', 'postgres', 'redis', 'mongod'];

function exec(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', timeout: 8000, shell: true }).trim(); }
  catch { return ''; }
}

function getPidsUnix(port) {
  if (!exec('command -v lsof') && !exec('which lsof')) {
    console.warn(`[dev] lsof not found — skipping port ${port} check.`);
    return [];
  }
  const raw = exec(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`);
  if (!raw) return [];
  return [...new Set(raw.split('\n').map(Number).filter(Boolean))];
}

function getPidsWindows(port) {
  const raw = exec(`netstat -ano -p tcp | findstr :${port}`);
  if (!raw) return [];
  const pids = new Set();
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.toUpperCase().includes('LISTENING')) continue;
    const parts = trimmed.split(/\s+/);
    const pid = Number(parts[parts.length - 1]);
    if (pid > 0) pids.add(pid);
  }
  return [...pids];
}

function getPids(port) {
  return IS_WIN ? getPidsWindows(port) : getPidsUnix(port);
}

function getCommandUnix(pid) {
  return exec(`ps -p ${pid} -o command=`);
}

function getCommandWindows(pid) {
  const wmic = exec(`wmic process where "ProcessId=${pid}" get CommandLine /format:list`);
  const line = wmic.split('\n').find((l) => l.startsWith('CommandLine='));
  if (line) return line.replace('CommandLine=', '').trim();
  return exec(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`);
}

function getCommand(pid) {
  return IS_WIN ? getCommandWindows(pid) : getCommandUnix(pid);
}

function isSafe(cmd) {
  const lower = cmd.toLowerCase();
  if (UNSAFE.some((p) => lower.includes(p))) return false;
  if (SAFE.some((p) => lower.includes(p))) return true;
  if (lower.includes(process.cwd().toLowerCase())) return true;
  return false;
}

function killPidUnix(pid) {
  try { process.kill(pid, 'SIGTERM'); } catch { return; }

  const start = Date.now();
  while (Date.now() - start < 800) { /* busy wait */ }

  try {
    process.kill(pid, 0);
    console.log(`[dev] PID ${pid} didn't exit, sending SIGKILL`);
    try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  } catch {
    // Already dead
  }
}

function killPidWindows(pid) {
  try { exec(`taskkill /PID ${pid} /T`); } catch { /* ignore */ }
  const start = Date.now();
  while (Date.now() - start < 800) { /* busy wait */ }
  try {
    process.kill(pid, 0);
    console.log(`[dev] PID ${pid} didn't exit, forcing taskkill`);
    try { exec(`taskkill /PID ${pid} /T /F`); } catch { /* gone */ }
  } catch {
    // Already dead
  }
}

function killPid(pid) {
  if (IS_WIN) killPidWindows(pid);
  else killPidUnix(pid);
}

// ── Main ────────────────────────────────────────────────
(function main() {
  const pids = getPids(PORT);

  if (pids.length === 0) {
    console.log(`[dev] Port ${PORT} is free`);
    return;
  }

  for (const pid of pids) {
    const cmd = getCommand(pid);
    console.log(`[dev] Port ${PORT} occupied by PID ${pid}: ${cmd || '(unknown)'}`);

    if (isSafe(cmd)) {
      console.log(`[dev] Safe dev process — terminating PID ${pid}...`);
      killPid(pid);
      console.log(`[dev] PID ${pid} terminated`);
    } else {
      console.error('');
      console.error('  ┌─────────────────────────────────────────────────────┐');
      console.error(`  │  REFUSED: Port ${PORT} is used by a non-dev process  │`);
      console.error('  ├─────────────────────────────────────────────────────┤');
      console.error(`  │  PID:  ${pid}`);
      console.error(`  │  CMD:  ${cmd || '(unknown)'}`);
      console.error('  │                                                     │');
      console.error('  │  Stop it manually or move it to another port.       │');
      console.error('  └─────────────────────────────────────────────────────┘');
      console.error('');
      process.exit(1);
    }
  }

  const remaining = getPids(PORT);
  if (remaining.length > 0) {
    console.error(`[dev] Unable to free port ${PORT}. PIDs still listening: ${remaining.join(', ')}`);
    process.exit(1);
  }

  console.log(`[dev] Port ${PORT} is free`);
})();
