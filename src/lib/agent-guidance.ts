import { BRAND } from '@/lib/brand';
import { SITE_URL } from '@/lib/site';

export const API_KEY_PREFIX = 'sk_mcp_';
export const API_KEY_PLACEHOLDER = `${API_KEY_PREFIX}<your-key>`;
export const API_KEY_HEADER = `Authorization: Bearer ${API_KEY_PLACEHOLDER}`;

export const SEARCH_ACTIVATION_CASES = [
  'Send messages, emails, or notifications to external services',
  'Query or write to databases, data stores, or file systems',
  'Create, update, or delete resources such as issues, PRs, records, or files',
  'Call any external API or interact with any third-party service',
  'Execute any operation that affects the real world',
] as const;

export const SEARCH_DEFLECTION_CASES = [
  'You can answer from your own training, such as definitions, explanations, or calculations',
  'The task is reasoning, writing, or code generation with no external action',
  'The intent is a knowledge question such as "what is X", "explain Y", or "how does Z work"',
] as const;

export const SEARCH_DECISION_RULE =
  'If the task requires an external capability, search first. If it only requires knowledge, answer directly.';

export const SCHEMA_GUIDANCE = 'Use the returned inputSchema exactly. Do not guess arguments.';
export const SECRET_GUIDANCE = 'Never put credentials, API keys, or tokens in tool arguments.';
export const STDIO_GUIDANCE =
  `${BRAND.cli} runs MCP servers locally from the manifest returned by Relay.`;

export function getAgentDocsUrl() {
  return `${SITE_URL}${BRAND.agentMdRoute}`;
}

export function getMcpServerUrl() {
  return `${SITE_URL}/api/mcp-server`;
}

export function getSearchUrlExample() {
  return `${SITE_URL}/api/servers/search?q={intent}`;
}

export function getInvokeUrlExample() {
  return `${BRAND.slug} invoke {serverName} {toolName}`;
}

export function getMcpInitializeInstructions() {
  return [
    `You are connected to ${BRAND.name}, a lightweight discovery layer for MCP tools.`,
    '',
    'RULES:',
    '1. Before taking action in an external service, call search_tools to find the right server and tool.',
    '2. Never assume the tool is already configured. Search first, then use the returned manifest locally.',
    `3. ${SECRET_GUIDANCE}`,
    '4. Credentials belong in your local agent or CLI environment.',
    '5. For knowledge, reasoning, writing, or calculation tasks, answer directly without searching.',
    '6. Use get_server_manifest when you need the full package, endpoint, env, and schema details.',
    `7. ${SCHEMA_GUIDANCE}`,
    `8. ${STDIO_GUIDANCE}`,
    '',
    `Full documentation: ${getAgentDocsUrl()}`,
  ].join('\n');
}

export function getAgentBootstrapPrompt() {
  return [
    `You have access to ${BRAND.name}.`,
    `If your framework supports MCP, connect to ${getMcpServerUrl()} and use search_tools plus get_server_manifest.`,
    `Otherwise read ${getAgentDocsUrl()} once before your first tool call and use the REST fallback below.`,
    'Before taking any action that affects an external system, search first.',
    'For knowledge-only questions, answer directly without searching.',
    SECRET_GUIDANCE,
    `Search: GET ${getSearchUrlExample()}`,
    `Run locally: ${getInvokeUrlExample()}`,
    SCHEMA_GUIDANCE,
  ].join('\n');
}

export function getNativeMcpConfigSnippet() {
  return `{
  "mcpServers": {
    "${BRAND.slug}": {
      "url": "${getMcpServerUrl()}"
    }
  }
}`;
}

export function getRateLimitAuthHint() {
  return `Add ${API_KEY_HEADER} for higher limits`;
}
