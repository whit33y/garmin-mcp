export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function addDays(date, days) {
  if (!validDate(date)) throw new Error('Nieprawidłowa data YYYY-MM-DD.');
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

export function dateRange(start, end, maxDays = 180) {
  if (!validDate(start) || !validDate(end) || start > end) throw new Error('Nieprawidłowy zakres dat.');
  const size = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  if (size > maxDays) throw new Error(`Maksymalny zakres to ${maxDays} dni.`);
  return Array.from({ length: size }, (_, i) => addDays(start, i));
}

export function today(timeZone = 'Europe/Warsaw', now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function weekday(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
}
