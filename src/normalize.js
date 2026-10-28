export const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export const positive = value => number(value) !== null && value > 0 ? value : null;
export const round = (value, digits = 2) => typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
export const mean = values => { const nums = values.filter(v => v !== null && Number.isFinite(v)); return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null; };
export function median(values) {
  const sorted = values.filter(v => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
export function sportOf(key = '') {
  key = key.toLowerCase();
  if (/strength|weight_training|functional_strength/.test(key)) return 'strength';
  if (/running|treadmill|trail_run|track_run|ultra_run/.test(key)) return 'running';
  if (/cycling|biking|indoor_bike|mountain_bike|gravel/.test(key)) return 'cycling';
  if (/swimming|lap_swim|open_water/.test(key)) return 'swimming';
  return 'other';
}

export function normalizeActivity(raw) {
  const summary = raw.summaryDTO || raw;
  const type = raw.activityTypeDTO?.typeKey ?? raw.activityType?.typeKey ?? '';
  const duration = number(summary.duration);
  const distance = number(summary.distance);
  const sport = sportOf(type);
  const speed = positive(summary.averageSpeed);
  const zoneSeconds = Array.from({ length: 5 }, (_, i) => number(raw[`hrTimeInZone_${i + 1}`] ?? summary[`hrTimeInZone_${i + 1}`]));
  const exercises = Array.isArray(raw.summarizedExerciseSets) ? raw.summarizedExerciseSets : [];
  return {
    id: String(raw.activityId), name: raw.activityName || null,
    date: (summary.startTimeLocal || raw.startTimeLocal || '').slice(0, 10) || null,
    startLocal: summary.startTimeLocal ?? raw.startTimeLocal ?? null,
    startUtc: summary.startTimeGMT ?? raw.startTimeGMT ?? null,
    sport, type, durationMinutes: duration === null ? null : round(duration / 60),
    distanceKm: distance === null ? null : round(distance / 1000, 3),
    paceSecondsPerKm: sport === 'running' && speed ? round(1000 / speed) : null,
    paceSecondsPer100m: sport === 'swimming' && speed ? round(100 / speed) : null,
    averageSpeedKmh: sport === 'cycling' && speed ? round(speed * 3.6) : null,
    averageHr: positive(summary.averageHR), maxHr: positive(summary.maxHR),
    elevationGainM: number(summary.elevationGain),
    averagePowerW: number(summary.averagePower ?? summary.avgPower),
    normalizedPowerW: number(summary.normalizedPower ?? summary.normPower),
    trainingEffect: number(summary.trainingEffect ?? summary.aerobicTrainingEffect),
    anaerobicTrainingEffect: number(summary.anaerobicTrainingEffect),
    garminLoad: number(raw.activityTrainingLoad ?? summary.activityTrainingLoad),
    tss: number(summary.trainingStressScore),
    zoneMinutes: zoneSeconds.map(v => v === null ? null : round(v / 60)),
    cadence: positive(summary.averageRunCadence ?? summary.averageRunningCadenceInStepsPerMinute ?? summary.averageBikeCadence ?? summary.averageBikingCadenceInRevPerMinute),
    swolf: positive(summary.averageSWOLF ?? summary.averageSwolf),
    activeLengths: number(summary.numberOfActiveLengths ?? summary.activeLengths),
    strength: sport === 'strength' ? {
      totalSets: number(raw.totalSets), totalReps: number(raw.totalReps),
      exercises: exercises.map(e => ({
        category: e.category ?? null, exercise: e.subCategory ?? null, sets: number(e.sets), reps: number(e.reps),
        volumeKgReps: number(e.volume) === null ? null : round(e.volume / 1000),
        maxWeightKg: number(e.maxWeight) === null ? null : round(e.maxWeight / 1000),
        durationMinutes: number(e.duration) === null ? null : round(e.duration / 60000),
      })),
    } : null,
    isParent: Boolean(raw.isParent || raw.isMultiSportParent || raw.parent),
    parentId: raw.parentId ? String(raw.parentId) : null,
    missing: ['duration', 'averageHR'].filter(field => number(summary[field]) === null),
  };
}

export function deduplicateActivities(rawItems) {
  const byId = new Map(rawItems.map(a => [String(a.activityId), a]));
  const parentsWithChildren = new Set(rawItems.filter(a => a.parentId).map(a => String(a.parentId)));
  return [...byId.values()].filter(a => !parentsWithChildren.has(String(a.activityId))).map(normalizeActivity);
}

export function normalizeDay(date, sleep, hrv, summary) {
  const s = sleep?.dailySleepDTO ?? sleep ?? {};
  const h = hrv?.hrvSummary ?? hrv ?? {};
  const d = summary ?? {};
  const score = s.sleepScores?.overall?.value ?? s.sleepScores?.overall?.score;
  return {
    date,
    sleepHours: positive(s.sleepTimeSeconds) === null ? null : round(s.sleepTimeSeconds / 3600),
    sleepScore: number(score),
    deepMinutes: number(s.deepSleepSeconds) === null ? null : round(s.deepSleepSeconds / 60),
    remMinutes: number(s.remSleepSeconds) === null ? null : round(s.remSleepSeconds / 60),
    awakeMinutes: number(s.awakeSleepSeconds) === null ? null : round(s.awakeSleepSeconds / 60),
    sleepStartLocal: s.sleepStartTimestampLocal ?? null,
    sleepEndLocal: s.sleepEndTimestampLocal ?? null,
    napMinutes: number(s.napTimeSeconds) === null ? null : round(s.napTimeSeconds / 60),
    awakenings: number(s.awakeCount),
    sleepStress: number(s.avgSleepStress),
    respirationPerMinute: positive(s.averageRespirationValue),
    sleepAlignmentStatus: s.sleepAlignment?.status ?? null,
    hrvMs: positive(h.lastNightAvg), hrvStatus: h.status ?? null,
    hrvWeeklyAverageMs: positive(h.weeklyAvg),
    hrvBaselineLowMs: positive(h.baseline?.balancedLow), hrvBaselineHighMs: positive(h.baseline?.balancedUpper),
    restingHr: positive(d.restingHeartRate), stress: number(d.averageStressLevel),
    stressHighMinutes: number(d.highStressDuration) === null ? null : round(d.highStressDuration / 60),
    stressMediumMinutes: number(d.mediumStressDuration) === null ? null : round(d.mediumStressDuration / 60),
    stressLowMinutes: number(d.lowStressDuration) === null ? null : round(d.lowStressDuration / 60),
    stressRestMinutes: number(d.restStressDuration) === null ? null : round(d.restStressDuration / 60),
    bodyBatteryWake: number(d.bodyBatteryAtWakeTime), bodyBatteryLatest: number(d.bodyBatteryMostRecentValue),
    bodyBatteryHigh: number(d.bodyBatteryHighestValue), bodyBatteryLow: number(d.bodyBatteryLowestValue),
    bodyBatteryCharged: number(d.bodyBatteryChargedValue), bodyBatteryDrained: number(d.bodyBatteryDrainedValue),
    bodyBatterySleepCharge: number(d.bodyBatteryDuringSleep),
    steps: number(d.totalSteps), activeMinutes: number(d.moderateIntensityMinutes),
    lastSyncUtc: d.lastSyncTimestampGMT ?? null,
  };
}
