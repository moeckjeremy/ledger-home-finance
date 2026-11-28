// Bank balance outlook: what's in checking today, what comes out and goes in
// before the next paydays, and where the balance is headed.
import { db, iso, getSetting, setSetting } from './db.js';
import { getRecurrings, getRegularTransfers, nextDue, occurrences } from './recurring.js';
import { expectedPayment } from './vipkid.js';
import { WAITING_DAYS } from './waiting.js';
import { gig, isGigPay } from './gig.js';
import { expectedGigPay, gigsWithOwnPay } from './gigpay.js';
import { bankUpdateExpected, nextReadAt } from './simplefin.js';
import { changesOf, amountOn, billRef } from './changes.js';

// When each paycheck arrives. `rule` is either "monthdays:15,last" (those days
// of the month, moved back to Friday when they fall on a weekend) or
// "weekly:5" (every Friday; 0 is Sunday). `amount_mode` is how to guess the
// amount: "last" deposit for a steady salary, or the "average" of recent ones.
db.exec(`CREATE TABLE IF NOT EXISTS pay_schedules (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, merchant_like TEXT NOT NULL,
  rule TEXT NOT NULL, amount_mode TEXT NOT NULL DEFAULT 'last')`);
// amount_mode 'fixed' uses an amount the household typed (for a paycheck the bank feed can't show).
if (!db.prepare("SELECT 1 FROM pragma_table_info('pay_schedules') WHERE name = 'amount'").get()) db.exec('ALTER TABLE pay_schedules ADD COLUMN amount REAL');
// What a payday is (2026-11-25): 'job' (a paycheck, the only kind before this), 'benefits' (Social Security and
// the like), 'pension', or 'other'. Only a job has pay stubs, so only a job is ever asked for one.
if (!db.prepare("SELECT 1 FROM pragma_table_info('pay_schedules') WHERE name = 'kind'").get()) db.exec("ALTER TABLE pay_schedules ADD COLUMN kind TEXT NOT NULL DEFAULT 'job'");

// The side gig's row, noted by id so the gig can be renamed without losing its pay forecast.
if (gig().on && getSetting('gig_schedule_id') === '') {
  const row = db.prepare('SELECT id FROM pay_schedules WHERE name = ?').get(gig().name);
  if (row) setSetting('gig_schedule_id', row.id);
}

// An employer's published pay calendar overrides the rule for the years it covers
// (it knows about bank holidays, which the rule doesn't).
db.exec('CREATE TABLE IF NOT EXISTS pay_dates (schedule_id INTEGER NOT NULL, date TEXT NOT NULL, PRIMARY KEY (schedule_id, date))');
// Amounts you've typed over an estimate in the outlook, one per bill per month
// (per payday for paychecks). `period` is the month (YYYY-MM) or the pay date.
db.exec('CREATE TABLE IF NOT EXISTS outlook_amounts (kind TEXT NOT NULL, name TEXT NOT NULL, period TEXT NOT NULL, amount REAL NOT NULL, PRIMARY KEY (kind, name, period))');
const periodFor = (kind, date) => (kind === 'pay' ? date : date.slice(0, 7));
// A row's date can be moved the same way (a bill drafted early or late around a holiday, a paycheck
// that comes on a different day). Same key as the amounts: one bill for one month, or one payday.
db.exec('CREATE TABLE IF NOT EXISTS outlook_dates (kind TEXT NOT NULL, name TEXT NOT NULL, period TEXT NOT NULL, date TEXT NOT NULL, PRIMARY KEY (kind, name, period))');
/** How far a row may be moved from the app's own date, in days. */
const MOVE_DAYS = 21;

/**
 * The amount to expect from a paycheck set to "same as the last deposit". A one-off (a bonus, a
 * short check) shouldn't carry forward, so the last deposit is used only when the one before agrees
 * with it; otherwise the middle of the last three. After a real raise this catches up on the
 * second paycheck.
 */
