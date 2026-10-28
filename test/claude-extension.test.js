import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { buildClaudeExtension } from '../scripts/build-claude-extension.js';

test('MCPB is portable, excludes private files and starts with only an API key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'garmin-mcpb-'));
  try {
    const { output, manifest } = buildClaudeExtension(dir);
    const files = unzipSync(readFileSync(output));
    assert.equal(manifest.user_config.api_key.sensitive, true);
    assert.equal(manifest.compatibility.runtimes.node, '>=24.0.0');
    const cached = join(dir, 'extension cache with spaces');
    for (const [name, bytes] of Object.entries(files)) {
      assert.ok(!/(^|\/)\.env(?:\.|$)/.test(name), name);
      assert.ok(!name.startsWith('data/') && !name.endsWith('.sqlite'), name);
      assert.ok(!name.startsWith('node_modules/fflate/'), name);
      const target = join(cached, name);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    }
    assert.equal(JSON.parse(strFromU8(files['manifest.json'])).name, manifest.name);
    assert.deepEqual(Object.keys(manifest.user_config), ['api_key']);
    assert.equal(manifest.user_config.api_key.required, true);
    for (const demo of [true, false]) {
      const env = { GARMIN_API_KEY: 'fake-key-for-offline-test', HOME: dir, USERPROFILE: dir };
      const mode = demo ? 'DEMO_SYNTHETIC_DATA' : 'GARMIN';
      const database = join(dir, '.garmin-personal-mcp', demo ? 'demo' : 'data', 'state.sqlite');
      const client = new Client({ name: 'extension-test', version: '1.0.0' });
      try {
        await client.connect(new StdioClientTransport({ command: process.execPath,
          args: manifest.server.mcp_config.args.map(value => value.replaceAll('${__dirname}', cached)).concat(demo ? ['--demo'] : []),
          cwd: tmpdir(), env, stderr: 'pipe' }));
        assert.equal((await client.listTools()).tools.length, 19);
        const status = (await client.callTool({ name: 'server_status', arguments: {} })).structuredContent;
        assert.equal(status.mode, mode);
        assert.equal(typeof status.timeZone, 'string');
        assert.ok(status.timeZone);
        assert.ok(existsSync(database));
        if (mode === 'DEMO_SYNTHETIC_DATA') {
          const recovery = await client.callTool({ name: 'summarize_recovery', arguments: {} });
          assert.notEqual(recovery.isError, true);
          assert.ok(recovery.structuredContent.current.date);
        }
      } finally { await client.close(); }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
