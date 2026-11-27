// The budget month, when it does not start on the 1st (2026-11-27; asked for by a friend of the owner's,
// David: "being able to select one day out of the month and have the user say this is my reset date").
//
// One setting, `budget_start_day` (1 to 28; 1 unless changed). A budget month is still named by a
// calendar month, "2026-11", and means the month that STARTS in it: with a start day of 20, "2026-11"
// runs from 2026-11-20 up to, not including, 2026-12-20. Everything about budgets goes through the
// helpers here: the month menu, budgets, the pace line, carry-over, the zero-based mode, plans for the
// coming month, reports by month, the recap, the summary email, alerts and the Home Assistant sensors.
// What stays on the calendar on purpose: taxes (the tax year), the bills calendar, the checking forecast,
// net worth, debts and anything else that is about real dates and not about a budget's month.
//
// **With the start day left on 1, every helper here gives exactly what the code gave before it existed**
// (`${m}-01` to the first of the next month, `substr(date, 1, 7)`, today's own year and month). That was
// checked on a copy of real data before this went live; keep it true.
//
// The day stops at 28 so every month has one. Changing the day re-slices the past: earlier months'
// totals move, so carry-over is started afresh from the current month when it changes.
import { db, iso, getSetting, setSetting } from './db.js';

const pad = (n) => String(n).padStart(2, '0');
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function startDay() {
  const d = Math.round(Number(getSetting('budget_start_day', '1')));
  return d >= 1 && d <= 28 ? d : 1;
}

/** The dates of budget month `m`: `start` is in it, `end` is the first day after it. */
export function periodBounds(m) {
  const D = startDay();
  const [y, mo] = m.split('-').map(Number);
  const start = `${m}-${pad(D)}`, end = iso(new Date(y, mo, D));
  return { start, end, days: Math.round((Date.parse(end) - Date.parse(start)) / 86400000), y, mo, day: D };
}

/** The budget month a date falls in (today's, when no date is given). */
export function periodOf(date = iso(new Date())) {
  const [y, mo, d] = date.split('-').map(Number);
  return d >= startDay() ? date.slice(0, 7) : iso(new Date(y, mo - 2, 1)).slice(0, 7);
}

/** SQL for the budget month of a date column. A date moved back by (start day - 1) days lands in the month it is named for. */
export function periodSql(col = 't.date') {
  const D = startDay();
  return D === 1 ? `substr(${col},1,7)` : `substr(date(${col}, '-${D - 1} days'),1,7)`;
}

/** Which day of its budget month a date is: 1 for the start day. */
export const dayIndex = (date, start) => Math.round((Date.parse(date) - Date.parse(start)) / 86400000) + 1;

export function addDays(date, n) {
  const [y, mo, d] = date.split('-').map(Number);
  return iso(new Date(y, mo - 1, d + n));
}

const ORD = (n) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

/** One sentence for the AI features when the budget month is not the calendar month; empty otherwise. */
export function periodNote() {
  const D = startDay();
  return D === 1 ? '' : ` This household's budget month starts on the ${ORD(D)} of each month, not the 1st: a month is named for the month it starts in, so "November" means November ${D} up to December ${D - 1}. Budgets, spending totals and "this month" all follow that; taxes and bill dates stay on the calendar.`;
}

export function installPeriod(app) {
  app.get('/api/budget-month', (_req, res) => res.json({ day: startDay(), month: periodOf(), ...periodBounds(periodOf()) }));
  app.put('/api/budget-month', (req, res) => {
    const day = Math.round(Number(req.body?.day));
    if (!Number.isFinite(day) || day < 1 || day > 28) return res.status(400).json({ error: 'Choose a day from the 1st to the 28th, so that every month has one.' });
    if (day !== startDay()) {
      setSetting('budget_start_day', String(day));
      // The past is now cut at different dates, so what carried over no longer adds up: carry-over starts
      // again from the month now running. Nothing else is deleted.
      const now = periodOf();
      try {
        db.prepare("UPDATE categories SET rollover_from = ? WHERE rollover = 1").run(now);
        db.prepare('DELETE FROM budget_months').run();
        if (MONTH.test(getSetting('zero_from', '')) && getSetting('zero_from', '') > now) setSetting('zero_from', now);
      } catch { /* a copy from before those tables existed */ }
    }
    res.json({ day: startDay(), month: periodOf(), ...periodBounds(periodOf()) });
  });
}
