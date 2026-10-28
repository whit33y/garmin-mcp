import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import { projectRoot } from '../src/config.js';

export function buildClaudeExtension(outputDir = resolve(projectRoot, 'dist')) {
  const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
  const manifest = {
    manifest_version: '0.3', name: 'garmin-personal-mcp', display_name: 'Garmin',
    version: pkg.version, description: 'Analiza treningów, snu i regeneracji z Garmin Connect.',
    author: { name: 'Garmin Personal MCP contributors' },
    privacy_policies: ['https://www.garmin.com/en-US/privacy/connect/'],
    compatibility: { platforms: ['darwin', 'win32'], runtimes: { node: '>=24.0.0' } },
    tools_generated: true,
    server: { type: 'node', entry_point: 'launcher.js', mcp_config: {
      command: 'node', args: ['${__dirname}/launcher.js'],
      env: { GARMIN_API_KEY: '${user_config.api_key}' },
    } },
    user_config: {
      api_key: { type: 'string', title: 'Klucz Garmin Personal API', sensitive: true, required: true,
        description: 'Twój GARMIN_API_KEY. Pozostałe ustawienia są dobierane automatycznie.' },
    },
  };
  // Allowlist: never traverse the checkout root, .env, data, or dev dependencies.
  const entries = { 'manifest.json': strToU8(JSON.stringify(manifest, null, 2) + '\n'),
    'package.json': strToU8(JSON.stringify({ name: pkg.name, version: pkg.version, type: 'module',
      engines: pkg.engines, dependencies: pkg.dependencies }, null, 2)),
    'launcher.js': readFileSync(join(projectRoot, 'plugins/claude-desktop/launcher.js')),
    'README.md': readFileSync(join(projectRoot, 'plugins/claude-desktop/README.md')),
  };
  function addDirectory(relative) {
    for (const item of readdirSync(join(projectRoot, relative), { withFileTypes: true })) {
      const path = `${relative}/${item.name}`;
      if (item.isDirectory()) addDirectory(path);
      else if (item.isFile()) entries[path] = readFileSync(join(projectRoot, path));
      else throw new Error(`Nieobsługiwany symlink w paczce: ${path}`);
    }
  }
  addDirectory('src');
  const lock = JSON.parse(readFileSync(join(projectRoot, 'package-lock.json'), 'utf8'));
  for (const [path, info] of Object.entries(lock.packages)) {
    if (path.startsWith('node_modules/') && !info.dev) addDirectory(path);
  }
  mkdirSync(outputDir, { recursive: true });
  const output = join(outputDir, `garmin-${pkg.version}.mcpb`);
  writeFileSync(output, zipSync(entries, { level: 6 }));
  return { output, manifest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(`Rozszerzenie Claude Desktop: ${buildClaudeExtension().output}`);
  console.log('Paczka nie zawiera .env, kluczy ani danych użytkownika.');
}
