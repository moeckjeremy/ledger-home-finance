// A month of bills laid out by day, with paydays marked (2026-11-27; the Recurring page's calendar view,
// picked by the owner from what Monarch has). It reads only: the same bills the list shows, each placed on
// the day it falls in the month asked for.
//
// Where a bill falls: one on its own rhythm (every few weeks or months) on each of its dates; a yearly one
// only in its month; a monthly one on its usual day, or the last day of a month too short for it. For the
// month that holds a bill's next known date, that date is used. Amounts are the list's own (an estimate
// where the list marks it so). Paydays are marked by name only: what a paycheck will be is the forecast's
// business, and the calendar is about what goes out.
import { db, iso } from './db.js';
import { getRecurrings, occurrences } from './recurring.js';
import { payDates } from './cashflow.js';

const round = (n) => Math.round(n * 100) / 100;

export function billCalendar(month) {
  const [y, mo] = month.split('-').map(Number);
  const first = iso(new Date(y, mo - 1, 1)), lastDay = new Date(y, mo, 0).getDate(), last = iso(new Date(y, mo - 1, lastDay));
  const on = new Map();   // date -> items
  const put = (date, item) => { if (date >= first && date <= last) on.set(date, [...(on.get(date) || []), item]); };
  for (const r of getRecurrings()) {
    const item = { name: r.name, amount: round(r.amount), estimate: !!r.variable || (!!r.seasonal && !r.known), icon: r.icon || '', pay_url: r.pay_url || '' };
    if (r.every_unit) { for (const d of occurrences(r, first, last)) put(d, item); continue; }
    if (r.month && r.month !== mo) continue;
    if (r.next && r.next.slice(0, 7) === month) { put(r.next, item); continue; }
    put(iso(new Date(y, mo - 1, Math.min(Number(r.day) || 1, lastDay))), item);
  }
  let pays = [];
  try {
    pays = db.prepare('SELECT id, name, rule FROM pay_schedules ORDER BY id').all()
      .flatMap((p) => payDates(p.rule, first, last, p.id).map((date) => ({ date, name: p.name })));
  } catch { /* no paydays set up */ }
  const days = [];
  for (let d = 1; d <= lastDay; d++) {
    const date = iso(new Date(y, mo - 1, d));
    const bills = (on.get(date) || []).sort((a, b) => b.amount - a.amount);
    days.push({ date, bills, total: round(bills.reduce((a, b) => a + b.amount, 0)), pay: pays.filter((p) => p.date === date).map((p) => p.name) });
  }
  return { month, today: iso(new Date()), startsOn: new Date(y, mo - 1, 1).getDay(), days, total: round(days.reduce((a, d) => a + d.total, 0)), count: days.reduce((a, d) => a + d.bills.length, 0) };
}

export function installBillCalendar(app) {
  app.get('/api/bills/calendar', (req, res) => {
    const m = String(req.query.month || '');
    res.json(billCalendar(/^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : iso(new Date()).slice(0, 7)));
  });
}
