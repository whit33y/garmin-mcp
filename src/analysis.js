import { addDays, dateRange } from './dates.js';
import { mean, median, round } from './normalize.js';

export function sumAvailable(values) {
  const valid = values.filter(v => v !== null && Number.isFinite(v));
  return { value: valid.length ? round(valid.reduce((a, b) => a + b, 0)) : null, available: valid.length, total: values.length };
}

export function trainingLoad(activities, startDate, endDate, checkins = []) {
  const days = dateRange(startDate, endDate);
  const selected = activities.filter(a => a.date >= startDate && a.date <= endDate);
  const sports = ['running', 'cycling', 'swimming', 'strength', 'other'];
  const daily = days.map(date => {
    const items = selected.filter(a => a.date === date);
    return { date, count: items.length, durationMinutes: sumAvailable(items.map(a => a.durationMinutes)),
      garminLoad: sumAvailable(items.map(a => a.garminLoad)),
      hardSessions: items.filter(a => (a.trainingEffect ?? 0) >= 4 || (a.anaerobicTrainingEffect ?? 0) >= 3).map(a => a.id),
    };
  });
  return {
    startDate, endDate, count: selected.length,
    durationMinutes: sumAvailable(selected.map(a => a.durationMinutes)),
    garminLoad: sumAvailable(selected.map(a => a.garminLoad)),
    bySport: Object.fromEntries(sports.map(sport => {
      const group = selected.filter(a => a.sport === sport);
      const rated = group.map(a => {
        const rating = checkins.find(c => c.activityId === a.id)?.rpe;
        return a.durationMinutes !== null && Number.isFinite(rating) ? a.durationMinutes * rating : null;
      });
      return [sport, { count: group.length, durationMinutes: sumAvailable(group.map(a => a.durationMinutes)),
        distanceKm: sport === 'strength' ? null : sumAvailable(group.map(a => a.distanceKm)),
        garminLoad: sumAvailable(group.map(a => a.garminLoad)), tss: sumAvailable(group.map(a => a.tss)),
        sessionRpeLoad: sumAvailable(rated),
        strengthVolumeKgReps: sport === 'strength' ? sumAvailable(group.flatMap(a => a.strength?.exercises.map(e => e.volumeKgReps) || [])) : null,
      }];
    })),
    daily,
    methods: {
      garminLoad: 'Suma activityTrainingLoad wyłącznie tam, gdzie Garmin udostępnia pomiar. Nie jest pełnym obciążeniem mięśniowym.',
      sessionRpeLoad: 'Czas sesji w minutach × podane przez użytkownika RPE 0–10. Raportowany osobno od Garmin Load i TSS.',
      strengthVolumeKgReps: 'Suma ciężar × powtórzenia z zapisanych serii; brak ciężaru nie oznacza zerowego obciążenia.',
    },
  };
}

export function recovery(days, targetDate, checkin) {
  const target = days.find(d => d.date === targetDate) ?? { date: targetDate };
  const historical = days.filter(d => d.date < targetDate);
  const metrics = ['sleepHours', 'sleepScore', 'hrvMs', 'restingHr', 'stress', 'bodyBatteryWake'];
  const baseline = Object.fromEntries(metrics.map(key => {
    const values = historical.map(d => d[key]).filter(v => v !== null && Number.isFinite(v));
    return [key, { median: round(median(values)), observations: values.length }];
  }));
  const flags = [];
  const compare = (metric, condition, text) => {
    const b = baseline[metric];
    if (b.observations >= 7 && target[metric] !== null && Number.isFinite(target[metric]) && condition(target[metric], b.median)) flags.push({ metric, value: target[metric], baseline: b.median, text });
  };
  compare('sleepHours', (v, b) => v < b * 0.8, 'Sen krótszy o ponad 20% od mediany.');
  compare('hrvMs', (v, b) => v < b * 0.8, 'HRV niższe o ponad 20% od mediany.');
  compare('restingHr', (v, b) => v >= b + 7, 'Tętno spoczynkowe wyższe o co najmniej 7 bpm od mediany.');
  compare('bodyBatteryWake', (v, b) => v < b * 0.8, 'Body Battery po przebudzeniu niższe o ponad 20% od mediany.');
  if ((checkin?.soreness ?? 0) >= 7 || checkin?.pain || (checkin?.energy !== undefined && checkin.energy <= 3)) flags.push({ metric: 'wellbeing', text: 'Zgłoszono ból, dużą bolesność lub niski poziom energii.' });
  const comparable = metrics.filter(k => Number.isFinite(target[k]) && baseline[k].observations >= 7);
  const status = flags.length ? 'caution' : comparable.length >= 3 ? 'typical' : 'insufficient_data';
  return {
    date: targetDate, status, current: target, baseline, comparableMetrics: comparable, flags,
    missing: metrics.filter(k => target[k] === null || target[k] === undefined),
    wellbeing: checkin ?? null,
    recentDays: days.filter(d => d.date >= addDays(targetDate, -6) && d.date <= targetDate),
    method: 'Przejrzysta heurystyka v1 względem mediany poprzednich dni (minimum 7 obserwacji dla metryki). Progi są ustawieniami produktu, nie zwalidowanym testem gotowości ani Garmin Training Readiness. Typowy wynik nie potwierdza pełnej regeneracji.',
  };
}

