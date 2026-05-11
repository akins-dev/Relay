/**
 * subprocess.ts — Child process lifecycle for downstream MCP servers.
 *
 * Manages spawning, timeout, and cleanup of MCP server subprocesses.
 * All child processes are tracked and killed on parent exit.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { SubprocessError, TimeoutError } from '../util/errors.js';

const activeProcesses = new Set<ChildProcess>();

// Kill all child processes on parent exit
function cleanupAll() {
  for (const proc of activeProcesses) {
    try { proc.kill('SIGTERM'); } catch {}
  }
}

process.on('exit', cleanupAll);
process.on('SIGINT', () => { cleanupAll(); process.exit(130); });
process.on('SIGTERM', () => { cleanupAll(); process.exit(143); });

export interface SpawnOptions {
  command: string[];
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
}

export interface McpSubprocess {
  process: ChildProcess;
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  stderr: string;
  kill: () => void;
}

/**
 * Spawn a child process for a downstream MCP server.
 *
 * The child receives the parent's environment (so downstream credentials
 * like GITHUB_TOKEN are available) plus any overrides.
 */
export function spawnMcpServer(opts: SpawnOptions): McpSubprocess {
  const [cmd, ...args] = opts.command;
  if (!cmd) {
    throw new SubprocessError('Empty launch command', { command: opts.command });
  }

  let stderrBuf = '';

  const child = spawn(cmd, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...opts.env },
    // Don't let the child survive if the parent is killed
    detached: false,
  });

  activeProcesses.add(child);

  child.stderr?.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString('utf-8');
    // Cap stderr buffer at 10KB to prevent memory issues
    if (stderrBuf.length > 10_240) {
      stderrBuf = stderrBuf.slice(-10_240);
    }
  });

  child.on('exit', () => {
    activeProcesses.delete(child);
  });

  child.on('error', (err) => {
    activeProcesses.delete(child);
    // Will be caught by the caller — just ensure cleanup
  });

  // Set up timeout
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  if (opts.timeoutMs && opts.timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      killProcess(child);
    }, opts.timeoutMs);
  }

  const kill = () => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    killProcess(child);
  };

  const sub: McpSubprocess = {
    process: child,
    stdin: child.stdin!,
    stdout: child.stdout!,
    get stderr() { return stderrBuf; },
    kill,
  };

  return sub;
}

/**
 * Kill a child process: SIGTERM first, then SIGKILL after 3s.
 */
function killProcess(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;

  try {
    child.kill('SIGTERM');
  } catch { return; }

  // Force kill after 3 seconds if still alive
  const forceKill = setTimeout(() => {
    try {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    } catch {}
  }, 3_000);

  // Don't let the timeout keep the parent alive
  forceKill.unref();
}

/**
 * Wait for a child process to be ready (listening on stdout).
 * Returns when the first byte is available on stdout, or rejects on early exit.
 */
export function waitForReady(sub: McpSubprocess, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new TimeoutError(
        `MCP server did not respond within ${timeoutMs}ms`,
        { stderr: sub.stderr.slice(-500) },
      ));
    }, timeoutMs);
    timeout.unref();

    // Resolve as soon as we can write to stdin (process is running)
    const checkAlive = () => {
      if (sub.process.exitCode !== null) {
        clearTimeout(timeout);
        reject(new SubprocessError(
          `MCP server exited with code ${sub.process.exitCode}`,
          { stderr: sub.stderr.slice(-500) },
        ));
        return;
      }
      clearTimeout(timeout);
      resolve();
    };

    // Give the process a moment to start
    setTimeout(checkAlive, 200);

    sub.process.on('error', (err) => {
      clearTimeout(timeout);
      reject(new SubprocessError(
        `Failed to spawn MCP server: ${err.message}`,
        { command: sub.process.spawnargs },
      ));
    });

    sub.process.on('exit', (code) => {
      clearTimeout(timeout);
      if (code !== null && code !== 0) {
        reject(new SubprocessError(
          `MCP server exited with code ${code} before initialization`,
          { stderr: sub.stderr.slice(-500) },
        ));
      }
    });
  });
}
