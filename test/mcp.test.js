import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Store } from '../src/store.js';
import { DemoClient } from '../src/demo.js';
import { TrainingService } from '../src/service.js';
import { createMcpServer } from '../src/server.js';

test('MCP handshake, resources and all 19 tools work with persisted plan lifecycle', async () => {
  const store = new Store(':memory:');
  const service = new TrainingService({ client: new DemoClient('Europe/Warsaw', '2026-10-28'), store, demo: true, clock: () => new Date('2026-10-28T12:00:00Z') });
  const server = createMcpServer(service);
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true, `${name}: ${JSON.stringify(result.content)}`);
    return result.structuredContent;
  };
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    const tools = await client.listTools(); assert.equal(tools.tools.length, 19);
    assert.equal(tools.tools.find(t => t.name === 'commit_training_plan').annotations.readOnlyHint, false);
    assert.equal((await client.listResources()).resources.length, 1);
    assert.ok((await client.readResource({ uri: 'garmin://methods' })).contents[0].text.includes('RPE'));
    assert.equal((await call('server_status')).mode, 'DEMO_SYNTHETIC_DATA');
    const activities = await call('list_activities', { startDate: '2026-10-01', endDate: '2026-10-28' });
    const strength = activities.activities.find(a => a.sport === 'strength'); assert.ok(strength);
    await call('log_wellbeing', { date: strength.date, activityId: strength.id, rpe: 8, rir: 2, energy: 7 });
    assert.equal((await call('analyze_training', { activityId: strength.id })).activity.sport, 'strength');
    assert.ok((await call('analyze_last_training')).activity);
    assert.ok((await call('analyze_training_week', { startDate: '2026-10-19' })).averages.sleepHours.observations);
    assert.equal((await call('summarize_recovery', { date: '2026-10-28' })).current.date, '2026-10-28');
    for (const name of ['analyze_hrv', 'analyze_stress', 'analyze_sleep', 'analyze_body_battery', 'health_report']) {
      const report = await call(name, { startDate: '2026-10-14', endDate: '2026-10-27' });
      assert.equal(report.warnings.length, 0, name);
      assert.ok(Object.keys(report.reports).length, name);
      assert.equal(report.daily.length, 14);
    }
    assert.ok((await call('analyze_load', { startDate: '2026-10-19', endDate: '2026-10-25' })).current.count);
    assert.equal((await call('find_correlations', { startDate: '2026-09-01', endDate: '2026-10-27' })).results.length, 6);
    assert.ok((await call('suggest_today_training')).suggestions.length);
    const draft = await call('plan_training', { startDate: '2026-10-28', endDate: '2026-11-10',
      goal: { description: 'Triathlon i siła', sports: ['running', 'cycling', 'swimming', 'strength'] },
      availability: [1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, minutes: 60 })) });
    assert.equal((await call('get_training_plan')).plan, null);
    const committed = await call('commit_training_plan', { proposalId: draft.proposal.id, expectedRevision: 0, userConfirmed: true });
    assert.equal(committed.plan.revision, 1);
    const adaptation = await call('adapt_plan', { reason: 'Brak czasu jutro', unavailableDates: ['2026-10-29'] });
    assert.ok(adaptation.changes.length);
    await call('commit_training_plan', { proposalId: adaptation.proposal.id, expectedRevision: 1, userConfirmed: true });
    assert.equal((await call('get_training_plan', { includeHistory: true })).history.length, 1);
    const invalid = await client.callTool({ name: 'log_wellbeing', arguments: { date: '2026-02-30' } });
    assert.equal(invalid.isError, true);
    const missingActivity = await client.callTool({ name: 'log_wellbeing', arguments: { date: '2026-10-28', rpe: 7 } });
    assert.equal(missingActivity.isError, true);
  } finally { await client.close(); await server.close(); store.close(); }
});

test('real stdio process initializes without logging on protocol stdout', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'garmin-mcp-test-'));
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('src/index.js'), '--demo'],
    env: { ...process.env, DATA_DIR: dir }, stderr: 'pipe' });
  const client = new Client({ name: 'stdio-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 19);
    const result = await client.callTool({ name: 'server_status', arguments: {} });
    assert.equal(result.structuredContent.mode, 'DEMO_SYNTHETIC_DATA');
  } finally { await client.close(); rmSync(dir, { recursive: true, force: true }); }
});
