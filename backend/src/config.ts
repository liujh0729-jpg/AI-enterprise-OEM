import { config } from 'dotenv';
import { resolve } from 'node:path';
const environment = process.env.NODE_ENV || 'development';
// This module must be evaluated before business modules read configuration.
config({
  path: [
    `.env.${environment}.local`,
    `.env.${environment}`,
    '.env.local',
    '.env',
  ].map((file) => resolve(__dirname, '..', file)),
  quiet: true,
});
export function validateConfig() {
  for (const key of ['DATABASE_URL', 'JWT_SECRET', 'EXTERNAL_CRED_KEY']) {
    if (!process.env[key]?.trim()) throw new Error(`${key} 未配置，拒绝启动`);
  }
}
