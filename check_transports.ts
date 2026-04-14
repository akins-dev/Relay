import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const svc = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log("Checking Smithery Server Transports...");
  const { data, error } = await svc
    .from('servers')
    .select('transport')
    .eq('source', 'smithery');
    
  if (error) {
    console.error(error);
    return;
  }
  
  const counts: Record<string, number> = {};
  for (const s of data) {
    counts[s.transport || 'null'] = (counts[s.transport || 'null'] || 0) + 1;
  }
  
  console.log(counts);
}

main();
