import { randomUUID } from 'node:crypto';

export const PROTOTYPE_PORT = Number(process.env.PROTOTYPE_MCP_PORT ?? '4010');
export const PROTOTYPE_BASE_URL = `http://127.0.0.1:${PROTOTYPE_PORT}`;
export const PROTOTYPE_API_KEY = 'sk_mcp_prototype_local_dev_key';
export const PROTOTYPE_TAG = 'prototype-fixture';

function schema(type, description, properties = {}, required = []) {
  return { type, description, properties, required };
}

function tool(name, description, inputSchema) {
  return { name, description, inputSchema };
}

function endpointFor(baseUrl, name, behavior) {
  if (behavior === 'timeout') return `${baseUrl}/timeout/${name}`;
  if (behavior === 'error') return `${baseUrl}/error/${name}`;
  if (behavior === 'redirect') return `${baseUrl}/redirect/${name}`;
  if (behavior === 'malformed_json') return `${baseUrl}/malformed/${name}`;
  return `${baseUrl}/mcp/${name}`;
}

function sourceFor(index) {
  const sources = ['official', 'direct', 'github', 'glama', 'pulsemcp', 'partner', 'mcp_run', 'composio'];
  return sources[index % sources.length];
}

function fixture(baseUrl, index, config) {
  const behavior = config.behavior ?? 'success';
  const transport = config.transport ?? 'streamable_http';
  const authType = config.authType ?? 'none';
  const name = config.name;

  return {
    id: randomUUID(),
    name,
    displayName: config.displayName ?? name,
    description: config.description,
    longDescription: config.longDescription ?? config.description,
    homepageUrl: config.homepageUrl ?? `${baseUrl}/catalog#${name}`,
    githubUrl: config.githubUrl ?? `https://github.com/akins-dev/${name}`,
    readmeUrl: config.readmeUrl ?? `https://github.com/akins-dev/${name}#readme`,
    license: 'MIT',
    version: config.version ?? '1.0.0',
    tags: [PROTOTYPE_TAG, ...(config.tags ?? [])],
    tools: config.toolSchemas.map((item) => item.name),
    toolSchemas: config.toolSchemas,
    resources: config.resources ?? [],
    prompts: config.prompts ?? [],
    status: 'active',
    verified: config.verified ?? true,
    stars: config.stars ?? Math.max(4, 160 - index * 2),
    latencyMs: config.latencyMs ?? 120 + index,
    uptimePct: config.uptimePct ?? 99.7,
    trustScore: config.trustScore ?? 84,
    schemaHash: `prototype-${name}`,
    scanStatus: config.scanStatus ?? 'passed',
    scanIssues: config.scanIssues ?? [],
    source: config.source ?? sourceFor(index),
    cveIssues: config.cveIssues ?? [],
    transport,
    authType,
    authSetupUrl: config.authSetupUrl ?? null,
    oauthAuthorizationUrl: config.oauthAuthorizationUrl ?? null,
    oauthTokenUrl: config.oauthTokenUrl ?? null,
    oauthScopes: config.oauthScopes ?? null,
    oauthClientId: config.oauthClientId ?? null,
    proxyAvailable: transport !== 'stdio' && (config.proxyAvailable ?? true),
    endpoint: transport === 'stdio' ? null : endpointFor(baseUrl, name, behavior),
    upstreamUpdatedAt: config.upstreamUpdatedAt ?? '2026-04-23T00:00:00.000Z',
    descriptionQuality: config.descriptionQuality ?? 'manual',
    behavior,
    requiredSecretName: config.requiredSecretName ?? null,
    secretDescription: config.secretDescription ?? null,
    secretObtainUrl: config.secretObtainUrl ?? null,
  };
}

const sendEmailSchema = tool(
  'send_email',
  'Send a transactional email with an HTML body to one or more recipients.',
  schema(
    'object',
    'Email delivery payload.',
    {
      to: { type: 'string', description: 'Recipient email address.' },
      subject: { type: 'string', description: 'Email subject line.' },
      html: { type: 'string', description: 'HTML body to send.' },
      text: { type: 'string', description: 'Optional plain text fallback.' },
      from: { type: 'string', description: 'Optional sender email.' },
    },
    ['to', 'subject', 'html']
  )
);

