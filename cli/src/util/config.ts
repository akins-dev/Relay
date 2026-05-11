/**
 * config.ts — Environment-driven configuration for Relay Local.
 *
 * Only two env vars matter for the CLI itself:
 *   RELAY_API_URL  — base URL for Relay Cloud (default: https://relay.dev)
 *   RELAY_API_KEY  — optional API key for higher rate limits
 *
 * Downstream MCP server credentials (GITHUB_TOKEN, SENDGRID_API_KEY, etc.)
 * are resolved from the user's environment by the subprocess — not by Relay.
 */

export interface RelayConfig {
  apiBase: string;
  apiKey: string | null;
}

let _config: RelayConfig | null = null;

export function getConfig(): RelayConfig {
  if (_config) return _config;

  let apiBase = process.env.RELAY_API_URL ?? 'https://relay.vercel.app';
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
