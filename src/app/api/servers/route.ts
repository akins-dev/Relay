import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { getDb, formatServer } from '@/lib/db';
import { getAuthFromRequest } from '@/lib/auth';
import { scanServer, computeTrustScore } from '@/lib/security';

const PublishSchema = z.object({
  name: z.string().min(3).max(64).regex(/^[a-z0-9-]+$/),
  display_name: z.string().min(3).max(100),
  description: z.string().min(20).max(500),
  long_description: z.string().max(5000).optional(),
  endpoint: z.string().url(),
  version: z.string().default('1.0.0'),
  github_url: z.string().url().optional().or(z.literal('')),
  homepage_url: z.string().url().optional().or(z.literal('')),
  license: z.string().default('MIT'),
  tags: z.array(z.string()).min(1).max(10),
  tools: z.array(z.string()).min(1).max(100),
});

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') || '';
  const tag = searchParams.get('tag') || '';
  const sort = searchParams.get('sort') || 'stars';
  const verified = searchParams.get('verified') || '';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = Math.min(50, parseInt(searchParams.get('limit') || '12'));
  const offset = (page - 1) * limit;

  const db = getDb();
  let where = "WHERE s.status = 'active'";
  const params: any[] = [];

  if (q) {
    where += ` AND (s.name LIKE ? OR s.display_name LIKE ? OR s.description LIKE ? OR s.tags LIKE ?)`;
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (tag) { where += ` AND s.tags LIKE ?`; params.push(`%"${tag}"%`); }
  if (verified === 'true') { where += ` AND s.verified = 1`; }

  const orderMap: Record<string, string> = {
    stars: 's.stars DESC', calls: 's.total_calls DESC',
    trust: 's.trust_score DESC', recent: 's.created_at DESC', latency: 's.latency_ms ASC',
  };
  const order = orderMap[sort] || 's.stars DESC';

  const servers = db.prepare(`
    SELECT s.*, u.username as author_name FROM servers s
    LEFT JOIN users u ON s.author_id = u.id
    ${where} ORDER BY ${order} LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[];

  const total = (db.prepare(`SELECT COUNT(*) as c FROM servers s ${where}`).get(...params) as any).c;

  return NextResponse.json({
    servers: servers.map(formatServer),
    total, page, pages: Math.ceil(total / limit),
  });
}

export async function POST(req: NextRequest) {
  const auth = getAuthFromRequest(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = PublishSchema.parse(await req.json());
    const db = getDb();

    const existing = db.prepare('SELECT id FROM servers WHERE name = ?').get(body.name);
    if (existing) return NextResponse.json({ error: 'Server name already taken' }, { status: 409 });

    const scanResult = scanServer({
      name: body.name, description: body.description,
      long_description: body.long_description,
      endpoint: body.endpoint, tools: body.tools, tags: body.tags,
    });

    const id = nanoid();
    const schemaHash = Buffer.from(JSON.stringify(body.tools) + body.version).toString('base64');
    const status = scanResult.passed ? 'active' : 'rejected';
    const trustScore = computeTrustScore({
      verified: 0, scanScore: scanResult.score, uptimePct: 100,
      stars: 0, daysSinceChange: 0,
    });

    db.prepare(`
      INSERT INTO servers (
        id, name, display_name, description, long_description, author_id,
        version, endpoint, github_url, homepage_url, license, tags, tools,
        status, schema_hash, scan_status, scan_issues, trust_score, last_scanned_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    `).run(
      id, body.name, body.display_name, body.description,
      body.long_description || null, auth.userId, body.version,
      body.endpoint, body.github_url || null, body.homepage_url || null,
      body.license, JSON.stringify(body.tags), JSON.stringify(body.tools),
      status, schemaHash, scanResult.passed ? 'passed' : 'failed',
      JSON.stringify(scanResult.issues), trustScore,
    );

    db.prepare(`
      INSERT INTO scan_results (id, server_id, scan_type, passed, issues, score, details)
      VALUES (?, ?, 'static', ?, ?, ?, ?)
    `).run(nanoid(), id, scanResult.passed ? 1 : 0, JSON.stringify(scanResult.issues), scanResult.score, scanResult.details);

    return NextResponse.json({ id, name: body.name, status, scan: scanResult, trust_score: trustScore }, { status: 201 });
  } catch (e: any) {
    if (e.errors) return NextResponse.json({ error: e.errors }, { status: 400 });
    return NextResponse.json({ error: 'Publish failed' }, { status: 500 });
  }
}
