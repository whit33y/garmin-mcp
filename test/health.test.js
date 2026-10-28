import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../src/dates.js';
import { normalizeDay } from '../src/normalize.js';
import { healthAnalytics, mergeBodyBattery, mergeStress, localClockMinutes, validateHealthRange } from '../src/health.js';
import { Store } from '../src/store.js';
import { TrainingService } from '../src/service.js';
import { DemoClient } from '../src/demo.js';

test('HRV compares Garmin weekly average to balanced range, not single night', () => {
  const day = normalizeDay('2026-10-28', {}, { lastNightAvg: 30, weeklyAvg: 48, status: 'BALANCED', baseline: { balancedLow: 40, balancedUpper: 60 } }, {});
  const report = healthAnalytics({ days: [day], startDate: day.date, endDate: day.date, domains: ['hrv'] });
  assert.equal(report.reports.hrv.outsideGarminBalancedRange.length, 0);
  assert.equal(report.reports.hrv.metrics.hrvMs.period.mean, 30);
  assert.equal(report.reports.hrv.metrics.hrvMs.changePercent, null);
  const outside = healthAnalytics({ days: [{ ...day, hrvWeeklyAverageMs: 65 }], startDate: day.date, endDate: day.date });
  assert.equal(outside.reports.hrv.outsideGarminBalancedRange.length, 1);
});

test('stress seconds convert to minutes and unknown values remain missing', () => {
  const base = normalizeDay('2026-10-28', {}, {}, { highStressDuration: 120, restStressDuration: 0 });
  const [day] = mergeStress([base], [{ calendarDate: base.date, values: { overallStressLevel: -1, highStressDuration: 600, restStressDuration: 0 } }]);
  assert.equal(day.stress, null);
  assert.equal(day.stressHighMinutes, 10);
  assert.equal(day.stressRestMinutes, 0);
});

test('Body Battery uses descriptor column, ignores unknown samples, preserves actual zero', () => {
  const base = normalizeDay('2026-10-28', {}, {}, {});
  const [day] = mergeBodyBattery([base], [{ date: base.date, charged: 50, drained: 70,
    bodyBatteryValueDescriptorDTOList: [{ bodyBatteryValueDescriptorIndex: 2, bodyBatteryValueDescriptorKey: 'bodyBatteryLevel' }],
    bodyBatteryValuesArray: [[100, 'status', -1], [200, 'status', 80], [300, 'status', 0]] }]);
  assert.equal(day.bodyBatteryHigh, 80); assert.equal(day.bodyBatteryLow, 0);
  assert.equal(day.bodyBatterySamples, 2); assert.equal(day.bodyBatteryCharged, 50);
  assert.equal(day.bodyBatteryWake, null);
  const [missing] = mergeBodyBattery([base], [{ date: base.date, bodyBatteryValuesArray: [[0, 70]] }]);
  assert.equal(missing.bodyBatteryHigh, null);
});

test('bedtime regularity crosses midnight and does not depend on host timezone', () => {
  const days = ['23:50', '00:10', '00:00'].map((time, i) => ({ date: addDays('2026-10-20', i), sleepStartLocal: `2026-10-20T${time}:00` }));
  const report = healthAnalytics({ days, startDate: '2026-10-20', endDate: '2026-10-22', domains: ['sleep'] });
  assert.equal(report.reports.sleep.regularity.standardDeviationMinutes, 8.16);
  assert.equal(localClockMinutes('2026-10-20T23:50:00+02:00'), 1430);
  assert.equal(localClockMinutes('bad'), null);
  assert.equal(localClockMinutes(null), null);
  assert.equal(localClockMinutes('2026-10-20T25:20:00'), null);
});

test('health trend baseline precedes period and requires coverage before comparing', () => {
  const days = Array.from({ length: 14 }, (_, i) => ({ date: addDays('2026-10-01', i), hrvMs: i < 7 ? 50 : 60 }));
  const report = healthAnalytics({ days, startDate: '2026-10-08', endDate: '2026-10-14', domains: ['hrv'] });
  assert.equal(report.reports.hrv.metrics.hrvMs.changePercent, 20);
  assert.equal(report.reports.hrv.metrics.hrvMs.period.observations, 7);
  assert.equal(report.reports.hrv.metrics.restingHr.period.mean, null);
  assert.throws(() => validateHealthRange('2026-10-01', '2026-11-01', 28, '2026-10-28'), /przyszłych/);
});

test('health supplement failure remains explicit while available daily metrics survive', async () => {
  const store = new Store(':memory:'); const client = new DemoClient('Europe/Warsaw', '2026-10-28');
  const original = client.get.bind(client);
  client.get = async (path, query) => {
    if (path.includes('/bodyBattery/')) throw new Error('HTTP 403');
    return original(path, query);
  };
  const service = new TrainingService({ client, store, demo: true, clock: () => new Date('2026-10-28T12:00:00Z') });
  try {
    const report = await service.analyzeHealth({ startDate: '2026-10-20', endDate: '2026-10-27' });
    assert.equal(report.warnings.length, 1);
    assert.equal(report.warnings[0].source, 'bodyBattery');
    assert.equal(report.reports.bodyBattery.metrics.bodyBatteryWake.period.observations, 8);
    assert.equal(report.reports.stress.metrics.stressHighMinutes.period.observations, 8);
  } finally { store.close(); }
});
