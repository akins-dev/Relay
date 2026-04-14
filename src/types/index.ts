export type { Profile, Server, ApiKey, ScanResult, AuditEntry } from './supabase';

export interface GlobalStats {
  total_servers:      number;
  active_servers:     number;
  pending_servers?:   number;   // pending_review count
  discovered_servers?: number;  // active + pending_review (total meaningful)
  invokable_servers?: number;   // active + non-stdio (proxy-callable)
  local_servers?:     number;   // stdio-only
  verified_servers:   number;
  total_calls:        number;
  calls_today:        number;
  avg_trust_score:    number;
}

export interface ScanIssue {
  severity: 'critical' | 'high' | 'medium' | 'low';
  type: string; description: string; field?: string;
}
