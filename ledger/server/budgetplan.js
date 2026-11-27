// Planning a month's budget before it starts (2026-11-26, asked for by someone setting Ledger up near the end
// of a month who wanted to work on next month's budget).
//
// A budget in Ledger is one standing amount per category. An amount typed for a month that hasn't begun is
// kept here, apart, so the current month is not touched. Looking at that coming month shows the planned
// amounts; when the month arrives they become the standing amounts (earlier months keep what they had) and
// carry on until changed, exactly as if they had been typed on the 1st.
//
// The zero-based mode needs none of this: its amounts are already kept month by month (server/zero.js).
import { db } from './db.js';
import { periodOf } from './period.js';
import { settleBudgets } from './rollover.js';

db.exec('CREATE TABLE IF NOT EXISTS budget_plan (category_id INTEGER NOT NULL, month TEXT NOT NULL, budget REAL NOT NULL, PRIMARY KEY (category_id, month))');

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const thisMonth = () => periodOf();   // the budget month now running (server/period.js)
const add = (m, n) => { const [y, mo] = m.split('-').map(Number); const t = y * 12 + (mo - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };

/** Plans whose month has arrived become the standing budgets. Cheap when there is nothing due. */
export function applyDuePlans() {
  const now = thisMonth();
  const due = db.prepare('SELECT category_id id, month, budget FROM budget_plan WHERE month <= ? ORDER BY month').all(now);
  if (!due.length) return;
  settleBudgets();   // finished months keep the budget they really had
  db.exec('BEGIN');
  try {
    const set = db.prepare("UPDATE categories SET budget = ? WHERE id = ? AND kind = 'expense' AND hidden = 0");
    for (const p of due) set.run(p.budget, p.id);   // in month order, so the latest one wins
    db.prepare('DELETE FROM budget_plan WHERE month <= ?').run(now);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('Planned budgets could not be applied:', e.message);
  }
}

/** The amounts planned for a month that hasn't begun: { [category id]: dollars }, or null for any other month. */
export function plannedFor(month) {
  if (!MONTH.test(month) || month <= thisMonth()) return null;
  const out = {};
  for (const p of db.prepare('SELECT category_id id, budget FROM budget_plan WHERE month <= ? ORDER BY month').all(month)) out[p.id] = p.budget;
  return out;
}

/** A category that is removed, merged away, hidden or left out of the budget has no plan to keep. */
export const forgetPlans = (id) => { db.prepare('DELETE FROM budget_plan WHERE category_id = ?').run(Number(id)); };

export function installBudgetPlan(app) {
  applyDuePlans();
  setInterval(applyDuePlans, 30 * 60 * 1000).unref();

  const view = (month) => ({ month, now: thisMonth(), next: add(thisMonth(), 1), planned: plannedFor(month) || {} });
  app.get('/api/budget-plan', (req, res) => res.json(view(String(req.query.month || add(thisMonth(), 1)))));

  app.put('/api/budget-plan', (req, res) => {
    const month = String(req.body?.month || ''), id = Number(req.body?.category_id), amount = Number(req.body?.amount);
    if (!MONTH.test(month) || month <= thisMonth()) return res.status(400).json({ error: 'That month has already begun: change its budget on the Budgets page.' });
    if (month > add(thisMonth(), 12)) return res.status(400).json({ error: 'That is further ahead than Ledger plans.' });
    if (!db.prepare("SELECT 1 FROM categories WHERE id = ? AND kind = 'expense' AND hidden = 0").get(id)) return res.status(400).json({ error: 'That category is no longer there.' });
    if (!Number.isFinite(amount) || amount < 0 || amount > 1e7) return res.status(400).json({ error: 'Enter a budget of 0 or more.' });
    db.prepare('INSERT INTO budget_plan (category_id, month, budget) VALUES (?,?,?) ON CONFLICT(category_id, month) DO UPDATE SET budget = excluded.budget').run(id, month, Math.round(amount * 100) / 100);
    res.json(view(month));
  });

  // Starting a coming month over: it goes back to the amounts the month before it has.
  app.delete('/api/budget-plan', (req, res) => {
    const month = String(req.query.month || '');
    if (MONTH.test(month)) db.prepare('DELETE FROM budget_plan WHERE month = ?').run(month);
    res.json(view(month));
  });
}
