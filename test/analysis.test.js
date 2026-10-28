import test from 'node:test';
import assert from 'node:assert/strict';
import { validDate, addDays, today } from '../src/dates.js';
import { deduplicateActivities, normalizeActivity, normalizeDay } from '../src/normalize.js';
import { trainingLoad, recovery, correlations, pearson } from '../src/analysis.js';

test('calendar dates reject impossible days and use Warsaw around UTC midnight', () => {
  assert.equal(validDate('2026-02-30'), false);
  assert.equal(validDate('2028-02-29'), true);
  assert.equal(addDays('2026-03-29', 1), '2026-03-30');
  assert.equal(today('Europe/Warsaw', new Date('2026-10-27T23:30:00Z')), '2026-10-28');
});

test('strength grams and milliseconds become kg and minutes; missing stays null', () => {
  const activity = normalizeActivity({ activityId: 1, activityType: { typeKey: 'strength_training' }, duration: 3600,
    summarizedExerciseSets: [{ maxWeight: 60000, volume: 1440000, duration: 600000, reps: 24, sets: 3 }] });
  assert.equal(activity.strength.exercises[0].maxWeightKg, 60);
  assert.equal(activity.strength.exercises[0].volumeKgReps, 1440);
  assert.equal(activity.strength.exercises[0].durationMinutes, 10);
  assert.equal(activity.garminLoad, null);
  assert.equal(activity.averageHr, null);
  const day = normalizeDay('2026-10-28', { sleepTimeSeconds: 0 }, {}, { averageStressLevel: -1, bodyBatteryAtWakeTime: 0 });
  assert.equal(day.sleepHours, null);
  assert.equal(day.stress, null);
  assert.equal(day.bodyBatteryWake, 0);
});

test('multisport parent and repeated pages do not double-count legs', () => {
  const parent = { activityId: 1, isParent: true, duration: 7200 };
  const child = { activityId: 2, parentId: 1, duration: 3600 };
  assert.deepEqual(deduplicateActivities([parent, child, child]).map(a => a.id), ['2']);
});

test('load separates metrics and reports partial coverage instead of implying full total', () => {
  const activities = [normalizeActivity({ activityId: 1, startTimeLocal: '2026-10-28 10:00:00', activityType: { typeKey: 'running' }, duration: 3600, activityTrainingLoad: 80 }),
    normalizeActivity({ activityId: 2, startTimeLocal: '2026-10-28 18:00:00', activityType: { typeKey: 'strength_training' }, duration: 1800 })];
  const result = trainingLoad(activities, '2026-10-28', '2026-10-28', [{ activityId: '2', rpe: 8 }]);
  assert.deepEqual(result.garminLoad, { value: 80, available: 1, total: 2 });
  assert.equal(result.bySport.strength.sessionRpeLoad.value, 240);
  assert.equal(result.bySport.running.sessionRpeLoad.value, null);
});

test('recovery excludes target from baseline, preserves missing and does not invent normality', () => {
  const days = Array.from({ length: 8 }, (_, i) => ({ date: addDays('2026-10-20', i), sleepHours: 8, hrvMs: 50, restingHr: 50 }));
  days.push({ date: '2026-10-28', sleepHours: 5, hrvMs: 30, restingHr: 58 });
  const result = recovery(days, '2026-10-28');
  assert.equal(result.baseline.sleepHours.median, 8);
  assert.equal(result.baseline.sleepHours.observations, 8);
  assert.equal(result.status, 'caution');
  assert.equal(result.flags.length, 3);
  assert.equal(recovery([], '2026-10-28').status, 'insufficient_data');
  assert.equal(recovery([], '2026-10-28', { pain: true }).status, 'caution');
});

test('correlations align previous day with following sleep and require 14 complete pairs', () => {
  assert.equal(pearson([[1, 2], [2, 4], [3, 6]]), 1);
  assert.equal(pearson([[1, 2], [1, 3]]), null);
  const days = Array.from({ length: 20 }, (_, i) => ({ date: addDays('2026-10-01', i), sleepHours: i + 4, hrvMs: i * 2 + 30, stress: i, restingHr: null }));
  const result = correlations(days, []);
  assert.equal(result.results.find(r => r.x === 'stress').lagDays, 1);
  assert.equal(result.results.find(r => r.x === 'stress').pairs, 19);
  assert.equal(result.results.find(r => r.y === 'restingHr').r, null);
  assert.equal(result.results.find(r => r.x === 'trainingMinutes').status, 'constant_series');
});
