# Relay Rate Limits

Last updated: 2026-04-25
Status: Canonical rate-limit reference

This file documents the exact default limits currently enforced by the codebase, how they are keyed, and where configuration is live versus hardcoded.

## How The Limiter Works

- Production uses Upstash Redis sliding-window rate limiting.
- Local development falls back to an in-memory limiter.
- Most current windows are `60_000 ms` or 60 seconds.
- Anonymous traffic is keyed by IP.
- Authenticated traffic is keyed by user ID or API-key owner.
- MCP requests fall back to a header fingerprint when no usable IP is present, so unknown clients do not all share one global bucket.

## Configuration Model

Relay currently has two classes of limits.

### 1. DB-configurable contexts

These contexts exist in `public.rate_limit_config`, are seeded by migration `023_security_hardening.sql`, and can override code defaults. The app caches DB values for 5 minutes.

| Context | Default | Keyed by | Used by |
|---|---:|---|---|
| `search` | 60/min | IP | anonymous `GET /api/servers/search`, anonymous MCP `search_tools` |
| `browse` | 120/min | IP | `GET /api/servers` |
| `proxy` | 30/min | IP | legacy hosted proxy context; not on the prototype invocation path |
| `proxyAuth` | 200/min | user | authenticated high-limit context currently reused by MCP `search_tools`, manifest lookup, and REST search with API key |
| `auth` | 10/min | IP | `POST /api/auth/login`, `POST /api/auth/register` |
| `publish` | 10/min | user | `POST /api/servers` |

### 2. Route-specific hardcoded limits

These are enforced today, but they do not yet have a row in `rate_limit_config`.

| Route | Default | Keyed by |
|---|---:|---|
| `POST /api/secrets` | 20/min | user |
| `GET /api/oauth/start` | 10/min | IP |
| `GET /api/oauth/callback` | 20/min | IP |
| `GET /api/oauth/connections` | 30/min | user |
| `POST /api/policies` | 30/min | user |

## Reserved Or Legacy Contexts

The following contexts are seeded in `rate_limit_config`, but are not currently the primary enforcement path in the application runtime:

| Context | Default | Current note |
|---|---:|---|
| `ingest` | 5/min | reserved for ingest-trigger protection; not the main enforced path today |
| `mcpServer` | 60/min | seeded, but MCP method calls currently use `search`, `proxy`, and `proxyAuth` buckets instead |

## Identity Model

### Anonymous callers

- Search and browse use IP-based buckets.
- Hosted REST proxy invocation is retired from the prototype path.
- MCP falls back to a fingerprint bucket when IP is unavailable.

### Authenticated callers

- Session-authenticated users and API-key users are rate-limited by user ID for core action paths.
- This gives higher limits to authenticated usage without sharing a bucket with other callers on the same NAT or gateway IP.

## Important Caveats

- DB-configured contexts are not universal yet. Some account-management routes still use hardcoded limits in their handlers.
- Redis and in-memory fallback are behaviorally close, but not identical. Production uses a true sliding window; local fallback is simpler.
- A route having a configured context in the DB does not guarantee it was wired in historically. This file tracks the current enforced state, not just configured intent.

## Source Of Truth In Code

- limiter implementation: `src/lib/ratelimit.ts`
- seeded config: `supabase/migrations/023_security_hardening.sql`
- core search route: `src/app/api/servers/search/route.ts`
- browse and publish routes: `src/app/api/servers/route.ts`
- native MCP server: `src/app/api/mcp-server/route.ts`
- Relay Local invocation will need its own local/runtime rate and policy model when implemented.

If limits change, update both the code and this file in the same workstream.