export function usualDeposit(recent) {
  const a = recent.map((r) => r.amount);
  if (a.length < 3 || Math.abs(a[0] - a[1]) <= Math.abs(a[1]) * 0.01) return a[0];
  return [a[0], a[1], a[2]].sort((x, y) => x - y)[1];
}
/** A deposit this many days before a payday is that payday come early. Weekly pay gets less room. */
const earlyDays = (rule) => (/^weekly:/.test(rule) || (/^every:/.test(rule) && Number(rule.split(':')[1]) < 14) ? 2 : 5);

const DAY = 86400000;
const round = (n) => Math.round(n * 100) / 100;
const addDays = (d, n) => iso(new Date(new Date(`${d}T12:00:00`).getTime() + n * DAY));
const weekday = (d) => new Date(`${d}T12:00:00`).getDay();
/** A payday on a weekend is paid the Friday before. */
const offWeekend = (d) => (weekday(d) === 6 ? addDays(d, -1) : weekday(d) === 0 ? addDays(d, -2) : d);

export function payDates(rule, from, to, scheduleId) {
  const listed = db.prepare('SELECT date FROM pay_dates WHERE schedule_id = ?').all(scheduleId ?? 0).map((r) => r.date);
  if (listed.length) {
    // Years with a published calendar use it; any other year falls back to the rule.
    const years = new Set(listed.map((d) => d.slice(0, 4)));
    return [...new Set([...listed.filter((d) => d >= from && d <= to), ...payDates(rule, from, to).filter((d) => !years.has(d.slice(0, 4)))])].sort();
  }
  const out = [];
  const [type, spec] = rule.split(':');
  if (type === 'weekly') {
    for (let d = from; d <= to; d = addDays(d, 1)) if (weekday(d) === Number(spec)) out.push(d);
  } else if (type === 'nthweekday') {
    // nthweekday:2:3 is the second Wednesday of each month (0 is Sunday); "last" is the last one.
    const [nth, wd] = [spec, Number(rule.split(':')[2])];
    const [y, m] = from.split('-').map(Number);
    for (let i = 0; i < 3; i++) {
      const days = new Date(y, m + i, 0).getDate();
      const hits = [];
      for (let day = 1; day <= days; day++) if (new Date(y, m - 1 + i, day, 12).getDay() === wd) hits.push(iso(new Date(y, m - 1 + i, day, 12)));
      const date = nth === 'last' ? hits[hits.length - 1] : hits[Number(nth) - 1];
      if (date && date >= from && date <= to) out.push(date);
    }
  } else if (type === 'every') {
    // every:14:2026-11-06 is every 14 days counted from a known payday.
    const [days, anchor] = [Number(spec), rule.split(':')[2]];
    if (days > 0 && /^\d{4}-\d{2}-\d{2}$/.test(anchor || '')) {
      const gap = Math.round((new Date(`${from}T12:00:00`) - new Date(`${anchor}T12:00:00`)) / DAY);
      for (let d = addDays(anchor, Math.ceil(gap / days) * days); d <= to; d = addDays(d, days)) if (d >= from) out.push(d);
    }
  } else if (type === 'monthdays') {
    const [y, m] = from.split('-').map(Number);
    for (let i = 0; i < 3; i++) {
      for (const day of spec.split(',')) {
        const date = day === 'last' ? iso(new Date(y, m + i, 0)) : iso(new Date(y, m - 1 + i, Number(day)));
        const paid = offWeekend(date);
        if (paid >= from && paid <= to) out.push(paid);
      }
    }
  }
  return [...new Set(out)].sort();
}

/**
 * What should be in checking right now. The dashboard and the Transactions page
 * both show this one figure.
 *
 * It starts from the bank's posted balance and takes off money that's spoken
 * for but hasn't posted. Two sources know about that: the bank's own pending
 * total (posted less available, as of the last sync) and the purchases you've
 * entered that are still waiting for the bank. They mostly describe the same
 * purchases, so they can't be added together; the larger of the two is used.
 * If you've entered something the bank hasn't reported yet, yours is larger and
 * wins; if the bank knows of pending charges you haven't entered, its total wins.
 * Money in that you've recorded (a transfer from savings) is added on top.
 */
