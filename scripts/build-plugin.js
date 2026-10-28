import { cpSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { projectRoot } from '../src/config.js';

// The installed plugin is copied to the host's cache. Bind it to this checkout,
// where .env, node_modules and the persistent database remain available.
export function buildPlugin(outputDir = resolve(projectRoot, 'dist/garmin-marketplace')) {
  const root = resolve(outputDir);
  const pluginDir = join(root, 'plugins/garmin');
  mkdirSync(pluginDir, { recursive: true });
  cpSync(resolve(projectRoot, 'plugins/garmin'), pluginDir, { recursive: true });
  const mcp = { mcpServers: { garmin: {
    command: realpathSync(process.execPath),
    args: [resolve(projectRoot, 'src/index.js')],
    cwd: projectRoot,
    startup_timeout_sec: 20,
    tool_timeout_sec: 180,
  } } };
  writeFileSync(join(pluginDir, '.mcp.json'), `${JSON.stringify(mcp, null, 2)}\n`);
  const marketplace = {
    name: 'garmin-local',
    interface: { displayName: 'Garmin — lokalne pluginy' },
    plugins: [{ name: 'garmin', source: { source: 'local', path: './plugins/garmin' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }],
  };
  mkdirSync(join(root, '.agents/plugins'), { recursive: true });
  writeFileSync(join(root, '.agents/plugins/marketplace.json'), `${JSON.stringify(marketplace, null, 2)}\n`);
  return { root, pluginDir, mcp };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { root } = buildPlugin();
  const { version } = JSON.parse(readFileSync(resolve(projectRoot, 'plugins/garmin/.codex-plugin/plugin.json'), 'utf8'));
  console.log(`Plugin Garmin ${version}: ${root}`);
  console.log('Pakiet zawiera ścieżki do tego komputera, bez .env, kluczy ani bazy danych.');
  console.log(`Instalacja:\ncodex plugin marketplace add "${root}"\ncodex plugin add garmin@garmin-local`);
}
