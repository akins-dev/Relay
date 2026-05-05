'use client';
import { useEffect, useState } from 'react';
import Link            from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button }      from '@/components/ui/button';
import { Input }       from '@/components/ui/input';
import { cn }          from '@/lib/cn';
import {
  Lock, Plus, Trash2, Eye, EyeOff, ExternalLink,
  ChevronLeft, AlertCircle, Shield,
} from 'lucide-react';

// ── ⚠ CRITICAL: Supabase statement logging must be set to ddl/none before use ─

interface Secret {
  id: string; server_name: string | null; secret_name: string;
  description: string | null; created_at: string; updated_at: string;
}

const HINTS: Record<string, { label: string; url: string; desc: string }> = {
  'STRIPE_API_KEY':          { label: 'Stripe API Key',              url: 'https://dashboard.stripe.com/apikeys',         desc: 'Your Stripe secret key (sk_live_... or sk_test_...)' },
  'STRIPE_PAYMENTS_API_KEY': { label: 'Stripe API Key',              url: 'https://dashboard.stripe.com/apikeys',         desc: 'Your Stripe secret key' },
  'GITHUB_TOKEN':            { label: 'GitHub Personal Access Token', url: 'https://github.com/settings/tokens',          desc: 'GitHub PAT with required repo scopes' },
  'GITHUB_TOOLS_API_KEY':    { label: 'GitHub Token',                url: 'https://github.com/settings/tokens',          desc: 'GitHub PAT with required repo scopes' },
  'SENDGRID_API_KEY':        { label: 'SendGrid API Key',            url: 'https://app.sendgrid.com/settings/api_keys',  desc: 'SendGrid API key with Mail Send permission' },
  'SENDGRID_MAIL_API_KEY':   { label: 'SendGrid API Key',            url: 'https://app.sendgrid.com/settings/api_keys',  desc: 'SendGrid API key with Mail Send permission' },
  'OPENAI_API_KEY':          { label: 'OpenAI API Key',              url: 'https://platform.openai.com/api-keys',        desc: 'Your OpenAI secret key (sk-... or sk-proj-...)' },
  'SLACK_TOKEN':             { label: 'Slack Bot Token',             url: 'https://api.slack.com/apps',                  desc: 'Slack Bot OAuth token (xoxb-...)' },
  'NOTION_API_KEY':          { label: 'Notion Integration Token',    url: 'https://www.notion.so/my-integrations',       desc: 'Notion internal integration secret' },
  'LINEAR_API_KEY':          { label: 'Linear API Key',              url: 'https://linear.app/settings/api',             desc: 'Linear personal API key' },
  'ANTHROPIC_API_KEY':       { label: 'Anthropic API Key',           url: 'https://console.anthropic.com/settings/keys', desc: 'Your Anthropic secret key (sk-ant-...)' },
};

