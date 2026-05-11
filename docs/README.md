# Relay Technical Docs

This directory is the project's technical source of truth.

## Canonical Files

- `TECHNICAL_BACKBONE.md`
  The living technical reference for the product, system model, infrastructure, ingest pipeline, data model, analytics, risks, and roadmap.
- `ARCHITECTURE_SYSTEM_MAP.md`
  The deepest code-grounded architecture walkthrough, spanning runtime, maintenance, auth, Vault, security, and analytics as one system.
- `ARCHITECTURE_FLOWS.md`
  The presentation-friendly architecture view built around explicit Relay flows that can be drawn directly in Excalidraw or slides.
- `diagrams/relay-system-overview.excalidraw`
  A single-canvas Excalidraw scene for the full system workflow, importable into Excalidraw or Obsidian.
- `DELIVERY_ROADMAP.md`
  The canonical sprint-by-sprint delivery plan. Detailed sprint scope should live here, not in architecture narratives.
- `PROTOTYPE_IMPLEMENTATION_PLAN.md`
  The canonical current MVP scope: runtime discovery, search, manifests, and local CLI execution.
- `MIGRATION_LEDGER.md`
  The canonical ledger for numbered Supabase migrations and retired schema objects.
- `RATE_LIMITS.md`
  The canonical reference for exact enforced rate limits, keying, and configuration behavior.
- `SECURITY.md`
  Focused security and trust-model reference.
- `DEVELOPMENT.md`
  Local setup and contributor workflow.
- `TESTING_GUIDE.md`
  Practical test paths for the MVP and local verification.
- `PROTOTYPE_GUIDE.md`
  Deterministic fixture-based prototype workflow.
- `DECISION_LOG.md`
  Append-only architecture decision log. New decisions are added; old decisions are never deleted.
- `CHANGELOG.md`
  Append-only project evolution log. Captures what changed and when.
- `articles/RELAY_AGENT_CENTRIC_RUNTIME_DISCOVERY.md`
  Draft publication-ready technical article/essay for external sharing.

## Update Contract

When implementation changes touch any of the areas below, these docs should be updated in the same workstream:

- ingest sources, normalization, extraction, deduplication, trust scoring, or schema handling
- database schema, RPCs, analytics tables, or retention rules
- runtime behavior, local invocation manifests, auth handling, policy enforcement, or security scanning
- infrastructure dependencies, free-tier assumptions, migration strategy, or backup/export paths
- roadmap, MVP scope, or major product/design decisions
- enforced rate limits, rate-limit configuration, or route-level throttling behavior
- database migrations or retired schema objects

## How To Use This Set

1. Start with `PROTOTYPE_IMPLEMENTATION_PLAN.md` to understand the current MVP scope.
2. Read `DELIVERY_ROADMAP.md` for the active delivery sequence.
3. Use `MIGRATION_LEDGER.md` before adding or reversing database schema.
4. Read `TECHNICAL_BACKBONE.md` for the broader technical history.
5. Read `DECISION_LOG.md` and `CHANGELOG.md` to understand why the system changed.

## Conflict Resolution

If documentation conflicts exist, treat this directory as canonical for technical and operational truth. The root `README.md` is the entrypoint summary, not the full authority.
