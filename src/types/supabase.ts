export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string; username: string; github_username: string | null;
          avatar_url: string | null; bio: string | null; website: string | null;
          created_at: string; updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['profiles']['Row'], 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
      };
      servers: {
        Row: {
          id: string; name: string; display_name: string; description: string;
          long_description: string | null; author_id: string; version: string;
          endpoint: string | null; homepage_url: string | null; github_url: string | null;
          license: string; tags: string[]; tools: string[];
          tool_schemas?: Json; resources?: Json; prompts?: Json;
          status: 'pending' | 'active' | 'pending_review' | 'rejected' | 'suspended';
          verified: boolean; stars: number; total_calls: number; calls_today: number;
          latency_ms: number | null; uptime_pct: number; trust_score: number;
          schema_hash: string | null; last_scanned_at: string | null;
          scan_status: 'pending' | 'passed' | 'failed'; scan_issues: Json;
          source?: string; smithery_id?: string | null; official_id?: string | null; glama_id?: string | null;
          cve_issues?: Json; cve_scan_at?: string | null; shell_issues?: Json;
          transport?: string; proxy_available?: boolean;
          protocol_version?: string | null; mcp_compliant?: boolean | null;
          auth_type?: string; auth_setup_url?: string | null;
          oauth_authorization_url?: string | null;
          upstream_updated_at?: string | null;
          description_quality?: string | null; readme_url?: string | null;
          name_normalized: string; search_vector: unknown;
          created_at: string; updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['servers']['Row'],
          'id' | 'stars' | 'total_calls' | 'calls_today' | 'name_normalized' | 'search_vector' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['servers']['Insert']>;
      };
      server_stars: {
        Row: { user_id: string; server_id: string; created_at: string };
        Insert: Omit<Database['public']['Tables']['server_stars']['Row'], 'created_at'>;
        Update: never;
      };
      api_keys: {
        Row: {
          id: string; user_id: string; key_hash: string; key_prefix: string;
          name: string; last_used_at: string | null; created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['api_keys']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['api_keys']['Insert']>;
      };
      scan_results: {
        Row: {
          id: string; server_id: string; scan_type: string; passed: boolean;
          score: number; issues: Json; details: string | null; created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['scan_results']['Row'], 'id' | 'created_at'>;
        Update: never;
      };
      schema_snapshots: {
        Row: {
          id: string; server_id: string; schema_hash: string;
          tools: string[]; version: string; captured_at: string;
        };
        Insert: Omit<Database['public']['Tables']['schema_snapshots']['Row'], 'id' | 'captured_at'>;
        Update: never;
      };
      audit_log: {
        Row: {
          id: string; server_id: string | null; user_id: string | null;
          action: string; tool_name: string | null;
          request_size: number | null; response_size: number | null;
          latency_ms: number | null; status_code: number | null;
          dlp_triggered: boolean; dlp_issues: string[] | null;
          ip: string | null; user_agent: string | null; created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['audit_log']['Row'], 'id' | 'created_at'>;
        Update: never;
      };
    };
    Functions: {
      global_stats:      { Args: Record<never, never>; Returns: Json };
      search_servers:    { Args: { query_text: string; result_limit?: number; include_stdio?: boolean }; Returns: Json[] };
      find_similar_names:{ Args: { candidate: string }; Returns: { name: string; similarity: number }[] };
      increment_stars:   { Args: { server_id: string }; Returns: void };
      decrement_stars:   { Args: { server_id: string }; Returns: void };
      increment_calls:   { Args: { server_id: string }; Returns: void };
    };
  };
};

export type Profile        = Database['public']['Tables']['profiles']['Row'];
export type Server         = Database['public']['Tables']['servers']['Row'];
export type ApiKey         = Database['public']['Tables']['api_keys']['Row'];
export type ScanResult     = Database['public']['Tables']['scan_results']['Row'];
export type AuditEntry     = Database['public']['Tables']['audit_log']['Row'];
export type SchemaSnapshot = Database['public']['Tables']['schema_snapshots']['Row'];
