import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

const LISTING_URL = 'https://registry.smithery.ai/servers';
const DETAIL_URL = 'https://registry.smithery.ai/servers';
const API_KEY = process.env.SMITHERY_API_KEY;

async function runTest() {
  console.log('Testing Smithery Rate Limit...');
  console.log('API Key available:', !!API_KEY);
  
  // 1. Fetch listing to get 200 server names
  const res = await fetch(`${LISTING_URL}?q=&page=1&pageSize=200`, {
    headers: { Authorization: `Bearer ${API_KEY}`, 'Accept': 'application/json' }
  });
  const data = await res.json();
  const names = data.servers.map((s: any) => s.qualifiedName);
  console.log(`Fetched ${names.length} servers for test`);

  let count = 0;
  let success = 0;
  let rateLimited = 0;
  
  const startTime = Date.now();
  
  // Hit them as fast as possible to find the limit
  const promises = names.map(async (name: string, i: number) => {
    // Add small stagger so we don't blow up network sockets locally
    await new Promise(r => setTimeout(r, i * 20)); 
    
    const reqStart = Date.now();
    const r = await fetch(`${DETAIL_URL}/${encodeURIComponent(name)}`, {
      headers: { Authorization: `Bearer ${API_KEY}`, 'Accept': 'application/json' }
    });
    
    count++;
    if (r.status === 429) {
      rateLimited++;
      const retryAfter = r.headers.get('Retry-After');
      const reset = r.headers.get('x-ratelimit-reset');
      console.log(`[${count}] 429 Rate Limited on ${name} (Retry-After: ${retryAfter}, Reset: ${reset})`);
    } else if (r.ok) {
      success++;
      if (count % 25 === 0) console.log(`[${count}] 200 OK`);
    } else {
      console.log(`[${count}] Error ${r.status} on ${name}`);
    }
  });

  await Promise.all(promises);
  
  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\nTest complete in ${elapsed.toFixed(1)}s`);
  console.log(`Success: ${success}`);
  console.log(`Rate Limited: ${rateLimited}`);
  console.log(`Approximate limit hit after ${success} requests.`);
}

runTest().catch(console.error);
