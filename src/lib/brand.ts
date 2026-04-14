import { SITE_URL } from '@/lib/site';

export const BRAND = {
  name:        process.env.NEXT_PUBLIC_BRAND_NAME    ?? 'Agentrail',
  domain:      process.env.NEXT_PUBLIC_BRAND_DOMAIN  ?? 'agentrail.dev',
  tagline:     'The trust layer for runtime discovery and secure invocation of remote MCP servers.',
  description: 'Give your agents the power to dynamically discover and securely invoke remote capabilities. Secure by default. Network native.',
  githubUrl:   process.env.NEXT_PUBLIC_GITHUB_URL    ?? 'https://github.com/the-17/agentrail',
  twitterHandle: '@the17dev',
  org:         'TheSeventeen',
  // Product lines
  cloud:       (process.env.NEXT_PUBLIC_BRAND_NAME   ?? 'Agentrail') + ' Cloud',
  cli:         (process.env.NEXT_PUBLIC_BRAND_NAME   ?? 'Agentrail') + ' CLI',
  vault:       (process.env.NEXT_PUBLIC_BRAND_NAME   ?? 'Agentrail') + ' Vault',
  // Agent skill file route
  agentMdRoute: process.env.NEXT_PUBLIC_AGENT_MD_ROUTE ?? '/agents.md',
  // Internal package/proxy identifier (short slug, no spaces)
  slug:        process.env.NEXT_PUBLIC_BRAND_SLUG    ?? 'agentrail',
} as const;
