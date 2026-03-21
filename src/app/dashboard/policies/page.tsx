'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

const PERMISSION_GROUPS = [
  {
    id: 'read',
    label: 'Read',
    icon: '👁',
    description: 'View, list, get, search, fetch, describe operations',
    patterns: ['read_*','get_*','list_*','search_*','fetch_*','find_*','query_*','describe_*','show_*'],
    default: 'allow' as const,
    safe: true,
  },
  {
    id: 'create',
    label: 'Create',
    icon: '✚',
    description: 'Create, add, insert, upload, generate new items',
    patterns: ['create_*','add_*','insert_*','upload_*','new_*','make_*','generate_*','build_*'],
    default: 'allow' as const,
    safe: true,
  },
  {
    id: 'update',
    label: 'Update',
    icon: '✎',
    description: 'Update, edit, patch, modify, rename existing items',
    patterns: ['update_*','edit_*','patch_*','modify_*','set_*','change_*','rename_*','move_*'],
    default: 'confirm' as const,
    safe: false,
  },
  {
    id: 'delete',
    label: 'Delete',
    icon: '✕',
    description: 'Delete, remove, destroy, drop, purge, wipe, truncate',
    patterns: ['delete_*','remove_*','destroy_*','drop_*','purge_*','wipe_*','truncate_*','clear_*','reset_*'],
    default: 'block' as const,
    safe: false,
  },
  {
    id: 'send',
    label: 'Send / Publish',
    icon: '📤',
    description: 'Send messages, emails, notifications, publish posts',
    patterns: ['send_*','publish_*','post_*','notify_*','broadcast_*','email_*','message_*'],
    default: 'confirm' as const,
    safe: false,
  },
  {
    id: 'execute',
    label: 'Execute / Deploy',
    icon: '▶',
    description: 'Execute code, run scripts, deploy, trigger pipelines',
    patterns: ['execute_*','run_*','deploy_*','trigger_*','launch_*','start_*','apply_*'],
    default: 'confirm' as const,
    safe: false,
  },
  {
    id: 'git',
    label: 'Merge / Push',
    icon: '⇡',
    description: 'Push code, merge branches, approve pull requests, force operations',
    patterns: ['push_*','merge_*','approve_*','commit_*','force_*','rebase_*'],
    default: 'confirm' as const,
    safe: false,
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: '⚙',
    description: 'Admin operations, permission changes, user management, format',
    patterns: ['admin_*','grant_*','revoke_*','ban_*','terminate_*','format_*','invite_*','kick_*'],
    default: 'block' as const,
    safe: false,
  },
];

type Action = 'allow' | 'confirm' | 'block';