export default function SecretsPage() {
  const sp = useSearchParams();
  const preServer = sp.get('server') ?? '';
  const preName   = sp.get('name')   ?? '';

  const [secrets,   setSecrets]   = useState<Secret[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [showForm,  setShowForm]  = useState(!!(preServer || preName));
  const [saving,    setSaving]    = useState(false);
  const [deleting,  setDeleting]  = useState<string | null>(null);
  const [error,     setError]     = useState('');
  const [success,   setSuccess]   = useState('');
  const [showVal,   setShowVal]   = useState(false);

  const [serverName,  setServerName]  = useState(preServer);
  const [secretName,  setSecretName]  = useState(preName);
  const [secretValue, setSecretValue] = useState('');
  const [description, setDescription] = useState('');

  const hint = HINTS[secretName];

  const load = async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session) headers['Authorization'] = `Bearer ${session.access_token}`;

      const res = await fetch('/api/secrets', { headers }).then(r => r.json());
      setSecrets(res.secrets ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { if (success) { const t = setTimeout(() => setSuccess(''), 5000); return () => clearTimeout(t); } }, [success]);

  const resetForm = () => {
    setServerName(''); setSecretName(''); setSecretValue('');
    setDescription(''); setError(''); setShowVal(false);
  };

  async function save() {
    const name  = secretName.trim();
    const value = secretValue.trim();
    if (!name)  { setError('Secret name is required'); return; }
    if (!value) { setError('Secret value is required'); return; }
    setSaving(true); setError('');
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session) headers['Authorization'] = `Bearer ${session.access_token}`;

      const res = await fetch('/api/secrets', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          server_name:  serverName.trim() || null,
          secret_name:  name.toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
          secret_value: value,
          description:  description.trim() || hint?.desc || null,
        }),
      }).then(r => r.json());

      if (res.success) {
        setSuccess(`${name} stored. The proxy will inject it automatically.`);
        setShowForm(false);
        resetForm();
        load();
      } else {
        setError(res.error ?? 'Failed to store secret');
      }
    } catch {
      setError('Network error — please try again');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Delete "${name}"? Calls requiring this credential will return 401 immediately.`)) return;
    setDeleting(id);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session) headers['Authorization'] = `Bearer ${session.access_token}`;

      await fetch(`/api/secrets?id=${id}`, { method: 'DELETE', headers });
      setSecrets(s => s.filter(x => x.id !== id));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10 pb-16 sm:px-8">

      {/* Breadcrumb + header */}
      <div className="mb-8">
        <Link href="/dashboard" className="mb-3 inline-flex items-center gap-1.5 text-[12px] text-muted-foreground no-underline hover:text-foreground">
          <ChevronLeft size={12} /> Dashboard
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="mb-1 text-2xl font-bold tracking-tight">Stored Credentials</h1>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Store API keys once. The proxy decrypts and injects them at call time — your agent never sees the raw value.
            </p>
          </div>
          <Button size="sm" onClick={() => { setShowForm(true); setError(''); setSuccess(''); }} className="shrink-0 gap-1.5">
            <Plus size={13} /> Add secret
          </Button>
        </div>
      </div>

      {/* How it works */}
      <div className="mb-6 grid grid-cols-3 gap-2.5">
        {[
          { n: '1', t: 'You store your API key — encrypted in Supabase Vault (AES-256-GCM)' },
          { n: '2', t: 'Agent calls any tool through the relay proxy' },
          { n: '3', t: 'Proxy resolves and injects key — agent never touches the value' },
        ].map(s => (
          <div key={s.n} className="rounded-xl border border-border bg-muted/30 p-3.5">
            <p className="mb-1 font-mono text-[10px] font-bold text-brand">{s.n}</p>
            <p className="text-[12px] leading-relaxed text-muted-foreground">{s.t}</p>
          </div>
        ))}
      </div>

      {/* Success banner */}
      {success && (
        <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-green-500/20 bg-green-500/10 px-4 py-3 text-[13px] text-green-400">
          <Shield size={14} className="shrink-0" />
          {success}
        </div>
      )}

      {/* Add form */}
      {showForm && (
        <div className="mb-6 rounded-xl border border-border bg-card p-6">
          <div className="mb-5 flex items-center justify-between">
            <h3 className="font-semibold text-foreground">Add a secret</h3>
            <button onClick={() => { setShowForm(false); resetForm(); }} className="text-muted-foreground hover:text-foreground">
              ✕
            </button>
          </div>

          {error && (
            <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-red-500/20 bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-400">
              <AlertCircle size={13} className="shrink-0" />
              {error}
            </div>
          )}

          <div className="space-y-4">
            {/* Server name */}
            <div className="space-y-1.5">
              <label className="text-[13px] font-semibold text-foreground">
                Server name <span className="font-normal text-muted-foreground">(optional — blank = global)</span>
              </label>
              <Input
                placeholder="e.g. stripe-payments"
                value={serverName}
                onChange={e => setServerName(e.target.value)}
                className="font-mono text-[13px]"
              />
              <p className="text-[11px] text-muted-foreground">
                Server-specific secrets take priority over global ones. Use the exact name from the registry.
              </p>
            </div>

            {/* Secret name */}
            <div className="space-y-1.5">
              <label className="text-[13px] font-semibold text-foreground">
                Secret name <span className="text-destructive">*</span>
              </label>
              <Input
                placeholder="e.g. STRIPE_API_KEY"
                value={secretName}
                onChange={e => setSecretName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
                className="font-mono text-[13px]"
              />
              <p className="text-[11px] text-muted-foreground">
                Uppercase letters, numbers, underscores only. The proxy matches by this name.
              </p>
            </div>

            {/* Known service hint */}
            {hint && (
              <div className="rounded-xl border border-brand/20 bg-brand-bg px-4 py-3.5">
                <p className="mb-1 text-[13px] font-semibold text-brand">{hint.label}</p>
                <p className="mb-2 text-[12px] text-muted-foreground">{hint.desc}</p>
                <a href={hint.url} target="_blank" rel="noopener"
                  className="inline-flex items-center gap-1 text-[12px] text-brand no-underline hover:underline">
                  Get your key from {new URL(hint.url).hostname}
                  <ExternalLink size={10} />
                </a>
              </div>
            )}

            {/* Secret value */}
            <div className="space-y-1.5">
              <label className="text-[13px] font-semibold text-foreground">
                Value <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <Input
                  type={showVal ? 'text' : 'password'}
                  placeholder="Paste your API key or token"
                  value={secretValue}
                  onChange={e => setSecretValue(e.target.value)}
                  className="pr-16 font-mono text-[13px]"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  onClick={() => setShowVal(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  {showVal ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Encrypted immediately. Never stored in plaintext. Never returned through the API after saving.
              </p>
            </div>

            {/* Note */}
            <div className="space-y-1.5">
              <label className="text-[13px] font-semibold text-foreground">
                Note <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Input
                placeholder="e.g. Production Stripe key"
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </div>

            <div className="flex gap-2.5 pt-1">
              <Button onClick={save} disabled={saving || !secretName || !secretValue}>
                {saving ? 'Storing…' : 'Store securely'}
              </Button>
              <Button variant="ghost" onClick={() => { setShowForm(false); resetForm(); }}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* Secrets list */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-brand" />
        </div>
      ) : secrets.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-muted/40">
            <Lock size={20} className="text-muted-foreground/50" />
          </div>
          <div>
            <p className="mb-1 font-semibold text-foreground">No secrets stored</p>
            <p className="max-w-xs text-[13px] text-muted-foreground">
              When a tool returns 401, the proxy response includes the exact name to use and a link back here.
            </p>
          </div>
          <Button size="sm" onClick={() => setShowForm(true)} className="gap-1.5">
            <Plus size={13} /> Add your first secret
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Header row */}
          <div className="grid grid-cols-[1fr_1.5fr_2fr_auto] gap-3 px-4 py-1">
            {['Server', 'Name', 'Note', ''].map(h => (
              <p key={h} className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">{h}</p>
            ))}
          </div>
          {secrets.map(s => (
            <div key={s.id} className="grid grid-cols-[1fr_1.5fr_2fr_auto] items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5">
              <code className="truncate font-mono text-[12px] text-muted-foreground">
                {s.server_name ?? <span className="italic text-muted-foreground/50">global</span>}
              </code>
              <code className="truncate font-mono text-[12px] font-semibold text-brand">{s.secret_name}</code>
              <p className="truncate text-[12px] text-muted-foreground">
                {s.description ?? <span className="italic text-muted-foreground/40">—</span>}
              </p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => remove(s.id, s.secret_name)}
                disabled={deleting === s.id}
                className="h-7 gap-1 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                {deleting === s.id ? '…' : <Trash2 size={12} />}
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Security note */}
      <div className="mt-8 rounded-xl border border-border bg-muted/30 p-4 text-[12px] leading-relaxed text-muted-foreground">
        <strong className="text-foreground">Encryption:</strong> Values are encrypted by Supabase Vault using pgsodium
        (libsodium AES-256-GCM). The encryption key is managed by Supabase KMS — never stored in the database.
        Even full database access cannot recover values without the KMS key. The proxy decrypts at call time
        and discards immediately after injecting the Authorization header.
      </div>
    </div>
  );
}