import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectRoot } from '../src/config.js';

// Resolve version-manager symlinks to a stable Node binary for GUI clients.
console.log(JSON.stringify({ mcpServers: { garmin: {
  command: realpathSync(process.execPath), args: [resolve(projectRoot, 'src/index.js')],
} } }, null, 2));
