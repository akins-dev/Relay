/**
 * errors.ts — Structured error types and exit codes for Relay CLI.
 *
 * Exit codes:
 *   0  success
 *   1  general error / tool call failed
 *   2  bad arguments / usage error
 *   3  network / API error
 *   4  missing env var / configuration error
 *   5  subprocess error (child MCP server)
 *   6  timeout
 */

export const EXIT = {
  OK: 0,
  ERROR: 1,
  USAGE: 2,
  NETWORK: 3,
  CONFIG: 4,
  SUBPROCESS: 5,
  TIMEOUT: 6,
} as const;

export class RelayError extends Error {
  constructor(
    message: string,
    public readonly code: keyof typeof EXIT,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'RelayError';
  }

  get exitCode(): number {
    return EXIT[this.code];
  }

  toJSON() {
    return {
      error: true,
      code: this.code,
      message: this.message,
      ...(this.details ?? {}),
    };
  }
}

export class NetworkError extends RelayError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'NETWORK', details);
    this.name = 'NetworkError';
  }
}

export class ConfigError extends RelayError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFIG', details);
    this.name = 'ConfigError';
  }
}

export class SubprocessError extends RelayError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'SUBPROCESS', details);
    this.name = 'SubprocessError';
  }
}

export class TimeoutError extends RelayError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'TIMEOUT', details);
    this.name = 'TimeoutError';
  }
}
