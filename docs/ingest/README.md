# Ingest Pipeline — Research & Reference

> Engineering reference for the MCP Registry ingest pipeline.
> All claims verified against live API responses.
> **GitHub reference fetcher is removed.** GitHub exposes no standard MCP server API.

---

## Table of Contents

1. [Registry Overview & Decisions](#1-registry-overview--decisions)
2. [How Each Registry Gets Its Data](#2-how-each-registry-gets-its-data)
3. [Field Grading System](#3-field-grading-system)
4. [Field Requirements by Transport](#4-field-requirements-by-transport)
5. [Tool Population Strategy](#5-tool-population-strategy)
6. [IngestServer Data Structure](#6-ingestserver-data-structure)
7. [Field Source Matrix](#7-field-source-matrix)
8. [Legal & ToS](#8-legal--tos)
9. [Known Bugs in Current Fetchers](#9-known-bugs-in-current-fetchers)
10. [MVP Test Server](#10-mvp-test-server)

---

## 1. Registry Overview & Decisions

### Pipeline Tiers

Sources are split into two tiers based on whether they can provide endpoints (required for invoke):

**Primary Sources — provide endpoints and/or tool schemas:**

| Registry | Actual Size | Has JSON API | What it provides for invoke |
|---|---|---|---|
| **Official Registry** | Unknown (thousands of records, hundreds–low thousands unique servers¹) | ✅ documented | `remotes[].url` (endpoint) + auth header specs + `packages[]` (stdio run command) |
| **Smithery** | ~5,111 | ✅ documented | `deploymentUrl` (endpoint) + full tool schemas + transport |

**Enrichment Sources — no endpoints, enrich via `github_url` cross-reference:**

| Registry | Actual Size | Has JSON API | What it provides for enrichment |
|---|---|---|---|
| **Glama** | Unknown (thousands²) | ✅ documented | SPDX license, `environmentVariablesJsonSchema`, `attributes[]` tags, `repository.url` |
| **mcp.directory** | 2,002 (confirmed) | ✅ verified | `toolCount`, `githubStars`, `npmWeeklyDownloads`, `publisher.verified`, `transportType[]` |

**Excluded — no programmatic API:**

| Registry | Reason |
|---|---|
| **mcp.so** | Web-only, no JSON API found |
| **mcpservers.org** | Static curated list, no ingest path |
| **GitHub** | No standard MCP server listing API |

> ¹ Official Registry API returns ALL versions per server (no server-side `isLatest` filter works). Must filter `isLatest: true` **client-side** during ingest. Real unique server count requires full traversal of all pages.
>
> ² Glama API returns cursor-paginated results with no `total` field. Full count requires traversal.

### Cross-Reference Strategy

Glama and mcp.directory don't have endpoint URLs. Their value is in enriching records already found via Official or Smithery, using `github_url` as the universal join key:

```
Primary ingest pass:
  Official → endpoint (remotes[]) + package_info + env_var_schema
  Smithery → endpoint (deploymentUrl) + tool_schemas + transport

Enrichment pass (match by github_url, then display_name):
  Glama      → license + env_var_schema (if richer) + tags from attributes[]
  mcp.directory → toolCount signal + githubStars + npmWeeklyDownloads + publisher.verified

For servers ONLY in Glama/mcp.directory (no Official/Smithery match):
  → endpoint = null
  → tool_extraction_source = 'none'
  → Still indexed for search_tools (name + description)
  → Attempt /.well-known/mcp/server-card.json probe if attributes[] includes 'hosting:remote-capable'
```

**Dedup key chain (priority order):**
1. `official_id` (reverse-DNS name, e.g. `io.modelcontextprotocol/filesystem`) — most precise
2. `smithery_id` (qualifiedName) — very reliable
3. `github_url` (`repository.url`) — reliable for open-source servers
4. Normalized `display_name` — fuzzy fallback only

### Why Ingest ALL Smithery Servers?

Every Smithery detail call returns real capability data (tool schemas, endpoint, transport). There is no valid reason to gate on `isDeployed`. Servers without tools today may have tools tomorrow. The ingest pipeline stores what is available and marks completeness with field grades — it does not decide upfront what is worth fetching.

At 200ms per call with 10 concurrent fetches, 5,111 servers ≈ 102 seconds total. Acceptable for a scheduled ingest job.

---

## 2. How Each Registry Gets Its Data

### 2a. Official Registry — `registry.modelcontextprotocol.io`

**Mechanism:** Self-submission via `mcp-publisher` CLI. No crawling.

**Tier: PRIMARY** — provides live endpoint URLs and install specs.

**API:** `GET /v0/servers?limit=100&cursor=...` → cursor-paginated  

> ⚠️ **Critical:** The API returns ALL versions of every server. The `isLatest` query parameter does **not** filter server-side — verified by live API response. You must filter `isLatest: true` **client-side** when paginating. Count all records ≠ count unique servers.

**What it provides (unique):**
- `remotes[].url` — the live HTTP endpoint URL (Grade A for invoke)
- `remotes[].headers[]` — auth header specs (`isSecret`, `isRequired`, `name`) — for vault injection
- `packages[]` — npm/pypi/docker/mcpb install info with `registryType`, `identifier`, `runtimeHint` (npx/uvx/docker)
- `packages[].environmentVariables[]` — name, description, required, isSecret, format, default, placeholder
- `icons[]` — server logos
- `repository.id` — GitHub numeric ID (resurrection-attack detection)
- `_meta["io.modelcontextprotocol.registry/official"].status` — `active | deprecated | deleted`
- `_meta["io.modelcontextprotocol.registry/publisher-provided"]` — extra publisher metadata (serverCard URL, agentSkills, docs)

**Does NOT provide:** Tool schemas, license, tags, usage counts.

---

### 2b. Smithery — `api.smithery.ai`

**Mechanism:** Publisher submits a live HTTPS endpoint. Smithery performs a real MCP handshake and stores the results. Fallback: `/.well-known/mcp/server-card.json` for auth-gated servers.

**This is why Smithery is the only registry with pre-stored tool schemas — it actually runs them.**

**API Listing:** `GET https://registry.smithery.ai/servers?q=&page=1&pageSize=100`
```json
{
  "qualifiedName": "exa",
  "displayName": "Exa Search",
  "iconUrl": "https://...",
  "verified": true,
  "useCount": 57198,
  "remote": true,
  "isDeployed": true,
  "createdAt": "...",
  "homepage": "..."
}
```
No tools, no connections, no transport in listing.

**API Detail:** `GET https://api.smithery.ai/v2/servers/{qualifiedName}`
```json
{
  "qualifiedName": "exa",
  "deploymentUrl": "https://exa.run.tools",
  "connections": [{ "type": "http", "configSchema": { ... } }],
  "tools": [{ "name": "web_search_exa", "description": "...", "inputSchema": { ... } }],
  "resources": [{ "name": "tools_list", "uri": "exa://tools/list", "mimeType": "..." }],
  "prompts": [{ "name": "web_search_help", "description": "..." }]
}
```

**Strategy: Ingest ALL 5,111 servers.** Listing sweep first, then detail calls for all.

---

### 2c. Glama — `glama.ai/api/mcp/v1/servers`

**Mechanism:** GitHub crawler. Scans repos tagged `mcp-server` on GitHub. No submission required.

> Confirmed: *"You don't have to do anything for your server to appear on this site, as we continuously fetch updates from GitHub."*

**Tier: ENRICHMENT** — does NOT provide endpoint URLs. Used to enrich records found via Official/Smithery via `repository.url` cross-reference.

**API:** `GET https://glama.ai/api/mcp/v1/servers?first=100&after=...` → cursor-paginated (no `total` field — must traverse)  
**Detail:** `GET https://glama.ai/api/mcp/v1/servers/{namespace}/{slug}`

**What it provides (unique):**
- `repository.url` — **the cross-reference key** (GitHub URL used to match against Official/Smithery records)
- `environmentVariablesJsonSchema` — JSON Schema object for env vars — richest normalized env var data in the ecosystem
- `spdxLicense` — e.g. `{ "name": "MIT License", "url": "https://spdx.org/licenses/MIT.json" }` — only SPDX source
- `attributes[]` — `hosting:remote-capable`, `hosting:local-only`, `author:official` — classification tags

**Does NOT provide:** Endpoint URL, tool schemas (always `[]`), transport.

**`url` field is a trap:** Always `https://glama.ai/mcp/servers/{id}` — Glama's own listing page. Never map to `homepage_url` or `endpoint`.

**Why tools are always `[]`:** Glama displays tools on their website by running their in-browser MCP Inspector live when you visit the page. This data is never stored in the API. Glama is not a source for tool schemas.

---

### 2d. mcp.directory — `mcp.directory/api/v1`

**Mechanism:** Publisher submission + GitHub data. Verified via live API response.

**Tier: ENRICHMENT** — does NOT provide endpoint URLs. Used to enrich records found via Official/Smithery, matched by `publisher.name` + `slug` → inferred GitHub URL.

**API:** `GET https://mcp.directory/api/v1/servers?limit=100&offset=0` → offset-paginated. **Total: 2,002 servers** (confirmed from `total` field).

**Verified response shape:**
```json
{
  "servers": [{
    "id": "1991",
    "name": "Atlassian (Jira & Confluence)",
    "slug": "atlassian-jira-confluence",
    "shortDescription": "Atlassian's official remote MCP server...",
    "classification": "official",
    "transportType": ["stdio"],
    "stars": 15934,
    "githubStars": 48180,
    "npmWeeklyDownloads": 872,
    "toolCount": 16,
    "publisher": { "name": "atlassian", "avatarUrl": "https://github.com/atlassian.png", "verified": true }
  }],
  "total": 2002
}
```

**What it provides for enrichment:**
- `toolCount` — confirms a server has tools (validates Smithery detail call is worth making)
- `githubStars` + `npmWeeklyDownloads` — analytics/ranking signals (stored in analytics table, not IngestServer)
- `publisher.verified` — curated trust signal
- `transportType[]` — declared transport (pre-confirms before probing)
- `publisher.avatarUrl` — fallback `icon_url` when Smithery/Official don't have one

**Does NOT provide:** Endpoint URL, tool schemas, env var schema, license.

---

## 3. Field Grading System

Every field in `IngestServer` carries a grade indicating its importance for the core product functions: `search_tools` and `invoke_tool`. This grade is used to prioritize data quality, surface completeness warnings, and inform per-server quality scores.

### Grade Definitions

| Grade | Label | Meaning |
|---|---|---|
| **A** | Critical | Missing = search_tools or invoke_tool fails or is severely broken |
| **B** | High | Missing = significantly degraded quality or user experience |
| **C** | Medium | Missing = noticeable gap, but system still functions |
| **D** | Low | Nice to have, marginal benefit |
| **F** | Internal | Tracked in our analytics DB, never sourced from upstream |

### Per-Field Grades

| Field | `search_tools` | `invoke_tool` | Notes |
|---|:---:|:---:|---|
| `name` | **A** | **A** | Primary identifier |
| `display_name` | **A** | **A** | Shown to user |
| `description` | **A** | C | Core of intent matching |
| `transport` | **A** | **A** | Routes to HTTP proxy vs CLI companion |
| `tools[]` (names) | **A** | B | Full-text search corpus |
| `tool_schemas` (inputSchema) | B | **A** | Argument validation at invoke time |
| `tool_schemas` (description) | **A** | B | Intent matching for tool selection |
| `endpoint` | C | **A** (HTTP/SSE) | N/A for stdio |
| `package_info` | C | **A** (stdio) | How to run it locally |
| `env_var_schema` | B | **A** | Must know creds required before invoke |
| `tags` | B | D | Category-based search |
| `title` | B | D | High-precision name search |
| `verified` | C | B | Trust signal for routing |
| `icon_url` | D | D | UI only |
| `license` | D | D | Informational |
| `github_url` | D | C | Reference for stdio servers |
| `homepage_url` | D | D | Informational |
| `long_description` | C | D | Expanded context for search |
| `resources[]` | C | C | Agent awareness of available resources |
| `prompts[]` | C | C | Agent awareness of available prompts |
| `use_count` | **F** | **F** | We compute this from invoke analytics |
| `stars` / `downloads` | **F** | **F** | We store from upstreams in analytics table |

---

## 4. Field Requirements by Transport

Different transports have different non-negotiable fields. The same `IngestServer` struct covers all, but completeness thresholds differ.

### HTTP / Streamable-HTTP / SSE Servers

| Field | Grade | Why |
|---|---|---|
| `endpoint` | **A** | Without it, invoke_tool cannot route the request |
| `transport` | **A** | Must be `http`, `sse`, or `streamable_http` explicitly |
| `tool_schemas` (inputSchema) | **A** | Argument validation before forwarding |
| `env_var_schema` | **A** | Identifies credentials that must be vault-injected |
| `tools[]` (names + descriptions) | **A** | Core search corpus |
| `remotes[]` (auth headers) | B | Enables vault-injection of auth headers |
| `verified` | B | Trust tier for proxy routing |
| `icon_url` | D | UI |

### stdio Servers (index only, no cloud proxy)

| Field | Grade | Why |
|---|---|---|
| `transport` | **A** | Must be `stdio` to prevent cloud proxy attempt |
| `package_info` | **A** | Command + args to launch locally via CLI companion |
| `env_var_schema` | **A** | Local credential injection |
| `tools[]` (names + descriptions) | **A** | Search corpus — user discovers, CLI executes |
| `github_url` | B | CLI companion may clone/install from source |
| `tool_schemas` (inputSchema) | B | Pre-validation before local execution |

> **stdio servers are indexed for `search_tools` but never cloud-proxied.**
> They are routed to the CLI companion for local execution.

---

## 5. Tool Population Strategy

Tools are the most valuable data. Priority order for populating `tool_schemas`:

```
1. smithery_detail    → Full inputSchema, descriptions, resources, prompts
                        Source: GET /v2/servers/{qualifiedName}
                        Coverage: all ~5,111 Smithery servers

2. mcp_probe          → Live MCP handshake to server endpoint
                        For: HTTP/SSE servers NOT in Smithery with a known endpoint
                        Process: connect → tools/list → resources/list → prompts/list
                        Rate-limited, timeout: 10s

3. sandbox            → Sandboxed local execution for stdio servers
                        For: stdio servers with known package (npm/pypi/docker)
                        Process: spin up server → probe → tear down
                        Expensive — only for Grade-A candidate servers

4. upstream_names     → Server is in a registry but only names are available
                        (e.g. mcp.directory provides toolCount but not schemas)
                        Mark: tool_extraction_source = 'upstream_names'

5. none               → No tool data available from any source
                        Mark: tool_extraction_source = 'none'
                        Server still ingested — search works on name/description
```

### Live Probe (`mcp_probe`) Details

For any HTTP/SSE server with a known `endpoint` that has no Smithery detail:

```typescript
// Pseudocode
const session = await connect(server.endpoint, server.transport);
const { tools }     = await session.request('tools/list', {});
const { resources } = await session.request('resources/list', {});
const { prompts }   = await session.request('prompts/list', {});
await session.close();
return { tools, resources, prompts, tool_extraction_source: 'mcp_probe' };
```

Timeout: 10 seconds. Failures are logged and retried on next ingest cycle.
Do not probe servers with `verified: false` and no known `github_url` (SSRF protection).

---

## 6. IngestServer Data Structure

Every upstream source normalizes into this interface before DB upsert.

**Rules:**
- `null` over fake — unknown fields are `null`, never defaulted
- Transport from contract — never guessed from URL patterns
- `use_count` / popularity signals → analytics table, not `IngestServer`
- Each field annotated with its grade

```typescript
// src/lib/ingest/types.ts

export type IngestSource = 'official' | 'smithery' | 'glama' | 'mcp_directory' | 'partner';

export type Transport = 'stdio' | 'sse' | 'streamable_http' | 'unknown';

export type ToolExtractionSource =
  | 'smithery_detail'
  | 'mcp_probe'
  | 'sandbox'
  | 'upstream_schemas'
  | 'upstream_names'
  | 'none';

export interface ToolSchema {
  name:         string;           // Grade A
  description?: string;           // Grade A for search
  inputSchema?: Record<string, unknown>; // Grade A for invoke
}

export interface McpResource {
  name:        string;
  uri:         string;
  description?: string;
  mimeType?:   string;
}

export interface McpPrompt {
  name:         string;
  description?: string;
  arguments?:   Array<{ name: string; description?: string; required?: boolean }>;
}

/**
 * Grade A for HTTP invoke, Grade A for stdio launch.
 * Normalized from:
 *   Official: packages[].environmentVariables[]
 *   Glama:    environmentVariablesJsonSchema.properties
 *   Smithery: connections[].configSchema.properties
 */
export interface EnvVarSpec {
  name:          string;
  description?:  string;
  isRequired:    boolean;
  isSecret:      boolean;
  defaultValue?: string;
  format?:       'string' | 'number' | 'boolean' | 'filepath';
  placeholder?:  string;
  choices?:      string[];
}

/**
 * Grade A for stdio invoke — this is how the CLI companion runs the server.
 * Source: Official registry packages[] only.
 */
export interface PackageInfo {
  registryType:     string;   // 'npm' | 'pypi' | 'oci' | 'nuget' | 'mcpb'
  registryBaseUrl?: string;
  identifier:       string;   // e.g. '@modelcontextprotocol/server-filesystem'
  version?:         string;
  runtimeHint?:     string;   // 'npx' | 'uvx' | 'docker' | 'dnx'
  fileSha256?:      string;
  transport:        Transport;
}

export interface IngestServer {
  // ── Identity (Grade A) ───────────────────────────────────────────────────
  name:              string;          // slugified, DB key
  display_name:      string;
  description:       string;          // Grade A — core search corpus
  transport:         Transport;       // Grade A — routes HTTP vs stdio

  // ── Identity (Grade B–C) ─────────────────────────────────────────────────
  title?:            string | null;   // B — Official only, high-precision search
  long_description?: string | null;   // C
  description_quality?: 'upstream' | 'readme_parsed' | 'auto_generated';

  // ── Connection (Grade A for HTTP; N/A for stdio) ──────────────────────────
  endpoint:          string | null;   // A (HTTP/SSE) — null for stdio

  // ── Versioning ───────────────────────────────────────────────────────────
  version:           string | null;   // null for Smithery/Glama/mcp.directory

  // ── Tool Capabilities (Grade A) ───────────────────────────────────────────
  tools:             string[];        // A — names for full-text search
  tool_schemas:      ToolSchema[];    // A — name + description + inputSchema
  tool_extraction_source?: ToolExtractionSource;
  resources?:        McpResource[];   // C
  prompts?:          McpPrompt[];     // C

  // ── Install & Config (Grade A) ────────────────────────────────────────────
  env_var_schema?:   EnvVarSpec[] | null;   // A — credential requirements
  package_info?:     PackageInfo[] | null;  // A (stdio) — how to run locally

  // ── URLs (Grade C–D) ─────────────────────────────────────────────────────
  github_url?:       string | null;   // B (stdio), D (HTTP)
  homepage_url?:     string | null;   // D
  icon_url?:         string | null;   // D — UI only
  readme_url?:       string | null;   // D

  // ── Classification (Grade B–D) ────────────────────────────────────────────
  license:           string | null;   // D — SPDX, never defaulted
  tags:              string[];        // B — category search
  verified?:         boolean;         // B — trust tier

  // ── Provenance ────────────────────────────────────────────────────────────
  source:            IngestSource;
  source_id?:        string | null;
  smithery_id?:      string | null;
  official_id?:      string | null;
  glama_id?:         string | null;
  mcp_directory_id?: string | null;
  upstream_updated_at?: string | null;

  // ── Raw upstream (side table: server_connection_profiles) ─────────────────
  raw_upstream_json?:  Record<string, unknown> | null;
  remotes?:            unknown[] | null;   // Official remotes[] — auth header specs
  icons?:              unknown[] | null;   // Official icons[]
  official_meta?:      Record<string, unknown> | null;
  publisher_meta?:     Record<string, unknown> | null;
}

export interface IngestResult {
  added:    number;
  updated:  number;
  rejected: number;
  skipped:  number;
  errors:   string[];
  fetched?: number;
  extraction_metrics?: {
    smithery_detail_fetched:  number;
    probe_attempts:           number;
    probe_success:            number;
    sandbox_attempts:         number;
    sandbox_success:          number;
    grade_a_complete:         number;   // all Grade A fields populated
    grade_b_complete:         number;   // all Grade A+B fields populated
  };
}

export type IngestFetcher = () => Promise<IngestServer[]>;
```

---

## 7. Field Source Matrix

| Field | Grade | Official | Smithery Detail | Glama | mcp.directory |
|---|:---:|:---:|:---:|:---:|:---:|
| `name` / `display_name` | A | ✅ | ✅ | ✅ | ✅ |
| `description` | A | ✅ | ✅ | ✅ | ✅ partial |
| `transport` | A | ✅ declared | ✅ `connections[].type` | inferred | ✅ `transportType[]` |
| `tools[]` names | A | ❌ | ✅ | ❌ `[]` | toolCount only |
| `tool_schemas` inputSchema | A | ❌ | ✅ **only source** | ❌ | ❌ |
| `tool_schemas` description | A | ❌ | ✅ | ❌ | ❌ |
| `endpoint` | A | ✅ `remotes[]` | ✅ `deploymentUrl` | ❌ | ❌ |
| `env_var_schema` | A | ✅ `envVars[]` | ✅ `configSchema` | ✅ `envVarsJsonSchema` | ❌ |
| `package_info` | A (stdio) | ✅ only | ❌ | ❌ | ❌ |
| `title` | B | ✅ only | ❌ | ❌ | ❌ |
| `tags` | B | ❌ | ❌ | ✅ `attributes[]` | ✅ `classification` |
| `verified` | B | ✅ | ✅ | ❌ | ✅ `publisher.verified` |
| `resources[]` | C | ❌ | ✅ | ❌ | ❌ |
| `prompts[]` | C | ❌ | ✅ | ❌ | ❌ |
| `github_url` | B/D | ✅ | ❌ | ✅ | via `githubStars` signal |
| `icon_url` | D | ✅ `icons[]` | ✅ `iconUrl` | ❌ | ✅ `publisher.avatarUrl` |
| `license` | D | ❌ | ❌ | ✅ SPDX | ❌ |
| `version` | D | ✅ | ❌ null | ❌ null | ❌ null |

---

## 8. Legal & ToS

| Source | Risk | Notes |
|---|---|---|
| **Official Registry** | ✅ None | Docs explicitly encourage hourly aggregation |
| **Smithery** (`api.smithery.ai`) | ✅ Low | Different domain from `smithery.ai`. API key = implicit consent. |
| **Glama** | ⚠️ Low-Med | `robots.txt` blocks `/api/` but they publicly advertise this API. ToS §14 explicitly claims aggregation of public data as their own right. Use documented endpoints only. Ping Discord. |
| **mcp.directory** | ⚠️ Low-Med | JSON API is publicly accessible, no auth required. Check their ToS before prod scale. |

**All fetchers must include:** `User-Agent: mcp-registry-next/1.0 (+https://relay.yourdomain.com)`

---

## 9. Known Bugs — Resolution Status

All bugs from the original audit have been resolved in the v2 implementation.

| # | File | Bug | Status |
|---|---|---|---|
| 1 | `glama.ts` | `s.url` mapped to `homepage_url` (was Glama's own page) | ✅ Fixed — `endpoint: null`, `homepage_url: null` |
| 2 | `smithery.ts` | Listing only — no tools, no transport, no endpoint | ✅ Fixed — two-phase: listing sweep + detail fetch for all servers |
| 3 | `smithery.ts` | `version: '1.0.0'` hardcoded | ✅ Fixed — `version: null` |
| 4 | `glama.ts` | `version: '1.0.0'` hardcoded | ✅ Fixed — `version: null` |
| 5 | `smithery.ts` | `iconUrl` not mapped | ✅ Fixed — mapped to `icon_url` |
| 6 | `official.ts` | `icons[0].src` not mapped | ✅ Fixed — mapped to `icon_url` |
| 7 | All | `env_var_schema` never populated | ✅ Fixed — normalized from Official pkgs + remotes, Smithery configSchema, Glama envVarsJsonSchema |
| 8 | `github.ts` | Entire file | ✅ Deleted — GitHub has no standard MCP server listing API |

**Additional issues fixed (not in original audit):**
- `pipeline.ts`: Enrichment sources (glama, mcp.directory) previously got SKIPPED when an existing Official/Smithery record was found, silently discarding license, env_var_schema, tags. Fixed with selective enrichment patch path.
- `official.ts`: `version: '0.0.0'` default in pipeline overwritten — now `null` for non-Official sources.
- `glama.ts`: `transport` was inferred from the bogus `s.url` field. Now correctly derived from `attributes[]` only.
- `pipeline.ts`: `resources` and `prompts` from Smithery detail were being ignored (probe was re-running and overwriting). Now prefers Smithery-provided data.

---

## 10. MVP Test Server

**Recommended: Exa Search**

- Smithery: `qualifiedName: "exa"` — `isDeployed: true`, `useCount: 57,198`
- Glama: `namespace: "exa-labs"`, `slug: "exa-mcp-server"`
- Official Registry: present with npm package + env var specs
- mcp.directory: present with `toolCount`, `stars`, `verified`
- Endpoint: `https://exa.run.tools` — public, no auth for basic probe
- Tools: `web_search_exa`, `web_fetch_exa` (via Smithery detail)
- Env vars: just `EXA_API_KEY` (from Glama + Official)

**Why perfect for MVP:** Appears across all 4 active sources. Tests dedup logic, transport detection, tool schema ingestion, env var normalization, and icon mapping in one shot.

**Secondary test servers:**

| Server | Purpose |
|---|---|
| `io.modelcontextprotocol/filesystem` | stdio, Official only, package_info test |
| `brave/brave-search-mcp-server` | 8 tools, multi-source, remote |
| `microsoft/playwright-mcp` | mcp.directory `githubStars` signal test |
| `atlassian/jira-confluence` | mcp.directory `toolCount: 16`, `npmWeeklyDownloads` |
