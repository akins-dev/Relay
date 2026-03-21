'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

// ── ⚠️  CRITICAL REMINDER ─────────────────────────────────────────────────────
// Before this page can store secrets safely, Supabase statement logging
// must be disabled. See migration 011 header for instructions.
// Dashboard → Database → Database Settings → Log Settings → Statement log level: ddl
// ─────────────────────────────────────────────────────────────────────────────

interface Secret {
  id:          string;
  server_name: string | null;
  secret_name: string;
  description: string | null;
  created_at:  string;
  updated_at:  string;
}

// Common credential hints — shown as suggestions when adding a secret
const CREDENTIAL_HINTS: Record<string, { label: string; obtain_url: string; description: string }> = {
  'STRIPE_API_KEY':          { label: 'Stripe API Key',           obtain_url: 'https://dashboard.stripe.com/apikeys', description: 'Your Stripe secret key (sk_live_... or sk_test_...)' },
  'STRIPE_PAYMENTS_API_KEY': { label: 'Stripe API Key',           obtain_url: 'https://dashboard.stripe.com/apikeys', description: 'Your Stripe secret key' },
  'GITHUB_TOKEN':            { label: 'GitHub Personal Access Token', obtain_url: 'https://github.com/settings/tokens', description: 'GitHub PAT with required repo scopes' },
  'GITHUB_TOOLS_API_KEY':    { label: 'GitHub Token',             obtain_url: 'https://github.com/settings/tokens', description: 'GitHub PAT with required repo scopes' },
  'SENDGRID_API_KEY':        { label: 'SendGrid API Key',         obtain_url: 'https://app.sendgrid.com/settings/api_keys', description: 'SendGrid API key with Mail Send permission' },
  'SENDGRID_MAIL_API_KEY':   { label: 'SendGrid API Key',         obtain_url: 'https://app.sendgrid.com/settings/api_keys', description: 'SendGrid API key with Mail Send permission' },
  'OPENAI_API_KEY':          { label: 'OpenAI API Key',           obtain_url: 'https://platform.openai.com/api-keys', description: 'Your OpenAI secret key (sk-...)' },
  'SLACK_TOKEN':             { label: 'Slack Bot Token',          obtain_url: 'https://api.slack.com/apps', description: 'Slack Bot OAuth token (xoxb-...)' },
  'NOTION_API_KEY':          { label: 'Notion Integration Token', obtain_url: 'https://www.notion.so/my-integrations', description: 'Notion internal integration secret' },
  'LINEAR_API_KEY':          { label: 'Linear API Key',           obtain_url: 'https://linear.app/settings/api', description: 'Linear personal API key' },
};

