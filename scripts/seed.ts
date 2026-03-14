import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data/registry.db');
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Run migrations inline
db.exec(`
  CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, github_username TEXT, avatar_url TEXT, bio TEXT, website TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()));
  CREATE TABLE IF NOT EXISTS servers (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, description TEXT NOT NULL, long_description TEXT, author_id TEXT NOT NULL REFERENCES users(id), version TEXT NOT NULL DEFAULT '1.0.0', endpoint TEXT NOT NULL, homepage_url TEXT, github_url TEXT, license TEXT DEFAULT 'MIT', tags TEXT NOT NULL DEFAULT '[]', tools TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending', verified INTEGER NOT NULL DEFAULT 0, stars INTEGER NOT NULL DEFAULT 0, total_calls INTEGER NOT NULL DEFAULT 0, calls_today INTEGER NOT NULL DEFAULT 0, latency_ms INTEGER, uptime_pct REAL DEFAULT 100.0, trust_score REAL DEFAULT 50.0, schema_hash TEXT, last_scanned_at INTEGER, scan_status TEXT DEFAULT 'pending', scan_issues TEXT DEFAULT '[]', created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()));
  CREATE TABLE IF NOT EXISTS server_stars (user_id TEXT NOT NULL REFERENCES users(id), server_id TEXT NOT NULL REFERENCES servers(id), created_at INTEGER NOT NULL DEFAULT (unixepoch()), PRIMARY KEY (user_id, server_id));
  CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), key_hash TEXT NOT NULL, key_prefix TEXT NOT NULL, name TEXT NOT NULL, last_used_at INTEGER, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
  CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, server_id TEXT REFERENCES servers(id), user_id TEXT REFERENCES users(id), action TEXT NOT NULL, tool_name TEXT, request_size INTEGER, response_size INTEGER, latency_ms INTEGER, status_code INTEGER, ip TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
  CREATE TABLE IF NOT EXISTS scan_results (id TEXT PRIMARY KEY, server_id TEXT NOT NULL REFERENCES servers(id), scan_type TEXT NOT NULL, passed INTEGER NOT NULL, issues TEXT NOT NULL DEFAULT '[]', score INTEGER DEFAULT 100, details TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
  CREATE INDEX IF NOT EXISTS idx_servers_status ON servers(status);
  CREATE INDEX IF NOT EXISTS idx_servers_trust ON servers(trust_score DESC);
  CREATE INDEX IF NOT EXISTS idx_servers_stars ON servers(stars DESC);
`);

