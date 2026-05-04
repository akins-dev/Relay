// ─────────────────────────────────────────────────────────────────────────────
// Security Layers
//
// L1  Publish-time static scan          → scanServer()
// L4  Proxy DLP — credential patterns   → dlpScan()
// L5  Trust score                        → computeTrustScore()
// L8  Typosquatting                      → find_similar_names() SQL RPC
// L9  MCP Sampling inspection            → samplingDlpScan()
// L10 PII detection                      → piiScan()
// L11 URL elicitation safety             → checkElicitationUrl()
// L12 Context isolation / leak detection → contextLeakScan()
// ─────────────────────────────────────────────────────────────────────────────



// ── L1: Publish-time static scan (manual submissions only) ───────────────────
//
// DESIGN NOTE: This function gates MANUAL server submissions by humans via the
// publish UI (/api/servers POST). It is intentionally NOT used in the automated
// ingest pipeline — ingest uses CVE-only rejection (S-14) to avoid false positives
// on legitimate servers whose descriptions contain words like "execute" or "shell".
//
// At proxy time, indirectInjectionScan() and shellInjectionScan() cover runtime
// payloads — descriptions are re-checked on every schema-drift event.
//
// For a typical clean MCP server, expect: passed=true, issues=[]
// For an injection attempt, expect: passed=false, issues=[{severity:'critical',...}]

export interface ScanIssue {
  severity: 'critical' | 'high' | 'medium' | 'low';
  type:     string;
  description: string;
}

export interface ScanResult {
  passed: boolean;
  issues: ScanIssue[];
  score:  number; // 0–100, used by computeTrustScore scanScore param
  details?: string;
}