export function checkingEstimate() {
  const accounts = db.prepare("SELECT id, name, balance, available, balance_at, manual FROM accounts WHERE type = 'checking' AND COALESCE(off_budget, 0) = 0").all();
  // Every checking account is kept by hand (no bank connection): there is no bank figure, pending total or waiting.
  const byHand = accounts.length > 0 && accounts.every((a) => a.manual);
  const ids = accounts.map((a) => a.id).join(',') || 0;
  // Days are worked out here, by the app's own clock (which follows TZ), and handed to the database as text.
  // The database's 'localtime' is plain UTC inside the container, which carries no time zone files, so after
  // six in the evening Central it would already be on tomorrow (found 2026-11-24).
  const since = addDays(iso(new Date()), -WAITING_DAYS);
  const fileFrom = accounts.filter((a) => !a.manual && a.balance_at).map((a) => `(t.account_id = ${Number(a.id)} AND t.date >= '${iso(new Date(a.balance_at))}')`).join(' OR ') || '0';
  const posted = round(accounts.reduce((a, x) => a + x.balance, 0));
  const available = round(accounts.reduce((a, x) => a + (x.available ?? x.balance), 0));
  const bankPending = round(posted - available);
  // Money out you've entered overlaps the bank's pending total. Money in you've
  // entered (a transfer from savings) is in neither figure, so it is added on its own.
  const w = db.prepare(`SELECT COALESCE(-SUM(CASE WHEN amount < 0 THEN amount END), 0) total, COALESCE(SUM(CASE WHEN amount > 0 THEN amount END), 0) incoming,
      COUNT(CASE WHEN amount < 0 THEN 1 END) n, COUNT(CASE WHEN amount > 0 THEN 1 END) nIn FROM transactions
    WHERE waiting = 1 AND account_id IN (${ids}) AND date >= '${since}'`).get();
  // Rows brought in from the bank's own export file since its last reading, which the connection hasn't
  // delivered yet (2026-11-24): the bank's posted balance is from before them, so they stand beside the
  // waiting entries as things Ledger knows about and the bank's figures here don't. Like those, they overlap
  // the bank's pending total (most were pending at the reading), so the larger of the two views is taken off.
  // They drop out by themselves when the connection delivers them and brings a newer balance.
  const f = db.prepare(`SELECT COALESCE(-SUM(CASE WHEN t.amount < 0 THEN t.amount END), 0) out, COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount END), 0) money_in, COUNT(*) n
    FROM transactions t JOIN accounts a ON a.id = t.account_id
    WHERE t.waiting = 0 AND t.pending = 0 AND (${fileFrom})
      AND (t.sfin_id LIKE 'csv:%' OR t.split_of IN (SELECT id FROM transactions WHERE sfin_id LIKE 'csv:%'))`).get();
  const fileOut = round(f.out), fileIn = round(f.money_in);
  const waiting = round(w.total), incoming = round(w.incoming + fileIn);
  // The bank's pending total is net: a transfer in that the bank is already processing
  // lowers it. That shows on the other side as money held in the savings account the
  // transfer came from. Those transfers are put back, so the bank's figure is its
  // pending money out alone and the transfer isn't counted once there and again below.
  const seen = db.prepare(`SELECT a.balance - a.available hold, COALESCE((SELECT -SUM(t.amount) FROM transactions t
      WHERE t.account_id = a.id AND t.waiting = 1 AND t.amount < 0 AND t.date >= '${since}'), 0) sent
    FROM accounts a WHERE a.type = 'savings' AND a.available IS NOT NULL AND a.balance - a.available > 0.005`).all();
  const transfersSeen = round(Math.min(incoming, seen.reduce((a, x) => a + Math.min(x.hold, x.sent), 0)));
  const bankOut = round(bankPending + transfersSeen);
  const known = round(waiting + fileOut);
  const held = Math.max(bankOut, known);
  return {
    byHand, accounts, ids, posted, available, bankPending, waiting, waitingCount: w.n, fileOut, fileIn, fileCount: f.n, incoming, incomingCount: w.nIn, held: round(held), estimate: round(posted - held + incoming),
    transfersSeen, bankOut, basis: known > bankOut + 0.005 ? 'waiting' : 'bank', syncedAt: Number(getSetting('simplefin_last_sync')) * 1000 || null,
    // The bank's own time on its figures: the oldest, if there is more than one checking account.
    bankAsOf: accounts.some((a) => a.balance_at) ? Math.min(...accounts.filter((a) => a.balance_at).map((a) => a.balance_at)) : null,
  };
}

