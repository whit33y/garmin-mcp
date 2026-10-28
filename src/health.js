import { addDays, dateRange } from './dates.js';
import { number, positive, round, mean, median } from './normalize.js';

const measured = (row, key) => Number.isFinite(row[key]);

export function metricSummary(days, key) {
  const values = days.filter(d => measured(d, key)).map(d => d[key]);
  return { mean: round(mean(values)), median: round(median(values)),
    min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null,
    observations: values.length, totalDays: days.length };
}

function comparison(current, baseline, key) {
  const period = metricSummary(current, key); const reference = metricSummary(baseline, key);
  const delta = reference.observations >= 7 && period.observations >= 3 ? round(period.mean - reference.median) : null;
  return { period, reference, changeFromReferenceMedian: delta,
    changePercent: delta !== null && reference.median > 0 ? round(delta / reference.median * 100) : null };
}

export function mergeStress(days, rows) {
  const byDate = new Map((Array.isArray(rows) ? rows : []).map(row => [row.calendarDate, row.values ?? {}]));
  return days.map(day => {
    const values = byDate.get(day.date);
    if (!values) return day;
    const result = { ...day };
    if (number(values.overallStressLevel) !== null) result.stress = number(values.overallStressLevel);
    for (const [target, source] of Object.entries({ stressHighMinutes: 'highStressDuration', stressMediumMinutes: 'mediumStressDuration', stressLowMinutes: 'lowStressDuration', stressRestMinutes: 'restStressDuration' })) {
      if (number(values[source]) !== null) result[target] = round(values[source] / 60);
    }
    return result;
  });
}

export function mergeBodyBattery(days, rows) {
  const byDate = new Map((Array.isArray(rows) ? rows : []).map(row => [row.date, row]));
  return days.map(day => {
    const raw = byDate.get(day.date);
    if (!raw) return day;
    const descriptors = Array.isArray(raw.bodyBatteryValueDescriptorDTOList) ? raw.bodyBatteryValueDescriptorDTOList : [];
    const column = descriptors.find(d => d.bodyBatteryValueDescriptorKey === 'bodyBatteryLevel')?.bodyBatteryValueDescriptorIndex;
    const points = Number.isInteger(column) && Array.isArray(raw.bodyBatteryValuesArray)
      ? raw.bodyBatteryValuesArray.map(row => number(row[column])).filter(v => v !== null && v <= 100) : [];
    return { ...day,
      bodyBatteryCharged: number(raw.charged) ?? day.bodyBatteryCharged,
      bodyBatteryDrained: number(raw.drained) ?? day.bodyBatteryDrained,
      bodyBatteryHigh: points.length ? Math.max(...points) : day.bodyBatteryHigh,
      bodyBatteryLow: points.length ? Math.min(...points) : day.bodyBatteryLow,
      bodyBatterySamples: points.length,
    };
  });
}

// Sleep timestamps marked Local by Garmin encode wall-clock time. Work on
// the local clock, not the host timezone. Center around noon before taking
// statistics so 23:50 and 00:10 are twenty minutes apart, not 23h40m.
export function localClockMinutes(value) {
  if (typeof value === 'string') {
    const match = /^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/.exec(value);
    if (match) {
      const hours = Number(match[1]); const minutes = Number(match[2]);
      return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
    }
  }
  if ((typeof value === 'number' && value > 1e11) || (typeof value === 'string' && /^\d{13}$/.test(value))) {
    const date = new Date(Number(value));
    return Number.isFinite(date.valueOf()) ? date.getUTCHours() * 60 + date.getUTCMinutes() : null;
  }
  return null;
}

function bedtimeRegularity(days) {
  const values = days.map(d => localClockMinutes(d.sleepStartLocal)).filter(v => v !== null).map(v => v < 720 ? v + 1440 : v);
  const center = mean(values);
  return {
    observations: values.length,
    standardDeviationMinutes: values.length >= 3 ? round(Math.sqrt(mean(values.map(v => (v - center) ** 2)))) : null,
    method: 'Odchylenie standardowe lokalnej pory zaśnięcia, dzień liczony od południa. Minimum 3 noce. Nie ocenia osób o nietypowym lub zmianowym rytmie snu.',
  };
}

