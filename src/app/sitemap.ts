import type { MetadataRoute } from 'next';
import { createClient } from '@/lib/supabase/server';
import { SITE_URL } from '@/lib/site';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = SITE_URL;

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    { url: base,               lastModified: new Date(), changeFrequency: 'daily',   priority: 1.0 },
    { url: `${base}/registry`, lastModified: new Date(), changeFrequency: 'hourly',  priority: 0.9 },
    { url: `${base}/connect`,  lastModified: new Date(), changeFrequency: 'weekly',  priority: 0.8 },
    { url: `${base}/docs`,     lastModified: new Date(), changeFrequency: 'weekly',  priority: 0.8 },
    { url: `${base}/publish`,  lastModified: new Date(), changeFrequency: 'monthly', priority: 0.6 },
  ];

  // Dynamic server pages — top 100 active servers
  try {
    const supabase = createClient();
    const { data: servers } = await supabase
      .from('servers')
      .select('name, updated_at')
      .eq('status', 'active')
      .order('trust_score', { ascending: false })
      .limit(100);

    const serverPages: MetadataRoute.Sitemap = (servers ?? []).map(s => ({
      url:              `${base}/registry/${s.name}`,
      lastModified:     new Date(s.updated_at),
      changeFrequency:  'weekly',
      priority:         0.7,
    }));

    return [...staticPages, ...serverPages];
  } catch {
    return staticPages;
  }
}
