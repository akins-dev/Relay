# MCP Registry — Ingest & Trust Score Architecture

> Last updated: 2026-05-05 (Migration 032: Behavioral Trust & Dynamic Diversity)

---

## Overview

The registry ingests MCP servers from four sources (Smithery, mcp.directory, official MCP registry, direct GitHub) and assigns each server a **behavioral trust score** (0–100). The score answers one question: *how safe and reliable is this server for an agent to invoke in production?*

---

## Trust Score Formula

The score is a weighted sum of six independent signals, plus runtime penalties.

| Slot | Points | Signal | Source |
|------|--------|--------|--------|
| Security quality | 25 | CVE scan + static scan (`scanServer()`) | Computed at ingest |
| Uptime | 20 | EWMA of 15-min probe results | Uptime cron |
| Publisher credibility | 15 | `verified` flag from trusted curator | Upstream source |
| **Behavioral reliability** | **15** | Bayesian-smoothed success rate × log-volume | `intent_server_mappings` |
| Deployment quality | 15 | Has live endpoint + tool schemas with `inputSchema` | Computed at ingest |
| Schema stability | 10 | Days since `schema_hash` last changed (max 90d) | Computed at ingest |
| **Total** | **100** | | |

**Runtime penalties** (applied on every uptime cron recompute):

| Condition | Penalty |
|-----------|---------|
| Request failure rate > 0% | Up to −15 pts |
| DLP trigger rate > 5% | Up to −10 pts |

---

## Behavioral Reliability Slot (replacing `use_count`)

### The Problem with `use_count`

`use_count` came from Smithery's listing API. Servers ingested from any other source (mcp.directory, GitHub, direct submission) had `use_count = 0`, giving them 0 pts in this slot and an artificial 15-point disadvantage that had nothing to do with quality.

### The Solution: Bayesian-Smoothed Runtime Evidence

This model originally consumed hosted proxy `invoke_tool` outcomes. In the current prototype, hosted proxy invocation is retired. The same Bayesian reliability model can become useful again when Relay Local intentionally reports invocation outcomes.

When Relay Local outcome reporting is enabled, `recordInvokeOutcome()` in `search-analytics.ts` can perform an atomic upsert on `intent_server_mappings`:

```
invoke_count  += 1
success_count += (1 if success else 0)
```

The behavioral reliability score is then computed as:

```
adjusted_rate = (success_count + 3) / (invoke_count + 4)   ← Beta(3,1) Bayesian prior
behavioral_pts = min(15, adjusted_rate × log10(invoke_count + 5) × 15)
```

**Why Beta(3,1)?**  
A Beta(3,1) prior means we assume a server is probably good (75% success rate) until proven otherwise. This prior washes out as real data accumulates — at 20+ invocations, the observed rate dominates.

**Score trajectory:**

| State | invoke_count | success_count | adjusted_rate | behavioral_pts |
|-------|-------------|---------------|---------------|----------------|
| Brand new (cold start) | 0 | 0 | 0.75 | ~7.9 pts |
| 10 invocations, 100% success | 10 | 10 | 0.929 | **15 pts (cap)** |
| 50 invocations, 95% success | 50 | 47 | 0.926 | 15 pts |
| 1000 invocations, 60% poor | 1000 | 600 | 0.600 | ~12 pts |

> `use_count` is **not removed** — it remains as a secondary search ranking tiebreaker in `ORDER BY use_count DESC`. It is no longer part of the trust score formula.

---

## Score Lifecycle