const previewSchema = tool(
  'preview_template',
  'Render an email template preview without delivering it.',
  schema(
    'object',
    'Preview an HTML email body.',
    {
      subject: { type: 'string' },
      html: { type: 'string' },
      locale: { type: 'string' },
    },
    ['html']
  )
);

const genericLookupSchema = tool(
  'lookup',
  'Fetch a record by external identifier.',
  schema(
    'object',
    'Lookup payload.',
    {
      id: { type: 'string' },
      type: { type: 'string' },
    },
    ['id']
  )
);

const issueSchema = tool(
  'create_issue',
  'Create a ticket or issue in an external system.',
  schema(
    'object',
    'Issue payload.',
    {
      title: { type: 'string' },
      body: { type: 'string' },
      repo: { type: 'string' },
      labels: { type: 'array', items: { type: 'string' } },
    },
    ['title', 'body']
  )
);

const querySchema = tool(
  'query_records',
  'Run a structured query against a remote dataset.',
  schema(
    'object',
    'Query payload.',
    {
      query: { type: 'string' },
      limit: { type: 'number' },
    },
    ['query']
  )
);

const fileSchema = tool(
  'write_file',
  'Write a local file through a stdio process.',
  schema(
    'object',
    'File write payload.',
    {
      path: { type: 'string' },
      content: { type: 'string' },
    },
    ['path', 'content']
  )
);