export default function SecretsPage() {
  const searchParams   = useSearchParams();
  const preServer      = searchParams.get('server') ?? '';
  const preName        = searchParams.get('name') ?? '';

  const [secrets,      setSecrets]      = useState<Secret[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [showAdd,      setShowAdd]      = useState(!!(preServer || preName));
  const [saving,       setSaving]       = useState(false);
  const [deleting,     setDeleting]     = useState<string | null>(null);
  const [error,        setError]        = useState('');
  const [success,      setSuccess]      = useState('');
  const [showValue,    setShowValue]    = useState(false);

  // Form state
  const [serverName,   setServerName]   = useState(preServer);
  const [secretName,   setSecretName]   = useState(preName);
  const [secretValue,  setSecretValue]  = useState('');
  const [description,  setDescription]  = useState('');

  const hint = CREDENTIAL_HINTS[secretName];

  async function load() {
    setLoading(true);
    const res = await fetch('/api/secrets').then(r => r.json());
    setSecrets(res.secrets ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function save() {
    if (!secretName || !secretValue) {
      setError('Secret name and value are required');
      return;
    }
    setSaving(true);
    setError('');
    const res = await fetch('/api/secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        server_name:  serverName || null,
        secret_name:  secretName.toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
        secret_value: secretValue,
        description:  description || hint?.description || null,
      }),
    }).then(r => r.json());

    if (res.success) {
      setSuccess(`${secretName} stored securely. The proxy will inject it automatically.`);
      setSecretValue('');
      setShowAdd(false);
      load();
    } else {
      setError(res.error ?? 'Failed to store secret');
    }
    setSaving(false);
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Delete secret "${name}"? This cannot be undone.`)) return;
    setDeleting(id);
    const res = await fetch(`/api/secrets?id=${id}`, { method: 'DELETE' }).then(r => r.json());
    if (res.success) {
      setSecrets(s => s.filter(x => x.id !== id));
    }
    setDeleting(null);
  }

  return (
    <div className="page-sm" style={{ paddingTop: '40px', paddingBottom: '80px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '32px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <Link href="/dashboard" style={{ fontSize: '13px', color: 'var(--text-3)', textDecoration: 'none' }}>Dashboard</Link>
            <span style={{ color: 'var(--text-3)' }}>→</span>
            <span style={{ fontSize: '13px', color: 'var(--text-2)' }}>Secrets</span>
          </div>
          <h1 style={{ fontSize: '26px', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '8px', fontFamily: 'var(--font-serif)' }}>
            Stored Credentials
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--text-2)', lineHeight: 1.6, maxWidth: '480px' }}>
            Store API keys and tokens once. The openMCP proxy injects them automatically
            on every call — your agent never sees the raw value.
          </p>
        </div>
        <button onClick={() => { setShowAdd(true); setError(''); setSuccess(''); }}
          className="btn btn-primary btn-sm">
          + Add Secret
        </button>
      </div>

      {/* How it works — short explanation */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px',
        marginBottom: '28px',
      }}>
        {[
          { step: '1', text: 'You store your API key here, encrypted in Supabase Vault' },
          { step: '2', text: 'Agent calls a tool through the openMCP proxy' },
          { step: '3', text: 'Proxy resolves your key and injects it — agent never sees it' },
        ].map(s => (
          <div key={s.step} style={{ padding: '14px', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: '10px' }}>
            <div style={{ fontSize: '11px', fontFamily: 'var(--mono)', color: 'var(--accent)', fontWeight: 700, marginBottom: '4px' }}>{s.step}</div>
            <div style={{ fontSize: '13px', color: 'var(--text-2)', lineHeight: 1.5 }}>{s.text}</div>
          </div>
        ))}
      </div>

      {/* Success */}
      {success && (
        <div style={{ padding: '12px 16px', marginBottom: '16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', fontSize: '13px', color: '#15803d' }}>
          ✓ {success}
        </div>
      )}

      {/* Add secret form */}
      {showAdd && (
        <div style={{
          padding: '24px', marginBottom: '24px',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: '14px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Add a secret</h3>
            <button onClick={() => setShowAdd(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: '18px' }}>×</button>
          </div>

          {error && (
            <div style={{ padding: '10px 14px', marginBottom: '16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', fontSize: '13px', color: '#dc2626' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Server name */}
            <div>
              <label style={{ fontSize: '13px', fontWeight: 600, marginBottom: '6px', display: 'block' }}>
                Server name <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>(optional — leave blank for global)</span>
              </label>
              <input
                className="input"
                placeholder="e.g. stripe-payments (blank = inject for any server)"
                value={serverName}
                onChange={e => setServerName(e.target.value)}
                style={{ fontFamily: 'var(--mono)', fontSize: '13px' }}
              />
              <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: '4px' }}>
                Server-specific secrets take priority over global ones. Use the exact server name from the registry.
              </div>
            </div>

            {/* Secret name */}
            <div>
              <label style={{ fontSize: '13px', fontWeight: 600, marginBottom: '6px', display: 'block' }}>
                Secret name <span style={{ color: 'var(--red)', fontWeight: 400 }}>*</span>
              </label>
              <input
                className="input"
                placeholder="e.g. STRIPE_API_KEY"
                value={secretName}
                onChange={e => setSecretName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
                style={{ fontFamily: 'var(--mono)', fontSize: '13px' }}
              />
              <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: '4px' }}>
                Uppercase letters, numbers, underscores only. The proxy resolves secrets by this name.
              </div>
            </div>

            {/* Hint if we recognise the secret name */}
            {hint && (
              <div style={{ padding: '12px 14px', background: 'var(--accent-bg)', border: '1px solid rgba(194,68,12,0.2)', borderRadius: '8px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--accent)', marginBottom: '4px' }}>
                  {hint.label}
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-2)', marginBottom: '6px' }}>
                  {hint.description}
                </div>
                <a href={hint.obtain_url} target="_blank" rel="noopener"
                  style={{ fontSize: '12px', color: 'var(--accent)', textDecoration: 'none' }}>
                  Get your key from {new URL(hint.obtain_url).hostname} →
                </a>
              </div>
            )}

            {/* Secret value */}
            <div>
              <label style={{ fontSize: '13px', fontWeight: 600, marginBottom: '6px', display: 'block' }}>
                Secret value <span style={{ color: 'var(--red)', fontWeight: 400 }}>*</span>
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  className="input"
                  type={showValue ? 'text' : 'password'}
                  placeholder="Paste your API key or token"
                  value={secretValue}
                  onChange={e => setSecretValue(e.target.value)}
                  style={{ fontFamily: 'var(--mono)', fontSize: '13px', paddingRight: '80px' }}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <button
                  onClick={() => setShowValue(v => !v)}
                  style={{
                    position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: '12px', color: 'var(--text-3)',
                  }}
                >{showValue ? 'Hide' : 'Show'}</button>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: '4px' }}>
                Encrypted immediately via Supabase Vault. The value is never stored in plaintext
                and never returned through the API.
              </div>
            </div>

            {/* Description */}
            <div>
              <label style={{ fontSize: '13px', fontWeight: 600, marginBottom: '6px', display: 'block' }}>
                Note <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                className="input"
                placeholder="e.g. Production Stripe key"
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={save} disabled={saving} className="btn btn-primary">
                {saving ? 'Storing...' : 'Store securely'}
              </button>
              <button onClick={() => { setShowAdd(false); setError(''); }} className="btn btn-ghost">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Secrets list */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-3)' }}>Loading...</div>
      ) : secrets.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 24px', color: 'var(--text-3)' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>🔑</div>
          <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-2)' }}>No secrets stored yet</div>
          <div style={{ fontSize: '14px', lineHeight: 1.6, maxWidth: '360px', margin: '0 auto 20px' }}>
            When you call a tool that requires authentication, the proxy will return a 401
            with a link back here to store the credential.
          </div>
          <button onClick={() => setShowAdd(true)} className="btn btn-primary btn-sm">
            Add your first secret
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr auto', gap: '0', marginBottom: '4px', padding: '0 12px' }}>
            {['Server', 'Name', 'Note', ''].map(h => (
              <div key={h} style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</div>
            ))}
          </div>
          {secrets.map(s => (
            <div key={s.id} style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr 2fr auto', gap: '12px',
              alignItems: 'center', padding: '14px 12px',
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: '10px',
            }}>
              <div style={{ fontSize: '13px', color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>
                {s.server_name ?? <span style={{ color: 'var(--text-3)', fontStyle: 'italic' }}>global</span>}
              </div>
              <div style={{ fontSize: '13px', fontFamily: 'var(--mono)', fontWeight: 600, color: 'var(--accent)' }}>
                {s.secret_name}
              </div>
              <div style={{ fontSize: '13px', color: 'var(--text-2)' }}>
                {s.description ?? <span style={{ color: 'var(--text-3)', fontStyle: 'italic' }}>—</span>}
              </div>
              <button
                onClick={() => remove(s.id, s.secret_name)}
                disabled={deleting === s.id}
                className="btn btn-danger btn-sm"
              >
                {deleting === s.id ? '...' : 'Delete'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Security note */}
      <div style={{ marginTop: '32px', padding: '16px 18px', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: '10px', fontSize: '13px', color: 'var(--text-3)', lineHeight: 1.7 }}>
        <strong style={{ color: 'var(--text-2)' }}>How encryption works:</strong> Secret values are encrypted
        by Supabase Vault using pgsodium (libsodium). The encryption key is never stored in the database —
        it is managed by the Supabase Key Management Service. Even if the database is fully compromised,
        the values cannot be read without the KMS key. The proxy decrypts at call time and immediately
        discards the value after injecting it as an Authorization header.
      </div>
    </div>
  );
}