export function pearson(pairs) {
  if (pairs.length < 2) return null;
  const mx = mean(pairs.map(p => p[0])); const my = mean(pairs.map(p => p[1]));
  let covariance = 0; let vx = 0; let vy = 0;
  for (const [x, y] of pairs) { covariance += (x - mx) * (y - my); vx += (x - mx) ** 2; vy += (y - my) ** 2; }
  return vx && vy ? round(covariance / Math.sqrt(vx * vy), 3) : null;
}

export function correlations(days, activities) {
  const byDate = new Map(days.map(d => [d.date, d]));
  const definitions = [
    ['sleepHours', 'hrvMs', 0], ['sleepHours', 'restingHr', 0],
    ['stress', 'sleepHours', 1], ['trainingMinutes', 'sleepHours', 1],
    ['trainingMinutes', 'hrvMs', 1], ['strengthMinutes', 'hrvMs', 1],
  ];
  const results = definitions.map(([x, y, lagDays]) => {
    const pairs = days.flatMap(day => {
      const matches = activities.filter(a => a.date === day.date && (x !== 'strengthMinutes' || a.sport === 'strength'));
      // Absence of recorded activity is explicitly an assumption, not missing HRV/sleep imputed as zero.
      const training = !matches.length ? 0 : sumAvailable(matches.map(a => a.durationMinutes));
      const xv = x.endsWith('Minutes') ? (typeof training === 'number' ? training : training.available === training.total ? training.value : null) : day[x];
      const yv = byDate.get(addDays(day.date, lagDays))?.[y];
      return Number.isFinite(xv) && Number.isFinite(yv) ? [[xv, yv, day.date]] : [];
    });
    return { x, y, lagDays, pairs: pairs.length, r: pairs.length >= 14 ? pearson(pairs) : null,
      status: pairs.length < 14 ? 'insufficient_pairs' : pearson(pairs) === null ? 'constant_series' : 'exploratory',
      from: pairs[0]?.[2] ?? null, to: pairs.at(-1)?.[2] ?? null };
  });
  return {
    results,
    limitations: ['Korelacja nie ustala przyczyny. Analiza eksploracyjna wielu par, bez testu istotności i kontroli czynników zakłócających.',
      'Sen przypisany jest do daty przebudzenia. Lag 1 łączy trening/stres z poprzedniego dnia ze snem lub HRV następnego dnia.',
      'Dzień bez zarejestrowanej aktywności oznacza 0 zarejestrowanych minut; nie dowodzi braku ćwiczeń. Analizuj tylko kompletnie pobrany zakres aktywności.'],
  };
}

export function analyzeSession(activity, comparable = []) {
  const peers = comparable.filter(a => a.id !== activity.id && a.sport === activity.sport && a.date < activity.date
    && activity.durationMinutes > 0 && a.durationMinutes >= activity.durationMinutes * 0.8 && a.durationMinutes <= activity.durationMinutes * 1.2);
  const observations = [];
  if ((activity.trainingEffect ?? 0) >= 4) observations.push('Garmin klasyfikuje efekt aerobowy tej sesji jako wysoki (Training Effect ≥4).');
  if (activity.sport === 'strength') observations.push('Tętno i Garmin Load nie opisują pełnego obciążenia siłowego; uwzględnij serie, ciężary i samopoczucie.');
  return {
    activity, observations,
    comparison: { observations: peers.length, medianHr: round(median(peers.map(a => a.averageHr))),
      medianPaceSecondsPerKm: round(median(peers.map(a => a.paceSecondsPerKm))),
      medianPowerW: round(median(peers.map(a => a.averagePowerW))),
      method: 'Ten sam sport i czas sesji ±20%, poprzednie aktywności. Brak kontroli trasy, pogody i celu sesji — nie jest to dowód poprawy formy.' },
    limitations: ['Podsumowanie nie zawiera pełnych próbek ani okrążeń. Dryf tętna i jakość poszczególnych interwałów wymagają odczytu oryginalnego FIT (poza tą wersją).'],
  };
}