export function buildFixtureWorld(baseUrl = PROTOTYPE_BASE_URL) {
  const rows = [
    fixture(baseUrl, 0, {
      name: 'fx-transactional-mail-sandbox',
      displayName: 'Transactional Mail Sandbox',
      description: 'Send a transactional email with HTML body, text fallback, and preview support for MVP checkout and notification flows.',
      tags: ['email', 'transactional', 'html', 'notifications'],
      toolSchemas: [sendEmailSchema, previewSchema],
      trustScore: 96,
      stars: 240,
      latencyMs: 82,
    }),
    fixture(baseUrl, 1, {
      name: 'fx-html-mailer',
      displayName: 'HTML Mailer',
      description: 'Deliver rich HTML email messages for receipts, onboarding, and transactional messaging.',
      tags: ['email', 'html', 'transactional'],
      toolSchemas: [sendEmailSchema, previewSchema],
      trustScore: 92,
      stars: 210,
      latencyMs: 88,
    }),
    fixture(baseUrl, 2, {
      name: 'fx-order-confirmation-mail',
      displayName: 'Order Confirmation Mail',
      description: 'Send order confirmation and shipment emails with templated HTML bodies and per-order metadata.',
      tags: ['email', 'orders', 'transactional'],
      toolSchemas: [sendEmailSchema],
      trustScore: 91,
      stars: 195,
      latencyMs: 93,
    }),
    fixture(baseUrl, 3, {
      name: 'fx-receipt-mailer',
      displayName: 'Receipt Mailer',
      description: 'Send payment receipts and invoice emails with HTML tables and PDF attachment metadata.',
      tags: ['email', 'receipts', 'finance'],
      toolSchemas: [sendEmailSchema],
      trustScore: 90,
      stars: 188,
      latencyMs: 97,
    }),
    fixture(baseUrl, 4, {
      name: 'fx-bulk-email-sandbox',
      displayName: 'Bulk Email Sandbox',
      description: 'Batch-send sandbox marketing and transactional email payloads without touching production providers.',
      tags: ['email', 'bulk', 'sandbox'],
      toolSchemas: [sendEmailSchema],
      trustScore: 86,
      stars: 170,
      latencyMs: 110,
    }),
    fixture(baseUrl, 5, {
      name: 'fx-calendar-sync',
      displayName: 'Calendar Sync',
      description: 'Create and query events for internal scheduling workflows.',
      tags: ['calendar', 'scheduling'],
      toolSchemas: [
        tool('create_event', 'Create a calendar event.', schema('object', 'Create event.', {
          title: { type: 'string' },
          starts_at: { type: 'string' },
          ends_at: { type: 'string' },
        }, ['title', 'starts_at']))
      ],
      trustScore: 85,
    }),
    fixture(baseUrl, 6, {
      name: 'fx-crm-upsert',
      displayName: 'CRM Upsert',
      description: 'Create or update CRM contacts and companies.',
      tags: ['crm', 'sales'],
      toolSchemas: [
        tool('upsert_contact', 'Create or update a CRM contact.', schema('object', 'CRM payload.', {
          email: { type: 'string' },
          name: { type: 'string' },
          company: { type: 'string' },
        }, ['email']))
      ],
      trustScore: 83,
    }),
    fixture(baseUrl, 7, {
      name: 'fx-ticket-creator',
      displayName: 'Ticket Creator',
      description: 'Open customer support tickets and internal ops tasks.',
      tags: ['tickets', 'support'],
      toolSchemas: [issueSchema],
      trustScore: 82,
    }),
    fixture(baseUrl, 8, {
      name: 'fx-slack-broadcast',
      displayName: 'Slack Broadcast',
      description: 'Post messages to team channels and incident rooms.',
      tags: ['slack', 'chat'],
      toolSchemas: [
        tool('post_message', 'Post a message to a channel.', schema('object', 'Slack message.', {
          channel: { type: 'string' },
          text: { type: 'string' },
        }, ['channel', 'text']))
      ],
      trustScore: 84,
    }),
    fixture(baseUrl, 9, {
      name: 'fx-postgres-reporting',
      displayName: 'Postgres Reporting',
      description: 'Query reporting tables for aggregated metrics and export rows.',
      tags: ['database', 'postgres', 'reporting'],
      toolSchemas: [querySchema],
      trustScore: 87,
    }),
    fixture(baseUrl, 10, {
      name: 'fx-invoice-pdf',
      displayName: 'Invoice PDF',
      description: 'Generate invoice PDFs and return downloadable references.',
      tags: ['pdf', 'finance'],
      toolSchemas: [
        tool('generate_invoice_pdf', 'Generate invoice PDF metadata.', schema('object', 'Invoice payload.', {
          customer_id: { type: 'string' },
          amount: { type: 'number' },
        }, ['customer_id', 'amount']))
      ],
      trustScore: 81,
    }),
    fixture(baseUrl, 11, {
      name: 'fx-webhook-dispatch',
      displayName: 'Webhook Dispatch',
      description: 'Send signed webhook events to partner systems.',
      tags: ['webhooks', 'integrations'],
      toolSchemas: [
        tool('dispatch_webhook', 'Send a webhook event.', schema('object', 'Webhook payload.', {
          url: { type: 'string' },
          event: { type: 'string' },
          payload: { type: 'object' },
        }, ['url', 'event']))
      ],
      trustScore: 79,
    }),
    fixture(baseUrl, 12, {
      name: 'fx-cms-publisher',
      displayName: 'CMS Publisher',
      description: 'Publish articles and update content entries.',
      tags: ['cms', 'content'],
      toolSchemas: [
        tool('publish_entry', 'Publish a CMS entry.', schema('object', 'CMS payload.', {
          title: { type: 'string' },
          body: { type: 'string' },
        }, ['title', 'body']))
      ],
      trustScore: 78,
    }),
    fixture(baseUrl, 13, {
      name: 'fx-search-indexer',
      displayName: 'Search Indexer',
      description: 'Push documents into a search index and query indexed content.',
      tags: ['search', 'indexing'],
      toolSchemas: [querySchema],
      trustScore: 77,
    }),
    fixture(baseUrl, 14, {
      name: 'fx-cloud-storage',
      displayName: 'Cloud Storage',
      description: 'Upload objects and generate signed asset links.',
      tags: ['storage', 'files'],
      toolSchemas: [
        tool('upload_object', 'Upload an object.', schema('object', 'Upload payload.', {
          bucket: { type: 'string' },
          path: { type: 'string' },
          content: { type: 'string' },
        }, ['bucket', 'path', 'content']))
      ],
      trustScore: 80,
    }),
    fixture(baseUrl, 15, {
      name: 'fx-weather-public',
      displayName: 'Weather Public',
      description: 'Fetch public weather forecasts without credentials.',
      tags: ['weather', 'public-data'],
      toolSchemas: [genericLookupSchema],
      trustScore: 76,
    }),
    fixture(baseUrl, 16, {
      name: 'fx-news-brief',
      displayName: 'News Brief',
      description: 'Fetch headlines and summaries from public feeds.',
      tags: ['news', 'public-data'],
      toolSchemas: [querySchema],
      trustScore: 75,
    }),
    fixture(baseUrl, 17, {
      name: 'fx-contacts-lookup',
      displayName: 'Contacts Lookup',
      description: 'Look up internal contacts by email or account id.',
      tags: ['contacts', 'directory'],
      toolSchemas: [genericLookupSchema],
      trustScore: 79,
    }),
    fixture(baseUrl, 18, {
      name: 'fx-payment-capture-sandbox',
      displayName: 'Payment Capture Sandbox',
      description: 'Capture and refund sandbox card payments.',
      tags: ['payments', 'sandbox'],
      toolSchemas: [
        tool('capture_payment', 'Capture a payment.', schema('object', 'Payment payload.', {
          amount: { type: 'number' },
          currency: { type: 'string' },
          customer_id: { type: 'string' },
        }, ['amount', 'currency']))
      ],
      trustScore: 88,
    }),
    fixture(baseUrl, 19, {
      name: 'fx-analytics-export',
      displayName: 'Analytics Export',
      description: 'Export aggregated usage and product analytics.',
      tags: ['analytics', 'reporting'],
      toolSchemas: [querySchema],
      trustScore: 78,
    }),
    fixture(baseUrl, 20, {
      name: 'fx-github-issues-sse',
      displayName: 'GitHub Issues SSE',
      description: 'Create GitHub issues and stream issue activity.',
      tags: ['github', 'issues'],
      toolSchemas: [issueSchema],
      transport: 'sse',
      trustScore: 87,
    }),
    fixture(baseUrl, 21, {
      name: 'fx-github-prs-sse',
      displayName: 'GitHub PRs SSE',
      description: 'Open pull requests and stream repository change events.',
      tags: ['github', 'pull-requests'],
      toolSchemas: [
        tool('create_pull_request', 'Create a pull request.', schema('object', 'PR payload.', {
          repo: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
          head: { type: 'string' },
          base: { type: 'string' },
        }, ['repo', 'title', 'head', 'base']))
      ],
      transport: 'sse',
      trustScore: 86,
    }),
    fixture(baseUrl, 22, {
      name: 'fx-linear-tickets-sse',
      displayName: 'Linear Tickets SSE',
      description: 'Create and watch engineering tickets.',
      tags: ['linear', 'tickets'],
      toolSchemas: [issueSchema],
      transport: 'sse',
      trustScore: 84,
    }),
    fixture(baseUrl, 23, {
      name: 'fx-email-template-sse',
      displayName: 'Email Template SSE',
      description: 'Preview and stream edits for transactional email templates.',
      tags: ['email', 'templates'],
      toolSchemas: [previewSchema],
      transport: 'sse',
      trustScore: 85,
    }),
    fixture(baseUrl, 24, {
      name: 'fx-search-crawler-sse',
      displayName: 'Search Crawler SSE',
      description: 'Crawl URLs and stream indexing progress.',
      tags: ['search', 'crawler'],
      toolSchemas: [querySchema],
      transport: 'sse',
      trustScore: 74,
    }),
    fixture(baseUrl, 25, {
      name: 'fx-notion-docs-sse',
      displayName: 'Notion Docs SSE',
      description: 'Read and write Notion pages with streamed sync status.',
      tags: ['notion', 'docs'],
      toolSchemas: [
        tool('create_page', 'Create a page.', schema('object', 'Page payload.', {
          title: { type: 'string' },
          content: { type: 'string' },
        }, ['title', 'content']))
      ],
      transport: 'sse',
      trustScore: 82,
    }),
    fixture(baseUrl, 26, {
      name: 'fx-status-page-sse',
      displayName: 'Status Page SSE',
      description: 'Publish incidents and stream status updates.',
      tags: ['status', 'incidents'],
      toolSchemas: [
        tool('create_incident', 'Create an incident.', schema('object', 'Incident payload.', {
          title: { type: 'string' },
          impact: { type: 'string' },
        }, ['title']))
      ],
      transport: 'sse',
      trustScore: 81,
    }),
    fixture(baseUrl, 27, {
      name: 'fx-calendar-events-sse',
      displayName: 'Calendar Events SSE',
      description: 'Create events and stream event reminders.',
      tags: ['calendar', 'events'],
      toolSchemas: [
        tool('create_event', 'Create event.', schema('object', 'Event payload.', {
          title: { type: 'string' },
          starts_at: { type: 'string' },
        }, ['title', 'starts_at']))
      ],
      transport: 'sse',
      trustScore: 80,
    }),
    fixture(baseUrl, 28, {
      name: 'fx-sendgrid-mail',
      displayName: 'SendGrid Mail',
      description: 'Send transactional email through an API-key-protected hosted mail service.',
      tags: ['email', 'transactional', 'provider'],
      toolSchemas: [sendEmailSchema],
      authType: 'managed',
      authSetupUrl: 'http://localhost:3000/dashboard/secrets?server=fx-sendgrid-mail',
      requiredSecretName: 'FX_SENDGRID_MAIL_API_KEY',
      secretDescription: 'Prototype SendGrid-style API key.',
      secretObtainUrl: 'https://example.com/sendgrid-key',
      trustScore: 89,
      behavior: 'auth',
    }),
    fixture(baseUrl, 29, {
      name: 'fx-mailgun-mail',
      displayName: 'Mailgun Mail',
      description: 'Send HTML and plain-text mail through a second API-key provider.',
      tags: ['email', 'transactional', 'provider'],
      toolSchemas: [sendEmailSchema],
      authType: 'managed',
      authSetupUrl: 'http://localhost:3000/dashboard/secrets?server=fx-mailgun-mail',
      requiredSecretName: 'FX_MAILGUN_MAIL_API_KEY',
      secretDescription: 'Prototype Mailgun-style API key.',
      secretObtainUrl: 'https://example.com/mailgun-key',
      trustScore: 87,
      behavior: 'auth',
    }),
    fixture(baseUrl, 30, {
      name: 'fx-github-oauth-tools',
      displayName: 'GitHub OAuth Tools',
      description: 'Authenticated GitHub operations using per-user OAuth.',
      tags: ['github', 'oauth'],
      toolSchemas: [issueSchema],
      authType: 'oauth',
      oauthAuthorizationUrl: 'https://github.com/login/oauth/authorize',
      oauthTokenUrl: 'https://github.com/login/oauth/access_token',
      oauthScopes: 'repo read:user',
      oauthClientId: 'prototype-github-client',
      trustScore: 90,
      behavior: 'auth',
    }),
    fixture(baseUrl, 31, {
      name: 'fx-salesforce-sync',
      displayName: 'Salesforce Sync',
      description: 'Push records into a private Salesforce instance.',
      tags: ['crm', 'salesforce'],
      toolSchemas: [genericLookupSchema],
      authType: 'managed',
      requiredSecretName: 'FX_SALESFORCE_SYNC_API_KEY',
      secretDescription: 'Prototype Salesforce access token.',
      secretObtainUrl: 'https://example.com/salesforce-key',
      trustScore: 84,
      behavior: 'auth',
    }),
    fixture(baseUrl, 32, {
      name: 'fx-stripe-secure',
      displayName: 'Stripe Secure',
      description: 'Authenticated payment operations for protected merchant accounts.',
      tags: ['payments', 'stripe'],
      toolSchemas: [
        tool('create_charge', 'Create a charge.', schema('object', 'Charge payload.', {
          amount: { type: 'number' },
          currency: { type: 'string' },
        }, ['amount', 'currency']))
      ],
      authType: 'managed',
      requiredSecretName: 'FX_STRIPE_SECURE_API_KEY',
      secretDescription: 'Prototype Stripe secret key.',
      secretObtainUrl: 'https://example.com/stripe-key',
      trustScore: 90,
      behavior: 'auth',
    }),
    fixture(baseUrl, 33, {
      name: 'fx-hubspot-private',
      displayName: 'HubSpot Private',
      description: 'Private HubSpot CRM write operations.',
      tags: ['crm', 'hubspot'],
      toolSchemas: [genericLookupSchema],
      authType: 'managed',
      requiredSecretName: 'FX_HUBSPOT_PRIVATE_API_KEY',
      secretDescription: 'Prototype HubSpot access key.',
      secretObtainUrl: 'https://example.com/hubspot-key',
      trustScore: 83,
      behavior: 'auth',
    }),
    fixture(baseUrl, 34, {
      name: 'fx-flaky-timeout',
      displayName: 'Flaky Timeout',
      description: 'A server that accepts requests but never responds before timeout.',
      tags: ['flaky', 'timeouts'],
      toolSchemas: [querySchema],
      verified: false,
      trustScore: 35,
      scanStatus: 'failed',
      behavior: 'timeout',
    }),
    fixture(baseUrl, 35, {
      name: 'fx-flaky-500',
      displayName: 'Flaky 500',
      description: 'A server that returns upstream 500 errors.',
      tags: ['flaky', 'errors'],
      toolSchemas: [querySchema],
      verified: false,
      trustScore: 32,
      scanStatus: 'failed',
      behavior: 'error',
    }),
    fixture(baseUrl, 36, {
      name: 'fx-flaky-redirect',
      displayName: 'Flaky Redirect',
      description: 'A server that redirects once before succeeding.',
      tags: ['flaky', 'redirects'],
      toolSchemas: [querySchema],
      verified: false,
      trustScore: 48,
      behavior: 'redirect',
    }),
    fixture(baseUrl, 37, {
      name: 'fx-flaky-malformed-response',
      displayName: 'Flaky Malformed Response',
      description: 'A server that responds with malformed JSON.',
      tags: ['flaky', 'malformed'],
      toolSchemas: [querySchema],
      verified: false,
      trustScore: 28,
      scanStatus: 'failed',
      behavior: 'malformed_json',
    }),
    fixture(baseUrl, 38, {
      name: 'fx-bad-schema-mail',
      displayName: 'Bad Schema Mail',
      description: 'Email server with incomplete schema metadata for edge-case ranking tests.',
      tags: ['email', 'metadata', 'edge-case'],
      toolSchemas: [
        { name: 'send_email', description: 'Incomplete schema on purpose.' }
      ],
      verified: false,
      trustScore: 40,
      descriptionQuality: 'auto_generated',
    }),
    fixture(baseUrl, 39, {
      name: 'fx-bad-schema-crm',
      displayName: 'Bad Schema CRM',
      description: 'CRM fixture with sparse schema fields for parser hardening.',
      tags: ['crm', 'metadata', 'edge-case'],
      toolSchemas: [
        { name: 'upsert_contact', inputSchema: { type: 'object' } }
      ],
      verified: false,
      trustScore: 39,
      descriptionQuality: 'auto_generated',
    }),
    fixture(baseUrl, 40, {
      name: 'fx-bad-description-search',
      displayName: 'Bad Description Search',
      description: 'search search search tool tool tool vague vague vague',
      tags: ['search', 'metadata', 'edge-case'],
      toolSchemas: [querySchema],
      verified: false,
      trustScore: 38,
      descriptionQuality: 'auto_generated',
    }),
    fixture(baseUrl, 41, {
      name: 'fx-bad-tool-shapes',
      displayName: 'Bad Tool Shapes',
      description: 'Mixed quality tool metadata for robustness testing.',
      tags: ['metadata', 'edge-case'],
      toolSchemas: [
        { name: 'odd_tool', description: null, inputSchema: { type: 'object', properties: { anything: { type: 'string' } } } },
        { name: 'second_tool' }
      ],
      verified: false,
      trustScore: 37,
      descriptionQuality: 'auto_generated',
    }),
    fixture(baseUrl, 42, {
      name: 'fx-email-dispatch-eu',
      displayName: 'Email Dispatch EU',
      description: 'EU-region transactional email dispatch with HTML templates and compliance metadata.',
      tags: ['email', 'transactional', 'eu'],
      toolSchemas: [sendEmailSchema],
      trustScore: 88,
      stars: 176,
      latencyMs: 96,
    }),
    fixture(baseUrl, 43, {
      name: 'fx-email-dispatch-us',
      displayName: 'Email Dispatch US',
      description: 'US-region transactional email dispatch with HTML templates and fast delivery.',
      tags: ['email', 'transactional', 'us'],
      toolSchemas: [sendEmailSchema],
      trustScore: 88,
      stars: 178,
      latencyMs: 84,
    }),
    fixture(baseUrl, 44, {
      name: 'fx-mail-dispatcher',
      displayName: 'Mail Dispatcher',
      description: 'General-purpose transactional email service with HTML body support.',
      tags: ['email', 'transactional'],
      toolSchemas: [sendEmailSchema],
      trustScore: 85,
      stars: 169,
      latencyMs: 91,
    }),
    fixture(baseUrl, 45, {
      name: 'fx-transactional-postmark-like',
      displayName: 'Transactional Postmark Like',
      description: 'Lean transactional mail provider optimized for account emails and password resets.',
      tags: ['email', 'transactional', 'provider'],
      toolSchemas: [sendEmailSchema],
      trustScore: 86,
      stars: 171,
      latencyMs: 87,
    }),
    fixture(baseUrl, 46, {
      name: 'fx-local-files-stdio',
      displayName: 'Local Files STDIO',
      description: 'Local stdio tool for writing and reading files.',
      tags: ['files', 'local'],
      toolSchemas: [fileSchema],
      transport: 'stdio',
      proxyAvailable: false,
      trustScore: 72,
    }),
    fixture(baseUrl, 47, {
      name: 'fx-terminal-git-stdio',
      displayName: 'Terminal Git STDIO',
      description: 'Local stdio git helper for branch and status operations.',
      tags: ['git', 'local'],
      toolSchemas: [
        tool('git_status', 'Read git status.', schema('object', 'Git payload.', {
          repo_path: { type: 'string' },
        }, ['repo_path']))
      ],
      transport: 'stdio',
      proxyAvailable: false,
      trustScore: 71,
    }),
    fixture(baseUrl, 48, {
      name: 'fx-image-processor-stdio',
      displayName: 'Image Processor STDIO',
      description: 'Local stdio image processing pipeline.',
      tags: ['images', 'local'],
      toolSchemas: [
        tool('resize_image', 'Resize an image.', schema('object', 'Image payload.', {
          path: { type: 'string' },
          width: { type: 'number' },
        }, ['path', 'width']))
      ],
      transport: 'stdio',
      proxyAvailable: false,
      trustScore: 69,
    }),
    fixture(baseUrl, 49, {
      name: 'fx-local-sqlite-stdio',
      displayName: 'Local SQLite STDIO',
      description: 'Local stdio SQLite query helper.',
      tags: ['sqlite', 'local', 'database'],
      toolSchemas: [querySchema],
      transport: 'stdio',
      proxyAvailable: false,
      trustScore: 70,
    }),
  ];

  if (rows.length !== 50) {
    throw new Error(`Expected 50 prototype fixtures, received ${rows.length}`);
  }

  return rows;
}

