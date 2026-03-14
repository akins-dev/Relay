import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { getDb } from './db';
import { NextRequest } from 'next/server';

const JWT_SECRET = process.env.JWT_SECRET || 'mcp-registry-dev-secret-change-in-production';

export interface AuthPayload {
  userId: string;
  username: string;
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): AuthPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthPayload;
  } catch {
    return null;
  }
}

export function getAuthFromRequest(req: NextRequest): AuthPayload | null {
  const auth = req.headers.get('authorization');
  if (!auth) return null;
  const token = auth.replace('Bearer ', '');
  if (token.startsWith('sk_mcp_')) {
    return getAuthFromApiKey(token);
  }
  return verifyToken(token);
}

function getAuthFromApiKey(key: string): AuthPayload | null {
  const db = getDb();
  const prefix = key.slice(0, 16);
  const apiKey = db.prepare('SELECT * FROM api_keys WHERE key_prefix = ?').get(prefix) as any;
  if (!apiKey) return null;
  if (!bcrypt.compareSync(key, apiKey.key_hash)) return null;
  db.prepare('UPDATE api_keys SET last_used_at = unixepoch() WHERE id = ?').run(apiKey.id);
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(apiKey.user_id) as any;
  if (!user) return null;
  return { userId: user.id, username: user.username };
}

export async function createApiKey(userId: string, name: string) {
  const db = getDb();
  const rawKey = `sk_mcp_${nanoid(32)}`;
  const keyHash = await bcrypt.hash(rawKey, 10);
  const keyPrefix = rawKey.slice(0, 16);
  const id = nanoid();
  db.prepare('INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name) VALUES (?, ?, ?, ?, ?)')
    .run(id, userId, keyHash, keyPrefix, name);
  return { id, rawKey, keyPrefix };
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}
