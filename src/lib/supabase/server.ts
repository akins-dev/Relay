import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  if (!anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set');

  return { url, anonKey };
}

/** Standard server client — respects RLS, uses cookie session */
export function createClient() {
  const { url, anonKey } = getSupabaseConfig();
  const cookieStore = cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.then((store) => store.getAll());
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
        return cookieStore.then((store) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            store.set(name, value, options)
          );
        }).catch(() => {
          // In Server Components — middleware handles cookie refresh
        });
      },
    },
  });
}

/** Service-role client — bypasses RLS. Only for cron routes + scan/audit writes. */
export function createServiceClient() {
  const { url } = getSupabaseConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createServerClient(url, serviceRoleKey, {
    cookies: { getAll: () => [], setAll: () => {} },
    auth:    { persistSession: false },
  });
}
