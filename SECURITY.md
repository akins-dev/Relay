# Security & Trust Models

Every server scanned before listing. Every proxy call inspected.

**Publish-time (per ingested server):**
- L1 Static scan — prompt injection, exfiltration patterns, deceptive tool descriptions
- L3 Schema pinning — SHA-256 hash; any mutation auto-suspends the server
- L8 Typosquatting — pg_trgm similarity blocks impersonation at publish time
- S-14 npm CVE scan — package.json checked against npm advisory database

**Runtime proxy (per call):**
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

Current OWASP MCP Top 10 coverage: **~70%**. Target: 90%+ with WASM sandbox (L2).

**What happens to threatening servers:**
- Critical scan issue or critical CVE → `rejected` — never listed
- High severity issues → listed with lower trust score + visible scan warning
- Schema mutation detected by drift cron → auto-suspended, re-queued for scan
- Runtime anomaly (DLP triggers, injection attempts) → flagged for human review

---

## Trust scores

Every server has a 0–100 trust score returned with every search result.

| Component | Weight | What it measures |
|---|---|---|
| Scan quality | 30 | Static scan + CVE scan result quality |
| Verified publisher | 25 | Publisher completed identity verification |
| Uptime | 20 | 30-day uptime measured every 15 minutes |
| Schema stability | 15 | Days since last schema change |
| Community | 10 | Stars, call volume |

**New servers:** get a discovery boost for 90 days — surfaced alongside top servers in their category with a "New" badge. Trust score stays honest; ranking gives them visibility.

**Category balance:** if a category has 5+ servers above trust score 85, lower-scored servers in that niche are surfaced in search results. High-trust monopolies do not crowd out legitimate alternatives.

---

## Security Layers Enforcement

| When | Layers | Catches mid-cycle changes? |
|------|--------|---------------------------|
| **Ingest** | L1 static scan, S-14 CVE scan | ❌ Only at ingest time |
| **Cron (6h)** | L3 schema drift | ✅ Detects tool rug-pulls |
| **Cron (15m)** | Uptime + trust recomputation | ✅ Detects server outages |
| **Proxy (every call)** | L4 DLP, S-12 shell injection, S-13 indirect injection, L9 sampling, L10 PII, L11 URL, L12 context | ✅ Runtime defense |

## Server Status Lifecycle

| Status | Set By | Visible? | Callable? |
|--------|--------|----------|----------|
| `active` | Ingest (scan ok) | ✅ | ✅ |
| `pending_review` | Ingest (high severity) | ❌ | ❌ |
| `rejected` | Ingest (critical) | ❌ | ❌ |
| `suspended` | Schema drift cron | ❌ | ❌ |
| `pending` | Manual publish | ❌ | ❌ |

Only `active` servers are visible to any user (human or AI) and callable through the proxy.

## CVE Scan Deduplication

Multiple servers can share the same GitHub repository. The pipeline deduplicates CVE scans by repo URL, scanning each unique repo only once per ingest run.
