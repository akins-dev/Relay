import { loadEnvConfig } from '@next/env';
import path from 'path';
loadEnvConfig(path.resolve(process.cwd()));

import { createClient } from '@supabase/supabase-js';

const svc = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log('Querying profiles...');
  const { data, error, count } = await svc.from('profiles').select('*', { count: 'exact' });
  if (error) {
    console.error('Error:', error);
  } else {
    console.log('Success! Profiles count:', count, 'Rows:', data);
  }
}

main().catch(console.error);
