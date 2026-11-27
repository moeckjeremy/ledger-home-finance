// Months of expenses covered (2026-11-27). One plain figure for the Accounts page: how long the household's
// savings would last at its usual spending. It is arithmetic on what Ledger already holds, and it stops
// there: no target, no "you should have six months". Keep it that way.
//
// Savings: every savings account's balance, less the account set aside for taxes (Taxes, "Tax savings"),
// since that money is already spoken for. Usual spending: the average of the last three finished months,
// counting only months with ten or more purchases (a month before the bank was connected would drag the
// average down). Spending is the same sum the budget uses: categories of kind 'expense', refunds netted.
import { db, getSetting, iso } from './db.js';

const round = (n) => Math.round(n * 100) / 100;

export function cushion() {
  const taxOn = getSetting('taxes_off') !== '1';
  const taxId = taxOn ? Number(getSetting('tax_account')) || 0 : 0;
  const rows = db.prepare("SELECT id, name, balance FROM accounts WHERE type = 'savings'").all();
  const counted = rows.filter((a) => a.id !== taxId);
  const savings = round(counted.reduce((a, r) => a + Math.max(0, r.balance), 0));
  const checking = round(db.prepare("SELECT COALESCE(SUM(MAX(COALESCE(available, balance), 0)), 0) s FROM accounts WHERE type = 'checking' AND COALESCE(off_budget, 0) = 0").get().s);
  const now = new Date();
  const months = [];
  for (let back = 1; back <= 6 && months.length < 3; back++) {
    const from = iso(new Date(now.getFullYear(), now.getMonth() - back, 1)), to = iso(new Date(now.getFullYear(), now.getMonth() - back + 1, 1));
    const r = db.prepare(`SELECT COUNT(*) n, COALESCE(-SUM(t.amount), 0) spent FROM transactions t JOIN categories c ON c.id = t.category_id
      WHERE c.kind = 'expense' AND t.date >= ? AND t.date < ? AND COALESCE(t.pending, 0) = 0`).get(from, to);
    if (r.n >= 10 && r.spent > 0) months.push({ month: from.slice(0, 7), spent: round(r.spent) });
  }
  if (!rows.length || !months.length) return { ready: false, hasSavings: rows.length > 0, savings };
  const monthly = round(months.reduce((a, m) => a + m.spent, 0) / months.length);
  return {
    ready: true, savings, monthly, basedOn: months.length,
    months: Math.round((savings / monthly) * 10) / 10,
    withChecking: Math.round(((savings + checking) / monthly) * 10) / 10, checking,
    taxLeftOut: taxId && rows.some((a) => a.id === taxId) ? rows.find((a) => a.id === taxId).name : '',
  };
}

export function installCushion(app) {
  app.get('/api/cushion', (_req, res) => res.json(cushion()));
}
