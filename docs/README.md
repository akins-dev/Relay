# Relay Technical Docs

This directory is the project's technical source of truth.

## Canonical Files

- `TECHNICAL_BACKBONE.md`
  The living technical reference for the product, system model, infrastructure, ingest pipeline, data model, analytics, risks, and roadmap.
- `DECISION_LOG.md`
  Append-only architecture decision log. New decisions are added; old decisions are never deleted.
- `CHANGELOG.md`
  Append-only project evolution log. Captures what changed and when.
- `../RELAY_AGENT_CENTRIC_RUNTIME_DISCOVERY.md`
  Draft publication-ready technical article/essay for external sharing.

## Update Contract

When implementation changes touch any of the areas below, these docs should be updated in the same workstream:

- ingest sources, normalization, extraction, deduplication, trust scoring, or schema handling
- database schema, RPCs, analytics tables, or retention rules
- runtime proxy behavior, auth injection, policy enforcement, or security scanning
- infrastructure dependencies, free-tier assumptions, migration strategy, or backup/export paths
- roadmap, MVP scope, or major product/design decisions

## How To Use This Set

1. Start with `TECHNICAL_BACKBONE.md` to understand the current system.
2. Read `DECISION_LOG.md` to understand why the system looks this way.
3. Read `CHANGELOG.md` to track how the architecture and plan evolved over time.

## Conflict Resolution

If this directory conflicts with older narrative docs in the repo root, treat this directory as the canonical technical reference and treat the older docs as historical context unless they are explicitly updated later.