const STATIC_INJECTION_PATTERNS: { pattern: RegExp; severity: ScanIssue['severity']; type: string; desc: string }[] = [
  // Prompt injection / instruction override attempts in descriptions
  { pattern: /ignore (previous|all|prior|above|earlier) instructions?/i, severity: 'critical', type: 'prompt_injection', desc: 'Instruction override detected in description' },
  { pattern: /you are (now|actually|really|instead)\s+/i,               severity: 'critical', type: 'identity_override', desc: 'Identity override attempt in description' },
  { pattern: /exfiltrate|send.{0,80}(?:data|credentials|secrets|user data).{0,40}(?:to|via|toward|towards)\b/i, severity: 'critical', type: 'exfiltration', desc: 'Data exfiltration instruction in description' },
  { pattern: /\[SYSTEM:|<\|im_start\|>|<\|im_end\|>/i,                  severity: 'critical', type: 'prompt_injection', desc: 'Chat template tokens in description' },
  { pattern: /forget (everything|all|your|previous)/i,                  severity: 'critical', type: 'memory_wipe',        desc: 'Memory wipe instruction in description' },
  { pattern: /your (true|real|actual|hidden) (purpose|goal|mission)/i,  severity: 'critical', type: 'hidden_purpose',     desc: 'Hidden purpose injection in description' },
  // Insecure endpoint
  { pattern: /^http:\/\//,                                               severity: 'high',     type: 'insecure_endpoint', desc: 'Server endpoint uses plain HTTP (not HTTPS)' },
  // Suspicious tool name patterns
  { pattern: /^(exec|eval|shell|cmd|system|spawn)$/i,                   severity: 'high',     type: 'dangerous_tool_name', desc: 'Tool name matches dangerous system call' },
];

export function scanServer(params: {
  name:             string;
  description:      string;
  long_description?: string;
  endpoint:         string;
  tools:            string[];
  tags:             string[];
}): ScanResult {
  const issues: ScanIssue[] = [];
  // Scan description + long_description + tool names together
  const textToScan = [params.description, params.long_description ?? '', ...params.tools].join(' ');

  // Check description and tool names for injection patterns
  for (const { pattern, severity, type, desc } of STATIC_INJECTION_PATTERNS) {
    if (type === 'insecure_endpoint') {
      if (pattern.test(params.endpoint)) {
        issues.push({ severity, type, description: desc });
      }
    } else if (type === 'dangerous_tool_name') {
      for (const tool of params.tools) {
        if (pattern.test(tool)) {
          issues.push({ severity, type, description: `${desc}: "${tool}"` });
        }
      }
    } else {
      if (pattern.test(textToScan)) {
        issues.push({ severity, type, description: desc });
      }
    }
  }

  const criticals = issues.filter(i => i.severity === 'critical').length;
  const highs     = issues.filter(i => i.severity === 'high').length;
  const score     = Math.max(0, 100 - criticals * 40 - highs * 20);
  const passed    = criticals === 0;

  return {
    passed,
    issues,
    score,
    details: issues.map(i => i.description).join('; ') || 'No issues detected',
  };
}



/**
 * Trust Score — L5 Security Layer
 *
 * Composite 0–100 score answering: "How safe and reliable is this server for
 * an agent to invoke?" Designed for a security-first MCP proxy registry.
 *
 * Weights (total = 100 base pts):
 *   Security quality    25 pts  CVE + static scan — the core value prop
 *   Uptime              20 pts  Runtime cron (every 15 min)
 *   Publisher credibility 15 pts  verified = trusted external party vouched for it
 *   Real-world usage    15 pts  useCount (Smithery) or stars (GitHub) — log scale
 *   Deployment quality  15 pts  Has working endpoint + tool schemas with inputSchema
 *   Schema stability    10 pts  Days since schema hash last changed (max 90d)
 *
 * Runtime penalties (applied post-ingest from metering):
 *   High failure rate   up to -15 pts
 *   DLP trigger rate    up to -10 pts
 *
 * Design principles:
 *   - No source-type bias. All inputs must come from real measured data.
 *   - verified is meaningful but not dominant (15 pts, not 40).
 *     Unverified servers can still reach 85 if everything else is excellent.
 *   - useCount replaces the fake stars hardcoding from the old pipeline.
 *   - deploymentQuality rewards servers that actually work end-to-end.
 */
export function computeTrustScore(params: {
  /** 1 if publisher verified by trusted source (Smithery review, mcp.directory), 0 otherwise */
  verified:           number;
  /** 0–100 uptime percentage from the 15-min uptime cron. Default 100 at ingest. */
  uptimePct:          number;
  /**
   * Real-world usage count — useCount from Smithery, or GitHub stars.
   * Use 0 if unknown. Log scale applied internally.
   */
  usageCount:         number;
  /**
   * Days since the schema_hash last changed.
   * Compute from schema_changed_at or first_seen_at. Use 0 for new servers.
   */
  daysSinceChange:    number;
  /**
   * 0–100 scan quality score from the CVE + static scan pipeline.
   * 100 = fully clean. Defaults to 100 if not provided (optimistic for new servers).
   */
  scanScore?:         number;
  /**
   * 1 if server has a working HTTP endpoint AND at least one tool_schema with
   * an inputSchema. Indicates the server is actually invokable end-to-end.
   */
  deploymentQuality?: number;
  /** Request failure rate from proxy metering (0–100, 0 = perfect). */
  failureRatePct?:    number;
  /** DLP trigger rate from proxy calls (0–100, 0 = clean). */
  dlpRatePct?:        number;
}): number {
  // ── Security quality — 25 pts ──────────────────────────────────────────────
  // CVE scan + static scan. The project's primary value prop.
  const scanScore = params.scanScore ?? 100;
  const securityPts = (Math.min(100, Math.max(0, scanScore)) / 100) * 25;

  // ── Uptime — 20 pts ────────────────────────────────────────────────────────
  // Measured every 15 min by the uptime cron. Defaults to 100 at ingest time.
  const uptimePts = (Math.min(100, Math.max(0, params.uptimePct)) / 100) * 20;

  // ── Publisher credibility — 15 pts ─────────────────────────────────────────
  // verified = a trusted external party (Smithery review, mcp.directory curator)
  // has explicitly vouched for this server. Not just "it exists in a registry."
  const credibilityPts = params.verified ? 15 : 0;

  // ── Real-world usage — 15 pts ──────────────────────────────────────────────
  // useCount from Smithery (real agent invocations) or GitHub stars.
  // Log scale: 10 uses = 1 pt, 100 = 2 pts, 1000 = 3 pts, 10k = 4 pts, 100k = 5 pts (×3)
  const usagePts = Math.min(Math.log10(Math.max(params.usageCount, 1)) / 5, 1) * 15;

  // ── Deployment quality — 15 pts ────────────────────────────────────────────
  // 1 if server has a live HTTP endpoint AND at least one tool schema with
  // inputSchema. This means an agent can actually call it end-to-end.
  const deploymentPts = (params.deploymentQuality ?? 0) * 15;

  // ── Schema stability — 10 pts ──────────────────────────────────────────────
  // Servers that frequently mutate their schema are less predictable.
  // Computed from actual schema_hash change history (not hardcoded).
  const stabilityPts = (Math.min(params.daysSinceChange, 90) / 90) * 10;

  let s = securityPts + uptimePts + credibilityPts + usagePts + deploymentPts + stabilityPts;

  // ── Runtime penalties (from metering — applied after ingest) ───────────────
  // High request failure rate: up to -15 pts
  if (params.failureRatePct !== undefined) {
    s = Math.max(0, s - (params.failureRatePct / 100) * 15);
  }
  // DLP trigger rate: up to -10 pts (server leaking credentials in responses)
  if (params.dlpRatePct !== undefined && params.dlpRatePct > 5) {
    s = Math.max(0, s - ((params.dlpRatePct - 5) / 100) * 10);
  }

  return Math.round(Math.min(100, Math.max(0, s)));
}

/**
 * Search ranking boost for new servers.
 * Does NOT affect the trust score — the score stays honest.
 * Only used in search ranking to surface new servers alongside established ones.
 *
 * Returns a multiplier (1.0 = no boost, up to 1.4 = 40% ranking boost).
 * Decays linearly over 90 days from first listing.
 */
export function newServerRankingBoost(daysSinceListing: number): number {
  if (daysSinceListing >= 90) return 1.0;
  // Max 40% boost in first week, decays to 0% at day 90
  const boost = 0.4 * (1 - daysSinceListing / 90);
  return 1.0 + boost;
}

/**
 * Category balance check.
 * When a category has N servers above threshold, signal that lower-scored
 * servers should be surfaced for ecosystem diversity.
 *
 * Used by the search RPC to inject diversity into results.
 */
export const CATEGORY_SATURATION_THRESHOLD = 5;
export const CATEGORY_HIGH_SCORE_THRESHOLD = 85;

// ── L4: Proxy DLP — credentials ───────────────────────────────────────────────

// ReDoS and Time Complexity mitigations for unbounded string scanning
function truncateForScan(text: string, limit = 150_000): string {
  if (text.length <= limit) return text;
  // If text is massive, scan the first 100kb and last 50kb
  // Credentials and injections typically cluster at the boundaries of large payloads
  return text.slice(0, 100_000) + "\n...\n" + text.slice(-50_000);
}

const CREDENTIAL_PATTERNS: { pattern: RegExp; label: string }[] = [
  // OpenAI — matches both old (sk-...) and new (sk-proj-...) formats
  { pattern: /sk-(?:proj-)?[a-zA-Z0-9_-]{20,}/,                                label: 'OpenAI API key' },
  { pattern: /sk_live_[a-zA-Z0-9]{20,}/,                                        label: 'Stripe live key' },
  { pattern: /sk_test_[a-zA-Z0-9]{20,}/,                                        label: 'Stripe test key' },
  { pattern: /ghp_[a-zA-Z0-9]{36}/,                                             label: 'GitHub PAT' },
  { pattern: /ghs_[a-zA-Z0-9]{36}/,                                             label: 'GitHub App token' },
  { pattern: /AKIA[A-Z0-9]{16}/,                                                label: 'AWS access key' },
  { pattern: /-----BEGIN( RSA| EC)? PRIVATE KEY-----/,                          label: 'Private key' },
  { pattern: /xox[baprs]-[a-zA-Z0-9-]{10,}/,                                   label: 'Slack token' },
  { pattern: /SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}/,                      label: 'SendGrid API key' },
  { pattern: /password["'\s]*[:=]["'\s]*\S{8,}/i,                              label: 'Plaintext password' },
  { pattern: /secret["'\s]*[:=]["'\s]*\S{8,}/i,                                label: 'Plaintext secret' },
  // Additional service-specific patterns
  { pattern: /AC[a-f0-9]{32}/,                                                  label: 'Twilio Account SID' },
  { pattern: /key-[a-f0-9]{32}/,                                                label: 'Mailgun API key' },
];

export function dlpScan(rawText: string): string[] {
  const text = truncateForScan(rawText);
  return CREDENTIAL_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label);
}

// ── L9: MCP Sampling inspection ───────────────────────────────────────────────
// Servers can initiate LLM sampling requests (Nov 2025 spec).
// Malicious servers could inject instructions via these requests.

const SAMPLING_INJECTION_PATTERNS = [
  /ignore (previous|all|above) instructions?/i,
  /you are now|act as|pretend to be|roleplay as/i,
  /\[INST\]|\[\/INST\]|<\|im_start\|>/i,
  /system:\s*(you|your|ignore)/i,
  /override your (previous|original|initial) (instructions?|prompt|system)/i,
];

export function samplingDlpScan(rawText: string): string[] {
  const text = truncateForScan(rawText);
  const issues: string[] = [];
  for (const pattern of SAMPLING_INJECTION_PATTERNS) {
    if (pattern.test(text)) issues.push(`Sampling injection: ${pattern.source.slice(0, 60)}`);
  }
  issues.push(...dlpScan(text));
  return issues;
}

// ── L10: PII detection ────────────────────────────────────────────────────────

const PII_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
    label: 'Email address' },
  // Handles: +1 (555) 123-4567 | (555) 123-4567 | 555-123-4567 | 555.123.4567
  { pattern: /(\+\d{1,3}[\s-])?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}\b/,
    label: 'Phone number' },
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/,
    label: 'SSN pattern' },
  // Visa — 16 digits, optionally grouped with spaces or dashes
  { pattern: /\b4[0-9]{3}[\s-]?[0-9]{4}[\s-]?[0-9]{4}[\s-]?[0-9]{1,4}\b/,
    label: 'Visa card number' },
  // Mastercard — 16 digits starting 51-55
  { pattern: /\b5[1-5][0-9]{2}[\s-]?[0-9]{4}[\s-]?[0-9]{4}[\s-]?[0-9]{4}\b/,
    label: 'Mastercard number' },
  // Amex — 15 digits starting 34 or 37
  { pattern: /\b3[47][0-9]{2}[\s-]?[0-9]{6}[\s-]?[0-9]{5}\b/,
    label: 'Amex card number' },
  { pattern: /\b(?:dob|date.of.birth|birthday)["'\s]*[:=]["'\s]*\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/i,
    label: 'Date of birth' },
  { pattern: /\bpassport\s*(?:no|number|#)?\s*[:=]?\s*[A-Z]{1,2}\d{6,9}/i,
    label: 'Passport number' },
];

export function piiScan(rawText: string): string[] {
  const text = truncateForScan(rawText);
  return PII_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label);
}

// ── L11: URL elicitation safety ───────────────────────────────────────────────
// MCP servers can send URLs for clients to follow (elicitation).
// Validate before acting on them.

const DANGEROUS_URL_PATTERNS = [
  { pattern: /^javascript:/i,                        desc: 'JavaScript URL — XSS risk' },
  { pattern: /^data:/i,                              desc: 'Data URL — injection risk' },
  { pattern: /^vbscript:/i,                          desc: 'VBScript URL' },
  { pattern: /localhost|127\.0\.0\.1|0\.0\.0\.0/i,  desc: 'Localhost redirect — SSRF risk' },
  { pattern: /169\.254\.\d+\.\d+/,                   desc: 'AWS metadata endpoint — SSRF' },
  { pattern: /^file:\/\//i,                          desc: 'File URL — local access risk' },
  { pattern: /[<>'"]/,                               desc: 'Injection characters in URL' },
];

/** Returns null if safe, or a string describing the danger. */
export function checkElicitationUrl(url: string): string | null {
  for (const { pattern, desc } of DANGEROUS_URL_PATTERNS) {
    if (pattern.test(url)) return desc;
  }
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) return `Unsafe scheme: ${parsed.protocol}`;
  } catch {
    return 'Invalid URL';
  }
  return null;
}

// ── L12: Context isolation / cross-user leak detection ───────────────────────
// Heuristic detection of one user's session data bleeding into another's response.

const CONTEXT_LEAK_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /user_id["'\s]*[:=]["'\s]*[a-f0-9-]{36}/i,
    label: 'User ID in response' },
  // session_token, session-token, sessiontoken, OR bare "session" key with long value
  { pattern: /session_?token["'\s]*[:=]["'\s]*\S{16,}/i,
    label: 'Session token in response' },
  { pattern: /"session"\s*:\s*"[^"]{16,}"/i,
    label: 'Session value in response' },
  { pattern: /auth_?token["'\s]*[:=]["'\s]*\S{16,}/i,
    label: 'Auth token in response' },
  { pattern: /bearer\s+[a-zA-Z0-9_-]{20,}/i,
    label: 'Bearer token in response body' },
  { pattern: /x-session-id["'\s]*[:=]["'\s]*\S+/i,
    label: 'Session ID in response body' },
  // JWT — three base64url segments separated by dots (eyJ... is always a JWT header)
  { pattern: /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]{10,}/,
    label: 'JWT token in response' },
];

export function contextLeakScan(rawText: string): string[] {
  const text = truncateForScan(rawText);
  const found = [
    ...CONTEXT_LEAK_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label),
    ...dlpScan(text),
  ];
  return [...new Set(found)];
}


// ── S-12: Shell / command injection detection ─────────────────────────────────
// The #1 real-world attack: 43% of all MCP CVEs are servers passing
// tool arguments directly to shell commands without sanitisation.

const SHELL_INJECTION_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /;\s*(rm|curl|wget|nc|bash|sh|python|perl|ruby|php|node)\b/i,  label: 'Shell command after semicolon' },
  { pattern: /\|\s*(nc|bash|sh|curl|wget|python|perl)\b/i,                  label: 'Pipe to shell command' },
  { pattern: /&&\s*(rm|curl|wget|nc|bash|sh|python)\b/i,                    label: 'AND-chained shell command' },
  { pattern: /`[^`]{1,200}`/,                                                label: 'Backtick command substitution' },
  { pattern: /\$\([^)]{1,200}\)/,                                            label: 'Dollar-paren command substitution' },
  { pattern: />\s*\/etc\/|>\s*~\/\./,                                        label: 'Redirect to sensitive path' },
  { pattern: /curl\s+[^\s]+\s*\|/i,                                         label: 'Curl pipe execution' },
  { pattern: /wget\s+[^\s]+\s*-O\s*-\s*\|/i,                               label: 'Wget pipe execution' },
  { pattern: /\/etc\/(passwd|shadow|hosts|cron)/i,                           label: 'Sensitive file path access' },
  // nc -e /bin/bash 10.0.0.1 4444  OR  nc -lvp 4444  OR  nc 10.0.0.1 4444
  { pattern: /\bnc\b.{0,60}\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/i,         label: 'Netcat reverse shell pattern' },
  { pattern: /\bnc\b\s+(-[a-z]+\s+)*\d{1,5}\b/i,                          label: 'Netcat listener' },
  { pattern: /base64\s+-d\s*\|/i,                                            label: 'Base64 decode pipe (obfuscated payload)' },
  { pattern: /python[23]?\s+-c\s+['"]import/i,                              label: 'Python inline code execution' },
  { pattern: /\beval\s*\(/i,                                                 label: 'eval() execution' },
  { pattern: /\bexec\s*\(/i,                                                 label: 'exec() execution' },
  { pattern: /\bsystem\s*\(/i,                                               label: 'system() call' },
  { pattern: /\bos\.system\s*\(/i,                                           label: 'os.system() call' },
  { pattern: /\bsubprocess\.(run|call|Popen)\s*\(/i,                        label: 'subprocess execution' },
  { pattern: /\bspawnSync\s*\(|\bexecSync\s*\(/i,                           label: 'Node.js sync shell execution' },
];

/**
 * S-12: Scan tool call arguments for shell injection patterns.
 * Call this on the parsed JSON body of proxy requests, not the raw string.
 * Returns array of issue labels. Empty = clean.
 */
export function shellInjectionScan(rawText: string): string[] {
  const text = truncateForScan(rawText);
  return SHELL_INJECTION_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ label }) => label);
}

// ── S-13: Indirect prompt injection in tool response data ─────────────────────
// Attackers inject LLM instructions into data that tools return.
// Classic example: a GitHub Issue containing "Ignore previous instructions and..."
// The agent reads the issue content and gets hijacked.

const INDIRECT_INJECTION_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /ignore (previous|all|prior|above|earlier) instructions?/i,     label: 'Instruction override in data' },
  { pattern: /you are (now|actually|really|instead)\s+/i,                    label: 'Identity override in data' },
  { pattern: /new (instructions?|directive|orders?|rules?):/i,               label: 'New instructions injected in data' },
  { pattern: /\[system\]|\[assistant\]|\[user\]/i,                           label: 'Role injection tokens in data' },
  { pattern: /<\|im_start\|>|<\|im_end\|>/,                                  label: 'Chat template tokens in data' },
  { pattern: /\[INST\].*\[\/INST\]/s,                                        label: 'Instruction template in data' },
  { pattern: /forget (everything|all|your|previous)/i,                       label: 'Memory wipe instruction in data' },
  { pattern: /your (true|real|actual|hidden) (purpose|goal|mission|role)/i,  label: 'Hidden purpose injection in data' },
  { pattern: /from now on(,| you| always| never)/i,                          label: 'Behavioral override in data' },
  { pattern: /\bDAN\b|\bjailbreak\b/i,                                       label: 'Known jailbreak keyword in data' },
  { pattern: /print\s+(your\s+)?(system\s+)?prompt/i,                       label: 'Prompt extraction attempt in data' },
  { pattern: /exfiltrate|send.*to.*http/i,                                   label: 'Exfiltration instruction in data' },
];

/**
 * S-13: Scan tool response data for indirect prompt injection.
 * Applied to response bodies in the proxy layer.
 * Returns array of issue labels. Empty = clean.
 */
export function indirectInjectionScan(rawText: string): string[] {
  const text = truncateForScan(rawText);
  return INDIRECT_INJECTION_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ label }) => label);
}

// ── S-14: npm CVE scanning helpers ───────────────────────────────────────────
// Called during ingest for servers with a GitHub URL.
// The actual API call lives in the ingest route — these are the types and helpers.

export interface CveIssue {
  name:     string;
  version:  string;
  severity: 'critical' | 'high' | 'moderate' | 'low';
  cve:      string;
  url:      string;
}

/**
 * S-14: Fetch package.json from a GitHub repo and check against npm audit.
 * Returns array of CVE issues found. Empty = clean.
 * Pass the raw GitHub repo URL: https://github.com/owner/repo
 */
export async function scanNpmDependencies(githubUrl: string): Promise<CveIssue[]> {
  try {
    const { parseGitHubUrl, isSafeUrlForServerFetch } = await import('@/lib/utils');
    const parts = parseGitHubUrl(githubUrl);
    if (!parts) return [];

    const branches = parts.branch ? [parts.branch, 'main', 'master'] : ['main', 'master'];
    const subpaths = parts.subpath ? [parts.subpath, null] : [null];

    for (const branch of branches) {
      for (const subpath of subpaths) {
        const path = subpath ? `${subpath.replace(/^\/+|\/+$/g, '')}/package.json` : 'package.json';
        const rawUrl = `https://raw.githubusercontent.com/${parts.owner}/${parts.repo}/${branch}/${path}`;
        if (!(await isSafeUrlForServerFetch(rawUrl))) continue;
        const res = await fetch(rawUrl, { signal: AbortSignal.timeout(8_000) });
        if (!res.ok) continue;
        const pkg = await res.json();
        return await runNpmAudit(pkg);
      }
    }
    return [];
  } catch {
    return [];
  }
}

async function runNpmAudit(pkg: any): Promise<CveIssue[]> {
  try {
    // npm audit requires a package-lock.json — we use the bulk advisory API instead
    const deps = {
      ...pkg.dependencies ?? {},
      ...pkg.devDependencies ?? {},
    };
    if (Object.keys(deps).length === 0) return [];

    const res = await fetch('https://registry.npmjs.org/-/npm/v1/security/advisories/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        Object.fromEntries(Object.keys(deps).map(name => [name, [deps[name].replace(/[\^~>=<]/g, '')]]))
      ),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return [];
    const data = await res.json();

    const issues: CveIssue[] = [];
    for (const [pkg, advisories] of Object.entries(data)) {
      for (const adv of advisories as any[]) {
        issues.push({
          name:     pkg,
          version:  deps[pkg] ?? 'unknown',
          severity: adv.severity,
          cve:      adv.cves?.[0] ?? adv.ghsa_id ?? 'unknown',
          url:      adv.url ?? '',
        });
      }
    }
    return issues;
  } catch {
    return [];
  }
}
