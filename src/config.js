import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export function config(env = process.env) {
  const demo = process.argv.includes('--demo') || env.DEMO_MODE === 'true';
  const region = env.GARMIN_REGION || 'com';
  if (!['com', 'cn'].includes(region)) throw new Error('GARMIN_REGION musi być com lub cn.');
  const timeZone = env.TIME_ZONE || 'Europe/Warsaw';
  new Intl.DateTimeFormat('en', { timeZone });
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Nieprawidłowy PORT.');
  if (!demo && !env.GARMIN_API_KEY) throw new Error('Ustaw GARMIN_API_KEY w .env albo uruchom npm run setup. Możesz też użyć --demo.');
  return {
    demo, timeZone, port,
    apiKey: env.GARMIN_API_KEY,
    baseUrl: `https://personal.connectapi.garmin.${region}`,
    dataDir: resolve(projectRoot, env.DATA_DIR || (demo ? './data/demo' : './data')),
    host: env.HOST || '127.0.0.1',
    accessToken: env.MCP_ACCESS_TOKEN || '',
    issuer: env.OAUTH_ISSUER || '',
    oauthSubject: env.OAUTH_SUBJECT || '',
    oauthAudience: env.OAUTH_AUDIENCE || '',
    oauthScope: env.OAUTH_SCOPE || 'mcp',
    publicUrl: env.MCP_PUBLIC_URL || '',
    allowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean),
  };
}

export function loadEnv() {
  const path = resolve(projectRoot, '.env');
  if (existsSync(path)) process.loadEnvFile(path);
}
