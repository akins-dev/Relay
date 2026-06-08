import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: [
          '/',
          '/agents.md',
          '/llms.txt',
          '/api/mcp',
          '/api/mcp-server',
          '/api/servers/search',
          '/.well-known/mcp.json',
          '/.well-known/mcp/server.json',
        ],
        disallow: ['/api/', '/dashboard/', '/publish/'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
