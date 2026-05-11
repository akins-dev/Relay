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

export async function ensureSearchContracts(): Promise<void> {
  if (Date.now() - lastOkAt < CONTRACT_CHECK_TTL_MS) return;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    await assertRpcExists('search_servers', {
      query_text: 'health-check',
      result_limit: 1,
      include_stdio: true,
    });
    lastOkAt = Date.now();
  })()
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