export function healthAnalytics({ days, startDate, endDate, domains = ['hrv', 'stress', 'sleep', 'bodyBattery'] }) {
  const period = days.filter(d => d.date >= startDate && d.date <= endDate);
  const baseline = days.filter(d => d.date < startDate);
  const stats = keys => Object.fromEntries(keys.map(key => [key, comparison(period, baseline, key)]));
  const reports = {};
  if (domains.includes('hrv')) {
    const statuses = {};
    for (const day of period) if (day.hrvStatus && !['NONE', 'INVALID'].includes(day.hrvStatus)) statuses[day.hrvStatus] = (statuses[day.hrvStatus] ?? 0) + 1;
    reports.hrv = {
      metrics: stats(['hrvMs', 'hrvWeeklyAverageMs', 'restingHr']), statuses,
      outsideGarminBalancedRange: period.flatMap(d => positive(d.hrvWeeklyAverageMs) !== null && positive(d.hrvBaselineLowMs) !== null && positive(d.hrvBaselineHighMs) !== null
        && (d.hrvWeeklyAverageMs < d.hrvBaselineLowMs || d.hrvWeeklyAverageMs > d.hrvBaselineHighMs)
        ? [{ date: d.date, weeklyAverageMs: d.hrvWeeklyAverageMs, balancedLowMs: d.hrvBaselineLowMs, balancedHighMs: d.hrvBaselineHighMs }] : []),
      method: 'Porównujemy nocne HRV z własną historią. Zakres BALANCED Garmina zestawiamy z jego średnią tygodniową, nie z pojedynczym odczytem nocnym. Nie stosujemy uniwersalnej normy HRV ani diagnozy.',
    };
  }
  if (domains.includes('stress')) reports.stress = {
    metrics: stats(['stress', 'stressHighMinutes', 'stressMediumMinutes', 'stressLowMinutes', 'stressRestMinutes']),
    method: 'Poziom i czas stresu fizjologicznego z Garmina. Okresy aktywności, braku pomiaru i snu mają wpływ na pokrycie. Wynik nie opisuje bezpośrednio samopoczucia psychicznego ani pełnego czasu doby.',
  };
  if (domains.includes('sleep')) reports.sleep = {
    metrics: stats(['sleepHours', 'sleepScore', 'deepMinutes', 'remMinutes', 'awakeMinutes', 'awakenings', 'napMinutes', 'sleepStress', 'respirationPerMinute']),
    regularity: bedtimeRegularity(period),
    method: 'Sen przypisany do dnia przebudzenia; drzemki osobno. Stadia i oddech są szacunkami urządzenia. Zmiany względem historii nie są kliniczną oceną snu. Nie przeliczamy sleepNeed.actual: Swagger nie określa jego jednostki.',
  };
  if (domains.includes('bodyBattery')) reports.bodyBattery = {
    metrics: stats(['bodyBatteryWake', 'bodyBatteryHigh', 'bodyBatteryLow', 'bodyBatteryCharged', 'bodyBatteryDrained', 'bodyBatterySleepCharge']),
    method: 'Ładowanie i zużycie jako osobne wartości Garmina; ich różnica nie jest zmianą energii organizmu. Brak odczytów nie oznacza zerowego zasobu. Wyniki historyczne nie używają ostatniego pomiaru jako wartości końca dnia.',
  };
  return {
    startDate, endDate, referencePeriod: { startDate: baseline[0]?.date ?? null, endDate: baseline.at(-1)?.date ?? null },
    reports, daily: period,
    limitations: ['Analiza opisuje pomiary i trendy, bez rozpoznawania chorób.', 'Średnie mogą obejmować różne liczby dni; zawsze porównaj pokrycie. Zmiana względem normy wymaga ≥7 dni odniesienia i ≥3 dni badanego okresu.'],
  };
}

export function validateHealthRange(startDate, endDate, baselineDays, today) {
  dateRange(startDate, endDate, 60);
  if (endDate > today) throw new Error('Analiza zdrowotna nie obejmuje przyszłych dni.');
  return { from: addDays(startDate, -baselineDays), to: endDate };
}
