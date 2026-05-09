import { BRAND } from '@/lib/brand';

type EnvVarLike = {
  name?: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  defaultValue?: string;
  format?: string;
  placeholder?: string;
};

type PackageLike = {
  registryType?: string;
  identifier?: string;
  version?: string;
  runtimeHint?: string;
  transport?: string;
};

export interface RelayManifestServer {
  name: string;
  transport?: string | null;
  endpoint?: string | null;
  package_info?: PackageLike[] | null;
  env_var_schema?: EnvVarLike[] | null;
}

function normalizeEnv(env?: EnvVarLike[] | null) {
  return (Array.isArray(env) ? env : [])
    .filter(v => typeof v?.name === 'string' && v.name.length > 0)
    .map(v => ({
      name: v.name!,
      description: v.description ?? null,
      required: v.isRequired === true,
      secret: v.isSecret === true,
      format: v.format ?? 'string',
      default: v.defaultValue ?? null,
      placeholder: v.placeholder ?? null,
    }));
}

function commandForPackage(pkg: PackageLike) {
  const runtime = pkg.runtimeHint || (
    pkg.registryType === 'npm' ? 'npx'
      : pkg.registryType === 'pypi' ? 'uvx'
        : pkg.registryType === 'nuget' ? 'dnx'
          : pkg.registryType === 'oci' ? 'docker'
            : null
  );
  const identifier = pkg.version ? `${pkg.identifier}@${pkg.version}` : pkg.identifier;

  if (!runtime || !identifier) return null;
  if (runtime === 'docker') return ['docker', 'run', '--rm', identifier];
  if (runtime === 'npx') return [runtime, '-y', identifier];
  return [runtime, identifier];
}

export function buildRelayManifest(server: RelayManifestServer) {
  const packages = Array.isArray(server.package_info) ? server.package_info : [];
  const stdioPackage = packages.find(pkg => pkg.transport === 'stdio' && pkg.identifier)
    ?? packages.find(pkg => pkg.identifier);
  const localCommand = stdioPackage ? commandForPackage(stdioPackage) : null;
  const hasRemote = Boolean(server.endpoint) && server.transport !== 'stdio';
  const env = normalizeEnv(server.env_var_schema);

  const runMode = localCommand
    ? 'local_stdio'
    : hasRemote
      ? 'remote_mcp'
      : 'discovery_only';

  return {
    run_mode: runMode,
    runnable: runMode !== 'discovery_only',
    transport: server.transport ?? 'unknown',
    cli: {
      command: `${BRAND.slug} invoke ${server.name} <tool_name>`,
      note: localCommand
        ? `${BRAND.cli} can launch this server locally from its package manifest.`
        : hasRemote
          ? `${BRAND.cli} can connect to this remote MCP endpoint locally.`
          : 'Relay has discovery metadata for this server, but no runnable connection manifest yet.',
    },
    launch: localCommand ? {
      type: 'stdio',
      package: stdioPackage?.identifier ?? null,
      registry: stdioPackage?.registryType ?? null,
      command: localCommand,
    } : hasRemote ? {
      type: 'remote',
      transport: server.transport ?? 'streamable_http',
      url: server.endpoint,
    } : null,
    env,
  };
}
