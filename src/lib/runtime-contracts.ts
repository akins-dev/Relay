import { createServiceClient } from '@/lib/supabase/server';

const CONTRACT_CHECK_TTL_MS = 5 * 60 * 1000;
let lastOkAt = 0;
let inFlight: Promise<void> | null = null;

function missingFunction(error: any): boolean {
  const msg = String(error?.message ?? '').toLowerCase();
  return msg.includes('does not exist') && msg.includes('function');
}

async function assertRpcExists(name: string, args: Record<string, unknown>) {
  const svc = createServiceClient();
  const { error } = await (svc as any).rpc(name, args);
  if (error && missingFunction(error)) {
    throw new Error(`Runtime RPC contract missing: ${name}`);
  }
}

export async function ensureRuntimeContracts(): Promise<void> {
  if (Date.now() - lastOkAt < CONTRACT_CHECK_TTL_MS) return;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    await assertRpcExists('search_servers', {
      query_text: 'health-check',
      result_limit: 1,
      include_stdio: true,
    });
    await assertRpcExists('check_tool_policy', {
      p_user_id: '00000000-0000-0000-0000-000000000000',
      p_server: 'health-check',
      p_tool: 'health-check',
    });
    await assertRpcExists('get_intent_boosts', {
      p_intent_hash: 'health-check',
      p_server_names: [],
    });
    await assertRpcExists('record_intent_outcome', {
      p_intent_hash: 'health-check',
      p_intent_text: 'health-check',
      p_server_name: 'health-check',
      p_tool_name: 'health-check',
      p_success: false,
      p_latency_ms: null,
    });
    lastOkAt = Date.now();
  })()
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
