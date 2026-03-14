export interface ScanIssue {
  severity: 'critical' | 'high' | 'medium' | 'low';
  type: string;
  description: string;
  field?: string;
}

export interface ScanResult {
  passed: boolean;
  score: number;
  issues: ScanIssue[];
  details: string;
}

const INJECTION_PATTERNS = [
  { pattern: /ignore (previous|all|above) instructions?/i, severity: 'critical' as const, type: 'prompt_injection', desc: 'Instruction override attempt' },
  { pattern: /\[INST\]|\[\/INST\]|<\|im_start\|>/i, severity: 'critical' as const, type: 'prompt_injection', desc: 'LLM special tokens detected' },
  { pattern: /system prompt/i, severity: 'high' as const, type: 'prompt_injection', desc: 'System prompt reference' },
  { pattern: /disregard|override|bypass/i, severity: 'medium' as const, type: 'prompt_injection', desc: 'Override language detected' },
  { pattern: /bcc|blind carbon copy/i, severity: 'high' as const, type: 'exfiltration', desc: 'Email exfiltration pattern' },
  { pattern: /exfiltrat/i, severity: 'critical' as const, type: 'exfiltration', desc: 'Exfiltration keyword' },
  { pattern: /secretly|hidden instruction|covert/i, severity: 'high' as const, type: 'deception', desc: 'Deceptive language' },
  { pattern: /eval\s*\(|exec\s*\(/i, severity: 'critical' as const, type: 'code_injection', desc: 'Dynamic code execution' },
];

const ENDPOINT_PATTERNS = [
  { pattern: /localhost|127\.0\.0\.1|0\.0\.0\.0/i, severity: 'high' as const, type: 'local_endpoint', desc: 'Localhost endpoint not suitable for registry' },
  { pattern: /ngrok|localtunnel|serveo/i, severity: 'medium' as const, type: 'tunnel', desc: 'Tunnel service — instability risk' },
  { pattern: /^http:\/\//i, severity: 'medium' as const, type: 'insecure', desc: 'Non-HTTPS endpoint' },
];

export function scanServer(data: {
  name: string;
  description: string;
  long_description?: string;
  endpoint: string;
  tools: string[];
  tags: string[];
}): ScanResult {
  const issues: ScanIssue[] = [];
  const text = [data.description, data.long_description || ''].join(' ');

  for (const { pattern, severity, type, desc } of INJECTION_PATTERNS) {
    if (pattern.test(text)) issues.push({ severity, type, description: desc, field: 'description' });
  }
  for (const tool of data.tools) {
    for (const { pattern, severity, type, desc } of INJECTION_PATTERNS) {
      if (pattern.test(tool)) issues.push({ severity, type, description: `${desc} in tool: ${tool}`, field: 'tools' });
    }
  }
  for (const { pattern, severity, type, desc } of ENDPOINT_PATTERNS) {
    if (pattern.test(data.endpoint)) issues.push({ severity, type, description: desc, field: 'endpoint' });
  }
  if (!/^[a-z0-9-]+$/.test(data.name)) issues.push({ severity: 'medium', type: 'naming', description: 'Name must be lowercase alphanumeric + hyphens', field: 'name' });
  if (data.tools.length === 0) issues.push({ severity: 'high', type: 'no_tools', description: 'Server exposes no tools' });
  if (data.tools.length > 100) issues.push({ severity: 'medium', type: 'too_many_tools', description: 'Unusually high tool count' });

  const deduction = issues.filter(i => i.severity === 'critical').length * 40
    + issues.filter(i => i.severity === 'high').length * 20
    + issues.filter(i => i.severity === 'medium').length * 10
    + issues.filter(i => i.severity === 'low').length * 5;

  const score = Math.max(0, 100 - deduction);
  const passed = !issues.some(i => i.severity === 'critical' || i.severity === 'high');

  return {
    passed, score, issues,
    details: passed
      ? `Scan passed. Score: ${score}/100.`
      : `Scan failed. Score: ${score}/100. ${issues.filter(i => i.severity === 'critical').length} critical issues.`,
  };
}

export function computeTrustScore(params: {
  verified: number; scanScore: number; uptimePct: number;
  stars: number; daysSinceChange: number;
}): number {
  let s = 0;
  s += params.verified ? 25 : 0;
  s += (params.scanScore / 100) * 30;
  s += (params.uptimePct / 100) * 20;
  s += (Math.min(params.daysSinceChange, 90) / 90) * 15;
  s += Math.min(Math.log10(Math.max(params.stars, 1)) / 4, 1) * 10;
  return Math.round(s);
}

export function dlpScan(text: string): string[] {
  const issues: string[] = [];
  if (/sk-[a-zA-Z0-9]{20,}/.test(text)) issues.push('Possible OpenAI key');
  if (/ghp_[a-zA-Z0-9]{36}/.test(text)) issues.push('Possible GitHub PAT');
  if (/AKIA[A-Z0-9]{16}/.test(text)) issues.push('Possible AWS key');
  if (/-----BEGIN.*PRIVATE KEY-----/.test(text)) issues.push('Private key material');
  if (/password["'\s]*[:=]["'\s]*\S{8,}/i.test(text)) issues.push('Possible password');
  return issues;
}
