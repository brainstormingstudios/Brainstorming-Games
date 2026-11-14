// Makes sure the ports this project needs are free before starting. A leftover copy of this
// project's own servers (a terminal closed without Ctrl+C, an earlier run still going) is stopped;
// anything else on the port is reported with what to do, instead of an EADDRINUSE stack trace.
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';

const OURS = /scripts[\\/](dev-services|serve-static|start|dev)\.mjs|next[\\/]dist[\\/]bin[\\/]next/;

function isFree(port) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}

/** Process id and command line of whatever listens on `port`, or null. */
function owner(port) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('powershell.exe', [
        '-NoProfile',
        '-Command',
        `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)"; "$($c.OwningProcess)|$($p.CommandLine)" }`,
      ], { encoding: 'utf8' }).trim();
      if (!out) return null;
      const [pid, ...cmd] = out.split('|');
      return { pid: Number(pid), cmd: cmd.join('|') };
    }
    const pid = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split('\n')[0];
    if (!pid) return null;
    const cmd = execFileSync('ps', ['-o', 'command=', '-p', pid], { encoding: 'utf8' }).trim();
    return { pid: Number(pid), cmd };
  } catch {
    return null;
  }
}

/** Frees each port from this project's own leftover servers; exits with advice if something else holds one. */
export async function freePorts(ports) {
  for (const port of ports) {
    if (await isFree(port)) continue;
    const who = owner(port);
    if (who && OURS.test(who.cmd)) {
      try {
        process.kill(who.pid);
        console.log(`[ports] stopped an earlier copy of this project on port ${port} (pid ${who.pid})`);
      } catch {
        // already gone
      }
    }
    // Stopping one of our servers takes its siblings down too, a moment later: give it time.
    for (let i = 0; i < 30 && !(await isFree(port)); i++) await new Promise((r) => setTimeout(r, 200));
    if (await isFree(port)) continue;
    const still = owner(port);
    if (still && OURS.test(still.cmd)) {
      try {
        process.kill(still.pid);
      } catch {
        // already gone
      }
      for (let i = 0; i < 20 && !(await isFree(port)); i++) await new Promise((r) => setTimeout(r, 200));
      if (await isFree(port)) continue;
    }
    console.error(
      `\n[ports] Port ${port} is used by another program${who ? ` (pid ${who.pid}: ${who.cmd.slice(0, 120)})` : ''}.\n` +
        `        Close it, or on Windows run:  Stop-Process -Id ${who?.pid ?? '<pid>'}\n`,
    );
    process.exit(1);
  }
}