const ACTIONS: Record<Action, { label: string; desc: string; color: string; bg: string; border: string }> = {
  allow:   { label: 'Allow',   desc: 'Agent calls freely',         color: '#15803d', bg: '#f0fdf4', border: '#bbf7d0' },
  confirm: { label: 'Confirm', desc: 'Agent must pause, ask you',  color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
  block:   { label: 'Block',   desc: 'Call rejected immediately',  color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
};

export default function PoliciesPage() {
  const supabase = createClient();
  const [settings, setSettings] = useState<Record<string, Action>>(() => {
    const d: Record<string, Action> = {};
    PERMISSION_GROUPS.forEach(g => { d[g.id] = g.default; });
    return d;
  });
  const [userId,  setUserId]  = useState<string | null>(null);
  const [saving,  setSaving]  = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved,   setSaved]   = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { setLoading(false); return; }
      setUserId(user.id);
      supabase.from('tool_policies').select('*').eq('user_id', user.id).is('server_name', null)
        .then(({ data }) => {
          if (data?.length) {
            const loaded: Record<string, Action> = {};
            data.forEach((row: any) => {
              PERMISSION_GROUPS.forEach(g => {
                if (g.patterns.includes(row.tool_pattern)) loaded[g.id] = row.action;
              });
            });
            setSettings(prev => ({ ...prev, ...loaded }));
          }
          setLoading(false);
        });
    });
  }, []);

  async function save(groupId: string, action: Action) {
    if (!userId) return;
    setSaving(groupId);
    const group = PERMISSION_GROUPS.find(g => g.id === groupId)!;

    await supabase.from('tool_policies').delete()
      .eq('user_id', userId).in('tool_pattern', group.patterns).is('server_name', null);

    if (action !== 'allow') {
      await supabase.from('tool_policies').insert(
        group.patterns.map(p => ({
          user_id: userId, server_name: null, tool_pattern: p, action,
          reason: `${group.label}: ${action}`,
        }))
      );
    }

    setSettings(prev => ({ ...prev, [groupId]: action }));
    setSaving(null);
    setSaved(groupId);
    setTimeout(() => setSaved(null), 1500);
  }

  if (!userId && !loading) return (
    <div style={{ textAlign: 'center', padding: '80px 24px' }}>
      <p style={{ color: 'var(--text-2)', marginBottom: '20px' }}>
        Sign in to manage your agent permissions.
      </p>
      <Link href="/login" className="btn btn-primary">Sign in</Link>
    </div>
  );

  return (
    <div className="page-sm" style={{ paddingTop: '48px', paddingBottom: '80px' }}>

      <div style={{ marginBottom: '40px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <Link href="/dashboard" style={{ fontSize: '13px', color: 'var(--text-3)', textDecoration: 'none' }}>Dashboard</Link>
          <span style={{ color: 'var(--text-3)' }}>→</span>
          <span style={{ fontSize: '13px', color: 'var(--text-2)' }}>Permissions</span>
        </div>
        <h1 style={{ fontSize: '26px', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '10px', fontFamily: 'var(--font-serif)' }}>
          Agent Permissions
        </h1>
        <p style={{ color: 'var(--text-2)', fontSize: '15px', lineHeight: 1.7, maxWidth: '520px' }}>
          Control what operations your agents can perform through openMCP.
          These apply globally across all MCP servers.
        </p>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '28px' }}>
        {Object.entries(ACTIONS).map(([action, s]) => (
          <div key={action} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: s.color }} />
            <span style={{ color: s.color, fontWeight: 600 }}>{s.label}</span>
            <span style={{ color: 'var(--text-3)' }}>— {s.desc}</span>
          </div>
        ))}
      </div>

      {/* Groups */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {PERMISSION_GROUPS.map(group => {
          const current = settings[group.id] ?? group.default;
          const isSaved = saved === group.id;
          return (
            <div key={group.id} style={{
              display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap',
              padding: '14px 18px',
              background: 'var(--surface)',
              border: `1px solid ${ACTIONS[current].border}`,
              borderRadius: '10px',
              transition: 'border-color .2s',
            }}>
              {/* Info */}
              <div style={{ flex: 1, minWidth: '200px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                  <span style={{ fontSize: '15px' }}>{group.icon}</span>
                  <span style={{ fontSize: '14px', fontWeight: 600 }}>{group.label}</span>
                  {isSaved && <span style={{ fontSize: '11px', color: '#15803d', fontFamily: 'var(--mono)' }}>✓ saved</span>}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-3)' }}>{group.description}</div>
              </div>

              {/* Toggle */}
              <div style={{ display: 'flex', gap: '4px' }}>
                {(['allow', 'confirm', 'block'] as Action[]).map(action => {
                  const ac = ACTIONS[action];
                  const active = current === action;
                  return (
                    <button
                      key={action}
                      onClick={() => save(group.id, action)}
                      disabled={saving === group.id}
                      style={{
                        padding: '6px 14px', borderRadius: '6px', fontSize: '12px',
                        fontWeight: active ? 600 : 400, cursor: 'pointer',
                        border: `1px solid ${active ? ac.border : 'var(--border)'}`,
                        background: active ? ac.bg : 'transparent',
                        color: active ? ac.color : 'var(--text-3)',
                        transition: 'all .15s',
                        opacity: saving === group.id ? .5 : 1,
                      }}
                    >
                      {saving === group.id && active ? '...' : ac.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Note */}
      <div style={{ marginTop: '24px', padding: '14px 18px', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: '10px', fontSize: '13px', color: 'var(--text-3)', lineHeight: 1.7 }}>
        Policies apply to authenticated API key calls only. openMCP's built-in security
        stack (shell injection detection, DLP, schema pinning) always runs regardless of
        these settings. The defaults shown are the recommended starting point — safe for
        most agent workflows.
      </div>
    </div>
  );
}
