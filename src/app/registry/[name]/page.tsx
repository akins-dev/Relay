'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { ServerCard } from '@/components/registry/ServerCard';
import { PaginationControls } from '@/components/ui/pagination-controls';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import type { Server } from '@/types';
import { SITE_URL } from '@/lib/site';
import { BRAND }    from '@/lib/brand';
import { paginateItems } from '@/lib/pagination';

export default function ServerDetailPage() {
  const { name } = useParams<{ name: string }>();
  const { user } = useAuth();  // no token — Supabase uses cookies
  const [server,  setServer]  = useState<Server | null>(null);
  const [scans,   setScans]   = useState<any[]>([]);
  const [relatedServers, setRelatedServers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [starred, setStarred] = useState(false);
  const [tab, setTab] = useState<'overview'|'tools'|'resources'|'prompts'|'security'|'analytics'|'integrate'>('overview');
  const [copied,  setCopied]  = useState('');
  const [analytics,  setAnalytics]  = useState<any>(null);
  const [connected,  setConnected]  = useState<boolean | null>(null); // OAuth connection state
  const [connecting, setConnecting] = useState(false);
  const [listPages, setListPages] = useState({ tools: 1, resources: 1, prompts: 1, related: 1 });

  useEffect(() => {
    // Check OAuth connection status if user is logged in
    if (user) {
      fetch('/api/oauth/connections').then(r => r.json())
        .then(d => {
          const conn = (d.connections ?? []).find((c: any) => c.server_name === name);
          setConnected(!!conn);
        }).catch(() => {});
    }
  }, [user, name]);

  useEffect(() => {
    // cookies sent automatically — no Authorization header needed
    fetch(`/api/servers/${name}`)
      .then(r => r.json())
      .then(d => {
        setServer(d);
        setScans(d.scans || []);
        setRelatedServers(d.related_servers || []);
        setStarred(d.starred);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [name]);

  useEffect(() => {
    if (tab === 'analytics' && server && !analytics) {
      fetch(`/api/servers/${server.name}/analytics`)
        .then(r => r.json())
        .then(setAnalytics)
        .catch(() => {});
    }
  }, [tab, server, analytics]);

  async function startOAuth() {
    if (!user) { window.location.href = '/login'; return; }
    setConnecting(true);
    window.location.href = `/api/oauth/start?server=${name}&redirect=/registry/${name}`;
  }

  async function disconnectOAuth() {
    if (!confirm('Disconnect your account from this server?')) return;
    await fetch(`/api/oauth/connections?server=${name}`, { method: 'DELETE' });
    setConnected(false);
  }

  async function toggleStar() {
    if (!user || !server) return;
    const res = await fetch(`/api/servers/${server.name}/star`, { method: 'POST' }).then(r => r.json());
    setStarred(res.starred);
    setServer(s => s ? { ...s, stars: s.stars + (res.starred ? 1 : -1) } : s);
  }

  function copy(text: string, key: string) {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  }

  function setListPage(key: keyof typeof listPages, page: number) {
    setListPages((current) => ({ ...current, [key]: page }));
  }

  const resources: any[] = useMemo(() => (server as any)?.resources ?? [], [server]);
  const prompts:   any[] = useMemo(() => (server as any)?.prompts   ?? [], [server]);
  const toolSchemas: any[] = useMemo(() => {
    const raw = (server as any)?.tool_schemas;
    return Array.isArray(raw) ? raw.filter((tool: any) => tool?.name) : [];
  }, [server]);
  const toolSchemaByName = useMemo(() => {
    const map = new Map<string, any>();
    for (const tool of toolSchemas) map.set(tool.name, tool);
    return map;
  }, [toolSchemas]);
  
  const pagedTools = useMemo(() => paginateItems(server?.tools ?? [], listPages.tools, 12), [server?.tools, listPages.tools]);
  const pagedResources = useMemo(() => paginateItems(resources, listPages.resources, 8), [resources, listPages.resources]);
  const pagedPrompts = useMemo(() => paginateItems(prompts, listPages.prompts, 8), [prompts, listPages.prompts]);
  const pagedRelated = useMemo(() => paginateItems(relatedServers, listPages.related, 3), [relatedServers, listPages.related]);

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '80px' }}>
      <div className="anim-spin" style={{ width: '24px', height: '24px', border: '2px solid var(--border)', borderTopColor: 'var(--green)', borderRadius: '50%' }} />
    </div>
  );
  if (!server) return (
    <div className="page-sm" style={{ textAlign: 'center', paddingTop: '80px', color: 'var(--text-2)' }}>
      Server not found. <Link href="/registry" style={{ color: 'var(--green)' }}>Back to registry</Link>
    </div>
  );

  const trustColor = server.trust_score >= 90 ? 'var(--green)' : server.trust_score >= 65 ? 'var(--yellow)' : 'var(--red)';
  const authorName = (server as any).profiles?.username ?? (server as any).author_name ?? 'unknown';

  const rawTransport   = (server as any).transport ?? 'unknown';
  const isStdio        = rawTransport === 'stdio';
  const isSse          = rawTransport === 'sse';
  const isHttp         = rawTransport === 'streamable_http';
  const isUnknown      = !isStdio && !isSse && !isHttp;
  const proxyAvailable = (server as any).proxy_available
    ?? (!isStdio && Boolean((server as any).endpoint));
  const localOnly      = !proxyAvailable;
  const mcpCompliant   = (server as any).mcp_compliant ?? false;
  const protocolVer    = (server as any).protocol_version ?? null;
  const previewTools = server.tools.slice(0, 12);

  const transportLabel = isStdio ? 'stdio' : isSse ? 'sse' : isHttp ? 'http' : 'unknown';
  const transportColor = isStdio
    ? 'var(--yellow)'
    : isSse
      ? 'var(--blue)'
      : isHttp
        ? 'var(--green)'
        : 'var(--text-3)';
  const nonProxyTitle = isStdio
    ? `⬡ stdio Server — ${BRAND.cli} Coming Soon`
    : 'Transport Not Verified';
  const nonProxyDescription = isStdio
    ? `This server runs as a local subprocess (stdio transport). It cannot be called through the web proxy. ${BRAND.cli} will bridge stdio servers locally when it launches. For now, check the GitHub repo for installation instructions.`
    : 'This server is listed in the catalog, but Relay has not verified a proxyable remote transport for it yet. Check the upstream metadata or GitHub instructions before attempting invocation.';
  const nonProxyBadge = isStdio ? '⬡ stdio · CLI coming soon' : '⚠ transport unverified';
  const proxyLabel = proxyAvailable ? '✓ available' : isStdio ? '✗ CLI only' : '✗ unavailable';

  const promptSnippet = localOnly
    ? `# ${BRAND.cli} (coming soon)
# This server is currently not invocable through Relay Cloud Proxy.
# Transport: ${transportLabel}
# ${isStdio ? `When ${BRAND.cli} launches, you will be able to run:` : 'Check the upstream registry page or GitHub repo for installation and transport details.'}
${isStdio ? `#   ${BRAND.slug} run ${server.name}` : ''}
#
# For now, this server is discoverable but not invocable
# through the web proxy. ${server.github_url ? `Use the GitHub repo for setup: ${server.github_url}` : 'Use the upstream source metadata for setup.'}`
    : `## MCP Tools — ${server.display_name}

POST /api/proxy/${server.name}/{toolName}
Available tools: ${server.tools.join(', ')}

# Auto-discover via registry:
GET /.well-known/mcp.json`;

  const curlSnippet = localOnly
    ? `# ${BRAND.cli} is not yet available.
# This server is not invocable through Relay Cloud Proxy today.
# Transport: ${transportLabel}
${server.github_url ? `# GitHub: ${server.github_url}` : '# No GitHub URL available.'}`
    : `curl -X POST ${SITE_URL}/api/proxy/${server.name}/${server.tools[0] ?? 'tool_name'} \\
  -H "Authorization: Bearer sk_mcp_..." \\
  -H "Content-Type: application/json" \\
  -d '{"param": "value"}'`;

  return (
    <div className="page" style={{ maxWidth: '960px' }}>
      {/* Breadcrumb */}
      <div style={{ fontSize: '12px', color: 'var(--text-3)', marginBottom: '24px', fontFamily: 'var(--mono)', display: 'flex', gap: '8px' }}>
        <Link href="/registry" style={{ color: 'var(--text-3)', textDecoration: 'none' }}>registry</Link>
        <span>/</span>
        <span style={{ color: 'var(--text)' }}>{server.name}</span>
      </div>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: '28px', fontWeight: 800, letterSpacing: '-0.02em', fontFamily: 'var(--mono)' }}>{server.name}</h1>
            {server.verified && <span className="badge badge-green">✓ verified</span>}
            {/* Transport badge */}
            <span style={{ fontSize: '10px', fontFamily: 'var(--mono)', padding: '2px 8px', borderRadius: '4px', background: 'var(--bg-3)', border: `1px solid ${transportColor}`, color: transportColor }}>
              {transportLabel}
            </span>
            {/* MCP compliance */}
            {mcpCompliant && (
              <span style={{ fontSize: '10px', fontFamily: 'var(--mono)', padding: '2px 8px', borderRadius: '4px', background: 'var(--green-bg)', border: '1px solid #166534', color: 'var(--green)' }}>
                MCP {protocolVer ?? '2025'}
              </span>
            )}
            {/* Stdio warning */}
            {localOnly && (
              <span style={{ fontSize: '10px', fontFamily: 'var(--mono)', padding: '2px 8px', borderRadius: '4px', background: '#2b2000', border: '1px solid #713f12', color: 'var(--yellow)' }}>
                {nonProxyBadge}
              </span>
            )}
            <span style={{ fontSize: '12px', color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>v{server.version}</span>
          </div>
          <p style={{ color: 'var(--text-2)', fontSize: '15px', maxWidth: '540px', lineHeight: 1.6 }}>{server.description}</p>
          <div style={{ display: 'flex', gap: '6px', marginTop: '12px', flexWrap: 'wrap' }}>
            {server.tags.map(t => (
              <Link key={t} href={`/registry?tag=${t}`} style={{ textDecoration: 'none' }}>
                <span className="tag tag-default">{t}</span>
              </Link>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={toggleStar} className={`btn ${starred ? 'btn-primary' : 'btn-ghost'}`}>
            ★ {server.stars?.toLocaleString()}
          </button>
          {server.github_url && (
            <a href={server.github_url} target="_blank" rel="noopener" className="btn btn-ghost" style={{ textDecoration: 'none' }}>GitHub →</a>
          )}
          {/* Primary CTA — different for stdio vs HTTP */}
          {localOnly ? (
            server.github_url ? (
              <a href={server.github_url} target="_blank" rel="noopener" className="btn btn-primary" style={{ textDecoration: 'none', fontFamily: 'var(--mono)', fontSize: '12px' }}>
                ⬡ View on GitHub
              </a>
            ) : (
              <button className="btn btn-ghost" disabled style={{ fontFamily: 'var(--mono)', fontSize: '12px', opacity: 0.5 }}>
                ⬡ {BRAND.cli} coming soon
              </button>
            )
          ) : (
            <button onClick={() => setTab('integrate')} className="btn btn-primary">Integrate →</button>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: '1px', background: 'var(--border)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: '32px' }}>
        {[
          { label: 'Trust',   value: `${Math.round(server.trust_score)}`,                  unit: '/100', color: trustColor },
          { label: 'Latency', value: `${server.latency_ms ?? '—'}`,                        unit: 'ms' },
          { label: 'Uptime',  value: `${Number(server.uptime_pct)?.toFixed(2) ?? '—'}`,    unit: '%' },
          { label: 'Today',   value: `${((server.calls_today ?? 0) / 1000).toFixed(1)}`,   unit: 'K calls' },
          { label: 'Total',   value: `${((server.total_calls ?? 0) / 1000).toFixed(0)}`,   unit: 'K calls' },
        ].map(s => (
          <div key={s.label} style={{ background: 'var(--bg-1)', padding: '16px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: '22px', fontWeight: 800, fontFamily: 'var(--mono)', color: (s as any).color ?? 'var(--text)', letterSpacing: '-0.02em' }}>
              {s.value}<span style={{ fontSize: '12px', color: 'var(--text-3)', fontWeight: 400 }}>{s.unit}</span>
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '4px' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid var(--border)', marginBottom: '28px', display: 'flex', overflowX: 'auto' }}>
        {(['overview', 'tools',
          ...(resources.length > 0 ? ['resources'] : []),
          ...(prompts.length   > 0 ? ['prompts']   : []),
          'security', 'analytics', 'integrate',
        ] as const).map((t: any) => (
          <button key={t} onClick={() => setTab(t)} style={{ background: 'none', border: 'none', borderBottom: tab === t ? '2px solid var(--green)' : '2px solid transparent', color: tab === t ? 'var(--text)' : 'var(--text-3)', padding: '10px 18px', cursor: 'pointer', fontSize: '13px', fontFamily: 'var(--font)', fontWeight: tab === t ? 600 : 400, textTransform: 'capitalize', transition: 'color .15s', whiteSpace: 'nowrap' }}>
            {t}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 270px', gap: '20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {server.long_description && (
              <div className="card" style={{ padding: '22px' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>About</div>
                <p style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--text-2)' }}>{server.long_description}</p>
              </div>
            )}

            {/* Non-proxy callout */}
            {localOnly && (
              <div style={{ padding: '18px 20px', borderRadius: '8px', background: '#1a1500', border: '1px solid #713f12' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--yellow)', marginBottom: '8px' }}>{nonProxyTitle}</div>
                <p style={{ fontSize: '13px', color: 'var(--text-2)', lineHeight: 1.6, marginBottom: '12px' }}>
                  {nonProxyDescription}
                </p>
                {server.github_url && (
                  <a href={server.github_url} target="_blank" rel="noopener" style={{ fontFamily: 'var(--mono)', fontSize: '12px', background: 'var(--bg-3)', padding: '10px 14px', borderRadius: '6px', color: 'var(--green)', display: 'block', textDecoration: 'none' }}>
                    → {server.github_url}
                  </a>
                )}
              </div>
            )}

            <div className="card" style={{ padding: '22px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '14px' }}>Tools ({server.tools.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {previewTools.map(t => (
                  <div key={t} style={{ background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px 10px' }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--green)' }}>fn {t}()</div>
                    {toolSchemaByName.get(t)?.description && (
                      <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: '3px', lineHeight: 1.45 }}>
                        {toolSchemaByName.get(t).description}
                      </div>
                    )}
                  </div>
                ))}
                {server.tools.length === 0 && (
                  <span style={{ fontSize: '13px', color: 'var(--text-3)' }}>No tools discovered yet. This entry is discovery-incomplete until ingest can fetch Smithery detail, live probe it, or extract tools in the sandbox.</span>
                )}
              </div>
              {server.tools.length > previewTools.length && (
                <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: '12px' }}>
                  Showing the first {previewTools.length} tools here. Open the Tools tab for the full paginated list.
                </div>
              )}
            </div>

            {/* Resources preview */}
            {resources.length > 0 && (
              <div className="card" style={{ padding: '22px' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '14px' }}>Resources ({resources.length})</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {resources.slice(0, 5).map((r: any, i: number) => (
                    <div key={i} style={{ fontSize: '13px', fontFamily: 'var(--mono)', color: 'var(--blue)', padding: '6px 10px', background: 'var(--bg-2)', borderRadius: '4px', border: '1px solid var(--border)' }}>
                      {r.uri ?? r.name}
                      {r.description && <span style={{ color: 'var(--text-3)', fontSize: '11px', marginLeft: '10px', fontFamily: 'var(--font)' }}>{r.description}</span>}
                    </div>
                  ))}
                  {resources.length > 5 && <span style={{ fontSize: '12px', color: 'var(--text-3)' }}>+{resources.length - 5} more — see Resources tab</span>}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="card" style={{ padding: '18px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>Details</div>
              {[
                ['Author',    authorName],
                ['License',   server.license],
                ['Version',   server.version],
                ['Transport', transportLabel.toUpperCase()],
                ...(protocolVer ? [['Protocol', protocolVer]] : []),
                ['MCP',       mcpCompliant ? '✓ compliant' : localOnly ? '— not probed' : '✗ not compliant'],
                ['Resources', String(resources.length)],
                ['Prompts',   String(prompts.length)],
                ['Proxy',     proxyLabel],
              ].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: '12px' }}>
                  <span style={{ color: 'var(--text-3)' }}>{l}</span>
                  <span style={{ color: l === 'MCP' && !mcpCompliant && !localOnly ? 'var(--red)' : l === 'MCP' && mcpCompliant ? 'var(--green)' : l === 'Proxy' && !proxyAvailable ? 'var(--yellow)' : 'var(--text)' }}>{v}</span>
                </div>
              ))}
            </div>
            <div className="card" style={{ padding: '18px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>Scan</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: server.scan_status === 'passed' ? 'var(--green)' : 'var(--red)' }} />
                <span style={{ fontSize: '13px', fontFamily: 'var(--mono)', color: server.scan_status === 'passed' ? 'var(--green)' : 'var(--red)' }}>{server.scan_status}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tools */}
      {tab === 'tools' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {localOnly && (
            <div style={{ padding: '12px 16px', borderRadius: '8px', background: '#1a1500', border: '1px solid #713f12', fontSize: '13px', color: 'var(--yellow)', marginBottom: '8px' }}>
              {isStdio
                ? `⬡ stdio server — ${BRAND.cli} (coming soon) will enable local invocation of these tools`
                : '⚠ transport not verified — these tools are listed for discovery, not proxy invocation'}
            </div>
          )}
          {server.tools.length === 0 && (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-3)', fontSize: '14px' }}>
              No tools discovered yet. This server should not be considered callable until tool metadata is present.
            </div>
          )}
          {pagedTools.items.map(tool => {
            const schema = toolSchemaByName.get(tool);
            const inputSchema = schema?.inputSchema ?? schema?.input_schema ?? schema?.input_schema_json;
            return (
            <div key={tool} className="card" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                <div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '14px' }}>
                    <span style={{ color: 'var(--green)' }}>fn </span>{tool}()
                  </div>
                  {schema?.description && (
                    <div style={{ fontSize: '13px', color: 'var(--text-2)', marginTop: '5px', lineHeight: 1.5 }}>
                      {schema.description}
                    </div>
                  )}
                </div>
                {proxyAvailable ? (
                  <button onClick={() => copy(`POST /api/proxy/${server.name}/${tool}`, tool)} className="btn btn-ghost btn-sm" style={{ fontFamily: 'var(--mono)', fontSize: '11px', flexShrink: 0 }}>
                    {copied === tool ? '✓ copied' : 'copy endpoint'}
                  </button>
                ) : (
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--yellow)', flexShrink: 0 }}>
                    {isStdio ? '⬡ stdio only' : '⚠ not proxyable'}
                  </span>
                )}
              </div>
              {inputSchema && (
                <details>
                  <summary style={{ cursor: 'pointer', color: 'var(--blue)', fontFamily: 'var(--mono)', fontSize: '12px' }}>input schema</summary>
                  <pre style={{ marginTop: '8px', padding: '12px', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-2)', fontSize: '11px', lineHeight: 1.5, overflow: 'auto', maxHeight: '260px', whiteSpace: 'pre-wrap' }}>
                    {JSON.stringify(inputSchema, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          );})}
          <PaginationControls
            className="mt-4"
            page={pagedTools.page}
            pages={pagedTools.pages}
            from={pagedTools.from}
            to={pagedTools.to}
            total={pagedTools.total}
            pageSize={pagedTools.pageSize}
            onPageChange={(nextPage) => setListPage('tools', nextPage)}
          />
        </div>
      )}      {/* Resources tab */}
      {tab === 'resources' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {pagedResources.items.map((r: any, i: number) => (
            <div key={i} className="card" style={{ padding: '16px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                <div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '13px', color: 'var(--blue)', marginBottom: '4px' }}>{r.uri ?? r.name}</div>
                  {r.description && <div style={{ fontSize: '12px', color: 'var(--text-3)' }}>{r.description}</div>}
                  {r.mimeType  && <div style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '4px', fontFamily: 'var(--mono)' }}>{r.mimeType}</div>}
                </div>
                {r.uri && proxyAvailable && (
                  <button onClick={() => copy(r.uri, `res-${i}`)} className="btn btn-ghost btn-sm" style={{ fontFamily: 'var(--mono)', fontSize: '11px', flexShrink: 0 }}>
                    {copied === `res-${i}` ? '✓' : 'copy uri'}
                  </button>
                )}
              </div>
            </div>
          ))}
          <PaginationControls
            className="mt-4"
            page={pagedResources.page}
            pages={pagedResources.pages}
            from={pagedResources.from}
            to={pagedResources.to}
            total={pagedResources.total}
            pageSize={pagedResources.pageSize}
            onPageChange={(nextPage) => setListPage('resources', nextPage)}
          />
        </div>
      )}

      {/* Prompts tab */}
      {tab === 'prompts' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {pagedPrompts.items.map((p: any, i: number) => (
            <div key={i} className="card" style={{ padding: '16px 20px' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '14px', marginBottom: '6px' }}>
                <span style={{ color: 'var(--purple)' }}>prompt </span>{p.name}
              </div>
              {p.description && <div style={{ fontSize: '13px', color: 'var(--text-2)', marginBottom: '8px' }}>{p.description}</div>}
              {p.arguments?.length > 0 && (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {p.arguments.map((a: any) => (
                    <span key={a.name} style={{ fontSize: '11px', fontFamily: 'var(--mono)', padding: '2px 8px', background: 'var(--bg-3)', borderRadius: '4px', border: '1px solid var(--border)', color: a.required ? 'var(--text)' : 'var(--text-3)' }}>
                      {a.name}{a.required ? '' : '?'}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
          <PaginationControls
            className="mt-4"
            page={pagedPrompts.page}
            pages={pagedPrompts.pages}
            from={pagedPrompts.from}
            to={pagedPrompts.to}
            total={pagedPrompts.total}
            pageSize={pagedPrompts.pageSize}
            onPageChange={(nextPage) => setListPage('prompts', nextPage)}
          />
        </div>
      )}

      {/* Security */}
      {tab === 'security' && (
        <SecurityTab server={server} scans={scans} />
      )}


      {/* Analytics */}
      {tab === 'analytics' && (
        <AnalyticsTab analytics={analytics} />
      )}

      {/* Integrate */}
      {tab === 'integrate' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {localOnly && (
            <div style={{ padding: '18px 20px', borderRadius: '8px', background: '#1a1500', border: '1px solid #713f12' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--yellow)', marginBottom: '8px' }}>{nonProxyTitle}</div>
              <p style={{ fontSize: '13px', color: 'var(--text-2)', lineHeight: 1.6 }}>
                {nonProxyDescription}
              </p>
            </div>
          )}

          {[{
            title: localOnly ? (isStdio ? `${BRAND.cli} (coming soon)` : 'Manual Setup') : 'System Prompt / AGENTS.md',
            key:   'prompt',
            code:  promptSnippet,
            color: 'var(--text-2)',
          }, {
            title: localOnly ? 'Local Setup' : 'cURL',
            key:   'curl',
            code:  curlSnippet,
            color: 'var(--green)',
          }].map(({ title, key, code, color }) => (
            <div key={key} className="codeblock">
              <div className="codeblock-header">
                <span style={{ fontSize: '13px', fontWeight: 600 }}>{title}</span>
                <button onClick={() => copy(code, key)} className="btn btn-ghost btn-sm">{copied === key ? '✓ Copied' : 'Copy'}</button>
              </div>
              <pre style={{ color }}>{code}</pre>
            </div>
          ))}

            <div className="card" style={{ padding: '22px' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '14px' }}>
              {localOnly ? (isStdio ? 'CLI Reference' : 'Transport Reference') : 'Endpoint Reference'}
            </div>
            {localOnly ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ padding: '14px', background: 'var(--bg-2)', borderRadius: '6px', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '12px', color: 'var(--yellow)', marginBottom: '8px', fontWeight: 600 }}>
                    {isStdio ? `⬡ ${BRAND.cli} is not yet available` : '⚠ Cloud proxy unavailable'}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-3)', lineHeight: 1.5 }}>
                    {isStdio
                      ? <>When it launches, you&apos;ll be able to run: <code style={{ fontFamily: 'var(--mono)' }}>{BRAND.slug} run {server.name}</code></>
                      : 'Relay does not currently have verified transport metadata for this server. Check the upstream registry page or GitHub repo before invoking it.'}
                  </div>
                </div>
                {server.github_url && (
                  <a href={server.github_url} target="_blank" rel="noopener" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: 'var(--bg-2)', borderRadius: '6px', border: '1px solid var(--border)', textDecoration: 'none', color: 'var(--green)', fontFamily: 'var(--mono)', fontSize: '13px' }}>
                    → Run locally via GitHub
                  </a>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {pagedTools.items.map(t => (
                  <div key={t} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: 'var(--bg-2)', borderRadius: '6px', border: '1px solid var(--border)' }}>
                    <span style={{ fontSize: '10px', fontFamily: 'var(--mono)', color: '#000', background: 'var(--green)', padding: '2px 6px', borderRadius: '3px', fontWeight: 700 }}>POST</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '13px' }}>/api/proxy/{server.name}/{t}</span>
                  </div>
                ))}
                {resources.length > 0 && <div style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '4px' }}>Also: GET /api/proxy/{server.name}/resources | POST /api/proxy/{server.name}/prompts/&lt;name&gt;</div>}
              </div>
            )}
          </div>
        </div>
      )}

      {relatedServers.length > 0 && (
        <div style={{ marginTop: '12px' }}>
          <div style={{ marginBottom: '14px' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px', fontFamily: 'var(--mono)' }}>
              Continue Exploring
            </div>
            <div style={{ fontSize: '18px', fontWeight: 700 }}>Related servers</div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pagedRelated.items.map((item) => (
              <ServerCard key={item.id} server={item} />
            ))}
          </div>
          <PaginationControls
            className="mt-4"
            page={pagedRelated.page}
            pages={pagedRelated.pages}
            from={pagedRelated.from}
            to={pagedRelated.to}
            total={pagedRelated.total}
            pageSize={pagedRelated.pageSize}
            onPageChange={(nextPage) => setListPage('related', nextPage)}
          />
        </div>
      )}
    </div>
  );
}

// ── Analytics Tab ─────────────────────────────────────────────────────────────
function AnalyticsTab({ analytics }: { analytics: any }) {
  if (!analytics) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}>
      <div className="anim-spin" style={{ width: '24px', height: '24px', border: '2px solid var(--border)', borderTopColor: 'var(--green)', borderRadius: '50%' }} />
    </div>
  );

  const { summary, calls_time_series: series, top_tools, recent_scans } = analytics;

  const chartStyle = {
    background: 'transparent',
    fontSize: '11px',
    fontFamily: 'var(--mono)',
    fill: 'var(--text-3)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Summary cards */}
      <div className="grid-3" style={{ gap: '12px' }}>
        {[
          { label: 'Calls (30d)',   value: summary.total_calls.toLocaleString(), color: 'var(--green)' },
          { label: 'Error Rate',    value: `${summary.error_rate}%`,             color: summary.error_rate > 5 ? 'var(--red)' : 'var(--text)' },
          { label: 'DLP Triggers',  value: String(summary.total_dlp),            color: summary.total_dlp > 0 ? 'var(--orange)' : 'var(--text)' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '20px 24px' }}>
            <div style={{ fontSize: '28px', fontWeight: 800, fontFamily: 'var(--mono)', color: s.color, letterSpacing: '-0.02em' }}>{s.value}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '4px' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Call volume chart */}
      <div className="card" style={{ padding: '24px' }}>
        <div style={{ fontSize: '12px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '20px', fontFamily: 'var(--mono)' }}>
          Call Volume — Last 30 Days
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={series} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
            <defs>
              <linearGradient id="callGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="errGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" tick={chartStyle} tickFormatter={(v: string) => v.slice(5)} interval={6} />
            <YAxis tick={chartStyle} />
            <Tooltip
              contentStyle={{ background: '#0d0d0d', border: '1px solid #1f1f1f', borderRadius: '8px', fontSize: '12px', fontFamily: 'var(--mono)' }}
              labelStyle={{ color: '#a0a0a0' }}
            />
            <Area type="monotone" dataKey="calls"  stroke="#22c55e" fill="url(#callGradient)" strokeWidth={1.5} name="Calls"  dot={false} />
            <Area type="monotone" dataKey="errors" stroke="#ef4444" fill="url(#errGradient)"  strokeWidth={1.5} name="Errors" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Latency chart */}
      <div className="card" style={{ padding: '24px' }}>
        <div style={{ fontSize: '12px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '20px', fontFamily: 'var(--mono)' }}>
          Avg Latency (ms) — Last 30 Days
        </div>
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={series.filter((d: any) => d.latency !== null)} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
            <defs>
              <linearGradient id="latGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" tick={chartStyle} tickFormatter={(v: string) => v.slice(5)} interval={6} />
            <YAxis tick={chartStyle} />
            <Tooltip
              contentStyle={{ background: '#0d0d0d', border: '1px solid #1f1f1f', borderRadius: '8px', fontSize: '12px', fontFamily: 'var(--mono)' }}
            />
            <Area type="monotone" dataKey="latency" stroke="#3b82f6" fill="url(#latGradient)" strokeWidth={1.5} name="ms" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid-2" style={{ gap: '12px' }}>
        {/* Top tools */}
        <div className="card" style={{ padding: '24px' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '16px', fontFamily: 'var(--mono)' }}>
            Top Tools
          </div>
          {top_tools.length === 0
            ? <div style={{ color: 'var(--text-3)', fontSize: '13px' }}>No call data yet</div>
            : <ResponsiveContainer width="100%" height={160}>
                <BarChart data={top_tools} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 10 }}>
                  <XAxis type="number" tick={chartStyle} />
                  <YAxis type="category" dataKey="tool" tick={chartStyle} width={120} />
                  <Tooltip contentStyle={{ background: '#0d0d0d', border: '1px solid #1f1f1f', borderRadius: '8px', fontSize: '12px' }} />
                  <Bar dataKey="calls" fill="#22c55e" radius={[0, 3, 3, 0]} name="Calls" />
                </BarChart>
              </ResponsiveContainer>
          }
        </div>

        {/* DLP events */}
        <div className="card" style={{ padding: '24px' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '16px', fontFamily: 'var(--mono)' }}>
            DLP Events (30d)
          </div>
          {series.filter((d: any) => d.dlp > 0).length === 0
            ? <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '16px 0' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--green)' }} />
                <span style={{ fontSize: '13px', color: 'var(--text-2)' }}>No DLP events detected</span>
              </div>
            : <ResponsiveContainer width="100%" height={160}>
                <BarChart data={series.filter((d: any) => d.dlp > 0)} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                  <XAxis dataKey="date" tick={chartStyle} tickFormatter={(v: string) => v.slice(5)} />
                  <YAxis tick={chartStyle} />
                  <Tooltip contentStyle={{ background: '#0d0d0d', border: '1px solid #1f1f1f', borderRadius: '8px', fontSize: '12px' }} />
                  <Bar dataKey="dlp" fill="#f97316" radius={[3, 3, 0, 0]} name="DLP triggers" />
                </BarChart>
              </ResponsiveContainer>
          }
        </div>
      </div>

      {/* Recent scan history */}
      {recent_scans.length > 0 && (
        <div className="card" style={{ padding: '24px' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '14px', fontFamily: 'var(--mono)' }}>
            Recent Scans
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {recent_scans.map((scan: any, i: number) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--bg-2)', borderRadius: '6px' }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text-3)' }}>{scan.scan_type}</span>
                  <span className={`badge ${scan.passed ? 'badge-green' : 'badge-red'}`}>{scan.passed ? 'passed' : 'failed'}</span>
                  {scan.score != null && <span style={{ fontSize: '11px', color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>{scan.score}/100</span>}
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>
                  {new Date(scan.created_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Security Breakdown Tab ────────────────────────────────────────────────────
const SECURITY_LAYERS = [
  { id: 'L1',  title: 'Static Scan',          desc: 'Prompt injection, exfiltration, deceptive language, suspicious tool names',  phase: 'publish' },
  { id: 'L2',  title: 'WASM Sandbox',         desc: 'Sandboxed pre-listing execution — runtime-only payloads, deferred attacks',   phase: 'publish', roadmap: true },
  { id: 'L3',  title: 'Schema Pinning',       desc: 'SHA-256 tool hash at publish. Auto-suspend on any mutation.',                 phase: 'publish' },
  { id: 'L4',  title: 'Proxy DLP',            desc: 'Credential patterns blocked in requests; response matches surfaced as warnings and audit events', phase: 'runtime' },
  { id: 'L5',  title: 'Trust Score',          desc: 'Composite 0–100: scan + uptime + stability + community',                     phase: 'runtime' },
  { id: 'L6',  title: 'Database RLS',         desc: 'Supabase Row Level Security on all tables',                                  phase: 'infra'   },
  { id: 'L7',  title: 'OAuth Flow Security',  desc: 'Validated redirects, state checks, encrypted token storage, and route-level rate limits', phase: 'infra'   },
  { id: 'L8',  title: 'Typosquatting',        desc: 'pg_trgm similarity check blocks impersonation names at publish',              phase: 'publish' },
  { id: 'L9',  title: 'Sampling Inspect',     desc: 'Injection patterns in MCP server-initiated sampling requests',                phase: 'runtime' },
  { id: 'L10', title: 'PII Detection',        desc: 'Email, phone, SSN, card numbers scanned in proxy responses with warning metadata', phase: 'runtime' },
  { id: 'L11', title: 'URL Elicitation',      desc: 'javascript:, data:, file://, localhost, AWS metadata SSRF blocked',          phase: 'runtime' },
  { id: 'L12', title: 'Context Isolation',    desc: 'Session tokens and auth values detected in proxy responses',                  phase: 'runtime' },
  { id: 'S12', title: 'Shell Injection',      desc: '18 OS command patterns blocked in tool arguments',                           phase: 'runtime' },
  { id: 'S13', title: 'Indirect Injection',   desc: 'Instruction-like language in tool response data',                            phase: 'runtime' },
  { id: 'S14', title: 'CVE Scan',             desc: 'npm package.json checked against npm advisory database',                     phase: 'publish' },
];

const PHASE_LABEL: Record<string, string> = {
  publish: 'Publish-time',
  runtime: 'Runtime proxy',
  infra:   'Infrastructure',
};
const PHASE_COLOR: Record<string, string> = {
  publish: 'var(--purple)',
  runtime: 'var(--blue)',
  infra:   'var(--text-3)',
};

function SecurityTab({ server, scans }: { server: any; scans: any[] }) {
  const issues: any[] = [
    ...(server.scan_issues ?? []),
    ...(server.cve_issues  ?? []),
    ...(server.shell_issues ?? []),
  ];

  const issueTypes = new Set(issues.map((i: any) => i.type));

  function layerStatus(layer: typeof SECURITY_LAYERS[0]) {
    if (layer.roadmap) return 'roadmap';
    // Infra layers are always active (they protect the registry itself)
    if (layer.phase === 'infra') return 'pass';
    // L3 — check schema_hash exists
    if (layer.id === 'L3') return server.schema_hash ? 'pass' : 'warn';
    // S14 — check cve_scan_at
    if (layer.id === 'S14') {
      if (!server.cve_scan_at) return 'skipped';
      return (server.cve_issues?.length ?? 0) === 0 ? 'pass' : 'fail';
    }
    // L1 — check scan_status
    if (layer.id === 'L1') return server.scan_status === 'passed' ? 'pass' : 'fail';
    // S12/S13 — check shell_issues
    if (layer.id === 'S12' || layer.id === 'S13') {
      return (server.shell_issues?.length ?? 0) === 0 ? 'pass' : 'fail';
    }
    // Runtime layers pass by default (they run on every call regardless)
    return 'pass';
  }

  const statusConfig = {
    pass:    { label: '✓ pass',    color: 'var(--green)',  bg: 'var(--green-bg)',  border: '#166534' },
    fail:    { label: '✕ fail',    color: 'var(--red)',    bg: 'var(--red-bg)',    border: '#7f1d1d' },
    warn:    { label: '⚠ warn',    color: 'var(--yellow)', bg: '#2b2000',          border: '#713f12' },
    skipped: { label: '— skip',    color: 'var(--text-3)', bg: 'var(--bg-3)',      border: 'var(--border)' },
    roadmap: { label: '◯ roadmap', color: 'var(--text-3)', bg: 'var(--bg-3)',      border: 'var(--border)' },
  };

  const passed  = SECURITY_LAYERS.filter(l => layerStatus(l) === 'pass').length;
  const total   = SECURITY_LAYERS.filter(l => !l.roadmap).length;
  const pct     = Math.round((passed / total) * 100);
  const pctColor = pct >= 90 ? 'var(--green)' : pct >= 70 ? 'var(--yellow)' : 'var(--red)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Score header */}
      <div className="card" style={{ padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px', fontFamily: 'var(--mono)' }}>
            Security Coverage
          </div>
          <div style={{ fontSize: '40px', fontWeight: 800, fontFamily: 'var(--mono)', color: pctColor, letterSpacing: '-0.03em' }}>
            {pct}<span style={{ fontSize: '18px', color: 'var(--text-3)' }}>%</span>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: '4px' }}>{passed}/{total} layers passed</div>
        </div>
        {/* Progress bar */}
        <div style={{ flex: 1, minWidth: '200px', maxWidth: '400px' }}>
          <div style={{ height: '6px', background: 'var(--bg-3)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: pctColor, borderRadius: '3px', transition: 'width .5s ease' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '10px', color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>
            <span>0%</span><span>50%</span><span>100%</span>
          </div>
        </div>
      </div>

      {/* Layer grid */}
      {(['publish', 'runtime', 'infra'] as const).map(phase => (
        <div key={phase}>
          <div style={{ fontSize: '11px', color: PHASE_COLOR[phase], textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--mono)', marginBottom: '10px', fontWeight: 700 }}>
            {PHASE_LABEL[phase]}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {SECURITY_LAYERS.filter(l => l.phase === phase).map(layer => {
              const status = layerStatus(layer);
              const sc = statusConfig[status];
              return (
                <div key={layer.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', background: 'var(--bg-2)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-3)', width: '28px', flexShrink: 0 }}>{layer.id}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '2px' }}>{layer.title}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-3)' }}>{layer.desc}</div>
                  </div>
                  <span style={{
                    fontSize: '10px', fontFamily: 'var(--mono)', padding: '2px 8px',
                    borderRadius: '4px', border: `1px solid ${sc.border}`,
                    background: sc.bg, color: sc.color, flexShrink: 0,
                  }}>
                    {sc.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Issues */}
      {issues.length > 0 && (
        <div>
          <div style={{ fontSize: '11px', color: 'var(--red)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--mono)', marginBottom: '10px', fontWeight: 700 }}>
            Issues Found
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {issues.map((issue: any, i: number) => (
              <div key={i} style={{ padding: '10px 14px', borderRadius: '6px', fontSize: '12px', background: issue.severity === 'critical' ? 'var(--red-bg)' : 'var(--orange-bg)', border: `1px solid ${issue.severity === 'critical' ? '#7f1d1d' : '#7c2d12'}`, display: 'flex', gap: '10px' }}>
                <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: '10px', textTransform: 'uppercase', color: issue.severity === 'critical' ? 'var(--red)' : 'var(--orange)', flexShrink: 0 }}>{issue.severity}</span>
                <span style={{ color: 'var(--text-2)' }}>{issue.description ?? issue.cve ?? 'Issue detected'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Scan history */}
      {scans.length > 0 && (
        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--mono)', marginBottom: '10px' }}>
            Scan History
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {scans.map((scan, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--bg-2)', borderRadius: '6px' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text-3)' }}>{scan.scan_type}</span>
                  <span className={`badge ${scan.passed ? 'badge-green' : 'badge-red'}`}>{scan.passed ? 'passed' : 'failed'}</span>
                  {scan.score != null && <span style={{ fontSize: '11px', color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>{scan.score}/100</span>}
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>
                  {new Date(scan.created_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
