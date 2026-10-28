import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { buildPlugin } from '../scripts/build-plugin.js';

test('installed plugin starts from a copied cache directory without bundling private files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'garmin-plugin-'));
  const client = new Client({ name: 'plugin-test', version: '1.0.0' });
  try {
    const { root, pluginDir } = buildPlugin(join(dir, 'marketplace'));
    const catalog = JSON.parse(readFileSync(join(root, '.agents/plugins/marketplace.json'), 'utf8'));
    assert.equal(join(root, catalog.plugins[0].source.path), pluginDir);
    const cached = join(dir, 'cache');
    cpSync(pluginDir, cached, { recursive: true });
    assert.deepEqual(readdirSync(cached).sort(), ['.codex-plugin', '.mcp.json', 'skills']);
    const manifest = JSON.parse(readFileSync(join(cached, '.codex-plugin/plugin.json'), 'utf8'));
    const { garmin } = JSON.parse(readFileSync(join(cached, manifest.mcpServers), 'utf8')).mcpServers;
    await client.connect(new StdioClientTransport({ ...garmin,
      args: [...garmin.args, '--demo'], cwd: tmpdir(),
      env: { ...process.env, DATA_DIR: join(dir, 'data') }, stderr: 'pipe' }));
    assert.equal((await client.listTools()).tools.length, 19);
    const status = await client.callTool({ name: 'server_status', arguments: {} });
    assert.equal(status.structuredContent.mode, 'DEMO_SYNTHETIC_DATA');
    const recovery = await client.callTool({ name: 'summarize_recovery', arguments: {} });
    assert.notEqual(recovery.isError, true);
    assert.ok(recovery.structuredContent.current.date);
  } finally {
    await client.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
