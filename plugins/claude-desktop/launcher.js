import { homedir } from 'node:os';
import { join } from 'node:path';

// Keep persistent state outside the installation cache, including after updates.
process.env.GARMIN_REGION = 'com';
process.env.TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
process.env.DEMO_MODE = process.argv.includes('--demo') ? 'true' : 'false';
process.env.DATA_DIR = join(homedir(), '.garmin-personal-mcp',
  process.env.DEMO_MODE === 'true' ? 'demo' : 'data');
if (process.env.DEMO_MODE !== 'true' && !process.env.GARMIN_API_KEY?.trim()) {
  throw new Error('Uzupełnij klucz Garmin w ustawieniach rozszerzenia.');
}
await import('./src/index.js');
