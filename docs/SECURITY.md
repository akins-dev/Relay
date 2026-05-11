# Security & Trust Models

Last updated: 2026-05-09 (Prototype scope reset)
Canonical technical reference: [`TECHNICAL_BACKBONE.md`](TECHNICAL_BACKBONE.md)
Exact rate-limit defaults and keying rules: [`RATE_LIMITS.md`](RATE_LIMITS.md)
Ingest & trust scoring deep-dive: [`ingest/README.md`](ingest/README.md)

This file now tracks legacy security and trust ideas. The current prototype does not run third-party MCP tools through Relay cloud, so the runtime proxy controls below are deferred rather than active MVP behavior.

Current MVP security boundary:

- Relay cloud stores and searches registry metadata.
- Relay cloud returns run manifests.
- Credentials stay in the user's local agent host or CLI environment.
- Local execution happens outside Relay cloud.
- Manual/admin ingest routes require `Authorization: Bearer $CRON_SECRET`.

**Publish-time (per ingested server):**
- L1 Static scan — prompt injection, exfiltration patterns, deceptive tool descriptions
- L3 Schema pinning — SHA-256 hash; any mutation auto-suspends the server
- L8 Typosquatting — pg_trgm similarity blocks impersonation at publish time
- S-14 npm CVE scan — package.json checked against npm advisory database

**Deferred runtime proxy ideas:**
- L4 DLP — 11 credential patterns blocked on requests; response matches surfaced via warning headers and audit logs
- S-12 Shell injection — 18 OS command patterns (43% of MCP CVEs are this class)
- S-13 Indirect injection — instruction language in response data
- L9 Sampling inspection — server-initiated LLM call hijacking
- L10 PII detection — email, phone, SSN, card numbers scanned in responses
- L11 URL elicitation — SSRF, javascript:, file:// blocked
- L12 Context isolation — session tokens leaking in responses

**Infrastructure:**
- L5 Trust score — 0–100 composite: scan quality + uptime + schema stability + community signals
- L6 Supabase RLS — database-level enforcement on all tables
- L7 OAuth connection security — validated redirects, state verification, encrypted token storage

Current OWASP MCP Top 10 coverage target is documented internally as **~70%** today, with a path to 90%+ once a stronger sandbox layer exists.

**What happens to threatening servers:**
- Critical scan issue or critical CVE → `rejected` — never listed
- High severity issues → listed with lower trust score + visible scan warning
- Schema mutation detected by drift cron → auto-suspended, re-queued for scan
- Runtime anomaly (DLP triggers, injection attempts) → flagged for human review

---

## Trust scores

Every server has a 0–100 trust score returned with every search result.

| Component | Points | What it measures | Source |
|---|---:|---|---|
| Security quality | 25 | CVE scan + static scan (the core value prop) | Computed at ingest |
| Uptime | 20 | EWMA of 15-min probe results | Uptime cron |
| Publisher credibility | 15 | `verified` flag from a trusted curator | Upstream source |
| **Behavioral reliability** | **15** | Bayesian-smoothed success rate × log-volume from Relay proxy invocations | `intent_server_mappings` |
| Deployment quality | 15 | Has live endpoint **and** at least one tool schema with `inputSchema` | Computed at ingest |
| Schema stability | 10 | Days since `schema_hash` last changed (max 90 days) | Computed at ingest |

**Deferred runtime penalties**:

| Condition | Penalty |
|---|---|
| Request failure rate > 0% | Up to −15 pts |
| DLP trigger rate > 5% | Up to −10 pts |

**Behavioral reliability** was designed for proxy outcomes. For the prototype, it should be treated as legacy ranking support unless the CLI intentionally reports local outcomes later.

**Typical score ranges under the new model:**

| Score | Meaning |
|---|---|
| 85–100 | Verified + proven runtime reliability ✅ Safe for production |
| 65–84 | Passed all scans, some invoke history ✅ Suitable for most use cases |
| 40–64 | New/unproven — scans passed, no invoke history yet ⚠ Test before production |
| < 40 | Active issues — scan failures, high error rate, or poor uptime 🚫 |

**New servers:** get a discovery ranking boost for 90 days — surfaced alongside top servers in their category with a "New" badge. Trust score stays honest; only search ranking is boosted.

**Category balance:** the search function applies a soft 8% penalty to servers that are (a) from a category over-represented in the current result set **and** (b) score below the result-set median trust score. This always fires because the threshold is relative to the current query results — not a hardcoded global number.

---

## Security Layers Enforcement

| When | Layers | Catches mid-cycle changes? |
|------|--------|---------------------------|
| **Ingest** | L1 static scan, S-14 CVE scan | ❌ Only at ingest time |
| **Cron (6h)** | L3 schema drift | ✅ Detects tool rug-pulls |
| **Cron (15m)** | Uptime + trust recomputation (using live ISM behavioral data) | ✅ Detects server outages |
| **Proxy (deferred)** | L4 DLP, S-12 shell injection, S-13 indirect injection, L9 sampling, L10 PII, L11 URL, L12 context | Deferred |

## Server Status Lifecycle

| Status | Set By | Visible? | Callable? |
|--------|--------|----------|----------|
| `active` | Ingest (scan ok) | ✅ | ✅ |
| `pending_review` | Ingest (high severity) | ❌ | ❌ |
| `rejected` | Ingest (critical) | ❌ | ❌ |
| `suspended` | Schema drift cron | ❌ | ❌ |
| `pending` | Manual publish | ❌ | ❌ |

Only `active` servers are visible to users and agents. Relay cloud does not provide a prototype proxy invocation path.

## CVE Scan Deduplication

Multiple servers can share the same GitHub repository. The pipeline deduplicates CVE scans by repo URL, scanning each unique repo only once per ingest run.
