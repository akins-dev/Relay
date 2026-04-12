import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 300; // Allow up to 5 minutes execution time for backfills on Vercel
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.split(' ')[1];
    if (token !== process.env.NEXT_PUBLIC_ADMIN_UID) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!process.env.SANDBOX_URL) {
      return NextResponse.json({ error: 'SANDBOX_URL is not configured' }, { status: 500 });
    }

    const supabase = createClient();
    
    // Fetch all stdio servers stuck in pending_review
    const { data: servers, error: fetchErr } = await supabase
      .from('servers')
      .select('id, name, github_url, smithery_id, status, transport')
      .eq('status', 'pending_review')
      .eq('transport', 'stdio')
      .limit(50); // Batch limit as a safety guard

    if (fetchErr) throw fetchErr;
    if (!servers || servers.length === 0) {
      return NextResponse.json({ message: 'No servers pending backfill.' });
    }

    const results = { successful: 0, failed: 0, logs: [] as string[] };

    for (const server of servers) {
      const target = server.smithery_id || server.github_url;
      if (!target) {
        results.logs.push(`Skipped ${server.name} - no github or smithery ID`);
        results.failed++;
        continue;
      }

      results.logs.push(`Probing ${server.name} via Sandbox...`);
      
      try {
        const reqSandbox = await fetch(`${process.env.SANDBOX_URL}/extract`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json', 
            'Authorization': `Bearer ${process.env.SANDBOX_AUTH_TOKEN || 'dev-sandbox-token'}` 
          },
          body: JSON.stringify({
            command: 'npx',
            args: ['-y', '@smithery/cli@latest', 'run', target]
          })
        });

        if (!reqSandbox.ok) {
          results.logs.push(`Sandbox returned ${reqSandbox.status} for ${server.name}`);
          results.failed++;
          continue;
        }

        const resBody = await reqSandbox.json();
        
        if (resBody.success && resBody.data && resBody.data.tools?.length > 0) {
          // Success! Update DB
          const updateData = {
            status: 'active', // Mark it active since we found the tools
            tools: resBody.data.tools.map((t: any) => t.name),
            tool_schemas: resBody.data.tools,
            resources: resBody.data.resources || [],
            prompts: resBody.data.prompts || [],
            mcp_compliant: true,
            protocol_version: '2024-11-05'
          };
          
          const { error: updateErr } = await supabase
            .from('servers')
            .update(updateData)
            .eq('id', server.id);
            
          if (updateErr) {
            results.logs.push(`DB update failed for ${server.name}: ${updateErr.message}`);
            results.failed++;
          } else {
            results.logs.push(`Successfully backfilled ${server.name} with ${resBody.data.tools.length} tools`);
            results.successful++;
          }
        } else {
          results.logs.push(`Sandbox extracted no tools for ${server.name}`);
           results.failed++;
        }
      } catch (e: any) {
        results.logs.push(`Exception probing ${server.name}: ${e.message}`);
        results.failed++;
      }
    }

    return NextResponse.json({ message: 'Backfill complete', results });
  } catch (error: any) {
    console.error('[backfill] Fatal error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
