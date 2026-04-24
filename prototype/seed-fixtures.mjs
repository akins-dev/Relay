import { createHash } from 'node:crypto';
import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';
import {
  PROTOTYPE_API_KEY,
  PROTOTYPE_BASE_URL,
  PROTOTYPE_TAG,
  buildFixtureWorld,
} from './fixture-world.mjs';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const fixtures = buildFixtureWorld(PROTOTYPE_BASE_URL);
  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, username')
    .order('created_at', { ascending: true })
    .limit(1);

  if (profileError) throw profileError;
  if (!profiles || profiles.length === 0) {
    throw new Error('No profile row found. Create a user first so fixtures can reference author_id.');
  }

  const author = profiles[0];

  const { error: deleteError } = await supabase
    .from('servers')
    .delete()
    .contains('tags', [PROTOTYPE_TAG]);

  if (deleteError) throw deleteError;

  const rows = fixtures.map((fixture) => ({
    id: fixture.id,
    name: fixture.name,
    display_name: fixture.displayName,
    description: fixture.description,
    long_description: fixture.longDescription,
    author_id: author.id,
    version: fixture.version,
    endpoint: fixture.endpoint,
    homepage_url: fixture.homepageUrl,
    github_url: fixture.githubUrl,
    readme_url: fixture.readmeUrl,
    license: fixture.license,
    tags: fixture.tags,
    tools: fixture.tools,
    tool_schemas: fixture.toolSchemas,
    resources: fixture.resources,
    prompts: fixture.prompts,
    status: fixture.status,
    verified: fixture.verified,
    stars: fixture.stars,
    latency_ms: fixture.latencyMs,
    uptime_pct: fixture.uptimePct,
    trust_score: fixture.trustScore,
    schema_hash: fixture.schemaHash,
    scan_status: fixture.scanStatus,
    scan_issues: fixture.scanIssues,
    source: fixture.source,
    cve_issues: fixture.cveIssues,
    transport: fixture.transport,
    auth_type: fixture.authType,
    auth_setup_url: fixture.authSetupUrl,
    oauth_authorization_url: fixture.oauthAuthorizationUrl,
    oauth_token_url: fixture.oauthTokenUrl,
    oauth_scopes: fixture.oauthScopes,
    oauth_client_id: fixture.oauthClientId,
    proxy_available: fixture.proxyAvailable,
    upstream_updated_at: fixture.upstreamUpdatedAt,
    description_quality: fixture.descriptionQuality,
  }));

  const { error: upsertError } = await supabase
    .from('servers')
    .upsert(rows, { onConflict: 'name' });

  if (upsertError) throw upsertError;

  const hints = fixtures
    .filter((fixture) => fixture.requiredSecretName)
    .map((fixture) => ({
      server_name: fixture.name,
      secret_name: fixture.requiredSecretName,
      required: true,
      description: fixture.secretDescription ?? `${fixture.displayName} credential`,
      obtain_url: fixture.secretObtainUrl,
    }));

  if (hints.length > 0) {
    const { error: hintError } = await supabase
      .from('server_credential_hints')
      .upsert(hints, { onConflict: 'server_name,secret_name' });

    if (hintError) throw hintError;
  }

  const keyHash = createHash('sha256').update(PROTOTYPE_API_KEY).digest('hex');
  const { data: existingKey, error: keyLookupError } = await supabase
    .from('api_keys')
    .select('id')
    .eq('key_hash', keyHash)
    .maybeSingle();

  if (keyLookupError) throw keyLookupError;

  if (!existingKey) {
    const { error: keyInsertError } = await supabase
      .from('api_keys')
      .insert({
        user_id: author.id,
        key_hash: keyHash,
        key_prefix: PROTOTYPE_API_KEY.slice(0, 16),
        name: 'Prototype Local Key',
      });

    if (keyInsertError) throw keyInsertError;
  }

  console.log(`Seeded ${fixtures.length} prototype fixtures for ${author.username ?? author.id}`);
  console.log(`Fake MCP base URL: ${PROTOTYPE_BASE_URL}`);
  console.log(`Prototype API key: ${PROTOTYPE_API_KEY}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
