'use client';
import { useEffect, useState } from 'react';
import Link           from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button }     from '@/components/ui/button';
import { cn }         from '@/lib/cn';
import { ChevronLeft, Check, Loader2 } from 'lucide-react';

const PERMISSION_GROUPS = [
  { id: 'read',    label: 'Read',           icon: '👁',  desc: 'View, list, get, search, fetch, describe operations',          patterns: ['read_*','get_*','list_*','search_*','fetch_*','find_*','query_*','describe_*','show_*'],                          default: 'allow'   as const, safe: true  },
  { id: 'create',  label: 'Create',         icon: '✚',  desc: 'Create, add, insert, upload, generate new items',             patterns: ['create_*','add_*','insert_*','upload_*','new_*','make_*','generate_*','build_*'],                               default: 'allow'   as const, safe: true  },
  { id: 'update',  label: 'Update',         icon: '✎',  desc: 'Update, edit, patch, modify, rename existing items',          patterns: ['update_*','edit_*','patch_*','modify_*','set_*','change_*','rename_*','move_*'],                               default: 'confirm' as const, safe: false },
  { id: 'delete',  label: 'Delete',         icon: '✕',  desc: 'Delete, remove, destroy, drop, purge, wipe, truncate',        patterns: ['delete_*','remove_*','destroy_*','drop_*','purge_*','wipe_*','truncate_*','clear_*','reset_*'],                  default: 'block'   as const, safe: false },
  { id: 'send',    label: 'Send / Publish', icon: '📤', desc: 'Send messages, emails, notifications, publish posts',         patterns: ['send_*','publish_*','post_*','notify_*','broadcast_*','email_*','message_*'],                                   default: 'confirm' as const, safe: false },
  { id: 'execute', label: 'Execute / Run',  icon: '▶',  desc: 'Execute code, run scripts, deploy, trigger pipelines',        patterns: ['execute_*','run_*','deploy_*','trigger_*','launch_*','start_*','apply_*'],                                       default: 'confirm' as const, safe: false },
  { id: 'git',     label: 'Merge / Push',   icon: '⇡',  desc: 'Push code, merge branches, approve pull requests',           patterns: ['push_*','merge_*','approve_*','commit_*','force_*','rebase_*'],                                                  default: 'confirm' as const, safe: false },
  { id: 'admin',   label: 'Admin',          icon: '⚙',  desc: 'Admin operations, permission changes, user management',      patterns: ['admin_*','grant_*','revoke_*','ban_*','terminate_*','format_*','invite_*','kick_*'],                              default: 'block'   as const, safe: false },
];

type Action = 'allow' | 'confirm' | 'block';

