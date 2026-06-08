#!/usr/bin/env node
const API_KEY = process.env.SMITHERY_API_KEY;
if (!API_KEY) { console.error('SMITHERY_API_KEY not set'); process.exit(1); }
const H = { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' };

async function go() {
  // Get non-deployed servers using isDeployed filter
  const listRes = await fetch('https://registry.smithery.ai/servers?isDeployed=false&page=1&pageSize=5&seed=1', { headers: H });
  const list = await listRes.json();
  console.log('Non-deployed listing count:', list.servers?.length, 'totalCount:', list.pagination?.totalCount);

  for (const s of (list.servers ?? []).slice(0, 3)) {
    console.log('\n=== NON-DEPLOYED:', s.qualifiedName, '===');
    console.log('  listing.isDeployed:', s.isDeployed);
    console.log('  listing.remote:', s.remote);

    const dRes = await fetch('https://registry.smithery.ai/servers/' + encodeURIComponent(s.qualifiedName), { headers: H });
    if (!dRes.ok) {
      console.log('  detail HTTP:', dRes.status);
      continue;
    }
    const detail = await dRes.json();
    console.log('  detail.deploymentUrl:', detail.deploymentUrl ?? null);
    console.log('  detail.connections:', JSON.stringify(detail.connections ?? []));
    console.log('  detail.tools:', detail.tools?.length ?? 0, 'items');
    if (detail.tools?.length > 0) {
      console.log('    first:', detail.tools[0].name, 'hasInputSchema:', !!detail.tools[0].inputSchema);
    }
    console.log('  detail.resources:', detail.resources?.length ?? 0);
    console.log('  detail.prompts:', detail.prompts?.length ?? 0);
    await new Promise(r => setTimeout(r, 300));
  }
}
go().catch(e => { console.error(e); process.exit(1); });
