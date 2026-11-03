import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DirectoryUser } from './user-lookup.service';
export type SeedUser = DirectoryUser & {
  username: string;
  role: string;
};
type SeedFile = Record<
  string,
  {
    userId: string;
    role: string;
    displayName: string;
    email?: string;
  }
>;
let cached: Map<string, SeedUser> | null = null;
export function loadSeedUsers(): Map<string, SeedUser> {
  if (cached) return cached;
  const file = [
    join(process.cwd(), 'prisma/seed-users.json'),
    join(__dirname, '../../prisma/seed-users.json'),
    join(__dirname, '../../../prisma/seed-users.json'),
  ].find((candidate) => {
    try {
      readFileSync(candidate);
      return true;
    } catch {
      return false;
    }
  });
  if (!file) {
    throw new Error('seed-users.json not found');
  }
  const raw = JSON.parse(readFileSync(file, 'utf8')) as SeedFile;
  cached = new Map();
  for (const [username, item] of Object.entries(raw)) {
    cached.set(item.userId, {
      id: item.userId,
      username,
      displayName: item.displayName,
      email: item.email || `${username}@demo.local`,
      avatarUrl: null,
      personalIntro: null,
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      role: item.role,
    });
  }
  return cached;
}
export function findSeedUser(userId: string): SeedUser | null {
  return loadSeedUsers().get(userId) || null;
}
export function findSeedUserByUsername(username: string): SeedUser | null {
  for (const user of loadSeedUsers().values()) {
    if (user.username === username) return user;
  }
  return null;
}
