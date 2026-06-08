import { loadEnvConfig } from '@next/env';
import path from 'path';
loadEnvConfig(path.resolve(process.cwd()));

import { createClient } from '@supabase/supabase-js';

const svc = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PAGE = 1000;

async function countWhere(filter?: (q: any) => any): Promise<number> {
  let q = svc.from('servers').select('*', { count: 'exact', head: true });
  if (filter) q = filter(q);
  const { count } = await q;
  return count ?? 0;
}

async function fetchAllNames(): Promise<{ name: string; source: string; official_id: string | null; smithery_id: string | null }[]> {
  const all: any[] = [];
  let offset = 0;
  while (true) {
    const { data } = await svc.from('servers').select('name, source, official_id, smithery_id').range(offset, offset + PAGE - 1).order('name');
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

async function main() {
  console.log('\n══════════════════════════════════════════');
  console.log('  LIVE DATABASE AUDIT');
  console.log('══════════════════════════════════════════\n');

  // Total count
  const total = await countWhere();
  console.log('TOTAL servers in DB:', total);

  // By source
  const allRows = await fetchAllNames();
  const bySource: Record<string, number> = {};
  for (const r of allRows) bySource[r.source] = (bySource[r.source] || 0) + 1;
  console.log('\nBY SOURCE:');
  for (const [src, cnt] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${src.padEnd(20)} ${cnt}`);
  }

  // Key fields populated
  const hasOfficialId  = await countWhere(q => q.not('official_id', 'is', null));
  const hasSmitheryId  = await countWhere(q => q.not('smithery_id', 'is', null));
  const hasLastScanned = await countWhere(q => q.not('last_scanned_at', 'is', null));
  const hasSchemaHash  = await countWhere(q => q.not('schema_hash', 'is', null));
  const hasUpstream    = await countWhere(q => q.not('upstream_updated_at', 'is', null));
  const hasGithubUrl   = await countWhere(q => q.not('github_url', 'is', null));

  console.log('\nKEY FIELD COVERAGE:');
  console.log(`  official_id set:         ${hasOfficialId}`);
  console.log(`  smithery_id set:         ${hasSmitheryId}`);
  console.log(`  last_scanned_at set:     ${hasLastScanned}  ← previously fully processed`);
  console.log(`  schema_hash set:         ${hasSchemaHash}`);
  console.log(`  upstream_updated_at set: ${hasUpstream}`);
  console.log(`  github_url set:          ${hasGithubUrl}`);

  // Duplicate name check
  console.log('\nDUPLICATE NAME CHECK:');
  const nameSeen: Record<string, number> = {};
  for (const r of allRows) nameSeen[r.name] = (nameSeen[r.name] || 0) + 1;
  const dupeNames = Object.entries(nameSeen).filter(([, c]) => c > 1);
  console.log(`  Duplicate names: ${dupeNames.length}`);
  if (dupeNames.length > 0) {
    console.log('  Sample duplicates:');
    for (const [name, count] of dupeNames.slice(0, 15)) {
      console.log(`    "${name}" appears ${count}x`);
    }
  }

  // Servers with both official_id AND smithery_id (cross-source merged)
  const bothIds = await countWhere(q => q.not('official_id', 'is', null).not('smithery_id', 'is', null));
  console.log(`\n  Servers with BOTH official_id + smithery_id: ${bothIds}  ← correctly merged cross-source`);

  // Servers with no ID at all (name-only dedup — risky)
  const { data: noIds } = await svc
    .from('servers')
    .select('name, source', )
    .is('official_id', null)
    .is('smithery_id', null)
    .is('glama_id', null)
    .limit(5);
  const noIdCount = await countWhere(q => q.is('official_id', null).is('smithery_id', null).is('glama_id', null));
  console.log(`\n  Servers with NO source ID (name-only dedup): ${noIdCount}`);
  if (noIds && noIds.length > 0) {
    console.log('  Sample:');
    for (const r of noIds) console.log(`    "${r.name}" (source: ${r.source})`);
  }

  console.log('\n══════════════════════════════════════════\n');
}

main().catch(console.error);
