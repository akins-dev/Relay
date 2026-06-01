# Relay Migration Ledger

Last updated: 2026-05-22
Status: Canonical migration tracking ledger

This file exists so numbered Supabase migrations do not become mystery history.

Rules:

- Never delete a migration that may have been applied to any database.
- Reverse or supersede old schema through a later numbered migration.
- Update this ledger in the same change that adds a migration.
- Mark MVP-retired objects clearly instead of pretending they never existed.

## Status Labels

- `active`: part of the current schema contract.
- `legacy`: still present or historically important, but not on the MVP critical path.
- `superseded`: replaced by a later migration or product decision.
- `retired`: removed by a later migration.

## Ledger

| Migration | Status | Purpose |
|---|---|---|
| `001_initial_schema.sql` | active | Initial application schema. |
| `002_seed_data.sql` | retired | Retired no-op placeholder; demo seed rows are no longer inserted. |
| `003_source_and_cve.sql` | legacy | Source/CVE-era registry metadata. Security scanning is no longer an MVP gate. |
| `004_mcp_server_and_schemas.sql` | active | MCP server and schema storage. |
| `005_metering.sql` | legacy | Metering foundation from the hosted invocation model. |
| `006_analytics.sql` | active | Analytics foundations used by search and product learning. |
| `007_tool_policies.sql` | legacy | Tool policy model from the hosted proxy era. |
| `008_anomaly_detection.sql` | legacy | Runtime anomaly detection from the hosted proxy era. |
| `009_transport_and_stdio_filter.sql` | active | Transport and stdio classification. |
| `010_auth_transparency_and_audit_public.sql` | legacy | Auth/audit transparency from the hosted proxy era. |
| `011_vault_secrets.sql` | legacy | Vault-backed secret storage. Not required for the MVP loop. |
| `012_oauth_connections.sql` | legacy | OAuth connection storage. Not required for the MVP loop. |
| `013_mcp_compliance_fields.sql` | active | MCP compliance metadata on servers. |
| `014_mcp_primitives_fields.sql` | active | Tool/resource/prompt primitive storage. |
| `015_final_schema_fixes.sql` | active | Schema fixes. |
| `016_fix_global_stats.sql` | active | Global stats correction. |
| `017_dedup_by_github_url.sql` | active | GitHub URL deduplication. |
| `018_operations_tracking.sql` | legacy | Operations tracking for production-style cron/admin views. |
| `019_add_vendor_source.sql` | active | Vendor source support. |
| `020_add_github_url_to_search.sql` | active | Adds GitHub URL to search output. |
| `021_add_new_sources.sql` | active | Additional ingest sources. |
| `022_analytics_intelligence_layer.sql` | active | `search_events`, `invoke_outcomes`, `intent_server_mappings` — ranking feedback when Relay Local reports outcomes. |
| `023_security_hardening.sql` | legacy | Security/rate-limit hardening. Rate limits remain; proxy security is retired. |
| `024_new_sources_and_partner_rename.sql` | active | Source naming and source additions. |
| `025_ingest_mvp_contract_fixes.sql` | active | Ingest contract fixes. |
| `026_server_connection_profiles.sql` | legacy | Connection profiles for richer runtime setup. |
| `027_ingest_provenance_and_public_tool_analytics.sql` | active | Ingest provenance and public tool analytics. |
| `028_ingest_provenance_quality_views.sql` | active | Quality views for registry inspection. |
| `029_ingest_v2_fields.sql` | active | Ingest v2 metadata fields. |
| `030_ingest_v2_source_and_functions.sql` | active | Ingest source/function updates. |
| `031_canonical_cleanup_and_trust_score.sql` | active | Canonical cleanup and trust score support. |
| `032_behavioral_trust_and_dynamic_diversity.sql` | active | Diversity penalty in search; behavioral signals when invoke outcomes exist. |
| `033_fix_license_not_null.sql` | active | License constraint fix. |
| `034_fix_enum_constraints.sql` | active | Enum/constraint fixes. |
| `035_search_v2.sql` | active | Current search RPC contract foundation. |
| `036_processing_jobs_and_mvp_ingest.sql` | superseded | Added async processing queue. Superseded by current MVP scope. |
| `037_drop_processing_jobs_queue.sql` | active | Drops `server_processing_jobs` and `processing_job_health`. |
| `040_tool_level_intent_search.sql` | active | `server_tools` table, triggers, and RRF `search_servers()`. Self-contained schema populated automatically via triggers at initial ingest time. |
| `041_optimize_search_rpc_timeout.sql` | active | Replaces `search_servers()` with a timeout-resistant version that avoids broad trigram similarity scoring over large tool documents. |


## Current MVP Schema Owner Map

| Area | Primary Objects | MVP Role |
|---|---|---|
| Registry | `servers` | Canonical server catalog. |
| Search | `search_servers(...)`, `server_tools` | Agent-facing intent search; per-tool FTS index (040). |
| Ingest tracking | `ingest_runs` | Observable manual ingest history. |
| Search analytics | `search_events` | Search quality review and future ranking. |
| Source/provenance | source fields, provenance fields, quality views | Helps rank and debug catalog quality. |
| Legacy runtime | policies, vault, OAuth, invoke outcomes, metering | Not part of MVP execution path. |

## Retired Objects

| Object | Retired By | Reason |
|---|---|---|
| `public.server_processing_jobs` | `037_drop_processing_jobs_queue.sql` | Async probe/sandbox/CVE queue is not part of the MVP. |
| `public.processing_job_health` | `037_drop_processing_jobs_queue.sql` | Derived view for retired queue. |
