import { randomUUID } from 'node:crypto';
import { addDays, dateRange, weekday } from './dates.js';
import { mean, round } from './normalize.js';

export function sessionTemplate(sport, minutes, phase = 'base') {
  const strength = sport === 'strength';
  return {
    title: strength ? 'Siła — sesja ogólna' : sport === 'swimming' ? 'Pływanie spokojne i technika' : sport === 'cycling' ? 'Spokojna jazda' : 'Spokojny bieg',
    intensity: 'easy', durationMinutes: minutes,
    instructions: strength
      ? ['Rozgrzewka i przygotowanie ruchowe.', 'Dobierz znane ćwiczenia do swojego doświadczenia i sprzętu; pozostaw około 3 powtórzeń w zapasie.', 'Zapisz ćwiczenia, ciężary, powtórzenia oraz RPE/RIR.']
      : ['Spokojny wysiłek, bez narzucania tempa lub mocy przy braku aktualnych progów.', 'Podziel dostępny czas na rozgrzewkę, część główną i spokojne zakończenie.'],
    phase,
  };
}

export function generatePlan({ startDate, endDate, goal, availability, activities, customSessions, baselineEndDate = addDays(startDate, -1) }) {
  const dates = dateRange(startDate, endDate, 180);
  const uniqueDays = new Set(availability.map(a => a.weekday));
  if (uniqueDays.size !== availability.length) throw new Error('Każdy dzień tygodnia może wystąpić w dostępności tylko raz.');
  if (!goal.sports.length) throw new Error('Wybierz co najmniej jedną dyscyplinę.');
  const cutoff = addDays(baselineEndDate, -27);
  const history = activities.filter(a => a.date >= cutoff && a.date <= baselineEndDate);
  const bySport = Object.fromEntries(goal.sports.map(sport => [sport, history.filter(a => a.sport === sport)]));
  const weeklyMinutes = history.reduce((sum, a) => sum + (a.durationMinutes ?? 0), 0) / 4;
  const notes = ['Plan jest szkicem do zatwierdzenia. Brak progów, doświadczenia lub pełnej historii oznacza spokojne sesje zamiast wymyślonych intensywności.',
    'Opis celu i wynik docelowy są kontekstem dla modelu. Generator nie wyznacza tempa startowego ani specjalistycznej periodyzacji dla wyniku. Dostosuj szkic przez customSessions.'];
  const sessions = [];
  if (customSessions) {
    const seen = new Set();
    for (const session of customSessions) {
      if (session.date < startDate || session.date > endDate) throw new Error('Sesja poza zakresem planu.');
      const slot = availability.find(a => a.weekday === weekday(session.date));
      if (!slot || session.durationMinutes > slot.minutes) throw new Error('Sesja przekracza dostępną ilość czasu.');
      if (!goal.sports.includes(session.sport)) throw new Error('Dyscyplina sesji nie pasuje do celu.');
      const key = `${session.date}:${session.sport}`;
      if (seen.has(key)) throw new Error('Powtórzona sesja tej samej dyscypliny w jednym dniu.');
      seen.add(key);
      sessions.push({ ...session, id: randomUUID(), status: 'planned' });
    }
    for (const date of dates) {
      const total = sessions.filter(s => s.date === date).reduce((sum, s) => sum + s.durationMinutes, 0);
      const budget = availability.find(a => a.weekday === weekday(date))?.minutes ?? 0;
      if (total > budget) throw new Error('Łączny czas sesji w dniu przekracza dostępność.');
    }
    notes.push('Sesje szczegółowe dostarczone przez model/użytkownika; przed zatwierdzeniem porównaj ich obciążenie z historią.');
  } else {
    let index = 0;
    const weeklyBudget = weeklyMinutes > 0 ? weeklyMinutes : 90;
    for (let week = 0; week * 7 < dates.length; week++) {
      const weekDates = dates.slice(week * 7, week * 7 + 7);
      const slots = weekDates.filter(date => availability.some(a => a.weekday === weekday(date)));
      const phase = week % 4 === 3 ? 'deload' : week < 2 ? 'base' : 'build';
      const progression = phase === 'deload' ? 0.75 : Math.min(1.15, 1 + week * 0.03);
      const minutesPerSession = slots.length ? weeklyBudget * progression / slots.length : 0;
      for (const date of slots) {
        if (goal.eventDate && date >= goal.eventDate) continue;
        const slot = availability.find(a => a.weekday === weekday(date));
        const sport = goal.sports[index++ % goal.sports.length];
        const typical = mean(bySport[sport].map(a => a.durationMinutes));
        const taper = Boolean(goal.eventDate && date >= addDays(goal.eventDate, -7));
        const minutes = Math.floor(Math.min(slot.minutes, typical ? typical * 1.1 : 30, minutesPerSession * (taper ? 0.6 : 1)));
        if (minutes < 10) continue;
        sessions.push({ id: randomUUID(), date, sport, ...sessionTemplate(sport, minutes, taper ? 'taper' : phase), status: 'planned' });
      }
    }
    if (!history.length) notes.push('Brak historii treningów: zastosowano roboczy budżet 90 min/tydzień; to nie ocena Twojej sprawności. Uzupełnij historię lub podaj customSessions.');
    if (goal.eventDate) notes.push('Ostatnie 7 dni przed zawodami mają zmniejszoną objętość. Sam start nie jest automatycznie zapisywany jako zwykła sesja.');
  }
  const weeks = [];
  for (let i = 0; i < dates.length; i += 7) {
    const start = dates[i]; const end = dates[Math.min(i + 6, dates.length - 1)];
    weeks.push({ start, end, minutes: round(sessions.filter(s => s.date >= start && s.date <= end).reduce((sum, s) => sum + s.durationMinutes, 0)) });
  }
  if (!sessions.length) throw new Error('Brak sesji mieszczących się w dostępności i zakresie dat. Zmień dostępność lub podaj customSessions.');
  return { goal, startDate, endDate, availability, sessions, weeklySummary: weeks, notes, baselineWeeklyMinutes: round(weeklyMinutes), baselineEndDate };
}