// VIPKid pay is kept for the tax bill: until the tax savings account holds what's
// owed, each payment is moved there, so the outlook doesn't count it as money to
// spend. The figures come from the tax estimate in server/index.js, which hands
// over a function here (this file can't import that one without a loop).
let taxHoldSource = null;
export const setTaxHoldSource = (fn) => { taxHoldSource = fn; };
function taxHold() {
  try { return taxHoldSource ? taxHoldSource() : null; } catch { return null; }
}

// `opts.until` (a date) stretches the same forecast further ahead, for the bills calendar's day-by-day
// balance (server/billcalendar.js): monthly bills and card payments then repeat each month up to that day.
// Called with nothing, as the dashboard does, it is exactly what it was.
export function outlook(opts = {}) {
  const today = iso(new Date());
  const until = /^\d{4}-\d{2}-\d{2}$/.test(opts.until || '') && opts.until > today ? opts.until : null;
  const est = checkingEstimate();
  const { accounts, posted } = est;
  // Start from the estimate: the posted balance with pending and waiting purchases already taken out.
  const balance = est.estimate;
  // Purchases known to be on their way out, so a bill among them isn't taken out twice.
  const pendingTx = [
    ...db.prepare(`SELECT merchant, amount FROM pending_tx WHERE account_id IN (${est.ids}) AND amount < 0`).all(),
    ...db.prepare(`SELECT merchant, amount FROM transactions WHERE waiting = 1 AND account_id IN (${est.ids}) AND amount < 0`).all(),
  ];
  const limit = until && until > addDays(today, 35) ? until : addDays(today, 35);
  // Old entries are no use once their month has passed.
  db.prepare('DELETE FROM outlook_amounts WHERE period < ?').run(addDays(today, -62).slice(0, 7));
  db.prepare('DELETE FROM outlook_dates WHERE period < ?').run(addDays(today, -62).slice(0, 7));
  const setDates = new Map(db.prepare('SELECT kind, name, period, date FROM outlook_dates').all().map((r) => [`${r.kind}|${r.name}|${r.period}`, r.date]));
  // Where a row was moved to; a moved date that has gone by with nothing seen shows as due today.
  const moved = (kind, name, date) => { const d = setDates.get(`${kind}|${name}|${periodFor(kind, date)}`); return d ? (d < today ? today : d) : null; };
  const setAmounts = new Map(db.prepare('SELECT kind, name, period, amount FROM outlook_amounts').all().map((r) => [`${r.kind}|${r.name}|${r.period}`, r.amount]));
  const yours = (kind, name, date) => setAmounts.get(`${kind}|${name}|${periodFor(kind, date)}`);

  // Amounts the household said will change from a day (server/changes.js): used for anything on or after it.
  const payAhead = changesOf('pay'), billAhead = changesOf('bill');

  // Paychecks.
  const pay = [];
  // A side gig forecast from booked sessions or typed-in jobs (server/gigpay.js) takes the place of its
  // paycheck's average here, so its pay isn't counted both ways.
  const ownPay = gigsWithOwnPay(), firstGig = gig();
  for (const s of db.prepare('SELECT * FROM pay_schedules').all()) {
    if (isGigPay(s) && (ownPay.has(s.name) || (ownPay.has(firstGig.name) && String(s.id) === getSetting('gig_schedule_id')))) continue;
    const recent = db.prepare('SELECT date, amount FROM transactions WHERE merchant LIKE ? AND amount > 0 ORDER BY date DESC LIMIT 8').all(s.merchant_like);
    // A typed amount needs no deposits to go on; the other two do.
    const fixed = s.amount_mode === 'fixed' && s.amount > 0;
    if (!recent.length && !fixed) continue;
    const estimate = s.amount_mode === 'average';
    const amount = round(fixed ? s.amount : estimate ? recent.reduce((a, r) => a + r.amount, 0) / recent.length : usualDeposit(recent));
    // Paydays from a little before today too, so one you moved later is still listed after its usual day.
    for (const date of payDates(s.rule, addDays(today, -MOVE_DAYS), limit, s.id)) {
      const to = moved('pay', s.name, date);
      if (date < today && !to) continue;
      // Skip a payday that has already been deposited, including one that came a few days early.
      const first = to && to < date ? to : date;
      if (recent.length && recent[0].date >= addDays(first, -earlyDays(s.rule))) continue;
      // VIPKid: when the class calendar covers that pay week, work the payment
      // out from the classes on it instead of using the average.
      const fromClasses = gig().classes && isGigPay(s) ? expectedPayment(date) : null;
      if (fromClasses?.weekStarted) {
        if (fromClasses.weekOver && fromClasses.amount === 0) continue;
        const note = `${fromClasses.classes} class${fromClasses.classes === 1 ? '' : 'es'}${fromClasses.weekOver ? '' : ' booked so far'}${fromClasses.incentive ? `, plus last month's incentive on ${fromClasses.incentiveClasses} class units` : ''}`;
        pay.push({ date, key: date, name: s.name, amount: fromClasses.amount, kind: 'pay', estimate: !fromClasses.weekOver, salary: false, note, gig: true });
      } else {
        const changed = amountOn(payAhead, s.id, date);
        if (changed != null) pay.push({ date, key: date, name: s.name, amount: round(changed), kind: 'pay', estimate: false, salary: !estimate, note: 'the new amount you entered', planned: true, gig: isGigPay(s) });
        else pay.push({ date, key: date, name: s.name, amount, kind: 'pay', estimate, salary: !estimate, note: estimate ? 'average of recent payments' : undefined, gig: isGigPay(s) });
      }
    }
  }
  if (ownPay.size) pay.push(...expectedGigPay(today, limit));
  const hold = taxHold();
  if (hold?.active) for (const p of pay) if (p.gig) p.aside = true;
  for (const p of pay) {
    const set = yours('pay', p.name, p.key);
    if (set != null) Object.assign(p, { usual: p.amount, amount: round(set), estimate: false, set: true });
    const to = moved('pay', p.name, p.key);
    if (to && to !== p.date) Object.assign(p, { date: to, usualDate: p.key });
  }
  const salaryDays = [...new Set(pay.filter((p) => p.salary).map((p) => p.date))].sort();
  const nextPayday = salaryDays[0] || null;
  // Show through the second upcoming salary payday, or three weeks if unknown.
  const horizon = until || salaryDays[1] || addDays(today, 21);

  // Bills, and regular card payments, that come out of checking.
  const categories = Object.fromEntries(db.prepare('SELECT id, icon FROM categories').all().map((c) => [c.id, c.icon]));
  const out = [];
  // A bill on its own rhythm (every two weeks, say) can fall due more than once before the horizon.
  // Looking further ahead, something monthly falls on its day in each later month too (the last day of a short month).
  const later = (first, day) => {
    const list = [first];
    if (!until) return list;
    const [y, m] = first.split('-').map(Number);
    for (let i = 0; i < 12; i++) {
      const d = iso(new Date(y, m + i, Math.min(day, new Date(y, m + i + 1, 0).getDate())));
      if (d > horizon) break;
      list.push(d);
    }
    return list;
  };
  const dues = (r) => {
    if (r.every_unit) return occurrences(r, today, horizon);
    const first = nextDue(r, today);
    return r.month ? [first] : later(first, Number(r.day) || Number(first.slice(8)));
  };
  for (const r of getRecurrings()) for (const due of dues(r)) {
    const date = moved('bill', r.name, due) || due;
    if (date > horizon) continue;
    const onCard = r.account_type === 'credit';
    // A bill that's already pending at the bank has left the available balance, so don't take it out twice.
    const set = yours('bill', r.name, due);
    const planned = set == null ? amountOn(billAhead, billRef(r.name), due) : null;
    const amount = set ?? planned ?? r.amount;
    const i = onCard ? -1 : pendingTx.findIndex((p) => Math.abs(-p.amount - amount) <= Math.max(0.01, amount * 0.02));
    const alreadyOut = i >= 0;
    if (alreadyOut) pendingTx.splice(i, 1);
    out.push({ date, key: due, ...(date !== due ? { usualDate: due } : {}), name: r.name, amount: -round(amount), kind: 'bill', estimate: set == null && planned == null && r.variable === true && r.known !== true, ...(planned != null ? { planned: true, usual: round(r.amount) } : {}), onCard, alreadyOut, icon: categories[r.category_id], ...(set != null ? { set: true, usual: round(r.amount) } : {}) });
  }
  for (const r of getRegularTransfers()) {
    // Same day next month as the last one.
    const [y, m, d] = r.last.split('-').map(Number);
    for (const due of later(iso(new Date(y, m, d)), d)) {
    const date = moved('card', r.name, due) || due;
    const set = yours('card', r.name, due);
    if (due >= today && date <= horizon) out.push({ date, key: due, ...(date !== due ? { usualDate: due } : {}), name: r.name, amount: -round(set ?? r.amount), kind: 'card', estimate: set == null && r.variable, onCard: false, icon: '💳', ...(set != null ? { set: true, usual: round(r.amount) } : {}) });
    }
  }

  const events = [...pay.filter((p) => p.date <= horizon).map((p) => ({ ...p, icon: '💵', onCard: false })), ...out]
    .sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
  let running = balance, lowest = { date: today, balance }, beforePayday = balance;
  for (const e of events) {
    if (!e.onCard && !e.alreadyOut && !e.aside) running = round(running + e.amount);
    e.balance = running;
    if (running < lowest.balance) lowest = { date: e.date, balance: running };
    if (nextPayday && e.date < nextPayday) beforePayday = running;
  }

  // Typical day-to-day spending from checking: the last 60 days, leaving out
  // the bills above and one-off payments of $1,000 or more.
  const billNames = [...new Set(out.map((o) => o.name))];
  const spend = db.prepare(`
    SELECT COALESCE(-SUM(t.amount), 0) total FROM transactions t JOIN categories c ON c.id = t.category_id JOIN accounts a ON a.id = t.account_id
    WHERE c.kind = 'expense' AND a.type = 'checking' AND COALESCE(a.off_budget, 0) = 0 AND t.amount < 0 AND t.amount > -1000 AND t.date >= ?
      AND t.merchant NOT IN (SELECT merchant FROM bill_history) ${billNames.length ? `AND t.merchant NOT IN (${billNames.map(() => '?').join(',')})` : ''}`)
    .get(addDays(today, -60), ...billNames).total;
  const perDay = round(spend / 60);
  const daysToPayday = nextPayday ? Math.max(0, Math.round((new Date(nextPayday) - new Date(today)) / DAY)) : 0;
  const estimatedIncomeBeforePayday = round(events.filter((e) => e.kind === 'pay' && e.estimate && !e.aside && nextPayday && e.date < nextPayday).reduce((a, e) => a + e.amount, 0));

  return {
    today, balance, posted, pending: est.held, bankPending: est.bankPending, waiting: est.waiting, waitingCount: est.waitingCount, basis: est.basis, accounts: accounts.map((a) => a.name), syncedAt: est.syncedAt, bankAsOf: est.bankAsOf,
    // When the feed should next have newer figures from the bank (an estimate), and the app's next reading of it.
    bankNextAt: bankUpdateExpected()?.expected ?? null, nextSyncAt: nextReadAt(),
    events, horizon,
    nextPayday: nextPayday ? { date: nextPayday, names: pay.filter((p) => p.salary && p.date === nextPayday).map((p) => p.name), amount: round(pay.filter((p) => p.salary && p.date === nextPayday).reduce((a, p) => a + p.amount, 0)) } : null,
    beforePayday, estimatedIncomeBeforePayday, lowest,
    taxHold: hold,
    typicalSpendPerDay: perDay, daysToPayday, afterTypicalSpending: round(beforePayday - perDay * daysToPayday),
  };
}

