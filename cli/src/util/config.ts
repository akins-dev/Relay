/**
 * config.ts — Environment-driven configuration for Relay Local.
 *
 * RELAY_API_URL
 *   Base URL for Relay Cloud. Defaults to https://relay.dev (production).
 *   Most users never change this — it's baked in like npm's registry URL.
 *   Only override if self-hosting a Relay Cloud instance.
 *
 *   For MCP mode: set via the `env` field in the agent host's MCP config.
 *   For CLI mode: inherited from the shell environment.
 *
 * RELAY_API_KEY
 *   Optional. Anonymous access works. Key exists only for future rate
 *   limiting under heavy traffic — irrelevant for the prototype.
 *
 * Downstream server credentials (GITHUB_TOKEN, SENDGRID_API_KEY, etc.)
 * are NOT configured here. They live in the user's environment and are
 * passed through to child processes automatically.
 */

export interface RelayConfig {
  apiBase: string;
  apiKey: string | null;
}

let _config: RelayConfig | null = null;

export function getConfig(): RelayConfig {
  if (_config) return _config;

  let apiBase = process.env.RELAY_API_URL ?? 'https://relay.dev';
  // Normalize: remove trailing slash
  apiBase = apiBase.replace(/\/+$/, '');
  // Add protocol if missing
  if (!apiBase.startsWith('http')) {
    apiBase = apiBase.includes('localhost') ? `http://${apiBase}` : `https://${apiBase}`;
  }

  _config = {
    apiBase,
    apiKey: process.env.RELAY_API_KEY ?? null,
  };

  return _config;
}

export const RELAY_VERSION = '0.1.0';
export const RELAY_CLIENT_NAME = 'relay-local';
export const RELAY_USER_AGENT = `relay-cli/${RELAY_VERSION}`;