```
Ingest (Day 0)
  ├── Security scan:      0 or 25 pts (CVE found → 50% score → 12.5 pts)
  ├── Uptime:             20 pts (default 100% at ingest)
  ├── Credibility:        0 or 15 pts (verified flag)
  ├── Behavioral:         ~7.9 pts (Bayesian prior, no invoke history)
  ├── Deployment quality: 0 or 15 pts (has endpoint + tool schemas)
  └── Stability:          0 pts (new server, no schema change history)
  
  Typical new, verified, clean server: ~65–73 pts
  Typical new, unverified, clean server: ~50–58 pts

After first uptime probe (up):
  └── Uptime EWMA begins converging upward
  → No change to other slots

After 30 days stable + 20 successful Relay invocation outcomes:
  └── Stability: +10 pts (max)
  └── Behavioral: ~15 pts (cap reached quickly)
  → Verified, proven server: ~88–95 pts

Steady state (high-quality, actively used):
  └── Score: 85–98 pts
```

---

## Search Diversity (Migration 032)

### The Old Logic (broken)

```sql
-- WRONG: scans entire servers table for trust_score >= 85
-- Silent failure: when new formula lowers scores below 85, 0 rows match,
-- LEFT JOIN nullifies everything, diversity never fires.
WITH category_counts AS (
  SELECT primary_tag, COUNT(*) FROM servers WHERE trust_score >= 85 ...
)
```

### The New Logic (correct)

```sql
-- Correct: scans only the result set (these specific search results)
WITH base AS (...filtered results...),
category_counts AS (
  SELECT tags[1] AS primary_tag, COUNT(*) AS result_count FROM base GROUP BY tags[1]
),
result_median AS (
  SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY trust_score) AS median_score FROM base
)
-- Penalty: over-represented category + below result-set median → trust × 0.92
CASE
  WHEN cc.result_count > 2 AND b.trust_score < rm.median_score
  THEN b.trust_score * 0.92
  ELSE b.trust_score
END DESC
```

**Key properties:**
- **Always fires** — the median is always defined (it's from *this* result set, not a global table)
- **Intent-sensitive** — adapts to what *this specific query* returned
- **Soft penalty** — 8% reduction, never suppresses genuinely better servers
- **No hardcoded thresholds** — all thresholds are relative to the current result distribution

---

## Score Interpretation Guide

| Score | Meaning | Recommendation |
|-------|---------|----------------|
| 85–100 | Verified publisher + proven runtime reliability | ✅ Safe for production |
| 70–84 | Passed all scans, some invoke history | ✅ Suitable for most use cases |
| 55–69 | New/unproven — scans passed, limited runtime data | ⚠️ Test before production use |
| < 55 | Active issues — scan failures, high error rate, or poor uptime | 🚫 Use with caution |

> **Note for dashboard operators:** Avg Trust Score in the Admin dashboard now represents *behavioral reliability* rather than manual metadata vetting. A newly ingested batch of clean, verified servers will show an average around 65–73 before the uptime cron runs and invoke data accumulates. This is correct.

---

## Files Involved

| File | Role |
|------|------|
| `src/lib/security.ts` | `computeTrustScore()` — TypeScript formula, all call sites |
| `src/lib/ingest/pipeline.ts` | Calls `computeTrustScore()` at ingest with `invokeCount: 0` |
| `src/lib/cron/uptime.ts` | Recomputes trust on every uptime probe using live ISM data |
| `src/app/api/servers/route.ts` | Manual submissions (POST) also use `invokeCount: 0` |
| `src/lib/search-analytics.ts` | `recordInvokeOutcome()` writes to `intent_server_mappings` |
| `supabase/migrations/032_behavioral_trust_and_dynamic_diversity.sql` | DB functions + search_servers() rewrite |
| `src/__tests__/security.test.ts` | Full test suite including Bayesian prior assertions |

---

## No New Infrastructure

The behavioral reliability signal requires:
- ✅ No new tables — reads from existing `intent_server_mappings`
- ✅ No new cron jobs — Relay Local can report outcomes directly when implemented
- ✅ No new columns — `invoke_count` and `success_count` already exist in ISM
- ✅ A new covering index: `idx_ism_server_reliability` (migration 032)
- ✅ A new DB helper function: `get_server_behavioral_reliability()`
