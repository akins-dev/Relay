# Search relevance benchmark

Golden intents for measuring how well Relay maps **intent → server → tool → runnable manifest**.

## Files

| File | Use |
|------|-----|
| `intents.jsonl` | Production catalog — run after ingest against live Supabase |

## Metrics

See [docs/SEARCH_PIPELINE.md](../docs/SEARCH_PIPELINE.md) § Measurement.

| Metric | Meaning |
|--------|---------|
| **Server-P@1** | Expected server in position 1 |
| **Server-P@3** | Expected server in top 3 |
| **Tool-P@1** | Expected tool in top server's trimmed tools (max 3) |
| **Runnable-P@1** | Top result `run_mode` is `local_stdio` or `remote_mcp` |
| **Knowledge precision** | Knowledge intents deflected without search (MCP only) |

## Run

```bash
# Unit tests (scoring + trim + classifier — no DB)
npm run test:benchmark

# Live eval against Supabase (requires .env)
npm run benchmark:eval
```

Output: `benchmark/reports/latest.md` and per-case JSON in `benchmark/reports/`.

## Updating labels

When ingest adds canonical servers, update `expected_servers` with stable name substrings (partial match). Re-run eval and commit the report when intentionally changing ranking.