const SERVERS = [
  { name: 'agentsecrets', display_name: 'AgentSecrets', description: 'Zero-knowledge credential proxy for AI agents. Inject secrets at the transport layer — agent memory never sees raw credentials.', long_description: 'AgentSecrets is the security infrastructure layer for the AI agent economy. It proxies credentials between agents and external services, injecting API keys and tokens at the transport layer via zero-knowledge binding. Agents call tools normally — credentials are never in context, never logged, never exposed.', version: '0.9.1', endpoint: 'https://mcp.agentsecrets.dev', github_url: 'https://github.com/the-17/agentsecrets', tags: ['security','credentials','proxy','zk'], tools: ['inject_credential','rotate_secret','audit_log','bind_domain','dlp_scan'], verified: 1, stars: 1102, total_calls: 298000, calls_today: 8900, latency_ms: 18, uptime_pct: 100.0, trust_score: 98.0 },
  { name: 'stripe-payments', display_name: 'Stripe Payments', description: 'Accept payments, manage subscriptions, issue refunds, and query transaction history via Stripe API.', version: '2.1.0', endpoint: 'https://mcp.stripe-payments.dev', github_url: 'https://github.com/community/stripe-mcp', tags: ['payments','finance','billing','stripe'], tools: ['charge_card','create_subscription','issue_refund','list_transactions','create_customer','create_invoice'], verified: 1, stars: 4821, total_calls: 3840000, calls_today: 128400, latency_ms: 42, uptime_pct: 99.98, trust_score: 97.0 },
  { name: 'github-ops', display_name: 'GitHub Ops', description: 'Create repos, manage issues, open PRs, read code, and trigger CI/CD pipelines.', version: '1.8.3', endpoint: 'https://mcp.github-ops.dev', github_url: 'https://github.com/community/github-mcp', tags: ['git','devops','code','github'], tools: ['create_repo','open_pr','list_issues','read_file','trigger_workflow','create_branch','merge_pr'], verified: 1, stars: 7203, total_calls: 10240000, calls_today: 341200, latency_ms: 61, uptime_pct: 99.95, trust_score: 96.0 },
  { name: 'postgres-query', display_name: 'Postgres Query', description: 'Natural language to SQL. Query, insert, update Postgres databases with schema introspection.', version: '3.0.0', endpoint: 'https://mcp.postgres-query.dev', tags: ['database','sql','postgres','data'], tools: ['query','insert','update','delete','describe_schema','run_migration'], verified: 1, stars: 3409, total_calls: 2678000, calls_today: 89300, latency_ms: 55, uptime_pct: 99.91, trust_score: 94.0 },
  { name: 'browserbase', display_name: 'Browserbase', description: 'Cloud browser automation. Navigate pages, extract data, fill forms, take screenshots.', version: '2.0.1', endpoint: 'https://mcp.browserbase.io', github_url: 'https://github.com/browserbase/mcp-server', tags: ['browser','scraping','automation','web'], tools: ['navigate','click','extract_text','screenshot','fill_form','wait_for_element'], verified: 1, stars: 5566, total_calls: 6030000, calls_today: 201000, latency_ms: 210, uptime_pct: 99.70, trust_score: 93.0 },
  { name: 'sendgrid-mail', display_name: 'SendGrid Mail', description: 'Send transactional and marketing emails, manage templates, track delivery metrics.', version: '1.2.0', endpoint: 'https://mcp.sendgrid-mail.dev', tags: ['email','marketing','notifications'], tools: ['send_email','create_template','list_campaigns','get_delivery_stats'], verified: 0, stars: 2187, total_calls: 1623000, calls_today: 54100, latency_ms: 73, uptime_pct: 99.82, trust_score: 82.0 },
  { name: 'slack-messenger', display_name: 'Slack Messenger', description: 'Post messages, manage channels, read conversation history, and react to events in Slack workspaces.', version: '1.5.0', endpoint: 'https://mcp.slack-messenger.dev', tags: ['slack','messaging','notifications'], tools: ['post_message','create_channel','list_channels','read_history','add_reaction'], verified: 1, stars: 3891, total_calls: 4120000, calls_today: 137300, latency_ms: 38, uptime_pct: 99.93, trust_score: 95.0 },
  { name: 'filesystem-ops', display_name: 'Filesystem Ops', description: 'Read, write, and manage files and directories with path safety and permission controls.', version: '2.3.1', endpoint: 'https://mcp.filesystem-ops.dev', tags: ['filesystem','files','storage','io'], tools: ['read_file','write_file','list_directory','create_directory','delete_file','copy_file'], verified: 1, stars: 6102, total_calls: 8900000, calls_today: 296700, latency_ms: 8, uptime_pct: 100.0, trust_score: 99.0 },
];

async function seed() {
  console.log('🌱 Seeding...');
  const userId = nanoid();
  const hash = await bcrypt.hash('demo-password-123', 10);
  db.prepare('INSERT OR IGNORE INTO users (id, username, email, password_hash, bio) VALUES (?, ?, ?, ?, ?)').run(userId, 'the-17', 'hello@the-17.dev', hash, 'Building the infrastructure layer of the AI agent economy.');

  for (const s of SERVERS) {
    const id = nanoid();
    const schemaHash = Buffer.from(JSON.stringify(s.tools) + s.version).toString('base64');
    db.prepare(`INSERT OR IGNORE INTO servers (id, name, display_name, description, long_description, author_id, version, endpoint, github_url, tags, tools, verified, stars, total_calls, calls_today, latency_ms, uptime_pct, trust_score, status, license, schema_hash, scan_status, last_scanned_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'MIT', ?, 'passed', unixepoch())`).run(
      id, s.name, s.display_name, s.description, (s as any).long_description ?? null, userId,
      s.version, s.endpoint, (s as any).github_url ?? null,
      JSON.stringify(s.tags), JSON.stringify(s.tools),
      s.verified, s.stars, s.total_calls, s.calls_today,
      s.latency_ms, s.uptime_pct, s.trust_score, schemaHash,
    );
    db.prepare('INSERT OR IGNORE INTO scan_results (id, server_id, scan_type, passed, issues, score, details) VALUES (?, ?, ?, 1, ?, 100, ?)').run(nanoid(), id, 'static', '[]', 'Scan passed. Score: 100/100.');
  }
  console.log(`✅ Seeded ${SERVERS.length} servers`);
}

seed().catch(console.error);
