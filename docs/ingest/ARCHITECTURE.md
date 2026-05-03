# Ingest Pipeline — Architecture Diagram

> Last updated: May 2026 — reflects all v2 hardening + deep integration audit fixes.

## Full Flow (Mermaid)

```mermaid
flowchart TD
    subgraph TRIGGER["Trigger Layer"]
        CRON["Vercel Cron\n(scheduled)"]
        API["POST /api/ingest\n?source=all|official|smithery|\nglama|mcp_directory|partner"]
        CRON --> ORCH
        API --> ORCH
    end

    subgraph ORCH["Orchestrator — cron/ingest.ts"]
        ORCH["runIngest(source)\n• resolves source list\n• sequential per-source\n• writes ingest_runs row"]
    end

    subgraph SOURCES["Source Fetchers"]
        direction TB
        P["partner.ts  [PARTNER]\ngithub.com/mcp org\nGitHub API paginated\n→ github_url, license, stars\n→ transport: unknown (probed later)"]
        O["official.ts  [PRIMARY]\nregistry.modelcontextprotocol.io\n→ endpoint, env_var_schema\n→ package_info, icon_url, title\nFilter isLatest: true client-side"]
        S["smithery.ts  [PRIMARY]\napi.smithery.ai\nPhase 1: listing sweep isDeployed:true\nPhase 2: detail fetch concurrency=5\n→ endpoint, tool_schemas (inputSchema)\n→ resources, prompts, configSchema"]
        G["glama.ts  [ENRICHMENT]\nglama.ai/api/mcp/v1\n→ env_var_schema (JSON Schema)\n→ SPDX license, attributes[] tags\n→ repository.url (dedup key)\n⚠ Never provides endpoint or tools"]
        D["mcp_directory.ts  [ENRICHMENT]\nmcp.directory/api/v1\n→ verified, icon_url\n→ heuristic github_url\n  (publisher.name/slug)\n→ classification tags\n⚠ Never provides endpoint or tools"]
    end

    ORCH --> P & O & S & G & D

    subgraph PIPELINE["upsertServers() — pipeline.ts"]
        direction TB
        PRE["1. Batch pre-fetch all existing rows\n   Build 6 lookup Maps:\n   smithery_id / official_id / glama_id\n   github_url / endpoint / name"]
        LOOP["2. Per-server loop"]
        GUARD["3. Guards\n   • name regex [a-z0-9-]+\n   • isSafeUrl (SSRF)\n   • SSRF on endpoint"]
        LOOKUP["4. Dedup lookup (priority)\n   smithery_id → official_id\n   → glama_id → github_url\n   → endpoint → name"]
        SKIP1["5a. Timestamp skip\n   upstream_updated_at ≤ last_scanned_at"]
        SKIP2["5b. Hash skip\n   sha256(tools+version+endpoint+github_url)\n   unchanged + scanned within 24h"]
        ENRICH["6. Enrichment-only path\n   (glama / mcp_directory)\n   Selective patch:\n   • glama → license, env_var_schema,\n     tags, glama_id\n     + auth_type: api_key if env added\n   • mcp_directory → verified,\n     icon_url, tags, mcp_directory_id"]

        PROBE["7a. HTTP Probe (proxy-available servers)\n    mcp-probe.ts\n    initialize → initialized\n    tools/list (paginated, cursor)\n    resources/list (paginated)\n    prompts/list (paginated)\n    → toolSchemas, resources, prompts\n    → real transport, protocol_version"]
        SANDBOX["7b. Sandbox (stdio servers)\n    POST SANDBOX_URL/extract\n    timeout: 60s (cold-start safe)\n    buildSandboxCommand():\n      npm pkg: npx -y {identifier}\n      github: git clone → npx\n    → toolSchemas, resources, prompts"]
        README["7c. README fallback\n    parseReadmeSchemas(github_url)\n    tool_extraction_source: readme_parsed"]

        SYNC["8. Sync tools[] from toolSchemas\n   Always (not just when empty)\n   Recompute schema_hash after sync\n   → matches drift cron inputs exactly"]

        CVE["9. CVE scan\n    scanNpmDependencies(github_url)\n    deduplicated by repo\n    critical → reject\n    high → pending_review"]

        AUTH["10. deriveAuthType()\n    env_var_schema present → api_key\n    official + public → none\n    smithery default → managed"]

        TRUST["11. Trust score\n    computeTrustScore(\n      verified, scanScore,\n      uptimePct, stars,\n      daysSinceChange)"]

        DB["12. DB write\n    INSERT or UPDATE servers\n    • new: author_id = system profile\n    • existing primary: full update\n    • existing enrichment-only: selective patch\n    • partner/official protected from\n      lower-tier source overwrites"]

        SIDE["13. Side-table writes\n    server_connection_profiles\n      (raw_upstream_json, remotes,\n       packages, icons, official_meta)\n    scan_results (CVE audit trail)"]

        HASHFINAL["14. Final schema_hash stored\n    Used by schema-drift cron\n    as rug-pull detection baseline"]
    end

    P & O & S & G & D --> PRE
    PRE --> LOOP --> GUARD --> LOOKUP
    LOOKUP --> SKIP1 & SKIP2 & ENRICH
    LOOKUP --> PROBE & SANDBOX & README
    PROBE & SANDBOX & README --> SYNC
    SYNC --> CVE --> AUTH --> TRUST --> DB --> SIDE --> HASHFINAL

    subgraph CRONS["Maintenance Crons"]
        UPTIME["uptime.ts (every 15min)\n• skip auth_type=api_key/oauth\n• probeUptime(endpoint)\n• EWMA uptime_pct α=0.01\n• EWMA latency α=0.1\n• recompute trust_score\n• write scan_results"]
        DRIFT["schema-drift.ts (daily)\n• probeMCPServer(endpoint)\n• hash(tools+version+endpoint+github_url)\n• match == stored → last_scanned_at\n• mismatch → run injection scan\n  → suspend + scan_results"]
    end

    DB --> UPTIME & DRIFT

    subgraph CONSUMERS["Downstream Consumers"]
        SEARCH["GET /api/servers/search\nsearch_servers() RPC\n+ secondary select:\n  tool_schemas, env_var_schema,\n  package_info, auth_type,\n  transport, proxy_available\n→ search_tools for agents"]
        INVOKE["executeProxyCall()\nReads: endpoint, tools,\n  auth_type, proxy_available,\n  transport, trust_score\n→ credential injection\n→ MCP handshake (SSE)\n→ upstream call + security scans"]
    end

    DB --> SEARCH & INVOKE
```

