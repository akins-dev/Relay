// ─────────────────────────────────────────────────────────────────────────────
// openMCP — Security Layers
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

export interface ScanIssue {
  severity: 'critical' | 'high' | 'medium' | 'low';
  type: string;
  description: string;
  field?: string;
}

export interface ScanResult {
  passed:  boolean;
  score:   number;
  issues:  ScanIssue[];
  details: string;
}

// ── L1: Publish-time patterns ─────────────────────────────────────────────────

const INJECTION_PATTERNS = [
  { pattern: /ignore (previous|all|above) instructions?/i,  severity: 'critical' as const, type: 'prompt_injection',   desc: 'Instruction override attempt' },
  { pattern: /\[INST\]|\[\/INST\]|<\|im_start\|>/i,        severity: 'critical' as const, type: 'prompt_injection',   desc: 'LLM special tokens detected' },
  { pattern: /system\s+prompt/i,                            severity: 'high'     as const, type: 'prompt_injection',   desc: 'System prompt reference' },
  { pattern: /disregard|override|bypass/i,                  severity: 'medium'   as const, type: 'prompt_injection',   desc: 'Override language detected' },
  { pattern: /\bbcc\b|blind carbon copy/i,                  severity: 'high'     as const, type: 'exfiltration',       desc: 'Email BCC exfiltration pattern' },
  { pattern: /exfiltrat/i,                                   severity: 'critical' as const, type: 'exfiltration',       desc: 'Exfiltration keyword' },
  { pattern: /secretly|hidden instruction|covert/i,          severity: 'high'     as const, type: 'deception',          desc: 'Deceptive language' },
  { pattern: /eval\s*\(|exec\s*\(/i,                        severity: 'critical' as const, type: 'code_injection',     desc: 'Dynamic code execution' },
  { pattern: /\$\{.*?\}|\{\{.*?\}\}/,                       severity: 'medium'   as const, type: 'template_injection', desc: 'Template injection pattern' },
];

const ENDPOINT_PATTERNS = [
  { pattern: /localhost|127\.0\.0\.1|0\.0\.0\.0/i, severity: 'high'   as const, type: 'local_endpoint', desc: 'Localhost endpoint — not public' },
  { pattern: /ngrok|localtunnel|serveo/i,           severity: 'medium' as const, type: 'tunnel',         desc: 'Tunnel service — unstable' },
  { pattern: /^http:\/\//i,                         severity: 'medium' as const, type: 'insecure',       desc: 'Non-HTTPS endpoint' },
];

const SUSPICIOUS_TOOL_NAMES = [
  { pattern: /^(password|passwd|secret|token|api.?key)$/i, severity: 'high'   as const, desc: 'Tool name implies raw credential handling' },
  { pattern: /drop_all|delete_all|truncate_all/i,          severity: 'medium' as const, desc: 'Potentially destructive tool name' },
];

export function scanServer(data: {
  name:              string;
  description:       string;
  long_description?: string;
  endpoint:          string;
  tools:             string[];
  tags:              string[];
}): ScanResult {
  const issues: ScanIssue[] = [];
  const text = [data.description, data.long_description ?? ''].join(' ');

  for (const { pattern, severity, type, desc } of INJECTION_PATTERNS) {
    if (pattern.test(text)) issues.push({ severity, type, description: desc, field: 'description' });
  }
  for (const tool of data.tools) {
    for (const { pattern, severity, type, desc } of INJECTION_PATTERNS) {
      if (pattern.test(tool)) issues.push({ severity, type, description: `${desc} in tool: ${tool}`, field: 'tools' });
    }
    for (const { pattern, severity, desc } of SUSPICIOUS_TOOL_NAMES) {
      if (pattern.test(tool)) issues.push({ severity, type: 'suspicious_tool', description: `${desc}: "${tool}"`, field: 'tools' });
    }
  }
  for (const { pattern, severity, type, desc } of ENDPOINT_PATTERNS) {
    if (pattern.test(data.endpoint)) issues.push({ severity, type, description: desc, field: 'endpoint' });
  }

  if (!/^[a-z0-9-]+$/.test(data.name)) issues.push({ severity: 'medium', type: 'naming',        description: 'Name must be lowercase letters, numbers, hyphens only' });
  if (data.tools.length === 0)          issues.push({ severity: 'high',   type: 'no_tools',      description: 'Server exposes no tools' });
  if (data.tools.length > 100)          issues.push({ severity: 'medium', type: 'too_many_tools', description: 'Over 100 tools — context bloat risk' });
  if (data.tags.length === 0)           issues.push({ severity: 'low',    type: 'no_tags',        description: 'No tags — will rank lower in search' });

  const deduction =
    issues.filter(i => i.severity === 'critical').length * 40 +
    issues.filter(i => i.severity === 'high').length     * 20 +
    issues.filter(i => i.severity === 'medium').length   * 10 +
    issues.filter(i => i.severity === 'low').length      * 5;

  const score  = Math.max(0, 100 - deduction);
  const passed = !issues.some(i => i.severity === 'critical' || i.severity === 'high');

  return {
    passed, score, issues,
    details: passed
      ? `Scan passed. Score: ${score}/100.`
      : `Scan failed. Score: ${score}/100. ${issues.filter(i => i.severity === 'critical').length} critical, ${issues.filter(i => i.severity === 'high').length} high severity issues.`,
  };
}

// ── L5: Trust score ───────────────────────────────────────────────────────────

export function computeTrustScore(params: {
  verified:        number;
  scanScore:       number;
  uptimePct:       number;
  stars:           number;
  daysSinceChange: number;
}): number {
  let s = 0;
  s += params.verified ? 25 : 0;
  s += (params.scanScore  / 100) * 30;
  s += (params.uptimePct  / 100) * 20;
  s += (Math.min(params.daysSinceChange, 90) / 90) * 15;
  s += Math.min(Math.log10(Math.max(params.stars, 1)) / 4, 1) * 10;
  return Math.round(s);
}

// ── L4: Proxy DLP — credentials ───────────────────────────────────────────────

const CREDENTIAL_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /sk-[a-zA-Z0-9]{20,}/,                                        label: 'OpenAI API key' },
  { pattern: /sk_live_[a-zA-Z0-9]{20,}/,                                   label: 'Stripe live key' },
  { pattern: /sk_test_[a-zA-Z0-9]{20,}/,                                   label: 'Stripe test key' },
  { pattern: /ghp_[a-zA-Z0-9]{36}/,                                        label: 'GitHub PAT' },
  { pattern: /ghs_[a-zA-Z0-9]{36}/,                                        label: 'GitHub App token' },
  { pattern: /AKIA[A-Z0-9]{16}/,                                           label: 'AWS access key' },
  { pattern: /-----BEGIN( RSA| EC)? PRIVATE KEY-----/,                      label: 'Private key' },
  { pattern: /xox[baprs]-[a-zA-Z0-9-]{10,}/,                              label: 'Slack token' },
  { pattern: /SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}/,                label: 'SendGrid API key' },
  { pattern: /password["'\s]*[:=]["'\s]*\S{8,}/i,                         label: 'Plaintext password' },
  { pattern: /secret["'\s]*[:=]["'\s]*\S{8,}/i,                           label: 'Plaintext secret' },
];

export function dlpScan(text: string): string[] {
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

export function samplingDlpScan(text: string): string[] {
  const issues: string[] = [];
  for (const pattern of SAMPLING_INJECTION_PATTERNS) {
    if (pattern.test(text)) issues.push(`Sampling injection: ${pattern.source.slice(0, 60)}`);
  }
  issues.push(...dlpScan(text));
  return issues;
}

// ── L10: PII detection ────────────────────────────────────────────────────────

const PII_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,           label: 'Email address' },
  { pattern: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,                                   label: 'Phone number' },
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/,                                            label: 'SSN pattern' },
  { pattern: /\b4[0-9]{12}(?:[0-9]{3})?\b/,                                      label: 'Visa card number' },
  { pattern: /\b5[1-5][0-9]{14}\b/,                                               label: 'Mastercard number' },
  { pattern: /\b3[47][0-9]{13}\b/,                                                label: 'Amex card number' },
  { pattern: /\b(?:dob|date.of.birth|birthday)["'\s]*[:=]["'\s]*\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/i, label: 'Date of birth' },
  { pattern: /\bpassport\s*(?:no|number|#)?\s*[:=]?\s*[A-Z]{1,2}\d{6,9}/i,     label: 'Passport number' },
];

export function piiScan(text: string): string[] {
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
  { pattern: /user_id["'\s]*[:=]["'\s]*[a-f0-9-]{36}/i,    label: 'User ID in response' },
  { pattern: /session_?token["'\s]*[:=]["'\s]*\S{16,}/i,    label: 'Session token in response' },
  { pattern: /auth_?token["'\s]*[:=]["'\s]*\S{16,}/i,       label: 'Auth token in response' },
  { pattern: /bearer\s+[a-zA-Z0-9_-]{20,}/i,                label: 'Bearer token in response body' },
  { pattern: /x-session-id["'\s]*[:=]["'\s]*\S+/i,          label: 'Session ID in response body' },
];

export function contextLeakScan(text: string): string[] {
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
  { pattern: /nc\s+(-[a-z]+\s+)*\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/i,    label: 'Netcat reverse shell pattern' },
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
export function shellInjectionScan(text: string): string[] {
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
export function indirectInjectionScan(text: string): string[] {
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
    // Convert github.com URL to raw content URL
    const match = githubUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) return [];
    const [, owner, repo] = match;
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/package.json`;

    const res = await fetch(rawUrl, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) {
      // Try master branch
      const res2 = await fetch(rawUrl.replace('/main/', '/master/'), { signal: AbortSignal.timeout(8_000) });
      if (!res2.ok) return [];
      const pkg = await res2.json();
      return await runNpmAudit(pkg);
    }
    const pkg = await res.json();
    return await runNpmAudit(pkg);
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