export function adaptPlan({ plan, date, recoveryStatus, missedSessionIds = [], unavailableDates = [], completed = [], reason, replacements }) {
  const knownIds = new Set(plan.sessions.map(s => s.id));
  if (missedSessionIds.some(id => !knownIds.has(id))) throw new Error('Nieznany identyfikator opuszczonej sesji.');
  if (missedSessionIds.some(id => plan.sessions.find(s => s.id === id).date > date)) throw new Error('Przyszłą sesję odwołaj przez unavailableDates, zamiast oznaczać jako opuszczoną.');
  const changes = [];
  const sessions = plan.sessions.map(s => {
    let result = { ...s };
    if (missedSessionIds.includes(s.id)) result = { ...result, status: 'missed' };
    if (s.status === 'planned' && s.date <= date && !missedSessionIds.includes(s.id)) {
      const match = completed.find(a => a.date === s.date && a.sport === s.sport);
      if (match) result = { ...result, status: 'completed', activityId: match.id, completionMatch: 'date_and_sport_unverified' };
    }
    if (result.status === 'planned' && s.date >= date) {
      if (unavailableDates.includes(s.date)) result = { ...result, status: 'cancelled' };
      else if (s.date <= addDays(date, 1) && recoveryStatus === 'caution') {
        result = { ...result, intensity: 'easy', durationMinutes: Math.max(10, Math.floor(s.durationMinutes * 0.65)),
          instructions: [...s.instructions, 'Objętość zmniejszona ze względu na sygnały regeneracji; oceń samopoczucie przed rozpoczęciem.'] };
      }
    }
    if (JSON.stringify(result) !== JSON.stringify(s)) changes.push({ id: s.id, before: s, after: result });
    return result;
  });
  if (replacements) {
    for (const replacement of replacements) {
      const index = sessions.findIndex(s => s.id === replacement.sessionId);
      if (index < 0 || sessions[index].status !== 'planned' || sessions[index].date < date) throw new Error('Można zmieniać tylko zaplanowane sesje od dziś.');
      const before = { ...sessions[index] };
      const { sessionId, ...fields } = replacement;
      sessions[index] = { ...sessions[index], ...fields };
      changes.push({ id: sessionId, before, after: sessions[index] });
    }
  }
  for (const s of sessions.filter(s => s.status === 'planned' && s.date >= date)) {
    if (s.date < plan.startDate || s.date > plan.endDate || unavailableDates.includes(s.date)) throw new Error('Zmieniona sesja ma niedostępny termin.');
    if (!plan.goal.sports.includes(s.sport)) throw new Error('Dyscyplina nie pasuje do celu.');
    if (sessions.filter(a => a.date === s.date && a.sport === s.sport && a.status === 'planned').length > 1) throw new Error('Powtórzona sesja tej samej dyscypliny w dniu.');
    const budget = plan.availability.find(a => a.weekday === weekday(s.date))?.minutes ?? 0;
    if (sessions.filter(a => a.date === s.date && a.status === 'planned').reduce((sum, a) => sum + a.durationMinutes, 0) > budget) throw new Error('Adaptacja przekracza dostępną ilość czasu w dniu.');
  }
  return {
    plan: { ...plan, sessions, weeklySummary: undefined, notes: [...plan.notes, `Adaptacja ${date}: ${reason}. Opuszczone sesje nie są automatycznie nadrabiane.`] },
    changes,
  };
}
