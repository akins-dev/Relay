import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Public values — safe to commit (anon key is not a secret)
const SUPABASE_URL      = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Standard server client — respects RLS, uses cookie session */
export function createClient() {
  const cookieStore = cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // In Server Components — middleware handles cookie refresh
        }
      },
    },
  });
}

/** Service-role client — bypasses RLS. Only for cron routes + scan/audit writes. */
export function createServiceClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createServerClient(SUPABASE_URL, serviceRoleKey, {
    cookies: { getAll: () => [], setAll: () => {} },
    auth:    { persistSession: false },
  });
}
