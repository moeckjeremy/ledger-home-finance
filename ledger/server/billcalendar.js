// A month of bills laid out by day, with paydays marked (2026-11-27; the Recurring page's calendar view,
// picked by the owner from what Monarch has). It reads only: the same bills the list shows, each placed on
// the day it falls in the month asked for.
//
// Where a bill falls: one on its own rhythm (every few weeks or months) on each of its dates; a yearly one
// only in its month; a monthly one on its usual day, or the last day of a month too short for it. For the
// month that holds a bill's next known date, that date is used. Amounts are the list's own (an estimate
// where the list marks it so). Paydays are marked by name only: what a paycheck will be is the forecast's
// business, and the calendar is about what goes out.
import { db, iso, getSetting } from './db.js';
import { getRecurrings, occurrences } from './recurring.js';
import { payDates, outlook } from './cashflow.js';
import { amountOn, billRef } from './changes.js';

const round = (n) => Math.round(n * 100) / 100;

const DAY = 86400000;
const addDays = (d, n) => iso(new Date(new Date(`${d}T12:00:00`).getTime() + n * DAY));

// The checking balance projected for each day ahead (2026-11-27, the owner's go-ahead after seeing a
// calendar-first budget app): the dashboard's own forecast, carried on to the end of the month shown or
// six weeks, whichever is later, and never more than about three months. It counts what the forecast
// counts: known bills, card payments and paychecks. Everyday spending is not in it; the page can take a
// usual day's worth off for each day if asked, and can try a purchase on top. It reads only.
function projection(last) {
  const today = iso(new Date());
  if (last < today) return null;
  const cap = addDays(today, 100), six = addDays(today, 42);
  const until = [last, six].sort().at(-1) > cap ? cap : [last, six].sort().at(-1);
  let o;
  try { o = outlook({ until }); } catch { return null; }
  if (!o.accounts.length) return null;
  const moves = new Map();   // date -> what the forecast moves that day
  for (const e of o.events) moves.set(e.date, [...(moves.get(e.date) || []), e]);
  const series = [];
  let balance = o.balance, lowest = { date: today, balance };
  for (let d = today; d <= until; d = addDays(d, 1)) {
    const list = moves.get(d) || [];
    if (list.length) balance = list.at(-1).balance;
    if (balance < lowest.balance) lowest = { date: d, balance };
    series.push({ date: d, balance, extra: list.filter((e) => e.kind !== 'bill').map((e) => ({ name: e.name, amount: e.amount, kind: e.kind, estimate: !!e.estimate, aside: !!e.aside })) });
  }
  return { from: today, until, start: o.balance, lowest, perDay: o.typicalSpendPerDay, low: Number(getSetting('alert_low', '100')) || 0, accounts: o.accounts, series };
}

export function billCalendar(month) {
  const [y, mo] = month.split('-').map(Number);
  const first = iso(new Date(y, mo - 1, 1)), lastDay = new Date(y, mo, 0).getDate(), last = iso(new Date(y, mo - 1, lastDay));
  const on = new Map();   // date -> items
  // A bill whose amount is set to change from a day (server/changes.js) shows the new amount from then on.
  const put = (date, item) => {
    if (date < first || date > last) return;
    const changed = amountOn(item.ahead, 0, date);
    const { ahead, ...rest } = item;
    on.set(date, [...(on.get(date) || []), changed != null ? { ...rest, amount: round(changed), estimate: false, changed: true } : rest]);
  };
  for (const r of getRecurrings()) {
    const item = { name: r.name, amount: round(r.amount), estimate: !!r.variable || (!!r.seasonal && !r.known), icon: r.icon || '', pay_url: r.pay_url || '', ahead: new Map([['0', r.changes || []]]) };
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
  const proj = projection(last);
  const ahead = new Map((proj?.series || []).map((s) => [s.date, s]));
  const days = [];
  for (let d = 1; d <= lastDay; d++) {
    const date = iso(new Date(y, mo - 1, d));
    const bills = (on.get(date) || []).sort((a, b) => b.amount - a.amount);
    days.push({ date, bills, balance: ahead.get(date)?.balance ?? null, extra: ahead.get(date)?.extra || [], total: round(bills.reduce((a, b) => a + b.amount, 0)), pay: pays.filter((p) => p.date === date).map((p) => p.name) });
  }
  return { month, proj, today: iso(new Date()), startsOn: new Date(y, mo - 1, 1).getDay(), days, total: round(days.reduce((a, d) => a + d.total, 0)), count: days.reduce((a, d) => a + d.bills.length, 0) };
}

export function installBillCalendar(app) {
  app.get('/api/bills/calendar', (req, res) => {
    const m = String(req.query.month || '');
    res.json(billCalendar(/^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : iso(new Date()).slice(0, 7)));
  });
}
