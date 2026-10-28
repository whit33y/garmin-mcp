import { loadEnv, config } from '../src/config.js';
import { GarminClient } from '../src/garmin.js';
import { today, addDays } from '../src/dates.js';
import { Store } from '../src/store.js';
import { TrainingService } from '../src/service.js';

// Deliberately print only availability and counts, never health data or tokens.
try {
  loadEnv();
  const settings = config();
  const client = new GarminClient(settings);
  await client.accessToken();
  console.log('Garmin token exchange: OK');
  const date = today(settings.timeZone);
  const activities = await client.activities(addDays(date, -6), date, 5);
  console.log(`Activity search: OK (${activities.items.length} records sampled; no private data printed)`);
  for (const [name, path, query] of [
    ['daily summary', '/usersummary-service/usersummary/daily', { calendarDate: date }],
    ['sleep', '/sleep-service/sleep/dailySleep', { date }],
    ['HRV', `/hrv-service/hrv/${date}`, {}],
  ]) {
    try {
      const result = await client.get(path, query);
      console.log(`${name}: ${result.data === null ? 'no data for this date' : 'OK'}`);
    } catch (error) { console.error(`${name}: ${error.message}`); process.exitCode = 1; }
  }
  if (process.argv.includes('--deep')) {
    const store = new Store(':memory:');
    try {
      const service = new TrainingService({ client, store, timeZone: settings.timeZone });
      const recovered = await service.summarizeRecovery({ date, baselineDays: 7 });
      console.log(`Recovery normalization: OK (${recovered.comparableMetrics.length} comparable metric types; ${recovered.warnings.length} source warnings)`);
      const lastId = activities.items[0]?.activityId;
      if (lastId) {
        const analysis = await service.analyzeTraining({ activityId: String(lastId) });
        console.log(`Actual training analysis: OK (${analysis.warnings.length} source warnings; no private measurements printed)`);
      }
    } finally { store.close(); }
  }
  if (process.argv.includes('--health')) {
    const store = new Store(':memory:');
    try {
      const service = new TrainingService({ client, store, timeZone: settings.timeZone });
      const report = await service.analyzeHealth({ startDate: addDays(date, -7), endDate: addDays(date, -1), baselineDays: 7 });
      for (const [name, section] of Object.entries(report.reports)) {
        const available = Object.values(section.metrics).filter(metric => metric.period.observations > 0).length;
        console.log(`Health ${name}: ${available} metric types available (no measurements printed)`);
      }
      console.log(`Health source warnings: ${report.warnings.length}`);
      for (const warning of report.warnings) console.error(`${warning.source}: ${warning.message}`);
      if (report.warnings.length) process.exitCode = 1;
    } finally { store.close(); }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
