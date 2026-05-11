/**
 * output.ts — Structured output formatting for Relay CLI.
 *
 * All CLI output goes through these helpers so agents always get
 * parseable JSON on stdout. Human-readable hints go to stderr.
 */

/**
 * Write structured JSON result to stdout (for agents to parse).
 */
export function writeResult(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

/**
 * Write a human-readable status message to stderr (not parsed by agents).
 */
export function writeStatus(message: string): void {
  process.stderr.write(`relay: ${message}\n`);
}

/**
 * Write an error to stderr and optionally output a structured error to stdout.
 */
export function writeError(message: string, details?: Record<string, unknown>): void {
  process.stderr.write(`relay: error: ${message}\n`);
  if (details) {
    writeResult({ error: true, message, ...details });
  }
}
