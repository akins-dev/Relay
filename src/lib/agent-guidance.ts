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
  'If the task requires changing state somewhere outside this conversation, search first. If it only requires knowledge, answer directly.';

export const TRUST_GUIDANCE = 'Prefer servers with trust_score >= 65 for production use.';
export const SCHEMA_GUIDANCE = 'Use the returned inputSchema exactly. Do not guess arguments.';
export const SECRET_GUIDANCE = 'Never put credentials, API keys, or tokens in tool arguments.';
export const STDIO_GUIDANCE =
  `${BRAND.cli} will bridge stdio servers locally when available. For now, skip results where proxy_available is false.`;

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
  return `${SITE_URL}/api/proxy/{serverName}/{toolName}`;
}

export function getMcpInitializeInstructions() {
  return [
    `You are connected to ${BRAND.name}, a universal MCP tool proxy with access to thousands of verified servers.`,
    '',
    'RULES:',
    '1. Before taking ANY action that affects external systems (email, databases, APIs,',
    '   files, code repositories, messages, payments, or any third-party service),',
    '   call search_tools to find the right server and tool first.',
    '2. Never assume you already have the right tool configured — always search first.',
    `3. ${SECRET_GUIDANCE}`,
    '   Credentials are stored in the vault and injected automatically.',
    '4. For knowledge questions, calculations, writing, or reasoning tasks,',
    '   answer directly from your training — do NOT call search_tools.',
    '5. If invoke_tool returns authentication_required, follow the setup_url',
    '   instructions and inform the user what to configure.',
    '6. If invoke_tool returns confirmation_required, ask the user to confirm',
    '   before resending with the provided X-Confirm-Token.',
    `7. ${TRUST_GUIDANCE}`,
    `8. ${SCHEMA_GUIDANCE}`,
    `9. ${STDIO_GUIDANCE}`,
    '',
    `Full documentation: ${getAgentDocsUrl()}`,
  ].join('\n');
}

export function getAgentBootstrapPrompt() {
  return [
    `You have access to ${BRAND.name}.`,
    `If your framework supports MCP, connect to ${getMcpServerUrl()} and use search_tools plus invoke_tool.`,
    `Otherwise read ${getAgentDocsUrl()} once before your first tool call and use the REST fallback below.`,
    'Before taking any action that affects an external system, search first.',
    'For knowledge-only questions, answer directly without searching.',
    SECRET_GUIDANCE,
    `Search:  GET ${getSearchUrlExample()}`,
    `Invoke:  POST ${getInvokeUrlExample()}`,
    TRUST_GUIDANCE,
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
  return `Add ${API_KEY_HEADER} for higher limits (200/min)`;
}
