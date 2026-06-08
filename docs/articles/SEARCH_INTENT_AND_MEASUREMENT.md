# Intent, Tools, and How We Measure Relay Search

Last updated: 2026-05-22  
Audience: engineers and agent builders evaluating Relay search quality

---

## The problem in one sentence

Agents need **the right invokable tool** for a live task—not a list of a thousand preloaded schemas.

Relay answers with a small interface: search by intent, fetch a manifest, invoke locally.

---

## Three layers of “right”

1. **Server** — which MCP package in the catalog matches the task?
2. **Tool** — which tools on that server should the model see (max 3 trimmed schemas)?
3. **Runnable** — can Relay Local start it (`local_stdio`) or connect (`remote_mcp`)?

Search optimizes layer 1–2 in Cloud; layer 3 is proven on the user machine.

---

## How mapping works today (no magic router)

Relay uses **lexical retrieval + rank fusion + light reranking**, not an LLM picker:

- Postgres full-text search on servers and on a per-tool `server_tools` table
- Reciprocal Rank Fusion to combine server-level and tool-level hits
- Trust, canonical catalog, and past invoke success as boosts
- TF-IDF trimming so payloads stay small
- A regex gate so obvious knowledge questions skip tool search on the MCP surface

As real agents invoke tools, `intent_server_mappings` records what worked—future searches for similar intents rank higher.

---

## Precision we report

| Metric | Meaning |
|--------|---------|
| Server-P@1 | Correct server at rank 1 |
| Server-P@3 | Correct server in top 3 |
| Tool-P@1 | Correct tool in the trimmed top-3 list for rank 1 |
| Runnable-P@1 | Top result is locally or remotely runnable |
| Knowledge precision | Knowledge intents deflected without a wasteful search |

Golden intents live in `benchmark/intents.jsonl`. Run `npm run test:benchmark` in CI and `npm run benchmark:eval` against a populated catalog.

---

## What comes next

- **Manifest-aware ranking** so action intents prefer runnable rows
- **Hybrid semantic search** (Sprint 6) for conversational queries FTS misses
- **Learned fast paths** once enough outcome data exists

We publish baseline numbers before adding embeddings so improvements stay honest.

---

## Try it

```bash
# Cloud search (REST)
curl -s "$RELAY_API_URL/api/servers/search?q=send+transactional+email&limit=3"

# CLI
npx -y @relay/cli search "create a github issue"
```

Full pipeline: `docs/SEARCH_PIPELINE.md`. Launch checklist: `docs/LAUNCH_AND_PUBLIC_TESTING.md`.
