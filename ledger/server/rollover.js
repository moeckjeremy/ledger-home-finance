// Budgets that carry over (added 2026-11-18, the owner's choice after comparing Ledger with other budget apps).
//
// A category with "Carry over" switched on takes what was left of its budget at the end of each month into
// the next one, and takes overspending with it too: $40 unspent on clothing in November makes December's
// clothing budget $40 larger, and going $25 over makes it $25 smaller. It starts with the month it was
// switched on in (`categories.rollover_from`), so that month's leftover is the first to carry.
//
// The amount budgeted for each finished month is written down once (`budget_months`), the first time a
// later month is looked at or just before the budget is changed, so changing a budget today doesn't
// rewrite what earlier months were allowed.
import { db } from './db.js';
import { periodOf, periodBounds } from './period.js';

for (const col of ['rollover INTEGER NOT NULL DEFAULT 0', 'rollover_from TEXT']) { try { db.exec(`ALTER TABLE categories ADD COLUMN ${col}`); } catch { /* already there */ } }
db.exec('CREATE TABLE IF NOT EXISTS budget_months (category_id INTEGER NOT NULL, month TEXT NOT NULL, budget REAL NOT NULL, PRIMARY KEY (category_id, month))');

const round = (n) => Math.round(n * 100) / 100;
// The budget month now running, and a month's dates: the calendar's unless the start day was moved (server/period.js).
const thisMonth = () => periodOf();
const next = (m) => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; };
/** Months from `from` up to, not including, `until` (at most ten years, so a bad value can't run away). */
function monthsBetween(from, until) {
  const out = [];
  for (let m = from; m < until && out.length < 120; m = next(m)) out.push(m);
  return out;
}

/** Writes down the budget of every finished month that hasn't been written down yet. Call before a budget changes. */
export function settleBudgets() {
  const now = thisMonth();
  const keep = db.prepare('INSERT OR IGNORE INTO budget_months (category_id, month, budget) VALUES (?, ?, ?)');
  for (const c of db.prepare("SELECT id, budget, rollover_from FROM categories WHERE rollover = 1 AND rollover_from IS NOT NULL").all()) {
    if (!/^\d{4}-\d{2}$/.test(c.rollover_from)) continue;
    for (const m of monthsBetween(c.rollover_from, now)) keep.run(c.id, m, c.budget);
  }
}

/** What each carrying category brings into `month`: { [category id]: dollars, negative when overspent }. */
export function carryInto(month) {
  settleBudgets();
  const out = {};
  const spent = db.prepare("SELECT COALESCE(-SUM(amount), 0) s FROM transactions WHERE category_id = ? AND date >= ? AND date < ?");
  const kept = db.prepare('SELECT budget FROM budget_months WHERE category_id = ? AND month = ?');
  for (const c of db.prepare("SELECT id, budget, rollover_from FROM categories WHERE kind = 'expense' AND rollover = 1 AND rollover_from IS NOT NULL").all()) {
    if (!/^\d{4}-\d{2}$/.test(c.rollover_from)) continue;
    let carry = 0;
    for (const m of monthsBetween(c.rollover_from, month)) carry += (kept.get(c.id, m)?.budget ?? c.budget) - spent.get(c.id, periodBounds(m).start, periodBounds(m).end).s;
    out[c.id] = round(carry);
  }
  return out;
}

/** Switches carrying over on (from this month) or off for one category. */
export function setRollover(id, on) {
  const c = db.prepare("SELECT id, rollover FROM categories WHERE id = ? AND kind = 'expense'").get(Number(id));
  if (!c) return { error: 'Choose a spending category.' };
  if (on && !c.rollover) db.prepare('UPDATE categories SET rollover = 1, rollover_from = ? WHERE id = ?').run(thisMonth(), c.id);
  if (!on && c.rollover) { db.prepare('UPDATE categories SET rollover = 0, rollover_from = NULL WHERE id = ?').run(c.id); db.prepare('DELETE FROM budget_months WHERE category_id = ?').run(c.id); }
  return { ok: true };
}
