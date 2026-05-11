export type ServerQualityStatus =
  | 'discovery_only'
  | 'proxy_ready'
  | 'schema_ready'
  | 'verified'
  | 'suspended';

export type ServerTrustState =
  | 'preliminary'
  | 'measured'
  | 'degraded'
  | 'suspended';

export function deriveServerQualityStatus(server: {
  status?: string | null;
  endpoint?: string | null;
  transport?: string | null;
  proxy_available?: boolean | null;
  tools?: any[] | null;
  tool_schemas?: any[] | null;
  scan_status?: string | null;
}): ServerQualityStatus {
  if (server.status === 'suspended') return 'suspended';

  const isStdio = server.transport === 'stdio';
  const hasEndpoint = Boolean(server.endpoint);
  const hasTools = Array.isArray(server.tools) && server.tools.length > 0;
  const proxyAvailable = server.proxy_available ?? (!isStdio && hasEndpoint);
  const hasRichSchemas = Array.isArray(server.tool_schemas)
    && server.tool_schemas.some((t: any) => t?.inputSchema && Object.keys(t.inputSchema).length > 0);

  if (!proxyAvailable || !hasEndpoint || !hasTools) return 'discovery_only';
  if (hasRichSchemas && server.scan_status === 'passed') return 'verified';
  if (hasRichSchemas) return 'schema_ready';
  return 'proxy_ready';
}

export function deriveServerTrustState(server: {
  status?: string | null;
  scan_status?: string | null;
  uptime_pct?: number | null;
}): ServerTrustState {
  if (server.status === 'suspended') return 'suspended';
  if (server.scan_status === 'failed') return 'degraded';
  if (server.scan_status === 'passed') return 'measured';
  return 'preliminary';
}
