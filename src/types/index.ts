export interface Server {
  id: string;
  name: string;
  display_name: string;
  description: string;
  long_description?: string;
  author_id: string;
  author_name?: string;
  author_avatar?: string;
  version: string;
  endpoint: string;
  homepage_url?: string;
  github_url?: string;
  license: string;
  tags: string[];
  tools: string[];
  status: 'active' | 'pending' | 'rejected' | 'suspended';
  verified: boolean;
  stars: number;
  total_calls: number;
  calls_today: number;
  latency_ms?: number;
  uptime_pct: number;
  trust_score: number;
  scan_status: 'passed' | 'failed' | 'pending';
  scan_issues: ScanIssue[];
  schema_hash?: string;
  last_scanned_at?: number;
  created_at: number;
  updated_at: number;
  starred?: boolean;
}

export interface ScanIssue {
  severity: 'critical' | 'high' | 'medium' | 'low';
  type: string;
  description: string;
  field?: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  avatar_url?: string;
  bio?: string;
  github_username?: string;
  created_at: number;
}

export interface ApiKey {
  id: string;
  key_prefix: string;
  name: string;
  last_used_at?: number;
  created_at: number;
}

export interface GlobalStats {
  total_servers: number;
  active_servers: number;
  verified_servers: number;
  total_calls: number;
  calls_today: number;
  avg_trust_score: number;
  tags: { tag: string; count: number }[];
}
