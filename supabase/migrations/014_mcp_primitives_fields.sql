-- Migration 014: Add complete MCP primitives, proxy config, and missing source

-- 1. Complete the primitive triad (tools exist, adding resources and prompts)
ALTER TABLE public.servers ADD COLUMN IF NOT EXISTS resources JSONB NOT NULL DEFAULT '[]';
ALTER TABLE public.servers ADD COLUMN IF NOT EXISTS prompts JSONB NOT NULL DEFAULT '[]';

-- 2. Proxy invocability flag (separate from transport)
ALTER TABLE public.servers ADD COLUMN IF NOT EXISTS proxy_available BOOLEAN NOT NULL DEFAULT false;

-- 3. Allow 'pulsemcp' as a valid source
ALTER TABLE public.servers DROP CONSTRAINT IF EXISTS servers_source_check;
ALTER TABLE public.servers ADD CONSTRAINT servers_source_check
  CHECK (source IN ('official', 'smithery', 'github', 'glama', 'pulsemcp', 'direct'));

-- Force PostgREST reload immediately
NOTIFY pgrst, 'reload schema';
