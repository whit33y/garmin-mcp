import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { generatePlan, adaptPlan } from '../src/planning.js';
import { DemoClient } from '../src/demo.js';
import { TrainingService } from '../src/service.js';

const goal = { description: 'Triathlon i siła', sports: ['running', 'cycling', 'swimming', 'strength'], eventDate: '2026-11-14' };
const availability = [1, 2, 4, 6].map(weekday => ({ weekday, minutes: 60 }));
const input = { startDate: '2026-10-28', endDate: '2026-11-14', goal, availability, activities: [] };

test('plan respects availability, all sports and generates conservative draft without history', () => {
  const plan = generatePlan(input);
  assert.equal(new Set(plan.sessions.map(s => s.sport)).size, 4);
  assert.ok(plan.sessions.every(s => s.durationMinutes <= 60 && s.intensity === 'easy'));
  assert.ok(plan.sessions.some(s => s.phase === 'taper'));
  assert.ok(plan.notes.some(n => n.includes('90 min')));
  assert.throws(() => generatePlan({ ...input, availability: [availability[0], availability[0]] }), /raz/);
});

test('custom plan enforces total daily budget and sport constraints', () => {
  const custom = { date: '2026-10-29', sport: 'running', title: 'Bieg', durationMinutes: 40, intensity: 'easy', instructions: ['Spokojnie'] };
  assert.throws(() => generatePlan({ ...input, customSessions: [custom, { ...custom, sport: 'cycling' }] }), /Łączny/);
  assert.throws(() => generatePlan({ ...input, customSessions: [{ ...custom, date: '2026-12-01' }] }), /zakresem/);
});

test('adaptation reduces near-term sessions and cancels unavailable days without cramming missed work', () => {
  const plan = generatePlan(input);
  const first = plan.sessions[0];
  const result = adaptPlan({ plan, date: '2026-10-29', recoveryStatus: 'caution', reason: 'Słaby sen', unavailableDates: ['2026-10-31'] });
  assert.ok(result.changes.length);
  assert.ok(result.plan.sessions.find(s => s.id === first.id).durationMinutes < first.durationMinutes);
  assert.equal(result.plan.sessions.find(s => s.date === '2026-10-31').status, 'cancelled');
  assert.equal(result.plan.sessions.length, plan.sessions.length);
  assert.throws(() => adaptPlan({ plan, date: '2026-10-28', recoveryStatus: 'typical', missedSessionIds: [first.id], reason: 'x' }), /Przyszłą/);
});

test('SQLite proposals commit once, detect competing revisions, and keep history', () => {
  const store = new Store(':memory:');
  try {
    const plan = generatePlan(input);
    const a = store.propose(plan, 'first', 0); const b = store.propose(plan, 'competing', 0);
    assert.equal(store.get('plan'), null);
    assert.equal(store.commit(a.id, 0).revision, 1);
    assert.throws(() => store.commit(a.id, 1), /już/);
    assert.throws(() => store.commit(b.id, 0), /zmienił/);
    const c = store.propose(plan, 'second', 1);
    assert.equal(store.commit(c.id, 1).revision, 2);
    assert.equal(store.list('history').length, 1);
  } finally { store.close(); }
});

test('a broken health source yields partial recovery, never fake measurements', async () => {
  const store = new Store(':memory:');
  const client = new DemoClient('Europe/Warsaw', '2026-10-28');
  const get = client.get.bind(client);
  client.get = async (path, query) => { if (path.includes('sleep')) throw new Error('HTTP 403'); return get(path, query); };
  const service = new TrainingService({ client, store, demo: true, clock: () => new Date('2026-10-28T12:00:00Z') });
  try {
    const result = await service.summarizeRecovery({ date: '2026-10-28' });
    assert.equal(result.current.sleepHours, null);
    assert.ok(result.warnings.length);
    assert.equal(result.current.restingHr > 0, true);
  } finally { store.close(); }
});
