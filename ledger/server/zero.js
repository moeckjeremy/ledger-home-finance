// Zero-based budgeting, as a mode a household can switch on and off (The owner, 2026-11-23: "Is zero based
// something that can also be turned on or off?" ... "You can build it").
//
// Ledger's ordinary budgets give each category a monthly amount and take no notice of income. In this mode
// the money comes first: income that has arrived is "to be assigned", and it is handed out to categories
// until none is left, so every dollar has a job. A category can only spend what it has been given; whatever
// it doesn't spend stays in it for later months, and overspending comes off it.
//
//   to be assigned (through month M) = starting amount + income since the start month - everything assigned
//   a category's month               = what it carried in + what was assigned this month - what was spent
//
// The ordinary budgets are not touched: `categories.budget`, carry-over settings and `budget_months` stay
// exactly as they were, so switching this off puts the Budgets page back as it was. Assignments live in
// their own table and are kept when the mode is switched off, in case it is switched on again.
//
//   settings   zero_on ('1'), zero_from ('YYYY-MM', the month it began), zero_start (money on hand to assign at the start)
//   table      zero_assign (month, category_id, amount)
//
// While it is on, summaryFor() (server/index.js) takes each category's budget for a month from here: what
// the category has to spend that month (carried in plus assigned). So the dashboard, meters, pace line,
// recap, summary email and over-budget alert all follow without changes of their own.
import { db, iso, getSetting, setSetting } from './db.js';
import { periodOf, periodBounds } from './period.js';

db.exec(`CREATE TABLE IF NOT EXISTS zero_assign (
  month TEXT NOT NULL, category_id INTEGER NOT NULL, amount REAL NOT NULL DEFAULT 0, PRIMARY KEY (month, category_id))`);