---

## Source → DB Field Coverage

| Field | partner | official | smithery | glama | mcp_directory | probe | sandbox |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `endpoint` | ❌ | ✅ remotes[] | ✅ deploymentUrl | ❌ | ❌ | — | — |
| `transport` | probed | ✅ | ✅ connections[] | inferred | ✅ transportType | ✅ | ✅ |
| `tool_schemas` | ❌ | ❌ | ✅ **only** | ❌ | ❌ | ✅ | ✅ |
| `env_var_schema` | ❌ | ✅ envVars[] | ✅ configSchema | ✅ **richest** | ❌ | ❌ | ❌ |
| `package_info` | ❌ | ✅ **only** | ❌ | ❌ | ❌ | ❌ | ❌ |
| `icon_url` | ❌ | ✅ icons[] | ✅ iconUrl | ❌ | ✅ avatarUrl | ❌ | ❌ |
| `github_url` | ✅ html_url | ✅ | ❌ | ✅ repo.url | heuristic | ❌ | ❌ |
| `license` | ✅ | ❌ | ❌ | ✅ SPDX | ❌ | ❌ | ❌ |
| `tags` | ❌ | ❌ | ❌ | ✅ attributes[] | ✅ classification | ❌ | ❌ |
| `verified` | ✅ always | ✅ | ✅ | ❌ | ✅ publisher | ❌ | ❌ |
| `auth_type` | derived | derived | derived | patch | ❌ | ❌ | ❌ |
| `resources[]` | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ paginated | ✅ |
| `prompts[]` | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ paginated | ✅ |

---

## auth_type Derivation Logic

```
deriveAuthType(source, transport, env_var_schema):
  env_var_schema present and non-empty  → 'api_key'
  source='official' and transport=HTTP  → 'none'   (public MCP registry)
  source='smithery'                     → 'managed' (Smithery-managed auth)
  default                               → 'managed'

Enrichment patch (Glama adds env_var_schema to existing record):
  → also writes auth_type = 'api_key'   ← FAULT-01 fix
```

---

## Naming Conventions

| Concept | DB `source` | File | Fetcher | API param |
|---|---|---|---|---|
| github.com/mcp org | `partner` | `partner.ts` | `fetchPartnerServers` | `partner` |
| Official MCP registry | `official` | `official.ts` | `fetchOfficialServers` | `official` |
| Smithery | `smithery` | `smithery.ts` | `fetchSmitheryServers` | `smithery` |
| Glama | `glama` | `glama.ts` | `fetchGlamaServers` | `glama` |
| mcp.directory | `mcp_directory` | `mcp_directory.ts` | `fetchMcpDirectoryServers` | `mcp_directory` |

> `vendor.ts` is a deprecated re-export shim → `partner.ts`. Will be removed in a future cleanup.

---

## "Safe to go" Checklist

- [x] All 10 integration faults fixed
- [x] vendor→partner rename complete, shim in place
- [x] API enum clean (`'github'` removed, `'vendor'` removed, `'mcp_directory'` added)
- [x] schema_hash computed post-probe (matches drift cron)
- [x] tools[] always synced from probe/sandbox result
- [x] auth_type updated in enrichment patch path
- [x] env_var_schema + package_info in search response
- [x] api_key servers exempt from uptime probe
- [x] partner.ts transport defaults to 'unknown'
- [x] mcp_directory heuristic github_url for dedup
- [x] extraction_metrics aligned pipeline ↔ response builder
- [x] ToolExtractionSource type has 'readme_parsed'
- [x] Sandbox fetch has 60s AbortSignal timeout
- [x] Subprocess SIGTERM + SIGKILL cleanup in sandbox
- [x] resources/prompts paginated in mcp-probe.ts
