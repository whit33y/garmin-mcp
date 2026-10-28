import { addDays, dateRange, today } from './dates.js';
import { mapLimit } from './garmin.js';
import { deduplicateActivities, normalizeActivity, normalizeDay, mean, round } from './normalize.js';
import { analyzeSession, correlations, recovery, trainingLoad } from './analysis.js';
import { generatePlan, adaptPlan, sessionTemplate } from './planning.js';
import { healthAnalytics, mergeStress, mergeBodyBattery, validateHealthRange } from './health.js';

export class TrainingService {
  constructor({ client, store, timeZone = 'Europe/Warsaw', demo = false, clock = () => new Date() }) {
    Object.assign(this, { client, store, timeZone, demo, clock });
  }
  today() { return today(this.timeZone, this.clock()); }
  envelope(result) {
    return { mode: this.demo ? 'DEMO_SYNTHETIC_DATA' : 'GARMIN', generatedAt: this.clock().toISOString(), timeZone: this.timeZone, ...result };
  }
  async activities(startDate, endDate, { sport, search, limit = 2000 } = {}) {
    dateRange(startDate, endDate);
    const response = await this.client.activities(startDate, endDate, limit, search);
    return { activities: deduplicateActivities(response.items).filter(a => !sport || a.sport === sport), sources: response.sources,
      truncated: response.truncated, warnings: response.truncated ? ['Osiągnięto limit aktywności. Zakres jest niekompletny; zawęź daty.'] : [] };
  }
  async health(startDate, endDate) {
    const dates = dateRange(startDate, endDate, 90);
    const sources = []; const warnings = [];
    const read = async (name, path, query) => {
      try {
        const result = await this.client.get(path, query);
        sources.push({ name, path, fetchedAt: result.fetchedAt, cached: result.cached, available: result.data !== null });
        return result.data;
      } catch (error) { warnings.push({ source: name, message: error.message }); return null; }
    };
    const [sleep, hrv, summaries] = await Promise.all([
      read('sleep', '/sleep-service/sleep/dailySleepSummariesByDate', { startDate, endDate }),
      read('hrv', `/hrv-service/hrv/daily/${startDate}/${endDate}`),
      mapLimit(dates, 3, date => read(`daily:${date}`, '/usersummary-service/usersummary/daily', { calendarDate: date })),
    ]);
    if (sleep !== null && !Array.isArray(sleep)) warnings.push({ source: 'sleep', message: 'Nieznany format zakresu snu; dane pominięto.' });
    if (hrv !== null && !Array.isArray(hrv.hrvSummaries)) warnings.push({ source: 'hrv', message: 'Nieznany format zakresu HRV; dane pominięto.' });
    const sleeps = new Map((Array.isArray(sleep) ? sleep : []).map(s => [s.calendarDate, s]));
    const hrvs = new Map((Array.isArray(hrv?.hrvSummaries) ? hrv.hrvSummaries : []).map(h => [h.calendarDate, h]));
    return { days: dates.map((date, i) => normalizeDay(date, sleeps.get(date), hrvs.get(date), summaries[i])), sources, warnings };
  }
  async analyzeTraining({ activityId }) {
    const detail = await this.client.get(`/activity-service/activity/${activityId}`);
    if (!detail.data) throw new Error('Nie znaleziono treningu.');
    const date = normalizeActivity(detail.data).date;
    if (!date) throw new Error('Aktywność nie zawiera daty.');
    const start = addDays(date, -28);
    const [history, health] = await Promise.all([this.activities(start, date), this.health(start, date)]);
    const listItem = history.activities.find(a => a.id === activityId);
    const activity = normalizeActivity(detail.data);
    // The search endpoint has fields (e.g. strength sets) not guaranteed in detail.
    const merged = listItem ? { ...activity, garminLoad: activity.garminLoad ?? listItem.garminLoad,
      zoneMinutes: activity.zoneMinutes.map((v, i) => v ?? listItem.zoneMinutes[i]),
      strength: activity.sport === 'strength' && !activity.strength?.exercises.length ? listItem.strength : activity.strength } : activity;
    let workouts = null;
    try {
      const result = await this.client.get(`/activity-service/activity/${activityId}/workouts`);
      workouts = Array.isArray(result.data) ? result.data.map(w => ({ name: w.workoutName, sport: w.sport, steps: w.steps })) : null;
      history.sources.push({ endpoint: 'performed-workouts', fetchedAt: result.fetchedAt, cached: result.cached });
    } catch (error) { history.warnings.push(error.message); }
    return this.envelope({ ...analyzeSession(merged, history.activities), performedWorkouts: workouts,
      recoveryContext: recovery(health.days, date, this.checkin(date)),
      sources: [{ endpoint: 'activity-detail', fetchedAt: detail.fetchedAt, cached: detail.cached }, ...history.sources, ...health.sources],
      warnings: [...history.warnings, ...health.warnings] });
  }
  async analyzeLast({ sport } = {}) {
    // Fetch a bounded date range to resolve multisport legs without counting the parent twice.
    const result = await this.activities(addDays(this.today(), -179), this.today(), { sport });
    if (!result.activities.length) return this.envelope({ activity: null, message: 'Brak aktywności w ostatnich 180 dniach.', ...result });
    const last = result.activities.sort((a, b) => (b.startLocal ?? '').localeCompare(a.startLocal ?? ''))[0];
    const analysis = await this.analyzeTraining({ activityId: last.id });
    analysis.warnings.push(...result.warnings);
    return analysis;
  }
  checkin(date) { return this.store.get('wellbeing', date); }
  async analyzeHealth({ startDate, endDate, baselineDays = 28, domains = ['hrv', 'stress', 'sleep', 'bodyBattery'] }) {
    const range = validateHealthRange(startDate, endDate, baselineDays, this.today());
    const health = await this.health(range.from, range.to);
    const supplements = [
      ...(domains.includes('stress') ? [['stress', `/usersummary-service/stats/stress/daily/${range.from}/${range.to}`, {}, mergeStress]] : []),
      ...(domains.includes('bodyBattery') ? [['bodyBattery', '/wellness-service/wellness/bodyBattery/reports/daily', { startDate: range.from, endDate: range.to }, mergeBodyBattery]] : []),
    ];
    const results = await Promise.all(supplements.map(async ([name, path, query, merge]) => {
      try {
        const result = await this.client.get(path, query);
        if (result.data !== null && !Array.isArray(result.data)) throw new Error('Nieznany format danych.');
        return { name, path, merge, result };
      } catch (error) { return { name, error }; }
    }));
    for (const supplement of results) {
      if (supplement.error) { health.warnings.push({ source: supplement.name, message: supplement.error.message }); continue; }
      health.days = supplement.merge(health.days, supplement.result.data);
      health.sources.push({ name: supplement.name, path: supplement.path, fetchedAt: supplement.result.fetchedAt, cached: supplement.result.cached, available: supplement.result.data !== null });
    }
    return this.envelope({ ...healthAnalytics({ days: health.days, startDate, endDate, domains }), sources: health.sources, warnings: health.warnings,
      includesIncompleteToday: endDate === this.today() });
  }
  async summarizeRecovery({ date = this.today(), baselineDays = 28 }) {
    const health = await this.health(addDays(date, -baselineDays), date);
    return this.envelope({ ...recovery(health.days, date, this.checkin(date)), sources: health.sources, warnings: health.warnings });
  }
  async analyzeLoad({ startDate, endDate }) {
    const dates = dateRange(startDate, endDate, 90);
    const previousStart = addDays(startDate, -dates.length);
    const previousEnd = addDays(startDate, -1);
    const data = await this.activities(previousStart, endDate);
    const checkins = this.store.list('session-rating');
    const current = trainingLoad(data.activities, startDate, endDate, checkins);
    const previous = trainingLoad(data.activities, previousStart, previousEnd, checkins);
    const change = (a, b) => b > 0 && a !== null ? round((a - b) / b * 100) : null;
    return this.envelope({ current, previous, changePercent: {
      duration: current.durationMinutes.available === current.count && previous.durationMinutes.available === previous.count
        ? change(current.durationMinutes.value, previous.durationMinutes.value) : null,
      garminLoad: current.garminLoad.available === current.count && previous.garminLoad.available === previous.count
        ? change(current.garminLoad.value, previous.garminLoad.value) : null },
      sources: data.sources, warnings: data.warnings,
      limitations: ['Brak aktywności oznacza brak zapisanych treningów, nie dowód odpoczynku. Nie obliczamy ryzyka urazu z ilorazu obciążeń.', 'Sumy niepełnych metryk mają jawne pokrycie; porównuj zakresy o podobnej kompletności.'] });
  }
  async analyzeWeek({ startDate }) {
    const endDate = addDays(startDate, 6);
    const [load, health] = await Promise.all([this.analyzeLoad({ startDate, endDate }), this.health(addDays(startDate, -28), endDate)]);
    const weekDays = health.days.filter(d => d.date >= startDate);
    return this.envelope({ startDate, endDate, load, recovery: recovery(health.days, endDate, this.checkin(endDate)),
      dailyContext: weekDays,
      averages: Object.fromEntries(['sleepHours', 'sleepScore', 'hrvMs', 'restingHr', 'stress'].map(k => [k, { value: round(mean(weekDays.map(d => d[k]))), observations: weekDays.filter(d => Number.isFinite(d[k])).length }])),
      plan: this.store.get('plan')?.sessions.filter(s => s.date >= startDate && s.date <= endDate) ?? [],
      sources: health.sources, warnings: health.warnings });
  }
  async findCorrelations({ startDate, endDate }) {
    if (endDate >= this.today()) throw new Error('Dla zależności wybierz zakończone dni, najpóźniej wczoraj.');
    const [activityData, health] = await Promise.all([this.activities(startDate, endDate), this.health(startDate, endDate)]);
    if (activityData.truncated) throw new Error('Niekompletny zakres aktywności. Zawęź daty przed analizą zależności.');
    return this.envelope({ ...correlations(health.days, activityData.activities), sources: [...activityData.sources, ...health.sources], warnings: [...activityData.warnings, ...health.warnings] });
  }
  async suggestToday({ date = this.today(), availableMinutes = 60, preferredSport }) {
    const [regen, recent] = await Promise.all([this.summarizeRecovery({ date }), this.activities(addDays(date, -7), date)]);
    const plan = this.store.get('plan');
    const planned = plan?.sessions.filter(s => s.date === date && s.status === 'planned' && (!preferredSport || s.sport === preferredSport)) ?? [];
    const doneToday = recent.activities.filter(a => a.date === date);
    const reasons = [];
    const checkin = this.checkin(date);
    const suggestions = [];
    if (doneToday.length) reasons.push('Dzisiaj jest już zarejestrowany trening; dodatkowa sesja wymaga uwzględnienia jego obciążenia.');
    if (checkin?.pain) {
      reasons.push('Zgłoszono ból. Brak automatycznej propozycji treningu.');
    } else if (regen.status === 'caution') {
      reasons.push('Sygnały regeneracji przemawiają za odpoczynkiem lub ograniczeniem wysiłku.');
      suggestions.push({ kind: 'rest', title: 'Odpoczynek', durationMinutes: 0 });
    } else if (!doneToday.length) {
      if (planned.length) {
        let remaining = availableMinutes;
        for (const session of planned) {
          if (remaining < 10) break;
          const minutes = Math.min(session.durationMinutes, remaining);
          const uncertain = regen.status === 'insufficient_data';
          suggestions.push({ ...session, durationMinutes: minutes, intensity: uncertain ? 'easy' : session.intensity,
            instructions: uncertain ? sessionTemplate(session.sport, minutes).instructions : session.instructions });
          remaining -= minutes;
        }
        reasons.push('Wykorzystano zapisany plan z ograniczeniem do dostępnego czasu.');
      } else {
        const sport = preferredSport ?? plan?.goal.sports[0] ?? 'running';
        suggestions.push({ sport, ...sessionTemplate(sport, Math.min(availableMinutes, 30)) });
        reasons.push('Brak zaplanowanej sesji; podano spokojną propozycję ogólną.');
      }
    }
    if (regen.status === 'insufficient_data') reasons.push('Za mało porównywalnych danych regeneracji; intensywność nie jest zwiększana.');
    return this.envelope({ date, suggestions, reasons, recovery: regen, recentActivities: recent.activities, planned, doneToday,
      warnings: recent.warnings, mutatesPlan: false });
  }
  async planTraining(input) {
    if (input.startDate < this.today()) throw new Error('Nowy plan musi zaczynać się dzisiaj lub później.');
    if (input.goal.eventDate && input.goal.eventDate < input.startDate) throw new Error('Zawody nie mogą poprzedzać początku planu.');
    const baselineEndDate = input.startDate <= this.today() ? addDays(input.startDate, -1) : addDays(this.today(), -1);
    const result = await this.activities(addDays(baselineEndDate, -27), baselineEndDate);
    if (result.truncated) throw new Error('Historia jest niekompletna; nie można ustalić bazowego obciążenia.');
    const plan = generatePlan({ ...input, activities: result.activities, baselineEndDate });
    const revision = this.store.get('plan')?.revision ?? 0;
    const proposal = this.store.propose(plan, 'Nowy plan pod cel', revision);
    return this.envelope({ proposal, requiresConfirmation: true, currentRevision: revision, sources: result.sources, warnings: result.warnings });
  }
  async adaptTraining(input) {
    const plan = this.store.get('plan');
    if (!plan) throw new Error('Najpierw utwórz i zatwierdź plan.');
    const date = input.date ?? this.today();
    if (date < this.today()) throw new Error('Adaptacja nie może zmieniać przeszłości.');
    const from = plan.startDate > date ? date : plan.startDate < addDays(date, -179) ? addDays(date, -179) : plan.startDate;
    const [regen, completed] = await Promise.all([this.summarizeRecovery({ date }), this.activities(from, date)]);
    const adapted = adaptPlan({ ...input, plan, date, recoveryStatus: regen.status, completed: completed.activities });
    if (!adapted.changes.length) return this.envelope({ message: 'Brak zmian do zapisania.', recovery: regen });
    const proposal = this.store.propose(adapted.plan, input.reason, plan.revision);
    return this.envelope({ proposal, changes: adapted.changes, recovery: regen, warnings: completed.warnings, requiresConfirmation: true, currentRevision: plan.revision });
  }
}
