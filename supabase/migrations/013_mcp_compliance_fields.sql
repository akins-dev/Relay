-- Add missing columns for MCP protocol version and compliance tracking
ALTER TABLE servers ADD COLUMN IF NOT EXISTS protocol_version TEXT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS mcp_compliant BOOLEAN DEFAULT false;

-- Force the PostgREST API to refresh its schema cache immediately so the upsert logic doesn't fail
NOTIFY pgrst, 'reload schema';
