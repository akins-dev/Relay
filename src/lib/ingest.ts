/**
 * DEPRECATED: This file is a compatibility shim.
 *
 * The ingest pipeline has been refactored into modular files under src/lib/ingest/.
 * All imports from '@/lib/ingest' now resolve to src/lib/ingest/index.ts (the barrel).
 *
 * This file exists ONLY because TypeScript/Next.js may resolve '@/lib/ingest'
 * to this file instead of the ingest/ directory's index.ts.
 *
 * To ensure the barrel takes precedence, this re-exports everything from the directory.
 *
 * TODO: Delete this file once we confirm the directory barrel resolves correctly.
 */

// Re-export everything from the new modular barrel
export * from './ingest/index';
