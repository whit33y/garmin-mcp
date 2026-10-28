import { addDays, today } from './dates.js';

// Synthetic fixtures, never mixed into real Garmin responses.
export class DemoClient {
  constructor(timeZone = 'Europe/Warsaw', anchor = today(timeZone)) {
    this.anchor = anchor;
    this.items = Array.from({ length: 120 }, (_, i) => {
      const n = 120 - i;
      const type = ['running', 'cycling', 'lap_swimming', 'strength_training'][n % 4];
      const strength = type === 'strength_training';
      const duration = (strength ? 45 : 35 + n % 5 * 10) * 60;
      const speed = type === 'cycling' ? 7 : type === 'lap_swimming' ? 0.7 : strength ? 0 : 2.8;
      return { activityId: 1000 + n, activityName: `DEMO ${type} ${n}`, activityType: { typeKey: type },
        startTimeLocal: `${addDays(anchor, -i - 1)} 17:00:00`, duration, distance: duration * speed,
        averageSpeed: speed, averageHR: strength ? 105 : 130 + n % 12, maxHR: 160,
        averagePower: type === 'cycling' ? 180 + n % 20 : undefined,
        aerobicTrainingEffect: 2.5, activityTrainingLoad: strength ? undefined : 50 + n % 30,
        hrTimeInZone_1: 600, hrTimeInZone_2: duration - 600, hrTimeInZone_3: 0, hrTimeInZone_4: 0, hrTimeInZone_5: 0,
        averageSwolf: type === 'lap_swimming' ? 38 : undefined,
        totalSets: strength ? 12 : undefined, totalReps: strength ? 96 : undefined,
        summarizedExerciseSets: strength ? [{ category: 'SQUAT', subCategory: 'BARBELL_BACK_SQUAT', reps: 24, sets: 3, maxWeight: 60000, volume: 1440000, duration: 600000 }] : undefined,
      };
    });
  }
  async activities(startDate, endDate, maxItems = 2000, search) {
    const all = this.items.filter(a => (!startDate || a.startTimeLocal.slice(0, 10) >= startDate) && (!endDate || a.startTimeLocal.slice(0, 10) <= endDate)
      && (!search || a.activityName.toLowerCase().includes(search.toLowerCase())));
    return { items: all.slice(0, maxItems), truncated: all.length > maxItems, sources: [{ endpoint: 'demo-activities', fetchedAt: new Date().toISOString(), cached: false }] };
  }
  day(date) {
    const n = Math.abs(Math.floor(Date.parse(date) / 86400000));
    return { calendarDate: date, sleepTimeSeconds: (6.8 + (n % 7) * 0.15) * 3600,
      sleepScores: { overall: { value: 75 + n % 15 } }, deepSleepSeconds: 4200, remSleepSeconds: 6000, awakeSleepSeconds: 900,
      sleepStartTimestampLocal: `${addDays(date, -1)}T23:15:00`, sleepEndTimestampLocal: `${date}T07:00:00`,
      napTimeSeconds: n % 3 === 0 ? 1200 : 0, awakeCount: 2 + n % 3, avgSleepStress: 15 + n % 8, averageRespirationValue: 14,
      restingHeartRate: 50 + n % 4, averageStressLevel: 25 + n % 12,
      highStressDuration: 1800 + n % 4 * 300, mediumStressDuration: 3600, lowStressDuration: 7200, restStressDuration: 18000,
      bodyBatteryAtWakeTime: 70 + n % 20, bodyBatteryMostRecentValue: 55, bodyBatteryHighestValue: 90, bodyBatteryLowestValue: 25,
      bodyBatteryChargedValue: 65 + n % 10, bodyBatteryDrainedValue: 55 + n % 15, bodyBatteryDuringSleep: 60,
      totalSteps: 8000, lastSyncTimestampGMT: `${date}T08:00:00Z`,
      lastNightAvg: 45 + n % 9, weeklyAvg: 48 + n % 3, baseline: { balancedLow: 40, balancedUpper: 60 }, status: 'BALANCED' };
  }
  async get(path, query = {}) {
    let data;
    if (path.includes('/activity-service/activity/')) {
      if (path.endsWith('/workouts')) data = [];
      else data = this.items.find(a => String(a.activityId) === path.split('/').at(-1)) ?? null;
    } else if (path.includes('dailySleepSummariesByDate')) {
      const { dateRange } = await import('./dates.js'); data = dateRange(query.startDate, query.endDate).map(d => this.day(d));
    } else if (path.includes('/hrv/daily/')) {
      const { dateRange } = await import('./dates.js');
      const [start, end] = path.split('/').slice(-2); data = { hrvSummaries: dateRange(start, end).map(d => this.day(d)) };
    } else if (path.includes('/stats/stress/daily/')) {
      const { dateRange } = await import('./dates.js');
      const [start, end] = path.split('/').slice(-2);
      data = dateRange(start, end).map(date => {
        const day = this.day(date);
        return { calendarDate: date, values: { overallStressLevel: day.averageStressLevel,
          highStressDuration: day.highStressDuration, mediumStressDuration: day.mediumStressDuration,
          lowStressDuration: day.lowStressDuration, restStressDuration: day.restStressDuration } };
      });
    } else if (path.includes('/bodyBattery/reports/daily')) {
      const { dateRange } = await import('./dates.js');
      data = dateRange(query.startDate, query.endDate).map(date => ({ date, charged: this.day(date).bodyBatteryChargedValue,
        drained: this.day(date).bodyBatteryDrainedValue,
        bodyBatteryValueDescriptorDTOList: [{ bodyBatteryValueDescriptorIndex: 0, bodyBatteryValueDescriptorKey: 'timestamp' }, { bodyBatteryValueDescriptorIndex: 1, bodyBatteryValueDescriptorKey: 'bodyBatteryLevel' }],
        bodyBatteryValuesArray: [[`${date}T06:00:00Z`, 90], [`${date}T18:00:00Z`, 25]],
      }));
    } else if (path.includes('usersummary/daily')) data = this.day(query.calendarDate);
    else if (path.includes('dailySleep')) data = this.day(query.date);
    else if (path.includes('/hrv/')) data = { hrvSummary: this.day(path.split('/').at(-1)) };
    else if (path.includes('heartRateZones')) data = [];
    else throw new Error('Nieobsługiwany endpoint demonstracyjny.');
    return { data, fetchedAt: new Date().toISOString(), cached: false };
  }
}
