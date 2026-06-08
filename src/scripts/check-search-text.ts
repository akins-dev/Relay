/**
 * Quick diagnostic: check search_text lengths in server_tools.
 * Run: npm run check-search-text  (or add script to package.json first)
 */
import { loadEnvConfig } from '@next/env';
import { createClient } from '@supabase/supabase-js';
loadEnvConfig(process.cwd());
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
async function main() {
  // Grab a sample of 500 rows
  const { data: samples, error } = await sb
    .from('server_tools')
    .select('server_name, tool_name, search_text')
    .order('server_name')
    .limit(500);
  if (error) {
    console.error('Query error:', error.message);
    process.exit(1);
  }
  const rows = samples ?? [];
  const lengths = rows.map(r => r.search_text?.length ?? 0);
  const buckets: Record<string, number> = {
    'under_200': 0,
    '200_400': 0,
    '400_600': 0,
    '600_800': 0,
    '800_1000': 0,
    '1000_2000': 0,
    'over_2000': 0,
  };
  for (const len of lengths) {
    if (len < 200) buckets['under_200']++;
    else if (len < 400) buckets['200_400']++;
    else if (len < 600) buckets['400_600']++;
    else if (len < 800) buckets['600_800']++;
    else if (len < 1000) buckets['800_1000']++;
    else if (len < 2000) buckets['1000_2000']++;
    else buckets['over_2000']++;
  }
  console.log(`\nSampled ${rows.length} rows`);
  console.log(`Min: ${Math.min(...lengths)}, Max: ${Math.max(...lengths)}, Avg: ${Math.round(lengths.reduce((a,b)=>a+b,0)/lengths.length)}`);
  console.log('\nLength distribution:');
  for (const [bucket, count] of Object.entries(buckets)) {
    const bar = '#'.repeat(Math.ceil(count / 2));
    console.log(`  ${bucket.padEnd(12)} ${String(count).padStart(4)} ${bar}`);
  }
  // Show 3 longest
  const sorted = rows.sort((a, b) => (b.search_text?.length ?? 0) - (a.search_text?.length ?? 0));
  console.log('\nLongest 3:');
  for (const r of sorted.slice(0, 3)) {
    console.log(`  [${r.search_text?.length} chars] ${r.server_name}/${r.tool_name}`);
    console.log(`    ${r.search_text?.substring(0, 150)}...`);
  }
  // Show 3 shortest
  console.log('\nShortest 3:');
  for (const r of sorted.slice(-3)) {
    console.log(`  [${r.search_text?.length} chars] ${r.server_name}/${r.tool_name}`);
    console.log(`    ${r.search_text}`);
  }
}
main().catch(console.error);