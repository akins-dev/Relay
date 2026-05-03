-- Migration: 029_ingest_v2_fields
-- Adds fields required by IngestServer v2 schema.
-- Covers: icon_url, env_var_schema, package_info, resources, prompts,
--         mcp_directory_id, mcp_directory_id index, version nullable.

-- ── servers table additions ───────────────────────────────────────────────────

-- Grade D: server logo URL (sources: Official icons[], Smithery iconUrl, mcp.directory avatarUrl)
ALTER TABLE servers ADD COLUMN IF NOT EXISTS icon_url TEXT;

-- Grade A: environment variable requirements for invoke
-- EnvVarSpec[]: [{ name, description, isRequired, isSecret, format, defaultValue }]
-- Sources: Official packages[].environmentVariables[], Smithery configSchema, Glama envVarsJsonSchema
ALTER TABLE servers ADD COLUMN IF NOT EXISTS env_var_schema JSONB;

-- Grade A (stdio only): package install specs from Official registry packages[]
-- PackageInfo[]: [{ registryType, identifier, version, runtimeHint, transport }]
ALTER TABLE servers ADD COLUMN IF NOT EXISTS package_info JSONB;

-- Grade C: MCP Resources from Smithery detail or live probe
-- McpResource[]: [{ uri, name, description, mimeType }]
ALTER TABLE servers ADD COLUMN IF NOT EXISTS resources JSONB DEFAULT '[]'::jsonb;

-- Grade C: MCP Prompts from Smithery detail or live probe
-- McpPrompt[]: [{ name, description, arguments[] }]
ALTER TABLE servers ADD COLUMN IF NOT EXISTS prompts JSONB DEFAULT '[]'::jsonb;

-- Cross-reference ID for mcp.directory (used by enrichment pass)
ALTER TABLE servers ADD COLUMN IF NOT EXISTS mcp_directory_id TEXT;

-- version is nullable — Smithery, Glama, mcp.directory do not version their listings
-- Only Official registry provides real semver versions
ALTER TABLE servers ALTER COLUMN version DROP NOT NULL;
ALTER TABLE servers ALTER COLUMN version DROP DEFAULT;

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_servers_mcp_directory_id
  ON servers (mcp_directory_id)
  WHERE mcp_directory_id IS NOT NULL;

-- Partial index for servers with tools (search performance)
CREATE INDEX IF NOT EXISTS idx_servers_has_tools
  ON servers USING GIN (tools)
  WHERE array_length(tools, 1) > 0;

-- Partial index for env_var_schema (invoke readiness queries)
CREATE INDEX IF NOT EXISTS idx_servers_has_env_schema
  ON servers (id)
  WHERE env_var_schema IS NOT NULL;

-- ── server_connection_profiles additions ──────────────────────────────────────

-- Store the Glama page URL separately from homepage_url (never confuse them)
ALTER TABLE server_connection_profiles
  ADD COLUMN IF NOT EXISTS glama_page_url TEXT;

-- Store the env_var_schema from this specific connection profile's source
ALTER TABLE server_connection_profiles
  ADD COLUMN IF NOT EXISTS env_var_schema JSONB;

-- Store toolCount from mcp.directory (Grade F — analytics only)
ALTER TABLE server_connection_profiles
  ADD COLUMN IF NOT EXISTS tool_count_upstream INTEGER;

-- ── Analytics signals (Grade F fields — never on IngestServer) ───────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'server_analytics'
  ) THEN
    ALTER TABLE server_analytics
      ADD COLUMN IF NOT EXISTS github_stars INTEGER,
      ADD COLUMN IF NOT EXISTS npm_weekly_downloads INTEGER,
      ADD COLUMN IF NOT EXISTS mcp_directory_tool_count INTEGER,
      ADD COLUMN IF NOT EXISTS mcp_directory_stars INTEGER;
  END IF;
END $$;

-- ── Comments (documentation in DB) ───────────────────────────────────────────

COMMENT ON COLUMN servers.icon_url IS
  'Server logo URL. Grade D (UI only). Sources: Official icons[0].src, Smithery iconUrl, mcp.directory publisher.avatarUrl.';

COMMENT ON COLUMN servers.env_var_schema IS
  'Environment variable requirements. Grade A for invoke. EnvVarSpec[] JSON array. Sources: Official packages[].environmentVariables[], Smithery connections[].configSchema, Glama environmentVariablesJsonSchema.';

COMMENT ON COLUMN servers.package_info IS
  'Package install specs for stdio servers. Grade A for stdio invoke. PackageInfo[] JSON array. Source: Official registry only.';

COMMENT ON COLUMN servers.resources IS
  'MCP Resource descriptors. Grade C. McpResource[] JSON array. Sources: Smithery detail, live mcp_probe.';

COMMENT ON COLUMN servers.prompts IS
  'MCP Prompt descriptors. Grade C. McpPrompt[] JSON array. Sources: Smithery detail, live mcp_probe.';

COMMENT ON COLUMN servers.mcp_directory_id IS
  'Cross-reference ID from mcp.directory (numeric string). Used by enrichment pass to link publisher.verified and icon_url.';