const ACTIONS: Record<Action, { label: string; desc: string; activeClass: string; dotColor: string }> = {
  allow:   { label: 'Allow',   desc: 'Agent calls freely',        activeClass: 'border-green-200 bg-green-50 text-green-700',   dotColor: 'bg-green-500'  },
  confirm: { label: 'Confirm', desc: 'Agent pauses, asks you',    activeClass: 'border-amber-200 bg-amber-50 text-amber-700',   dotColor: 'bg-amber-400'  },
  block:   { label: 'Block',   desc: 'Call rejected immediately',  activeClass: 'border-red-200 bg-red-50 text-red-700',         dotColor: 'bg-red-500'    },
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

    // Delete existing policies for this group, then insert new ones if not default
    await supabase.from('tool_policies')
      .delete()
      .eq('user_id', userId)
      .in('tool_pattern', group.patterns)
      .is('server_name', null);

    if (action !== 'allow') {
      await supabase.from('tool_policies').insert(
        group.patterns.map(p => ({
          user_id: userId, server_name: null, tool_pattern: p,
          action, reason: `${group.label}: ${action}`,
        }))
      );
    }

    setSettings(prev => ({ ...prev, [groupId]: action }));
    setSaving(null);
    setSaved(groupId);
    setTimeout(() => setSaved(null), 2000);
  }

  async function resetAll() {
    if (!userId || !confirm('Reset all policies to defaults?')) return;
    await supabase.from('tool_policies').delete().eq('user_id', userId).is('server_name', null);
    const d: Record<string, Action> = {};
    PERMISSION_GROUPS.forEach(g => { d[g.id] = g.default; });
    setSettings(d);
  }

  if (!userId && !loading) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <p className="text-muted-foreground">Sign in to manage agent permissions.</p>
        <Link href="/login"><Button>Sign in</Button></Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10 pb-16 sm:px-8">

      {/* Header */}
      <div className="mb-8">
        <Link href="/dashboard" className="mb-3 inline-flex items-center gap-1.5 text-[12px] text-muted-foreground no-underline hover:text-foreground">
          <ChevronLeft size={12} /> Dashboard
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="mb-1 text-2xl font-bold tracking-tight">Agent Permissions</h1>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Control what operations your agents can perform through openMCP. Applied globally across all MCP servers.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={resetAll}>Reset defaults</Button>
        </div>
      </div>

      {/* Legend */}
      <div className="mb-6 flex flex-wrap gap-4">
        {(Object.entries(ACTIONS) as [Action, typeof ACTIONS[Action]][]).map(([action, s]) => (
          <div key={action} className="flex items-center gap-2 text-[12px]">
            <div className={cn('h-2 w-2 rounded-full', s.dotColor)} />
            <span className="font-semibold text-foreground">{s.label}</span>
            <span className="text-muted-foreground">— {s.desc}</span>
          </div>
        ))}
      </div>

      {/* Policy groups */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-brand" />
        </div>
      ) : (
        <div className="space-y-2">
          {PERMISSION_GROUPS.map(group => {
            const current = settings[group.id] ?? group.default;
            const isSaving = saving === group.id;
            const isSaved  = saved  === group.id;

            return (
              <div
                key={group.id}
                className={cn(
                  'flex flex-wrap items-center gap-4 rounded-xl border px-5 py-4 transition-colors',
                  current === 'allow'   && 'border-green-200/60 bg-green-50/30',
                  current === 'confirm' && 'border-amber-200/60 bg-amber-50/30',
                  current === 'block'   && 'border-red-200/60 bg-red-50/30',
                )}
              >
                {/* Group info */}
                <div className="flex min-w-[200px] flex-1 items-start gap-3">
                  <span className="mt-0.5 text-base" aria-hidden>{group.icon}</span>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-[14px] font-semibold text-foreground">{group.label}</p>
                      {!group.safe && (
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-muted-foreground">
                          sensitive
                        </span>
                      )}
                      {isSaved && (
                        <span className="flex items-center gap-0.5 text-[11px] font-medium text-green-700">
                          <Check size={11} /> saved
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-muted-foreground">{group.desc}</p>
                  </div>
                </div>

                {/* Action toggle */}
                <div className="flex gap-1.5">
                  {(['allow', 'confirm', 'block'] as Action[]).map(action => {
                    const a = ACTIONS[action];
                    const isActive = current === action;
                    return (
                      <button
                        key={action}
                        onClick={() => !isSaving && save(group.id, action)}
                        disabled={isSaving}
                        className={cn(
                          'flex min-w-[68px] items-center justify-center rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-all',
                          isActive
                            ? a.activeClass
                            : 'border-border bg-transparent text-muted-foreground hover:border-border/80 hover:text-foreground',
                          isSaving && 'opacity-50'
                        )}
                      >
                        {isSaving && isActive
                          ? <Loader2 size={12} className="animate-spin" />
                          : a.label
                        }
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footnote */}
      <div className="mt-6 rounded-xl border border-border bg-muted/30 p-4 text-[12px] leading-relaxed text-muted-foreground">
        <strong className="text-foreground">Note:</strong> Policies apply to authenticated API key calls only.
        The built-in security stack (shell injection, DLP, schema pinning) always runs regardless of these settings.
        Defaults shown are the recommended starting point for most agent workflows.
      </div>
    </div>
  );
}