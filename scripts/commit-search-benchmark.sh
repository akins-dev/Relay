#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

git checkout dev

git add \
  .gitignore \
  README.md \
  package.json \
  benchmark/ \
  docs/ARCHITECTURE_SYSTEM_MAP.md \
  docs/CHANGELOG.md \
  docs/DELIVERY_ROADMAP.md \
  docs/LAUNCH_AND_PUBLIC_TESTING.md \
  docs/MIGRATION_LEDGER.md \
  docs/README.md \
  docs/SEARCH_IMPLEMENTATION_PLAN.md \
  docs/SEARCH_PIPELINE.md \
  docs/TESTING_GUIDE.md \
  docs/articles/SEARCH_INTENT_AND_MEASUREMENT.md \
  docs/migrations/ \
  src/__tests__/benchmark-score.test.ts \
  src/__tests__/search-quality.test.ts \
  src/__tests__/integration.test.ts \
  src/app/api/mcp-server/route.ts \
  src/benchmark/ \
  src/lib/intent-classifier.ts \
  src/scripts/run-benchmark-eval.ts \
  supabase/migrations/040_tool_level_intent_search.sql \
  supabase/migrations/041_optimize_search_rpc_timeout.sql \
  supabase/migrations/042_remove_tool_text_trigram_from_search.sql \
  supabase/migrations/043_restore_tool_text_trigram_search.sql \
  supabase/migrations/044_prune_inactive_server_tools.sql

git commit -m "$(cat <<'EOF'
Ship tool-level intent search with benchmark harness and migrations 040/041.

Measure search quality before launch and apply RRF tool-level ranking in production.
EOF
)"

git push -u origin dev

echo "COMMIT=$(git rev-parse HEAD)"
echo "FILES:"
git show --name-only --pretty=format: HEAD