const round = (n) => Math.round(n * 100) / 100;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const thisMonth = () => periodOf();   // the budget month now running (server/period.js)
const next = (m) => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; };
const prev = (m) => { const [y, mo] = m.split('-').map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`; };

export const zeroOn = () => getSetting('zero_on', '0') === '1' && MONTH.test(getSetting('zero_from', ''));
const from = () => getSetting('zero_from', '');
const startAmount = () => Number(getSetting('zero_start', '0')) || 0;

/**
 * Where every category and the unassigned money stand in one month, or null when the mode is off or the
 * month is before it began (those months keep their ordinary budgets).
 */
export function zeroFor(month) {
  if (!zeroOn() || !MONTH.test(month) || month < from()) return null;
  const first = periodBounds(from()).start, { start: mStart, end: mEnd } = periodBounds(month);
  const cats = db.prepare("SELECT id, name, icon, budget FROM categories WHERE kind = 'expense' ORDER BY sort").all();
  const spentBy = (a, b) => Object.fromEntries(db.prepare(`SELECT t.category_id id, -SUM(t.amount) s FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE c.kind = 'expense' AND t.date >= ? AND t.date < ? GROUP BY t.category_id`).all(a, b).map((r) => [r.id, r.s]));
  const assignedBy = (cond, ...args) => Object.fromEntries(db.prepare(`SELECT category_id id, SUM(amount) s FROM zero_assign WHERE ${cond} GROUP BY category_id`).all(...args).map((r) => [r.id, r.s]));
  const spentBefore = spentBy(first, mStart), spentNow = spentBy(mStart, mEnd);
  const assignedBefore = assignedBy('month >= ? AND month < ?', from(), month), assignedNow = assignedBy('month = ?', month);
  const out = {};
  for (const c of cats) {
    const carryIn = round((assignedBefore[c.id] || 0) - (spentBefore[c.id] || 0));
    const assigned = round(assignedNow[c.id] || 0), spent = round(spentNow[c.id] || 0);
    out[c.id] = { id: c.id, name: c.name, icon: c.icon, usual: c.budget, carryIn, assigned, spent, available: round(carryIn + assigned - spent) };
  }
  const income = (a, b) => db.prepare(`SELECT COALESCE(SUM(t.amount), 0) s FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE c.kind = 'income' AND t.date >= ? AND t.date < ?`).get(a, b).s;
  const assignedAll = db.prepare('SELECT COALESCE(SUM(amount), 0) s FROM zero_assign WHERE month >= ? AND month <= ?').get(from(), month).s;
  return {
    month, from: from(), start: startAmount(),
    income: round(income(mStart, mEnd)), incomeSinceStart: round(income(first, mEnd)),
    assignedMonth: round(Object.values(out).reduce((a, c) => a + c.assigned, 0)),
    toAssign: round(startAmount() + income(first, mEnd) - assignedAll),
    cats: out,
  };
}

const expenseIds = () => new Set(db.prepare("SELECT id FROM categories WHERE kind = 'expense'").all().map((c) => c.id));
const put = (month, id, amount) => db.prepare('INSERT INTO zero_assign (month, category_id, amount) VALUES (?,?,?) ON CONFLICT(month, category_id) DO UPDATE SET amount = excluded.amount').run(month, id, round(amount));
const got = (month, id) => db.prepare('SELECT amount FROM zero_assign WHERE month = ? AND category_id = ?').get(month, id)?.amount || 0;

export function installZero(app) {
  const view = (month) => {
    const m = MONTH.test(month) ? month : thisMonth();
    const z = zeroFor(m);
    const hasLast = zeroOn() && !!db.prepare('SELECT 1 FROM zero_assign WHERE month = ? LIMIT 1').get(prev(m));
    return { on: zeroOn(), from: from(), start: startAmount(), month: m, before: zeroOn() && m < from(), hasLast, ...(z ? { income: z.income, assignedMonth: z.assignedMonth, toAssign: z.toAssign, cats: Object.values(z.cats) } : {}) };
  };
  app.get('/api/zero', (req, res) => res.json(view(String(req.query.month || ''))));

  // Switching on starts from the current month the first time; switching off keeps everything for next time.
  app.put('/api/zero', (req, res) => {
    const b = req.body || {};
    if (b.start !== undefined) {
      const n = Number(b.start);
      if (!Number.isFinite(n) || n < 0 || n > 1e8) return res.status(400).json({ error: 'Enter the money you already have to hand out, 0 or more.' });
      setSetting('zero_start', String(round(n)));
    }
    if (b.on !== undefined) {
      if (b.on && !MONTH.test(from())) setSetting('zero_from', thisMonth());
      setSetting('zero_on', b.on ? '1' : '0');
    }
    res.json(view(String(b.month || '')));
  });

  // Starting over: forget what was assigned and begin again from this month.
  app.post('/api/zero/reset', (_req, res) => {
    db.exec('DELETE FROM zero_assign');
    setSetting('zero_from', thisMonth());
    res.json(view(''));
  });

  const ready = (req, res) => {
    const month = String(req.body?.month || '');
    if (!zeroOn()) { res.status(400).json({ error: 'Switch on "give every dollar a job" first.' }); return null; }
    if (!MONTH.test(month) || month < from()) { res.status(400).json({ error: 'That month is before this way of budgeting began.' }); return null; }
    return month;
  };

  app.put('/api/zero/assign', (req, res) => {
    const month = ready(req, res); if (!month) return;
    const id = Number(req.body?.category_id), amount = Number(req.body?.amount);
    if (!expenseIds().has(id)) return res.status(400).json({ error: 'That category is no longer there.' });
    if (!Number.isFinite(amount) || amount < 0 || amount > 1e7) return res.status(400).json({ error: 'Enter an amount, 0 or more.' });
    put(month, id, amount);
    res.json(view(month));
  });

  // Moving money between two categories in a month: one goes down, the other up, by the same amount.
  app.post('/api/zero/move', (req, res) => {
    const month = ready(req, res); if (!month) return;
    const a = Number(req.body?.from), b = Number(req.body?.to), amount = round(Number(req.body?.amount));
    const ids = expenseIds();
    if (!ids.has(a) || !ids.has(b) || a === b) return res.status(400).json({ error: 'Choose two different categories.' });
    if (!(amount > 0)) return res.status(400).json({ error: 'Enter how much to move.' });
    const z = zeroFor(month);
    if (z.cats[a].available < amount - 0.005) return res.status(400).json({ error: `${z.cats[a].name} only has ${z.cats[a].available.toFixed(2)} to give.` });
    // The giving category's assignment this month may go below zero: it is handing back money it carried in.
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO zero_assign (month, category_id, amount) VALUES (?,?,?) ON CONFLICT(month, category_id) DO UPDATE SET amount = excluded.amount').run(month, a, round(got(month, a) - amount));
      put(month, b, got(month, b) + amount);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); return res.status(500).json({ error: 'That could not be moved. Nothing was changed.' }); }
    res.json(view(month));
  });

  // A quick start for a month: give each category with nothing assigned its usual amount, or last month's.
  app.post('/api/zero/fill', (req, res) => {
    const month = ready(req, res); if (!month) return;
    const how = req.body?.how === 'last' ? 'last' : 'usual';
    const z = zeroFor(month);
    let filled = 0;
    for (const c of Object.values(z.cats)) {
      if (Math.abs(c.assigned) > 0.005) continue;
      const amount = how === 'last' ? Math.max(0, got(prev(month), c.id)) : c.usual;
      if (amount > 0) { put(month, c.id, amount); filled++; }
    }
    res.json({ ...view(month), filled });
  });
}