export function installCashflow(app) {
  app.get('/api/cashflow', (_req, res) => res.json(outlook()));
  // Type over one row's amount in the outlook, or send no amount to go back to the app's figure.
  app.put('/api/cashflow/amount', (req, res) => {
    const { kind, name, date, amount, to } = req.body || {};
    if (!['bill', 'card', 'pay'].includes(kind) || !name || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ error: "That row can't be changed." });
    const period = periodFor(kind, date);
    // `date` is the app's own date for the row (its key); `to` moves it. Leave `to` out to keep the
    // date as it is, send it empty or equal to the app's date to go back.
    if (to !== undefined) {
      if (to === null || to === '' || to === date) {
        db.prepare('DELETE FROM outlook_dates WHERE kind = ? AND name = ? AND period = ?').run(kind, String(name), period);
      } else {
        const today = iso(new Date());
        if (!/^\d{4}-\d{2}-\d{2}$/.test(to) || Number.isNaN(Date.parse(to))) return res.status(400).json({ error: 'Choose a date.' });
        if (to < today) return res.status(400).json({ error: 'Choose today or a later date.' });
        if (Math.abs(new Date(`${to}T12:00:00`) - new Date(`${date}T12:00:00`)) > MOVE_DAYS * DAY) return res.status(400).json({ error: `Choose a date within ${MOVE_DAYS} days of the usual one.` });
        db.prepare('INSERT INTO outlook_dates (kind, name, period, date) VALUES (?,?,?,?) ON CONFLICT(kind, name, period) DO UPDATE SET date = excluded.date').run(kind, String(name), period, to);
      }
      if (amount === undefined) return res.json(outlook());
    }
    if (amount === null || amount === undefined || amount === '') {
      db.prepare('DELETE FROM outlook_amounts WHERE kind = ? AND name = ? AND period = ?').run(kind, String(name), period);
    } else {
      const n = Number(amount);
      if (!Number.isFinite(n) || n < 0 || n > 1e6) return res.status(400).json({ error: 'Enter an amount of 0 or more.' });
      db.prepare('INSERT INTO outlook_amounts (kind, name, period, amount) VALUES (?,?,?,?) ON CONFLICT(kind, name, period) DO UPDATE SET amount = excluded.amount').run(kind, String(name), period, round(n));
    }
    res.json(outlook());
  });
  // "It's pending at the bank" on a bill in the outlook: the bank's feed gives only a
  // pending total for checking, so the app can't tell that a bill is inside it. This
  // records the bill as a waiting entry, which stops it being taken out a second time;
  // the bank's own entry takes it over when it posts.
  app.post('/api/cashflow/pending', (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 120);
    const amount = round(Math.abs(Number(req.body?.amount)));
    if (!name || !(amount > 0) || amount > 1e6) return res.status(400).json({ error: "That bill can't be marked." });
    const checking = db.prepare("SELECT id, manual FROM accounts WHERE type = 'checking' AND COALESCE(off_budget, 0) = 0 ORDER BY manual, id LIMIT 1").get();
    if (!checking) return res.status(400).json({ error: 'There is no checking account to put it on.' });
    const today = iso(new Date());
    if (!db.prepare("SELECT 1 FROM transactions WHERE account_id = ? AND waiting = 1 AND merchant = ? AND abs(amount + ?) < 0.005 AND date >= date(?, '-10 days')").get(checking.id, name, amount, today) && !(checking.manual && db.prepare("SELECT 1 FROM transactions WHERE account_id = ? AND merchant = ? AND abs(amount + ?) < 0.005 AND date = ?").get(checking.id, name, amount, today))) {
      const cat = db.prepare('SELECT category_id c FROM transactions WHERE merchant = ? AND amount < 0 ORDER BY date DESC LIMIT 1').get(name)?.c
        ?? db.prepare("SELECT id c FROM categories WHERE COALESCE(key, name) IN ('Bills', 'Other') ORDER BY COALESCE(key, name) = 'Bills' DESC LIMIT 1").get()?.c;
      db.prepare("INSERT INTO transactions (account_id, date, merchant, amount, category_id, notes, manual, waiting) VALUES (?,?,?,?,?,?,1,?)").run(checking.id, today, name, -amount, cat, checking.manual ? 'Marked as paid' : 'Marked as pending at the bank', checking.manual ? 0 : 1);
    }
    res.json(outlook());
  });
  app.get('/api/checking', (_req, res) => {
    const { ids, accounts, ...e } = checkingEstimate();
    res.json({ ...e, accounts: accounts.map((a) => a.name) });
  });
}
