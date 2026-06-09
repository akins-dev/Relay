/**
 * brand.ts
 *
 * All product names, URLs, and identifiers are driven from environment variables.
 * This makes the project fully composable — fork it, set env vars, deploy your own.
 *
 * For the official deployment:
 *   NEXT_PUBLIC_BRAND_NAME=Relay
 *   NEXT_PUBLIC_BRAND_SLUG=relay
 *   NEXT_PUBLIC_BRAND_DOMAIN=mcp-relay.vercel.app
 *   NEXT_PUBLIC_BRAND_ORG=akins-dev
 *   NEXT_PUBLIC_GITHUB_URL=https://github.com/akins-dev/relay
 *   NEXT_PUBLIC_BRAND_TWITTER=@akins_dev
 *   NEXT_PUBLIC_AGENT_MD_ROUTE=/agents.md
 *
 * Never hardcode brand strings outside this file.
 */

const name = process.env.NEXT_PUBLIC_BRAND_NAME ?? "Relay";
const slug = process.env.NEXT_PUBLIC_BRAND_SLUG ?? "relay";
const domain = process.env.NEXT_PUBLIC_BRAND_DOMAIN ?? "mcp-relay.vercel.app";
const org = process.env.NEXT_PUBLIC_BRAND_ORG ?? "akins-dev";

export const BRAND = {
  name,
  slug,
  domain,
  org,
  tagline:
    process.env.NEXT_PUBLIC_BRAND_TAGLINE ??
    "Runtime tool discovery for AI agents.",
  description:
    process.env.NEXT_PUBLIC_BRAND_DESCRIPTION ??
    "Give your agents a lightweight way to discover MCP servers and run them locally without explicit preconfiguration or context bloat.",
  githubUrl:
    process.env.NEXT_PUBLIC_GITHUB_URL ??
    `https://github.com/akins-dev/${slug}`,
  twitterHandle: process.env.NEXT_PUBLIC_BRAND_TWITTER ?? `@akins_dev`,
  // Product lines — all derived from name, overridable individually
  cloud: process.env.NEXT_PUBLIC_BRAND_CLOUD ?? `${name} Cloud`,
  cli: process.env.NEXT_PUBLIC_BRAND_CLI ?? `${name} CLI`,
  vault: process.env.NEXT_PUBLIC_BRAND_VAULT ?? `${name} Vault`,
  sdk: process.env.NEXT_PUBLIC_BRAND_SDK ?? `${name} SDK`,
  // Routes
  agentMdRoute: process.env.NEXT_PUBLIC_AGENT_MD_ROUTE ?? "/agents.md",
} as const;
