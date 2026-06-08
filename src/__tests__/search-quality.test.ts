import {
  hashIntent,
  normalizeIntent,
  trimSchemasToIntent,
  computeConfidence,
  MAX_TOOLS_PER_RESULT,
} from '../lib/search-analytics';
import { classifyIntent, looksLikeKnowledgeOnly } from '../lib/intent-classifier';
import { buildRelayManifest } from '../lib/relay-manifest';

describe('intent normalization and hashing', () => {
  test('normalizeIntent collapses whitespace and strips trailing punctuation', () => {
    expect(normalizeIntent('  Send   Email!!!  ')).toBe('send email');
  });

  test('hashIntent is stable across word forms', () => {
    const a = hashIntent('sending transactional emails');
    const b = hashIntent('send transactional email');
    expect(a).toBe(b);
    expect(a).toHaveLength(32);
  });

  test('different intents produce different hashes', () => {
    expect(hashIntent('send email')).not.toBe(hashIntent('create github issue'));
  });
});

describe('intent classifier', () => {
  test('knowledge intents without action verbs deflect', () => {
    expect(classifyIntent('what is the model context protocol')).toBe('knowledge');
    expect(looksLikeKnowledgeOnly('explain REST APIs')).toBe(true);
  });

  test('action verbs prevent false deflection', () => {
    expect(classifyIntent('what is the best way to send email')).toBe('action');
    expect(classifyIntent('create a github issue')).toBe('action');
  });

  test('compare pattern is knowledge', () => {
    expect(classifyIntent('compare SQL versus NoSQL')).toBe('knowledge');
  });
});

describe('trimSchemasToIntent', () => {
  const tools = [
    { name: 'send_email', description: 'Send transactional email with HTML body' },
    { name: 'list_domains', description: 'List verified domains' },
    { name: 'delete_contact', description: 'Remove a marketing contact' },
    { name: 'preview_template', description: 'Preview HTML template' },
    { name: 'webhook_create', description: 'Create inbound webhook' },
  ];

  test('returns at most MAX_TOOLS_PER_RESULT tools', () => {
    const trimmed = trimSchemasToIntent(tools, 'send transactional email html body');
    expect(trimmed.length).toBeLessThanOrEqual(MAX_TOOLS_PER_RESULT);
    expect(trimmed[0].name).toBe('send_email');
  });

  test('returns all tools when count is within limit', () => {
    const small = tools.slice(0, 2);
    expect(trimSchemasToIntent(small, 'anything')).toHaveLength(2);
  });

  test('empty intent returns first N tools', () => {
    const trimmed = trimSchemasToIntent(tools, 'a');
    expect(trimmed.length).toBeGreaterThan(0);
  });
});

describe('computeConfidence', () => {
  test('rank 0 with high trust yields high confidence', () => {
    const c = computeConfidence({
      rank: 0,
      totalResults: 5,
      trustScore: 95,
      successRate: 0,
      invokeCount: 0,
    });
    expect(c).toBeGreaterThan(0.7);
  });

  test('Wilson history increases confidence with strong outcomes', () => {
    const noHistory = computeConfidence({
      rank: 0,
      totalResults: 3,
      trustScore: 80,
      successRate: 0,
      invokeCount: 0,
    });
    const withHistory = computeConfidence({
      rank: 0,
      totalResults: 3,
      trustScore: 80,
      successRate: 1,
      invokeCount: 20,
    });
    expect(withHistory).toBeGreaterThan(noHistory);
  });
});

describe('relay manifest run_mode', () => {
  test('npm package yields local_stdio', () => {
    const m = buildRelayManifest({
      name: 'demo',
      transport: 'stdio',
      package_info: [{ registryType: 'npm', identifier: '@demo/mcp' }],
      env_var_schema: [],
    });
    expect(m.run_mode).toBe('local_stdio');
    expect(m.launch?.command).toEqual(['npx', '-y', '@demo/mcp']);
  });

  test('endpoint without package yields remote_mcp', () => {
    const m = buildRelayManifest({
      name: 'remote',
      transport: 'streamable_http',
      endpoint: 'https://api.example.com/mcp',
      package_info: [],
    });
    expect(m.run_mode).toBe('remote_mcp');
  });

  test('no package or endpoint yields discovery_only', () => {
    const m = buildRelayManifest({
      name: 'docs-only',
      transport: 'stdio',
      package_info: [],
      endpoint: null,
    });
    expect(m.run_mode).toBe('discovery_only');
  });
});
