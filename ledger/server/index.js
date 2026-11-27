// One process serves both the API and the app, on one port.
import { CURRENCIES, currency, validCurrency, validLocale } from './money.js';
import { installGigPay } from './gigpay.js';
import { installHaAi } from './haai.js';
import { installHaSensors } from './hasensors.js';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { db, iso, getSetting, setSetting, tzGiven, validZone } from './db.js';
import { WAITING_DAYS } from './waiting.js';
import { estimateTax, TAX_YEAR } from './tax.js';
import { stateChosen, stateList, stateOf, STATES } from './states.js';
import { installAuth, passwordSet, claimed } from './auth.js';
import * as simplefin from './simplefin.js';
import * as importer from './importer.js';
import { getRecurrings, installRecurring, nextDue, inMonth } from './recurring.js';
import { installUndo, keepForUndo } from './undo.js';
import { installRecap } from './recap.js';
import { installAi } from './ai.js';
import { installCfo } from './cfo.js';
import { installMail } from './mail.js';
import { installTap, installTapEndpoint, setStart } from './tap.js';
import { nameLoanPayments } from './loans.js';
import { applyNames, installNames } from './names.js';
import { installScan } from './scan.js';
import { installPasskeys } from './passkeys.js';
import { installCashflow, setTaxHoldSource } from './cashflow.js';
import { installVipkid } from './vipkid.js';
import { gig, extraGigs, installGig } from './gig.js';
import { installDeposits } from './deposits.js';
import { installRules } from './rules.js';
import { installTaxPack } from './taxpack.js';
import { installReceipts, dropReceipt } from './receipts.js';
import { installAlerts } from './alerts.js';
import { installPaydays } from './paydays.js';
import { installPaystub } from './paystub.js';
import { installTaxHints } from './taxhints.js';
import { installDebtGraph } from './debtgraph.js';
import { installStatements } from './statements.js';
import { installStatementRemind } from './statementremind.js';
import { installCatSuggest } from './catsuggest.js';
import { installOwners, ownerWhere } from './owners.js';
import { installOffBudget } from './offbudget.js';
import { installOrganize } from './organize.js';
import { applyDuePlans, forgetPlans, installBudgetPlan, plannedFor } from './budgetplan.js';
import { installUpdateCheck } from './updatecheck.js';
import { installCushion } from './cushion.js';
import { demoMode, installDemo } from './demo.js';
import { installDemoCfo } from './democfo.js';
import { installHideNames } from './hidenames.js';
import { installPrices } from './prices.js';
import { installZero, zeroFor } from './zero.js';
import { installAllowance } from './allowance.js';
import { installSetup } from './setup.js';
import { goals, installGoals, setTaxTarget } from './goals.js';
import { installSplits } from './splits.js';
import { carryInto, setRollover, settleBudgets } from './rollover.js';
import { installHoldings, investments } from './holdings.js';
import { installReconcile, lastChecks } from './reconcile.js';
import { installFamily } from './family.js';
import { installFeedback } from './feedback.js';
import { installLogos } from './logos.js';
import { installLogoFinder } from './logofinder.js';
const { startAutoSync } = simplefin;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 4317;
// Only this Mac can reach the app by default. Set HOST=0.0.0.0 to let other
// devices on your network (such as your iPhone) open it.
const HOST = process.env.HOST || '127.0.0.1';
const app = express();
// The usual protective headers (added 2026-11-18 in a pre-beta check; the request page already sent them).
// No other site may put Ledger in a frame, browsers must not guess file types, and where a link was
// followed from isn't passed on. The content rules apply only to the built app: scripts and data only
// from Ledger itself, pictures also from data and blob addresses (receipts, drawn icons).
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // As a Home Assistant add-on the pages are shown inside Home Assistant's own frame, so framing is allowed there and nowhere else.
  const framed = process.env.LEDGER_INGRESS === '1';
  if (!framed) res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (process.env.NODE_ENV === 'production') res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; ${framed ? '' : "frame-ancestors 'none'; "}base-uri 'self'; form-action 'self'`);
  next();
});
app.use(express.json({ limit: '8mb' }));
// A public demo's limits come before every route (server/demo.js). Does nothing on any other copy.
installDemo(app);
// The holiday backdrop is also used by Home Assistant (the kitchen display loads it from here as a
// module), and a browser will only load a module from another address if that address says it may.
// The file holds drawing code only, nothing private.
app.use((req, res, next) => { if (req.path === '/seasonal-backdrop.js') res.setHeader('Access-Control-Allow-Origin', '*'); next(); });
// Apple Pay purchases posted by a phone: let in by that phone's key, not by a sign-in.
installTapEndpoint(app);
installAuth(app);
installTap(app);
installRecurring(app);
installUndo(app);

const round = (n) => Math.round(n * 100) / 100;
const monthBounds = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return { start: `${m}-01`, end: iso(new Date(y, mo, 1)), days: new Date(y, mo, 0).getDate(), y, mo };
};
const validMonth = (m) => (/^\d{4}-\d{2}$/.test(m || '') ? m : iso(new Date()).slice(0, 7));

// Transactions worth a second look: anything left in "Other", plus payment-app
// transfers (Venmo, Cash App), which are often really haircuts or groceries.
export const NEEDS_REVIEW = "(c.name = 'Other' OR (c.kind = 'transfer' AND (t.merchant LIKE '%Venmo%' OR t.merchant LIKE '%Cash App%')))";

const TX_SELECT = `
  SELECT t.id, t.date, t.merchant, t.amount, t.notes, t.category_id, t.account_id, t.manual, t.pending, t.waiting, t.settled_at, t.deduct_pct, t.deduct_kind,
         -- A split purchase (server/splits.js): how many parts it has, and the whole amount the bank charged.
         t.split_of, (SELECT COUNT(*) FROM transactions k WHERE k.split_of = t.id) parts, t.left_out IS NOT NULL left_out, (t.acct_out IS NOT NULL AND t.acct_out != t.category_id) acct_out, a.off_budget acct_off,
         (SELECT 1 FROM receipts r WHERE r.transaction_id = COALESCE(t.split_of, t.id)) receipt,
         (SELECT ROUND(p.amount + COALESCE((SELECT SUM(k.amount) FROM transactions k WHERE k.split_of = p.id), 0), 2) FROM transactions p WHERE p.id = COALESCE(t.split_of, t.id)) whole,
         c.name category, c.icon, c.color, c.kind, c.key cat_key, a.name account
  FROM transactions t JOIN categories c ON c.id = t.category_id JOIN accounts a ON a.id = t.account_id`;

app.get('/api/months', (_req, res) => {
  // The current month is always offered, so a household with no purchases yet still sees its
  // dashboard (balances, forecast, budgets) and not an empty page.
  const seen = db.prepare("SELECT DISTINCT substr(date,1,7) m FROM transactions ORDER BY m DESC").all().map((r) => r.m);
  res.json([...new Set([iso(new Date()).slice(0, 7), ...seen])].sort().reverse());
});

app.get('/api/categories', (_req, res) => {
  res.json(db.prepare('SELECT * FROM categories ORDER BY sort').all());
});

/** Everything the dashboard shows for one month. Also feeds the recap. */
function summaryFor(monthArg) {
  const month = validMonth(monthArg);
  applyDuePlans();   // budgets planned ahead for a month that has now begun (server/budgetplan.js)
  const { start, end, days, y, mo } = monthBounds(month);
  const today = iso(new Date());
  const isCurrent = today.slice(0, 7) === month;
  const lastDay = isCurrent ? Number(today.slice(8)) : days;

  const categories = db.prepare(`
    SELECT c.id, c.name, c.icon, c.color, c.fixed, c.budget, c.hidden, c.group_id, COALESCE(-SUM(t.amount), 0) spent
    FROM categories c LEFT JOIN transactions t ON t.category_id = c.id AND t.date >= ? AND t.date < ?
    WHERE c.kind = 'expense' GROUP BY c.id ORDER BY c.sort`).all(start, end)
    .map((c) => ({ ...c, spent: round(c.spent) }));
  // A month that hasn't begun shows the amounts planned for it, where any were typed.
  const planned = plannedFor(month);
  if (planned) for (const c of categories) if (c.id in planned) { c.budget = planned[c.id]; c.planned = true; }
  // A category that carries over (server/rollover.js) has this month's budget raised by what was left in
  // earlier months, or lowered by what was overspent. `budget` is what the month really has to spend, so
  // every total, meter and pace line follows; `base` is the monthly amount as typed, and `carry` the difference.
  // In the zero-based mode (server/zero.js) a category's budget for the month is what it has been given:
  // what it carried in plus what was assigned this month. `base` is this month's assignment.
  const zero = zeroFor(month);
  const carried = zero ? {} : carryInto(month);
  for (const c of categories) {
    if (zero) {
      const z = zero.cats[c.id] || { assigned: 0, carryIn: 0 };
      c.zero = true; c.base = z.assigned; c.carry = z.carryIn; c.rollover = false;
      c.budget = Math.max(0, round(z.assigned + z.carryIn));
      continue;
    }
    c.base = c.budget;
    c.rollover = c.id in carried;
    c.carry = carried[c.id] || 0;
    if (c.rollover) c.budget = Math.max(0, round(c.base + c.carry));
  }

  // Categories left out of the budget (server/organize.js): what went out under each this month and what
  // came back. They are in none of the figures below.
  const aside = db.prepare(`
    SELECT c.id, c.name, c.icon, COALESCE(-SUM(CASE WHEN t.amount < 0 THEN t.amount END), 0) out,
           COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount END), 0) back
    FROM categories c LEFT JOIN transactions t ON t.category_id = c.id AND t.date >= ? AND t.date < ?
    WHERE c.kind = 'aside' GROUP BY c.id ORDER BY c.sort, c.id`).all(start, end).map((c) => ({ ...c, out: round(c.out), back: round(c.back) }));

  const byDay = Object.fromEntries(db.prepare(`
    SELECT t.date, -SUM(t.amount) s FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE c.kind = 'expense' AND t.date >= ? AND t.date < ? GROUP BY t.date`).all(start, end)
    .map((r) => [Number(r.date.slice(8)), r.s]));

  // Budget pace: flexible categories accrue evenly through the month; fixed
  // categories step up on the days their bills are due.
  const recurrings = getRecurrings();
  const flexBudget = categories.filter((c) => !c.fixed).reduce((a, c) => a + c.budget, 0);
  const fixedCats = categories.filter((c) => c.fixed);
  const paceAt = (d) => {
    let p = (flexBudget * d) / days;
    for (const c of fixedCats) {
      // Yearly bills only count in the month they renew.
      const bills = recurrings.filter((r) => r.category_id === c.id).flatMap((r) => inMonth(r, y, mo));
      const total = bills.reduce((a, r) => a + r.amount, 0);
      if (!total) p += (c.budget * d) / days;
      else p += (c.budget * bills.filter((r) => r.day <= d).reduce((a, r) => a + r.amount, 0)) / total;
    }
    return round(p);
  };
  const daily = [];
  let cum = 0;
  for (let d = 1; d <= days; d++) {
    cum += byDay[d] || 0;
    daily.push({ day: d, spent: d <= lastDay ? round(cum) : null, pace: paceAt(d) });
  }

  const spent = round(categories.reduce((a, c) => a + c.spent, 0));
  const budget = round(categories.reduce((a, c) => a + c.budget, 0));
  const income = round(db.prepare(`
    SELECT COALESCE(SUM(t.amount), 0) s FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE c.kind = 'income' AND t.date >= ? AND t.date < ?`).get(start, end).s);

  // An insurance policy's figure is a premium or amount due, not money you have or owe on a loan, so it stays out of net worth.
  const netWorth = round(db.prepare("SELECT SUM(balance) s FROM accounts WHERE type != 'insurance'").get().s);
  const prior = db.prepare("SELECT SUM(balance) s FROM balance_history WHERE account_id NOT IN (SELECT id FROM accounts WHERE type = 'insurance') AND date = ?")
    .get(iso(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1))).s;

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const upcoming = recurrings.map((r) => {
    const cat = categories.find((c) => c.id === r.category_id);
    return { ...r, next: nextDue(r, iso(now)), icon: cat?.icon, category: cat?.name };
  }).sort((a, b) => a.next.localeCompare(b.next));

  const cashflow = [];
  for (let i = 5; i >= 0; i--) {
    const m = iso(new Date(y, mo - 1 - i, 1)).slice(0, 7);
    const b = monthBounds(m);
    const row = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN c.kind = 'income' THEN t.amount END), 0) income,
             COALESCE(-SUM(CASE WHEN c.kind = 'expense' THEN t.amount END), 0) spending
      FROM transactions t JOIN categories c ON c.id = t.category_id WHERE t.date >= ? AND t.date < ?`).get(b.start, b.end);
    cashflow.push({ month: m, income: round(row.income), spending: round(row.spending) });
  }

  return { aside,
    month, isCurrent, lastDay, days, spent, budget, income, netWorth,
    netWorthChange: prior ? round(netWorth - prior) : 0,
    paceToday: paceAt(lastDay), categories, daily, upcoming, cashflow,
    recent: db.prepare(`${TX_SELECT} WHERE t.date >= ? AND t.date < ? ORDER BY t.date DESC, t.id DESC LIMIT 7`).all(start, end),
  };
}
app.get('/api/summary', (req, res) => res.json(summaryFor(req.query.month)));

/**
 * What's behind the four dashboard tiles: net worth by account, spending by
 * category and merchant, income by source, and how income less spending came out.
 */
app.get('/api/insight', (req, res) => {
  const s = summaryFor(req.query.month);
  const { start, end, y, mo } = monthBounds(s.month);
  const prevMonth = iso(new Date(y, mo - 2, 1)).slice(0, 7);
  const prev = monthBounds(prevMonth);
  // "By this point last month": the same number of days into the previous month.
  const cutDay = Math.min(s.lastDay, prev.days);
  const prevCut = s.isCurrent ? iso(new Date(prev.y, prev.mo - 1, cutDay + 1)) : prev.end;

  const lastByCat = Object.fromEntries(db.prepare(`
    SELECT t.category_id id, -SUM(t.amount) s FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE c.kind = 'expense' AND t.date >= ? AND t.date < ? GROUP BY t.category_id`).all(prev.start, prevCut).map((r) => [r.id, round(r.s)]));
  const categories = s.categories.filter((c) => c.spent || c.budget || lastByCat[c.id])
    .map((c) => ({ ...c, last: lastByCat[c.id] || 0 })).sort((a, b) => b.spent - a.spent);
  const merchants = db.prepare(`
    SELECT t.merchant, COUNT(*) n, -SUM(t.amount) total, MAX(c.icon) icon FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE c.kind = 'expense' AND t.date >= ? AND t.date < ? GROUP BY t.merchant HAVING total > 0 ORDER BY total DESC LIMIT 12`).all(start, end)
    .map((m) => ({ ...m, total: round(m.total) }));
  const largest = db.prepare(`${TX_SELECT} WHERE c.kind = 'expense' AND t.amount < 0 AND t.date >= ? AND t.date < ? ORDER BY t.amount LIMIT 10`).all(start, end);

  const sumKind = (kind, from, to) => round(db.prepare(`
    SELECT COALESCE(SUM(t.amount), 0) s FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE c.kind = ? AND t.date >= ? AND t.date < ?`).get(kind, from, to).s);
  const sources = db.prepare(`
    SELECT t.merchant, c.name category, c.icon, COUNT(*) n, SUM(t.amount) total FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE c.kind = 'income' AND t.date >= ? AND t.date < ? GROUP BY t.merchant, c.id ORDER BY total DESC`).all(start, end)
    .map((r) => ({ ...r, total: round(r.total) }));
  const deposits = db.prepare(`${TX_SELECT} WHERE c.kind = 'income' AND t.date >= ? AND t.date < ? ORDER BY t.date DESC, t.id DESC LIMIT 60`).all(start, end);

  const fixedSpent = round(s.categories.filter((c) => c.fixed).reduce((a, c) => a + c.spent, 0));
  const accounts = db.prepare(`
    SELECT a.id, a.name, a.institution, a.type, a.balance,
      (SELECT h.balance FROM balance_history h WHERE h.account_id = a.id AND h.date >= ? AND h.date < ? ORDER BY h.date LIMIT 1) first,
      (SELECT h.date FROM balance_history h WHERE h.account_id = a.id AND h.date >= ? AND h.date < ? ORDER BY h.date LIMIT 1) since
    FROM accounts a WHERE a.type != 'insurance' ORDER BY a.balance DESC`).all(start, end, start, end);

  res.json({
    month: s.month, isCurrent: s.isCurrent, lastDay: s.lastDay, prevMonth,
    spent: s.spent, budget: s.budget, income: s.income, paceToday: s.paceToday,
    spentLast: -sumKind('expense', prev.start, prevCut), spentLastFull: -sumKind('expense', prev.start, prev.end),
    incomeLast: sumKind('income', prev.start, prevCut), incomeLastFull: sumKind('income', prev.start, prev.end),
    categories, merchants, largest, sources, deposits,
    fixedSpent, flexSpent: round(s.spent - fixedSpent), cashflow: s.cashflow,
    netWorth: s.netWorth, accounts,
  });
});

app.get('/api/transactions', (req, res) => {
  const where = [];
  const args = [];
  if (req.query.month) {
    const b = monthBounds(validMonth(req.query.month));
    where.push('t.date >= ? AND t.date < ?');
    args.push(b.start, b.end);
  }
  if (req.query.category) { where.push('t.category_id = ?'); args.push(Number(req.query.category)); }
  if (req.query.account) { where.push('t.account_id = ?'); args.push(Number(req.query.account)); }
  const own = ownerWhere(String(req.query.who || ''));
  if (own.sql) { where.push(own.sql); args.push(...own.args); }
  if (req.query.claimed) where.push('t.deduct_pct > 0');
  if (req.query.review) where.push(NEEDS_REVIEW);
  if (req.query.q) {
    // A figure typed in the search box (58.20, $58, 1,200) also finds transactions of that amount.
    const figure = /^\$?[\d,]*\.?\d+$/.test(String(req.query.q).trim()) ? String(req.query.q).replace(/[$,]/g, '').trim() : '';
    where.push(`(t.merchant LIKE ? OR t.notes LIKE ?${figure ? " OR printf('%.2f', abs(t.amount)) LIKE ?" : ''})`);
    args.push(`%${req.query.q}%`, `%${req.query.q}%`, ...(figure ? [`${figure}%`] : []));
  }
  const sql = `${TX_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.date DESC, t.id DESC LIMIT 500`;
  res.json(db.prepare(sql).all(...args));
});

// A purchase split across categories keeps the categories it was given: changing every purchase from a merchant leaves it alone.
if (!db.prepare('PRAGMA table_info(transactions)').all().some((c) => c.name === 'left_out')) db.exec('ALTER TABLE transactions ADD COLUMN left_out INTEGER');
// Purchases a merchant-wide change may touch: not split ones, and not ones left out of spending on purpose.
const NOT_SPLIT = 'split_of IS NULL AND left_out IS NULL AND id NOT IN (SELECT split_of FROM transactions WHERE split_of IS NOT NULL)';
// A change made for every purchase from a shop doesn't reach into an account left out of the budget
// (server/offbudget.js): those purchases stay out unless one is filed by hand.
const IN_BUDGET = 'account_id NOT IN (SELECT id FROM accounts WHERE off_budget = 1)';

// Recategorize one or many transactions. With applyToMerchant, every
// transaction from that merchant changes and a rule remembers it for later.
// "It's a refund" on money that came in: file it under the category of the purchase it refunds, so
// it comes off that category's spending (every total nets money in against money out per category).
// The purchase is the most recent one in the last six months from the same merchant, or failing
// that from one whose name shares its first word.
app.post('/api/transactions/:id/refund', (req, res) => {
  const t = db.prepare('SELECT * FROM transactions WHERE id = ?').get(Number(req.params.id));
  if (!t || !(t.amount > 0)) return res.status(404).json({ error: 'That is not money coming in.' });
  const bought = (where, arg) => db.prepare(`SELECT t.merchant, t.date, t.category_id, c.name category FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE t.amount < 0 AND c.kind = 'expense' AND t.date <= ? AND t.date >= date(?, '-180 days') AND ${where} ORDER BY t.date DESC LIMIT 1`).get(t.date, t.date, arg);
  const first = (String(t.merchant).toLowerCase().match(/[a-z0-9]{4,}/) || [''])[0];
  const from = bought('t.merchant = ? COLLATE NOCASE', t.merchant) || (first ? bought('lower(t.merchant) LIKE ?', `${first}%`) : null);
  if (!from) return res.status(404).json({ error: "Ledger couldn't find the purchase this refunds. Choose its category from the menu on this line instead: any spending category works." });
  db.prepare('UPDATE transactions SET category_id = ? WHERE id = ?').run(from.category_id, t.id);
  res.json({ category: from.category, from: `${from.merchant} on ${from.date}` });
});

app.post('/api/transactions/categorize', (req, res) => {
  const { ids = [], category_id, applyToMerchant } = req.body || {};
  if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(category_id)) return res.status(400).json({ error: 'Unknown category' });
  // Remember what each transaction was before, so the change can be undone.
  const before = new Map();
  const one = db.prepare('SELECT id, category_id FROM transactions WHERE id = ?');
  for (const id of ids) { const r = one.get(Number(id)); if (r) before.set(r.id, r.category_id); }
  let rule = null;
  if (applyToMerchant) {
    for (const r of db.prepare(`SELECT id, category_id FROM transactions WHERE merchant = ? AND ${NOT_SPLIT} AND ${IN_BUDGET}`).all(applyToMerchant)) if (!before.has(r.id)) before.set(r.id, r.category_id);
    rule = { merchant: applyToMerchant, previous: db.prepare('SELECT category_id FROM rules WHERE merchant = ?').get(applyToMerchant)?.category_id ?? null };
  }
  let changed = 0;
  // Choosing a category by hand for something left out puts it back in, under that category.
  const upd = db.prepare('UPDATE transactions SET category_id = ?, left_out = NULL WHERE id = ?');
  for (const id of ids) changed += upd.run(category_id, Number(id)).changes;
  // Filed as income by hand: that is the household's answer, so the deposit review doesn't ask about it.
  if (db.prepare("SELECT 1 FROM categories WHERE id = ? AND kind = 'income'").get(category_id)) for (const id of ids) db.prepare('UPDATE transactions SET income_ok = 1 WHERE id = ? AND amount > 0').run(Number(id));
  if (applyToMerchant) {
    changed = db.prepare(`UPDATE transactions SET category_id = ? WHERE merchant = ? AND ${NOT_SPLIT} AND ${IN_BUDGET}`).run(category_id, applyToMerchant).changes;
    db.prepare('INSERT INTO rules (merchant, category_id) VALUES (?, ?) ON CONFLICT(merchant) DO UPDATE SET category_id = excluded.category_id')
      .run(applyToMerchant, category_id);
  }
  res.json({ changed, undo: { items: [...before].map(([id, c]) => ({ id, category_id: c })), rule } });
});

// Undo a recategorization: put each transaction back, and the merchant rule with it.
app.post('/api/transactions/restore', (req, res) => {
  const { items = [], rule } = req.body || {};
  const valid = new Set(db.prepare('SELECT id FROM categories').all().map((c) => c.id));
  const upd = db.prepare('UPDATE transactions SET category_id = ? WHERE id = ?');
  let restored = 0;
  for (const it of items.slice(0, 5000)) if (valid.has(Number(it.category_id))) restored += upd.run(Number(it.category_id), Number(it.id)).changes;
  if (rule?.merchant) {
    if (rule.previous != null && valid.has(Number(rule.previous))) db.prepare('INSERT INTO rules (merchant, category_id) VALUES (?, ?) ON CONFLICT(merchant) DO UPDATE SET category_id = excluded.category_id').run(String(rule.merchant), Number(rule.previous));
    else db.prepare('DELETE FROM rules WHERE merchant = ?').run(String(rule.merchant));
  }
  res.json({ restored });
});

// Add a transaction by hand, such as a cash purchase. The amount arrives as a
// positive number; the category decides whether it counts as spending or income.
app.post('/api/transactions', (req, res) => {
  const { date, merchant, amount, category_id, account_id, notes } = req.body || {};
  const name = String(merchant || '').trim().slice(0, 120);
  const amt = Number(amount);
  const cat = db.prepare('SELECT kind FROM categories WHERE id = ?').get(Number(category_id));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || Number.isNaN(Date.parse(date))) return res.status(400).json({ error: 'Choose a date.' });
  if (!name) return res.status(400).json({ error: 'Enter where the money went.' });
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'Enter an amount above 0.' });
  if (!cat) return res.status(400).json({ error: 'Choose a category.' });
  const account = db.prepare('SELECT type, manual FROM accounts WHERE id = ?').get(Number(account_id));
  if (!account) return res.status(400).json({ error: 'Choose an account.' });
  // Entries read from a screenshot say which way the money went; otherwise the category decides.
  const signed = round(req.body.direction === 'in' ? amt : req.body.direction === 'out' ? -amt : cat.kind === 'income' ? amt : -amt);
  // On a bank or card account the bank will list this too, so the entry waits to be replaced by it.
  const waiting = account.type !== 'cash' && !account.manual ? 1 : 0;
  if (waiting && !req.body.force) {
    const dup = db.prepare(`SELECT merchant, date FROM transactions WHERE account_id = ? AND manual = 0 AND abs(amount - ?) < 0.005
      AND date >= date(?, '-1 day') AND date <= date(?, '+${WAITING_DAYS} days') ORDER BY date LIMIT 1`).get(Number(account_id), signed, date, date);
    if (dup) return res.status(409).json({ error: `The bank already lists a charge for this amount: ${dup.merchant} on ${dup.date}. Nothing was added.`, duplicate: true });
  }
  const rule = cat.kind === 'expense' && signed < 0 ? db.prepare('SELECT pct, kind FROM deduct_rules WHERE ? LIKE merchant ORDER BY length(merchant) DESC LIMIT 1').get(name) : null;
  const r = db.prepare('INSERT INTO transactions (account_id, date, merchant, amount, category_id, notes, manual, waiting, deduct_pct, deduct_kind) VALUES (?,?,?,?,?,?,1,?,?,?)')
    .run(Number(account_id), date, name, signed, Number(category_id), String(notes || '').slice(0, 500), waiting, rule?.pct ?? 0, rule?.kind ?? 'vipkid');
  if (cat.kind === 'income' && signed > 0) db.prepare('UPDATE transactions SET income_ok = 1 WHERE id = ?').run(Number(r.lastInsertRowid));
  res.json({ id: Number(r.lastInsertRowid), waiting: !!waiting });
});

// Record a transfer you've made at the bank: money out of one account and into
// another, both waiting for the bank's own entries. Ledger can't move money itself.
app.post('/api/transfers', (req, res) => {
  const { date } = req.body || {};
  const amt = round(Number(req.body?.amount));
  const find = db.prepare("SELECT id, name, type, manual FROM accounts WHERE id = ? AND type != 'insurance'");
  const from = find.get(Number(req.body?.from)), to = find.get(Number(req.body?.to));
  if (!from || !to) return res.status(400).json({ error: 'Choose both accounts.' });
  if (from.id === to.id) return res.status(400).json({ error: 'Choose two different accounts.' });
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'Enter an amount above 0.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || Number.isNaN(Date.parse(date))) return res.status(400).json({ error: 'Choose a date.' });
  const cat = db.prepare("SELECT id FROM categories WHERE kind = 'transfer' ORDER BY (name = 'Transfer') DESC, id LIMIT 1").get();
  if (!cat) return res.status(400).json({ error: 'There is no transfer category to file this under.' });
  const ins = db.prepare('INSERT INTO transactions (account_id, date, merchant, amount, category_id, notes, manual, waiting) VALUES (?,?,?,?,?,?,1,?)');
  const waits = (a) => (a.type !== 'cash' && !a.manual ? 1 : 0);
  const out = Number(ins.run(from.id, date, `Transfer to ${to.name}`, -amt, cat.id, '', waits(from)).lastInsertRowid);
  const into = Number(ins.run(to.id, date, `Transfer from ${from.name}`, amt, cat.id, '', waits(to)).lastInsertRowid);
  // The two halves know each other, so removing one removes both and no half is left behind.
  db.prepare('UPDATE transactions SET pair = ? WHERE id IN (?, ?)').run(out, out, into);
  res.json({ ok: true, from: from.name, to: to.name, amount: amt });
});

// Claim a purchase (or a share of it) as a VIPKid business expense. With
// applyToMerchant, every purchase from that merchant is claimed the same way
// and a rule repeats it on future ones.
app.post('/api/transactions/deduct', (req, res) => {
  const { id, applyToMerchant } = req.body || {};
  const pct = Number(req.body?.pct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return res.status(400).json({ error: 'Enter a share from 0 to 100.' });
  const kind = req.body?.kind === 'teaching' ? 'teaching' : 'vipkid';
  let changed = 0;
  if (applyToMerchant) {
    changed = db.prepare('UPDATE transactions SET deduct_pct = ?, deduct_kind = ? WHERE merchant = ? AND amount < 0').run(pct, kind, applyToMerchant).changes;
    if (pct > 0) db.prepare('INSERT INTO deduct_rules (merchant, pct, kind) VALUES (?, ?, ?) ON CONFLICT(merchant) DO UPDATE SET pct = excluded.pct, kind = excluded.kind').run(applyToMerchant, pct, kind);
    else db.prepare('DELETE FROM deduct_rules WHERE merchant = ?').run(applyToMerchant);
  } else {
    changed = db.prepare('UPDATE transactions SET deduct_pct = ?, deduct_kind = ? WHERE id = ? AND amount < 0').run(pct, kind, Number(id)).changes;
  }
  res.json({ changed });
});

app.delete('/api/transactions/:id',(req, res) => {
  const mine = db.prepare('SELECT * FROM transactions WHERE id = ? AND manual = 1').get(Number(req.params.id));
  const pair = mine?.pair;
  // Everything that goes with it is remembered for ten minutes, so "Undo" can put it all back.
  const going = mine ? [
    { table: 'transactions', row: mine },
    ...(pair != null ? db.prepare('SELECT * FROM transactions WHERE pair = ? AND manual = 1 AND id != ?').all(pair, mine.id) : []).map((row) => ({ table: 'transactions', row })),
    ...db.prepare('SELECT * FROM transactions WHERE split_of = ?').all(mine.id).map((row) => ({ table: 'transactions', row })),
    ...db.prepare('SELECT * FROM receipts WHERE transaction_id = ?').all(mine.id).map((row) => ({ table: 'receipts', row })),
  ] : [];
  const r = db.prepare('DELETE FROM transactions WHERE id = ? AND manual = 1').run(Number(req.params.id));
  if (!r.changes) return res.status(400).json({ error: 'Only transactions you added by hand can be removed.' });
  // The other half of a transfer you recorded goes with it (unless the bank has already taken that half over).
  const both = pair != null && db.prepare('DELETE FROM transactions WHERE pair = ? AND manual = 1').run(pair).changes > 0;
  // Its parts, if it had been split, go with it, and so does a receipt's picture.
  db.prepare('DELETE FROM transactions WHERE split_of = ?').run(Number(req.params.id));
  dropReceipt(req.params.id);
  res.json({ ok: true, both, undo: keepForUndo(mine.merchant, going), label: mine.merchant });
});

// "Leave out": a transaction that shouldn't count as spending or income, such as a charge the bank
// posted twice or one that was paid back another way. Nothing is deleted (the bank's feed would only
// bring it back): it is filed under Transfer, which every total in the app already leaves out, and
// the category it had is kept in `left_out` so "Put back" can restore it. Its account balance is not
// changed, because the bank's figure already includes whatever really happened.
app.post('/api/transactions/:id/leave-out', (req, res) => {
  const t = db.prepare('SELECT t.*, c.kind FROM transactions t JOIN categories c ON c.id = t.category_id WHERE t.id = ?').get(Number(req.params.id));
  if (!t) return res.status(404).json({ error: 'That transaction is gone.' });
  if (req.body?.on === false) {
    if (t.left_out == null) return res.status(400).json({ error: "That transaction isn't left out." });
    const back = db.prepare('SELECT id FROM categories WHERE id = ?').get(t.left_out)?.id
      ?? db.prepare("SELECT id FROM categories WHERE COALESCE(key, name) = ?").get(t.amount > 0 ? 'Income' : 'Other')?.id;
    db.prepare('UPDATE transactions SET category_id = ?, left_out = NULL WHERE id = ?').run(back, t.id);
    return res.json({ ok: true });
  }
  if (t.left_out != null) return res.json({ ok: true });
  if (t.kind === 'transfer') return res.status(400).json({ error: "Transfers already don't count as spending." });
  if (t.pending) return res.status(400).json({ error: 'Wait until the bank has posted it.' });
  if (t.split_of || db.prepare('SELECT 1 FROM transactions WHERE split_of = ?').get(t.id)) return res.status(400).json({ error: 'Undo the split first.' });
  const transfer = db.prepare("SELECT id FROM categories WHERE kind = 'transfer' ORDER BY COALESCE(key, name) = 'Transfer' DESC, id LIMIT 1").get()?.id;
  if (!transfer) return res.status(400).json({ error: 'There is no Transfer category to file it under.' });
  // A purchase left out shouldn't stay claimed for tax either.
  db.prepare('UPDATE transactions SET left_out = category_id, category_id = ?, deduct_pct = 0 WHERE id = ?').run(transfer, t.id);
  res.json({ ok: true });
});

app.get('/api/merchant-count',(req, res) => {
  res.json(db.prepare('SELECT COUNT(*) n FROM transactions WHERE merchant = ?').get(String(req.query.merchant || '')));
});

app.patch('/api/transactions/:id', (req, res) => {
  if (req.body?.notes !== undefined) db.prepare('UPDATE transactions SET notes = ? WHERE id = ?').run(String(req.body.notes ?? '').slice(0, 500), Number(req.params.id));
  // Correcting something you typed in: its name, amount or date. Only entries added by hand, and not
  // ones that have been split (undo the split first), since the bank's own entries are the bank's record.
  if (req.body?.merchant !== undefined || req.body?.amount !== undefined || req.body?.date !== undefined) {
    const t = db.prepare('SELECT * FROM transactions WHERE id = ?').get(Number(req.params.id));
    if (!t || !t.manual) return res.status(400).json({ error: 'Only transactions you added by hand can be changed. The bank decides the rest.' });
    if (t.split_of || db.prepare('SELECT 1 FROM transactions WHERE split_of = ?').get(t.id)) return res.status(400).json({ error: 'Undo the split first, then change it.' });
    const name = req.body.merchant !== undefined ? String(req.body.merchant).trim().slice(0, 120) : t.merchant;
    const amt = req.body.amount !== undefined ? Number(req.body.amount) : Math.abs(t.amount);
    const date = req.body.date !== undefined ? String(req.body.date) : t.date;
    if (!name) return res.status(400).json({ error: 'Enter a name.' });
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'Enter an amount above 0.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return res.status(400).json({ error: 'Choose a date.' });
    db.prepare('UPDATE transactions SET merchant = ?, amount = ?, date = ? WHERE id = ?').run(name, round(t.amount < 0 ? -amt : amt), date, t.id);
  }
  // "Keep" on an entry the bank never listed: it stays as an ordinary hand-added transaction.
  if (req.body?.waiting === false) {
    db.prepare('UPDATE transactions SET waiting = 0 WHERE id = ? AND manual = 1').run(Number(req.params.id));
    db.prepare('UPDATE transactions SET waiting = 0 WHERE split_of = ? AND manual = 1').run(Number(req.params.id));
  }
  res.json({ ok: true });
});

const CATEGORY_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948', '#4f8f9c', '#a0672b'];
app.post('/api/categories', (req, res) => {
  const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const icon = String(req.body?.icon || '').trim().slice(0, 8) || '🏷️';
  const budget = req.body?.budget === undefined || req.body.budget === '' ? 0 : Number(req.body.budget);
  if (!name) return res.status(400).json({ error: 'Enter a name for the category.' });
  if (!Number.isFinite(budget) || budget < 0) return res.status(400).json({ error: 'Enter a budget of 0 or more.' });
  const twin = db.prepare('SELECT hidden FROM categories WHERE lower(name) = lower(?)').get(name);
  if (twin) return res.status(400).json({ error: twin.hidden ? `You already have a category called ${name}, hidden. Show it again at the foot of the Budgets page.` : `You already have a category called ${name}.` });
  const count = db.prepare('SELECT COUNT(*) n FROM categories').get().n;
  // New categories sit just above "Other" in lists.
  const other = db.prepare("SELECT sort FROM categories WHERE COALESCE(key, name) = 'Other'").get()?.sort ?? 11;
  const id = Number(db.prepare("INSERT INTO categories (name, icon, color, kind, fixed, budget, sort) VALUES (?, ?, ?, 'expense', 0, ?, ?)")
    .run(name, icon, CATEGORY_COLORS[count % CATEGORY_COLORS.length], budget, other - 0.5 + count * 0.001).lastInsertRowid);
  res.json({ id, name, icon });
});

// Remove a category. Everything filed in it moves to Other (or Income, for an income category), so no
// transaction is left without one. The few categories the app itself relies on can't be removed.
app.delete('/api/categories/:id', (req, res) => {
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(req.params.id));
  if (!cat) return res.status(404).json({ error: 'That category is no longer there.' });
  if (['Other', 'Income', 'Transfer'].includes(cat.name) || cat.kind === 'transfer') return res.status(400).json({ error: `${cat.name} can't be removed: Ledger uses it for things that don't fit anywhere else.` });
  if (extraGigs().some((x) => x.categoryId === cat.id)) return res.status(400).json({ error: `${cat.name} is a side gig's category. Remove that side gig in Settings first.` });
  if (String(cat.id) === getSetting('vipkid_category_id') && gig().on) return res.status(400).json({ error: `${cat.name} is your side gig's category. Switch the side gig off in Settings first.` });
  const home = db.prepare('SELECT id, name FROM categories WHERE COALESCE(key, name) = ?').get(cat.kind === 'income' ? 'Income' : 'Other');
  if (!home) return res.status(400).json({ error: 'There is nowhere to move its transactions to.' });
  db.exec('BEGIN');
  try {
    const moved = db.prepare('UPDATE transactions SET category_id = ? WHERE category_id = ?').run(home.id, cat.id).changes;
    db.prepare('UPDATE recurrings SET category_id = ? WHERE category_id = ?').run(home.id, cat.id);
    db.prepare('DELETE FROM rules WHERE category_id = ?').run(cat.id);
    db.prepare('DELETE FROM categories WHERE id = ?').run(cat.id);
    forgetPlans(cat.id);
    if (String(cat.id) === getSetting('vipkid_category_id')) setSetting('vipkid_category_id', '');
    db.exec('COMMIT');
    res.json({ ok: true, moved, to: home.name });
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: `That category couldn't be removed: ${e.message}` });
  }
});

app.patch('/api/categories/:id', (req, res) => {
  // The name and icon (clicking a category's icon anywhere, or Rename on Budgets), or just the budget.
  if ((req.body?.icon !== undefined || req.body?.name !== undefined) && req.body?.budget === undefined) {
    const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(req.params.id));
    if (!cat) return res.status(404).json({ error: 'That category is gone.' });
    if (req.body.name !== undefined) {
      const name = String(req.body.name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      if (!name) return res.status(400).json({ error: 'Enter a name for the category.' });
      if (name !== cat.name) {
        // The app itself files things under these three by name, and a side gig's category is named from Settings.
        if (['Other', 'Income', 'Transfer', 'Deposit'].includes(cat.key || cat.name)) return res.status(400).json({ error: `${cat.name} can't be renamed: Ledger files things there itself.` });
        if ((String(cat.id) === getSetting('vipkid_category_id') && gig().on) || extraGigs().some((x) => x.categoryId === cat.id)) return res.status(400).json({ error: `${cat.name} is a side gig's category. Rename the side gig in Settings and this follows.` });
        if (db.prepare('SELECT 1 FROM categories WHERE lower(name) = lower(?) AND id != ?').get(name, cat.id)) return res.status(400).json({ error: `You already have a category called ${name}.` });
        // Its first name is kept as `key`, which is how automatic filing still finds a built-in category.
        db.prepare('UPDATE categories SET name = ?, key = COALESCE(key, ?) WHERE id = ?').run(name, cat.name, cat.id);
      }
    }
    if (req.body.icon !== undefined) {
      const icon = [...String(req.body.icon || '').trim()].slice(0, 4).join('');
      if (!icon) return res.status(400).json({ error: 'Choose an icon.' });
      db.prepare('UPDATE categories SET icon = ? WHERE id = ?').run(icon, cat.id);
    }
    return res.json({ ok: true });
  }
  // Carry what's left into next month, or stop.
  if (req.body?.rollover !== undefined && req.body?.budget === undefined) {
    const r = setRollover(req.params.id, !!req.body.rollover);
    return r.error ? res.status(400).json(r) : res.json(r);
  }
  const budget = Number(req.body?.budget);
  if (!Number.isFinite(budget) || budget < 0) return res.status(400).json({ error: 'Enter a budget of 0 or more' });
  settleBudgets();   // earlier months keep the budget they had
  db.prepare('UPDATE categories SET budget = ? WHERE id = ?').run(budget, Number(req.params.id));
  res.json({ ok: true });
});

app.get('/api/accounts', (_req, res) => {
  const checks = lastChecks();
  const accounts = db.prepare('SELECT * FROM accounts ORDER BY COALESCE(sort, id), id').all().map((a) => ({ ...a, checked: checks[a.id] || null }));
  const history = db.prepare(`
    SELECT date, SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END) assets,
           SUM(CASE WHEN balance < 0 THEN -balance ELSE 0 END) debts, SUM(balance) net
    FROM balance_history WHERE account_id NOT IN (SELECT id FROM accounts WHERE type = 'insurance') GROUP BY date ORDER BY date`).all();
  const counted = accounts.filter((a) => a.type !== 'insurance');
  const net = counted.reduce((a, x) => a + x.balance, 0);
  history.push({
    date: iso(new Date()), net,
    assets: counted.filter((a) => a.balance > 0).reduce((a, x) => a + x.balance, 0),
    debts: -counted.filter((a) => a.balance < 0).reduce((a, x) => a + x.balance, 0),
  });
  res.json({ accounts, history: history.map((h) => ({ ...h, net: round(h.net), assets: round(h.assets), debts: round(h.debts) })) });
});

app.get('/api/reports', (req, res) => {
  // ?who= limits the figures to one adult's accounts, or the shared ones (server/owners.js).
  const own = ownerWhere(String(req.query.who || ''));
  const mine = own.sql ? ` AND ${own.sql}` : '';
  const rows = db.prepare(`
    SELECT substr(t.date,1,7) month, t.category_id, -SUM(t.amount) total
    FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE c.kind = 'expense'${mine} GROUP BY month, t.category_id ORDER BY month`).all(...own.args);
  const months = {};
  for (const r of rows) (months[r.month] ??= { month: r.month, total: 0, byCategory: {} }),
    (months[r.month].byCategory[r.category_id] = round(r.total)), (months[r.month].total = round(months[r.month].total + r.total));
  const since = iso(new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1));
  const merchants = db.prepare(`
    SELECT t.merchant, -SUM(t.amount) total, COUNT(*) count, c.icon
    FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE c.kind = 'expense' AND t.date >= ?${mine} GROUP BY t.merchant ORDER BY total DESC LIMIT 10`).all(since, ...own.args)
    .map((m) => ({ ...m, total: round(m.total) }));
  res.json({ months: Object.values(months), merchants });
});

// ---- Settings -------------------------------------------------------------

const SETTING_DEFAULTS = {
  // What amounts are written in (server/money.js). Display only: nothing is converted.
  currency: 'USD',
  currency_locale: '',
  // How the household files: joint (married filing jointly), single, or hoh (head of household).
  filing_status: 'joint',
  // The state the household pays income tax to (two letters). Empty until chosen: none is assumed.
  tax_state: '',
  your_salary: '0', spouse_salary: '0', pretax_you: '0', pretax_spouse: '0', kids: '0',
  educators: '0', vipkid_expenses: '0', vipkid_override: '', extra_payment: '', mins_in_budget: '0',
  // Tax taken out of paychecks for the whole year, and estimated payments already sent. Blank until known.
  withheld_fed: '', withheld_ar: '', paid_fed: '', paid_ar: '',
  // '1' when someone in the household is retired: the tax page then says what its estimate leaves out.
  retired: '0',
  // The savings account where money for the VIPKid tax bill is kept (an account id).
  tax_account: '',
  // '1' stops Ledger asking icon services for shops' logos (server/logos.js).
  logos_off: '0',
};
const settings = () => Object.fromEntries(Object.entries(SETTING_DEFAULTS).map(([k, d]) => [k, getSetting(k, d)]));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

app.get('/api/settings', (_req, res) => res.json(settings()));
app.put('/api/settings', (req, res) => {
  for (const [k, v] of Object.entries(req.body || {})) {
    if (!(k in SETTING_DEFAULTS)) continue;
    const s = String(v ?? '').trim();
    if (k === 'tax_state') { if (!stateChosen(s)) return res.status(400).json({ error: 'Choose a state.' }); setSetting(k, s.toUpperCase()); continue; }
    if (k === 'logos_off') { setSetting(k, s === '1' ? '1' : '0'); continue; }
    if (k === 'currency') { if (!validCurrency(s.toUpperCase())) return res.status(400).json({ error: 'Choose a currency from the list.' }); setSetting(k, s.toUpperCase()); continue; }
    if (k === 'currency_locale') { setSetting(k, validLocale(s) ? s : ''); continue; }
    if (k === 'filing_status') { if (!['joint', 'single', 'hoh', 'separate'].includes(s)) return res.status(400).json({ error: 'Choose how you file.' }); setSetting(k, s); continue; }
    const blankOk = ['vipkid_override', 'extra_payment', 'withheld_fed', 'withheld_ar', 'paid_fed', 'paid_ar', 'tax_account'].includes(k);
    if (s === '' && blankOk) { setSetting(k, ''); continue; }
    if (s === '' || !Number.isFinite(Number(s)) || Number(s) < 0) return res.status(400).json({ error: 'Enter a number of 0 or more.' });
    setSetting(k, s);
  }
  res.json(settings());
});

// ---- Taxes ----------------------------------------------------------------

// ---- More about the household, for the tax estimate (added 2026-11-18) ----
// Kept as one JSON setting, `tax_more`: birth years, dependents with their birth years, other jobs
// this year, retirement and other income, costs that lower tax, and marketplace insurance. All of
// it is optional; a household that fills none in gets the estimate it always had.
const MORE_SHAPE = {
  income: ['ss_you', 'ss_spouse', 'pension_you', 'pension_spouse', 'ira_you', 'ira_spouse', 'unemployment_you', 'unemployment_spouse', 'interest', 'dividends', 'gains', 'rental', 'other', 'support'],
  costs: ['student_loan', 'care', 'college_students', 'college', 'mortgage', 'property_tax', 'giving', 'medical'],
  market: ['benchmark_month', 'advance_month', 'months', 'people'],
};
const SIGNED = ['gains', 'rental'];
function cleanMore(b) {
  const year = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 1900 && n <= TAX_YEAR ? n : ''; };
  const amount = (v, signed) => { const n = Number(v); return Number.isFinite(n) && Math.abs(n) < 1e8 && (signed || n >= 0) ? Math.round(n * 100) / 100 : 0; };
  const out = { born_you: year(b?.born_you), born_spouse: year(b?.born_spouse), last_year_tax: b?.last_year_tax === '' || b?.last_year_tax == null ? '' : amount(b.last_year_tax) };
  out.dependents = (Array.isArray(b?.dependents) ? b.dependents : []).slice(0, 12).map((d) => ({ born: year(d?.born), kind: d?.kind === 'other' ? 'other' : 'child', student: !!d?.student })).filter((d) => d.born !== '');
  out.jobs = (Array.isArray(b?.jobs) ? b.jobs : []).slice(0, 8).map((j) => ({ who: j?.who === 'spouse' ? 'spouse' : 'you', name: String(j?.name || '').trim().slice(0, 40), wages: amount(j?.wages), pretax: amount(j?.pretax) })).filter((j) => j.wages > 0 || j.name);
  for (const [group, keys] of Object.entries(MORE_SHAPE)) out[group] = Object.fromEntries(keys.map((k) => [k, amount(b?.[group]?.[k], SIGNED.includes(k))]));
  out.market.months = Math.min(12, Math.round(out.market.months)); out.market.people = Math.min(15, Math.round(out.market.people));
  return out;
}
const taxMore = () => { try { return cleanMore(JSON.parse(getSetting('tax_more', '{}') || '{}')); } catch { return cleanMore({}); } };
app.get('/api/tax/more', (_req, res) => res.json(taxMore()));
app.put('/api/tax/more', (req, res) => { setSetting('tax_more', JSON.stringify(cleanMore({ ...taxMore(), ...(req.body || {}) }))); res.json(taxMore()); });

// Estimated tax is due in four parts for income nobody withholds from.
const QUARTERS = [[`${TAX_YEAR}-04-15`, 'April 15'], [`${TAX_YEAR}-06-15`, 'June 15'], [`${TAX_YEAR}-09-15`, 'September 15'], [`${TAX_YEAR + 1}-01-15`, 'January 15']];

function taxEstimate() {
  const s = settings();
  const m = taxMore();
  const g = gig();
  const now = new Date();
  const yearStart = `${TAX_YEAR}-01-01`, yearEnd = `${TAX_YEAR + 1}-01-01`;
  // Project the full year from the pace so far.
  const elapsed = now.getFullYear() > TAX_YEAR ? 1 : Math.max(1 / 365, (now - new Date(TAX_YEAR, 0, 1)) / (365 * 86400000));
  const received = (catId) => db.prepare('SELECT COALESCE(SUM(amount), 0) total, COUNT(*) n FROM transactions WHERE category_id = ? AND date >= ? AND date < ?').get(catId || -1, yearStart, yearEnd);
  // The first side gig's income category; -1 (no such category) when the household has no side gig.
  const catId = g.categoryId || -1;
  const ytd = received(catId);
  const byMonth = db.prepare('SELECT substr(date,1,7) month, SUM(amount) total FROM transactions WHERE category_id = ? AND date >= ? AND date < ? GROUP BY month ORDER BY month').all(catId, yearStart, yearEnd)
    .map((x) => ({ month: x.month, total: round(x.total) }));
  const projected = round(ytd.total / Math.min(1, elapsed));
  // The first gig: its deposits (or the figure typed over them), plus income that never reached the bank.
  const vipkidIncome = !g.on ? 0 : round((s.vipkid_override !== '' ? num(s.vipkid_override) : projected) + g.cash);
  const deductions = db.prepare('SELECT * FROM deductions ORDER BY id').all();
  const sum = (kind) => round(deductions.filter((d) => d.kind === kind).reduce((a, d) => a + d.amount, 0));
  // Purchases claimed in Transactions count toward business expenses too.
  const claimedFor = (kind) => {
    const r = db.prepare('SELECT COALESCE(SUM(-amount * deduct_pct / 100), 0) total, COUNT(*) n FROM transactions WHERE deduct_pct > 0 AND deduct_kind = ? AND amount < 0 AND date >= ? AND date < ?').get(kind, yearStart, yearEnd);
    return { total: round(r.total), count: r.n };
  };
  const claimedPurchases = { business: claimedFor('vipkid'), teaching: claimedFor('teaching') };
  const deductionTotals = {
    business: round(sum('business') + claimedPurchases.business.total), teaching: round(sum('teaching') + claimedPurchases.teaching.total),
    adjustment: sum('adjustment'), itemized: sum('itemized'),
  };
  // Every gig, with whose it is. Business expenses claimed on purchases come off the first one.
  const first = Math.max(0, vipkidIncome - deductionTotals.business);
  const gigs = !g.on ? [] : [
    { name: g.name, who: g.who, income: vipkidIncome, costs: deductionTotals.business, profit: round(first), received: round(ytd.total) },
    ...extraGigs().map((x) => { const r = received(x.categoryId); const income = round(r.total / Math.min(1, elapsed) + x.cash); return { id: x.id, name: x.name, who: x.who, income, costs: x.costs, profit: round(Math.max(0, income - x.costs)), received: round(r.total) }; }),
  ];
  const two = s.filing_status === 'joint' || s.filing_status === 'separate';
  const profitOf = (who) => gigs.filter((x, i) => (two ? x.who : 'you') === who).reduce((a, x) => a + x.profit, 0);
  // seYou is on top of the first gig's own figures, which estimateTax takes as yours.
  const firstMine = !g.on || !two || g.who === 'you';
  const seYou = profitOf('you') - (firstMine ? first : 0), seSpouse = two ? profitOf('spouse') : 0;
  const seGross = gigs.slice(1).reduce((a, x) => a + x.income, 0);

  const educators = Math.min(2, Math.max(0, Math.round(num(s.educators))));
  const age = (born) => (born === '' ? null : TAX_YEAR - born);
  // Dependents by age at the end of the year. With none listed, "Children under 17" stands.
  const deps = m.dependents.length ? {
    under17: m.dependents.filter((d) => d.kind === 'child' && age(d.born) < 17).length,
    other: m.dependents.filter((d) => !(d.kind === 'child' && age(d.born) < 17)).length,
    eitc: m.dependents.filter((d) => d.kind === 'child' && (age(d.born) < 19 || (d.student && age(d.born) < 24))).length,
    under13: m.dependents.filter((d) => d.kind === 'child' && age(d.born) < 13).length,
  } : null;
  const jobs = (who, key) => m.jobs.filter((j) => j.who === who).reduce((a, j) => a + j[key], 0);
  const I = m.income, C = m.costs, months = m.market.months || 12;
  const input = (stateTax) => ({
    status: s.filing_status, state: stateOf(s.tax_state),
    yourWages: num(s.your_salary) + jobs('you', 'wages'), spouseWages: num(s.spouse_salary) + jobs('spouse', 'wages'),
    pretaxYou: num(s.pretax_you) + jobs('you', 'pretax'), pretaxSpouse: num(s.pretax_spouse) + jobs('spouse', 'pretax'),
    kids: Math.round(num(s.kids)), vipkidIncome: firstMine ? vipkidIncome : 0, vipkidExpenses: firstMine ? deductionTotals.business : 0,
    adjustments: deductionTotals.adjustment, itemized: deductionTotals.itemized, teaching: deductionTotals.teaching, educators,
    more: {
      seYou, seSpouse, seGross: seGross + (firstMine ? 0 : vipkidIncome), ages: { you: age(m.born_you), spouse: age(m.born_spouse) }, dependents: deps,
      income: { ssYou: I.ss_you, ssSpouse: I.ss_spouse, pensionYou: I.pension_you, pensionSpouse: I.pension_spouse, iraYou: I.ira_you, iraSpouse: I.ira_spouse, unemploymentYou: I.unemployment_you, unemploymentSpouse: I.unemployment_spouse, interest: I.interest, dividends: I.dividends, gains: I.gains, rental: I.rental, other: I.other },
      costs: { studentLoan: C.student_loan, care: C.care, collegeStudents: C.college_students, college: C.college, mortgage: C.mortgage, propertyTax: C.property_tax, stateTax, giving: C.giving, medical: C.medical },
      market: { benchmark: m.market.benchmark_month * months, advance: m.market.advance_month * months, people: m.market.people },
    },
  });
  // State income tax is itself an itemized deduction, so the estimate is run once to find it.
  let estimate = estimateTax(input(0));
  if (C.mortgage + C.property_tax + C.giving + C.medical + deductionTotals.itemized > 0) estimate = estimateTax(input(estimate.with.arTax));
  // Owe or refund at filing, once the year's withholding has been entered.
  const w = estimate.with;
  const filing = {
    // A state with no income tax has no withholding to wait for.
    known: s.withheld_fed !== '' && (s.withheld_ar !== '' || !!STATES[stateOf(s.tax_state)].none),
    federal: round(w.fedIncomeTax + w.seTax - num(s.withheld_fed) - num(s.paid_fed)),
    arkansas: round(w.arTax - num(s.withheld_ar) - num(s.paid_ar)),
  };
  // Quarterly payments: what is left to pay after withholding, spread over the dates still to come.
  // The IRS asks for them when $1,000 or more would be owed at filing; paying 90% of this year's tax
  // (or all of last year's) in time avoids its penalty.
  const today = iso(now);
  const upcoming = QUARTERS.filter(([date]) => date >= today);
  const fedTotal = Math.max(0, w.fedIncomeTax + w.seTax), fedLeft = fedTotal - num(s.withheld_fed) - num(s.paid_fed);
  const arLeft = w.arTax - num(s.withheld_ar) - num(s.paid_ar);
  const lastYear = m.last_year_tax === '' ? null : m.last_year_tax;
  const safe = Math.max(0, Math.min(0.9 * fedTotal, lastYear ?? Infinity) - num(s.withheld_fed) - num(s.paid_fed));
  const quarterly = {
    needed: fedLeft >= 1000, federalLeft: round(Math.max(0, fedLeft)), arkansasLeft: round(Math.max(0, arLeft)), arkansasNeeded: arLeft > 1000,
    toAvoidPenalty: round(safe), basis: lastYear != null && lastYear < 0.9 * fedTotal ? 'last year' : 'this year',
    dates: upcoming.map(([date, label]) => ({ date, label, federal: round(Math.max(0, fedLeft) / upcoming.length), arkansas: round(Math.max(0, arLeft) / upcoming.length) })),
    next: upcoming[0] ? { date: upcoming[0][0], label: upcoming[0][1] } : null,
  };
  // Money put away for the tax bill, against what this year's side income has built up so far.
  const cashAccounts = db.prepare("SELECT id, name, balance, available FROM accounts WHERE type IN ('checking', 'savings') ORDER BY name").all();
  const taxAccount = cashAccounts.find((a) => String(a.id) === s.tax_account);
  const lastDeposit = db.prepare('SELECT date, amount FROM transactions WHERE category_id = ? AND amount > 0 ORDER BY date DESC LIMIT 1').get(catId);
  const receivedAll = gigs.reduce((a, x) => a + x.received, 0);
  const taxSavings = {
    accounts: cashAccounts.map((a) => ({ id: a.id, name: a.name })),
    account: taxAccount ? { id: taxAccount.id, name: taxAccount.name, balance: round(taxAccount.available ?? taxAccount.balance) } : null,
    owedSoFar: round(receivedAll * estimate.setAsideRate),
    lastDeposit: lastDeposit ? { ...lastDeposit, setAside: round(lastDeposit.amount * estimate.setAsideRate) } : null,
  };
  return { gig: { on: g.on, name: g.name }, gigs, more: m, dependents: deps, quarterly, filing, taxSavings, deductions, deductionTotals, claimedPurchases, settings: s, ytd: round(ytd.total), deposits: ytd.n, projected, vipkidIncome, usingOverride: s.vipkid_override !== '', byMonth, ...estimate };
}
app.get('/api/tax', (_req, res) => res.json(taxEstimate()));
app.get('/api/tax/states', (_req, res) => res.json(stateList()));
installTaxPack(app, { taxEstimate });
// Whether VIPKid pay is still being kept for taxes. The target is what's owed at
// filing once the year's withholding has been entered; until then, the tax built
// up on VIPKid income so far.
// The whole tax section can be switched off (2026-11-24, the owner: for people outside the United States,
// whose taxes Ledger knows nothing about). Setting `taxes_off` '1': the Taxes page leaves the menus, and
// nothing else in the app leans on the estimate: no pay held back in the forecast, no tax goal figure, no
// tax set aside in the debt plan, no pay stub reminder, no January tax pack.
const taxesOff = () => getSetting('taxes_off') === '1';
app.get('/api/tax/on', (_req, res) => res.json({ on: !taxesOff() }));
app.put('/api/tax/on', (req, res) => { setSetting('taxes_off', req.body?.on ? '0' : '1'); res.json({ on: !taxesOff() }); });

setTaxHoldSource(() => {
  if (taxesOff()) return null;
  const t = taxEstimate();
  const account = t.taxSavings.account;
  if (!account || !gig().on) return null;
  const target = round(Math.max(0, t.filing.known ? t.filing.federal + t.filing.arkansas : t.taxSavings.owedSoFar));
  return { active: account.balance < target, account: account.name, saved: account.balance, target, basis: t.filing.known ? 'filing' : 'vipkid' };
});

// The tax bill a savings goal can follow: what's owed at filing once the year's withholding is known;
// until then, the tax built up so far on side-gig income (which has none taken out). The same figure
// the forecast holds side-gig pay back for.
setTaxTarget(() => {
  if (taxesOff()) return { target: 0, basis: 'none' };
  const t = taxEstimate();
  if (t.filing.known) return { target: round(Math.max(0, t.filing.federal + t.filing.arkansas)), basis: 'filing' };
  if (gig().on) return { target: round(Math.max(0, t.taxSavings.owedSoFar)), basis: 'gig' };
  return { target: 0, basis: 'none' };
});

app.post('/api/deductions', (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 80);
  const amount = Number(req.body?.amount);
  const kind = req.body?.kind;
  if (!name) return res.status(400).json({ error: 'Enter what the deduction is for.' });
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Enter an amount above 0.' });
  if (!['business', 'teaching', 'adjustment', 'itemized'].includes(kind)) return res.status(400).json({ error: 'Choose a type.' });
  res.json({ id: Number(db.prepare('INSERT INTO deductions (name, amount, kind) VALUES (?,?,?)').run(name, amount, kind).lastInsertRowid) });
});
app.delete('/api/deductions/:id', (req, res) => {
  db.prepare('DELETE FROM deductions WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---- Debt -----------------------------------------------------------------

const DEBT_TYPES = ['credit', 'auto', 'mortgage', 'loan'];
// An amount paid on top of a debt's regular payment every month, come what may (The owner pays $75 extra principal
// on the mortgage automatically; 2026-11-23). It is part of that debt's payment in the plan, and the page says
// what it saves against the regular payment alone.
if (!db.prepare('PRAGMA table_info(accounts)').all().some((c) => c.name === 'extra_monthly')) db.exec('ALTER TABLE accounts ADD COLUMN extra_monthly REAL NOT NULL DEFAULT 0');
// Federal student loans and loan forgiveness (The owner, 2026-11-23, after finding his own plan may not count):
// `min_only` keeps a loan out of the snowball, so the plan pays only its regular payment and never sends
// spare money to it (paying down a balance that will be forgiven is money wasted); `forgive_count` is the
// number of qualifying payments the household read off studentaid.gov, with `forgive_at` the day they typed
// it, so the page can say how far along they are. Ledger never works the count out or says who qualifies.
if (!db.prepare('PRAGMA table_info(accounts)').all().some((c) => c.name === 'min_only')) db.exec('ALTER TABLE accounts ADD COLUMN min_only INTEGER NOT NULL DEFAULT 0; ALTER TABLE accounts ADD COLUMN forgive_count INTEGER; ALTER TABLE accounts ADD COLUMN forgive_at TEXT;');
// A loan that looks like a federal student loan, by its servicer or its name.
const studentLoan = (a) => a.type === 'loan' && /aidvantage|nelnet|mohela|edfinancial|great ?lakes|navient|fedloan|ecsi|dept\.? of ed|department of ed|student/i.test(`${a.institution} ${a.name}`);

/** Pays debts in the given order: minimums on all, everything spare on the first unpaid. */
function snowball(debts, extra, lump = 0) {
  const bal = debts.map((d) => d.balance);
  const paid = debts.map(() => null);
  let interest = 0;
  for (let m = 1; m <= 720 && paid.some((p) => p == null); m++) {
    let pool = extra + (m === 1 ? lump : 0);   // a one-time amount goes in with the first month's payments
    debts.forEach((d, i) => {
      if (bal[i] <= 0) return void (pool += d.min_payment);
      const int = (bal[i] * d.apr) / 1200;
      interest += int;
      bal[i] += int;
      bal[i] -= Math.min(bal[i], d.min_payment);
    });
    for (let i = 0; i < debts.length && pool > 0.005; i++) {
      if (bal[i] <= 0) continue;
      const pay = Math.min(bal[i], pool);
      bal[i] -= pay;
      pool -= pay;
    }
    debts.forEach((_d, i) => { if (paid[i] == null && bal[i] <= 0.005) { paid[i] = m; bal[i] = 0; } });
  }
  return { paid, interest: round(interest) };
}

/** One debt on its own, with extra money arriving from a given month onward. */
function payoffAlone(d, extra = 0, extraFromMonth = 1) {
  let bal = d.balance, interest = 0;
  for (let m = 1; m <= 720; m++) {
    const int = (bal * d.apr) / 1200;
    interest += int;
    bal += int - Math.min(bal + int, d.min_payment + (m >= extraFromMonth ? extra : 0));
    if (bal <= 0.005) return { months: m, interest: round(interest) };
  }
  return { months: null, interest: round(interest) };
}

// What has gone toward a debt so far this month, in however many payments (2026-11-23: the owner pays cards in
// parts as side-gig money arrives). A card: money in on the card that is filed as a transfer. A loan: money in
// on the loan's own account, or else payments out of checking or savings under the loan's name. A mortgage is
// left out, because its payment from checking includes escrow and would look like an overpayment.
function paidThisMonth(d) {
  if (d.type === 'mortgage') return null;
  const start = `${iso(new Date()).slice(0, 7)}-01`;
  let rows;
  if (d.type === 'credit') {
    rows = db.prepare(`SELECT t.amount, t.date FROM transactions t JOIN categories c ON c.id = t.category_id
      WHERE t.account_id = ? AND t.amount > 0 AND c.kind = 'transfer' AND COALESCE(c.key, c.name) != 'Deposit' AND t.date >= ?`).all(d.id, start);
  } else {
    rows = db.prepare('SELECT amount, date FROM transactions WHERE account_id = ? AND amount > 0 AND date >= ?').all(d.id, start);
    if (!rows.length) rows = db.prepare(`SELECT -t.amount amount, t.date FROM transactions t JOIN accounts a ON a.id = t.account_id
      WHERE a.type IN ('checking', 'savings', 'cash') AND t.amount < 0 AND t.date >= ? AND lower(t.merchant) IN (?, ?)`).all(start, d.name.toLowerCase(), `${d.name.toLowerCase()} payment`);
  }
  if (!rows.length) return { total: 0, count: 0 };
  const total = round(rows.reduce((a, r) => a + r.amount, 0));
  const planned = round((d.min_payment || 0) + (d.extra_monthly || 0));
  return { total, count: rows.length, last: rows.map((r) => r.date).sort().at(-1), planned, over: planned > 0 ? round(Math.max(0, total - planned)) : 0, short: planned > 0 ? round(Math.max(0, planned - total)) : 0 };
}

// A card paid in full every month (2026-11-24, the owner's go-ahead: his store card is on autopay for the
// whole statement, yet the plan put it first). `paid_full` takes a card out of the payoff order, the
// minimums and the interest sums: its balance is this month's shopping, not a debt being paid down.
if (!db.prepare('PRAGMA table_info(accounts)').all().some((c) => c.name === 'paid_full')) db.exec('ALTER TABLE accounts ADD COLUMN paid_full INTEGER NOT NULL DEFAULT 0');

function debtPlan(tryOut = null) {
  const s = settings();
  const all = db.prepare(`SELECT * FROM accounts WHERE type IN (${DEBT_TYPES.map(() => '?').join(',')}) ORDER BY id`).all(...DEBT_TYPES)
    .map((a) => ({ ...a, balance: round(Math.max(0, -a.balance)) }));
  const full = (d) => d.type === 'credit' && !!d.paid_full;
  const ready = (d) => d.balance > 0 && d.apr != null && d.min_payment > 0 && !full(d);

  // Excess money: typical income, less the budget, taxes to set aside, and debt minimums.
  const since = iso(new Date(new Date().getFullYear(), new Date().getMonth() - 3, 1));
  const until = iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const income = round(db.prepare(`SELECT COALESCE(SUM(t.amount), 0) s FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE c.kind = 'income' AND t.date >= ? AND t.date < ?`).get(since, until).s / 3);
  const budget = round(db.prepare("SELECT COALESCE(SUM(budget), 0) s FROM categories WHERE kind = 'expense'").get().s);
  const taxSetAside = getSetting('taxes_off') === '1' ? 0 : round(taxEstimate().extra / 12);
  const minimums = round(all.filter(ready).reduce((a, d) => a + d.min_payment, 0));
  // Mortgage and loan payments show up as spending in budget categories (Housing,
  // Loan payments). Card payments are transfers, so their minimums are extra.
  const cardMinimums = round(all.filter((d) => ready(d) && d.type === 'credit').reduce((a, d) => a + d.min_payment, 0));
  const minsInBudget = s.mins_in_budget === '1';
  const excessAmount = round(income - budget - taxSetAside - (minsInBudget ? 0 : cardMinimums));
  const usual = s.extra_payment !== '' ? num(s.extra_payment) : Math.max(0, excessAmount);
  // `tryOut` is a what-if (the Debt page's "Try a different plan"): another extra amount, or a one-time sum.
  const extra = tryOut && tryOut.extra != null ? tryOut.extra : usual;
  const lump = tryOut?.lump || 0;

  // Dave Ramsey's debt snowball: smallest balance first, whatever the interest
  // rate. The mortgage waits until everything else is gone.
  // Each debt as it is really paid: its regular payment plus any standing extra.
  const paidAs = (d) => ({ ...d, min_payment: d.min_payment + (d.extra_monthly || 0) });
  const order = all.filter((d) => ready(d) && d.type !== 'mortgage' && !d.min_only).sort((a, b) => a.balance - b.balance).map(paidAs);
  const plan = snowball(order, extra, lump);
  const noExtra = snowball(order, 0);
  // The same debts and the same money, paid highest rate first (the "avalanche"), to set beside the plan.
  // Shown as two sets of figures and nothing more: which order to follow is the household's choice.
  const byRate = [...order].sort((a, b) => b.apr - a.apr || a.balance - b.balance);
  const rate = snowball(byRate, extra, lump);
  const sumUp = (list, r) => ({ months: r.paid.every((p) => p != null) ? Math.max(0, ...r.paid) : null, interest: r.interest, first: list[0]?.name || '', order: list.map((d) => d.name) });
  const compare = { count: order.length, extra, lump, usual, same: order.every((d, i) => d.id === byRate[i].id), smallest: sumUp(order, plan), rate: sumUp(byRate, rate) };
  const done = plan.paid.every((p) => p != null) ? Math.max(0, ...plan.paid) : null;
  const freed = extra + order.reduce((a, d) => a + d.min_payment, 0);

  let neverEnds = false, interestMin = 0, interestPlan = plan.interest;
  const debts = all.map((d) => {
    const base = { id: d.id, name: d.name, institution: d.institution, type: d.type, balance: d.balance, apr: d.apr, min_payment: d.min_payment, manual: d.manual, extra_monthly: d.extra_monthly || 0,
      student: studentLoan(d), paid_full: full(d), min_only: !!d.min_only, forgive_count: d.forgive_count, forgive_at: d.forgive_at, paid: paidThisMonth(d) };
    if (d.balance <= 0) return { ...base, status: 'paid' };
    if (full(d)) return { ...base, status: 'full' };
    if (!ready(d)) return { ...base, status: 'missing' };
    const alone = payoffAlone(d);
    // What the standing extra does by itself: against the regular payment alone, nothing else changing.
    const withExtra = d.extra_monthly > 0 ? payoffAlone(paidAs(d)) : null;
    if (withExtra) base.standing = { extra: d.extra_monthly, months: withExtra.months, sooner: alone.months != null && withExtra.months != null ? alone.months - withExtra.months : null, interestSaved: withExtra.months != null && alone.months != null ? Math.max(0, round(alone.interest - withExtra.interest)) : null };
    // Kept at its regular payment on purpose: no place in the payoff order, and nothing rolled into it.
    if (d.min_only) {
      const mine = withExtra || alone;
      interestMin += alone.interest; interestPlan += mine.interest;
      return { ...base, status: 'ok', minMonths: alone.months, planMonths: mine.months };
    }
    if (d.type === 'mortgage') {
      const mine = withExtra || alone;
      const after = done == null ? mine : payoffAlone(paidAs(d), freed, done + 1);
      interestMin += alone.interest;
      interestPlan += after.interest;
      return { ...base, status: 'ok', minMonths: alone.months, planMonths: after.months, rollover: done == null ? 0 : round(freed) };
    }
    // A payment that doesn't cover the interest never ends, so its interest has no total. Count only what the
    // balance as it stands today would cost until the plan's debt-free month, and say the saving is "at least".
    if (alone.months == null) { neverEnds = true; interestMin += round((d.balance * d.apr) / 1200 * (done || 0)); }
    else interestMin += alone.interest;
    const i = order.findIndex((o) => o.id === d.id);
    return { ...base, status: 'ok', order: i + 1, minMonths: alone.months, planMonths: plan.paid[i], noExtraMonths: noExtra.paid[i] };
  });

  return {
    debts, extra, compare, usingExcess: s.extra_payment === '',
    excess: { income, budget, taxSetAside, minimums: cardMinimums, minsInBudget, amount: excessAmount },
    totals: {
      balance: round(all.reduce((a, d) => a + d.balance, 0)), minimums,
      paidFull: round(all.filter(full).reduce((a, d) => a + d.balance, 0)),
      debtFreeMonths: done, debtFreeNoExtraMonths: noExtra.paid.every((p) => p != null) ? Math.max(0, ...noExtra.paid) : null,
      interestSaved: Math.max(0, round(interestMin - interestPlan)),
      interestSavedAtLeast: neverEnds,
    },
  };
}
// Registered before the plain route so '/api/debts/graph' is not taken for a debt's id.
installDebtGraph(app, { debtPlan });
// "Try a different plan": the payoff figures with another extra amount or a one-time sum. Reads only.
app.get('/api/debts/try', (req, res) => {
  const amount = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 10_000_000 ? Math.round(n * 100) / 100 : null; };
  const extra = req.query.extra === undefined || req.query.extra === '' ? null : amount(req.query.extra);
  const lump = req.query.lump === undefined || req.query.lump === '' ? 0 : amount(req.query.lump);
  if ((req.query.extra !== undefined && req.query.extra !== '' && extra == null) || lump == null) return res.status(400).json({ error: 'Enter amounts of 0 or more.' });
  res.json({ now: debtPlan().compare, tried: debtPlan({ extra, lump }).compare });
});
app.get('/api/debts', (_req, res) => res.json(debtPlan()));

// Add a debt by hand (a mortgage, or a lender the bank feed doesn't cover).
app.post('/api/accounts', (req, res) => {
  const { name, institution, type, balance, apr, min_payment } = req.body || {};
  const n = String(name || '').trim().slice(0, 80);
  if (!n) return res.status(400).json({ error: 'Enter a name for the debt.' });
  if (!DEBT_TYPES.includes(type)) return res.status(400).json({ error: 'Choose a type.' });
  if (!(Number(balance) > 0)) return res.status(400).json({ error: 'Enter the balance you owe.' });
  if (!(Number(apr) >= 0) || apr === '' || apr == null) return res.status(400).json({ error: 'Enter the interest rate.' });
  if (!(Number(min_payment) > 0)) return res.status(400).json({ error: 'Enter the monthly payment.' });
  const id = Number(db.prepare('INSERT INTO accounts (name, institution, type, balance, apr, min_payment, manual) VALUES (?,?,?,?,?,?,1)')
    .run(n, String(institution || '').trim().slice(0, 80) || 'Added by you', type, -Number(balance), Number(apr), Number(min_payment)).lastInsertRowid);
  // Carry the balance back through the net worth history, so the chart
  // doesn't show the debt appearing overnight.
  const ins = db.prepare('INSERT OR IGNORE INTO balance_history (account_id, date, balance) VALUES (?,?,?)');
  for (const { date } of db.prepare('SELECT DISTINCT date FROM balance_history').all()) ins.run(id, date, -Number(balance));
  res.json({ id });
});

app.patch('/api/accounts/:id', (req, res) => {
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(req.params.id));
  if (!acc || !DEBT_TYPES.includes(acc.type)) return res.status(400).json({ error: "That account isn't a debt." });
  const { apr, min_payment, balance, extra_monthly } = req.body || {};
  const bad = (v) => v !== undefined && (v === '' || !Number.isFinite(Number(v)) || Number(v) < 0);
  if (bad(apr) || bad(min_payment) || bad(balance) || (extra_monthly !== undefined && extra_monthly !== '' && bad(extra_monthly))) return res.status(400).json({ error: 'Enter a number of 0 or more.' });
  if (extra_monthly !== undefined) db.prepare('UPDATE accounts SET extra_monthly = ? WHERE id = ?').run(Number(extra_monthly) || 0, acc.id);
  if (req.body?.paid_full !== undefined) {
    if (acc.type !== 'credit') return res.status(400).json({ error: 'Only a credit card can be marked as paid in full each month.' });
    db.prepare('UPDATE accounts SET paid_full = ? WHERE id = ?').run(req.body.paid_full ? 1 : 0, acc.id);
  }
  if (req.body?.min_only !== undefined) db.prepare('UPDATE accounts SET min_only = ? WHERE id = ?').run(req.body.min_only ? 1 : 0, acc.id);
  if (req.body?.forgive_count !== undefined) {
    const n = req.body.forgive_count === '' || req.body.forgive_count == null ? null : Math.round(Number(req.body.forgive_count));
    if (n != null && !(n >= 0 && n <= 600)) return res.status(400).json({ error: 'Enter the number of qualifying payments, 0 or more.' });
    db.prepare('UPDATE accounts SET forgive_count = ?, forgive_at = ? WHERE id = ?').run(n, n == null ? null : iso(new Date()), acc.id);
  }
  if (apr !== undefined) db.prepare('UPDATE accounts SET apr = ? WHERE id = ?').run(Number(apr), acc.id);
  if (min_payment !== undefined) db.prepare('UPDATE accounts SET min_payment = ? WHERE id = ?').run(Number(min_payment), acc.id);
  if (balance !== undefined && acc.manual) {
    // If Ledger keeps this balance itself, the figure you typed becomes the new starting point.
    if (acc.base_id != null) setStart(acc.id, -round(Number(balance)));   // a card made by hand: only what's entered from now on counts
    else {
      db.prepare('UPDATE accounts SET balance = ? WHERE id = ?').run(-Number(balance), acc.id);
      db.prepare('UPDATE accounts SET base_balance = ?, base_date = ? WHERE id = ? AND base_date IS NOT NULL').run(-Number(balance), iso(new Date()), acc.id);
    }
  }
  res.json({ ok: true });
});

// The balance of an account kept by hand, typed in to correct it (Accounts page). What you type becomes
// its new starting point; entries made after that move it.
app.put('/api/accounts/:id/balance', (req, res) => {
  const acc = db.prepare("SELECT * FROM accounts WHERE id = ? AND manual = 1 AND type NOT IN ('cash', 'insurance')").get(Number(req.params.id));
  if (!acc) return res.status(400).json({ error: "Only an account you keep by hand can have its balance typed in. A connected account's balance comes from the bank." });
  const b = Number(req.body?.balance);
  if (req.body?.balance === '' || req.body?.balance == null || !Number.isFinite(b) || b < 0) return res.status(400).json({ error: 'Enter an amount of 0 or more.' });
  setStart(acc.id, [...DEBT_TYPES, 'credit'].includes(acc.type) ? -round(b) : round(b));
  res.json({ ok: true });
});

app.delete('/api/accounts/:id', (req, res) => {
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ? AND manual = 1').get(Number(req.params.id));
  if (!acc || acc.type === 'cash') return res.status(400).json({ error: 'Only accounts you added by hand can be removed.' });
  if (db.prepare('SELECT 1 FROM transactions WHERE account_id = ? LIMIT 1').get(acc.id)) return res.status(400).json({ error: "This account has transactions, so it can't be removed." });
  db.prepare('DELETE FROM balance_history WHERE account_id = ?').run(acc.id);
  db.prepare('DELETE FROM holdings WHERE account_id = ?').run(acc.id);
  db.prepare('DELETE FROM statement_checks WHERE account_id = ?').run(acc.id);
  db.prepare('DELETE FROM accounts WHERE id = ?').run(acc.id);
  res.json({ ok: true });
});

installRecap(app, { summaryFor, debtPlan, taxEstimate });
installAi(app);
installHideNames(app);
installCushion(app);
installHaAi(app);
installHoldings(app);
installReconcile(app);
installDemoCfo(app, { summaryFor, debtPlan });   // a public demo's example answers; nothing on any other copy
installCfo(app, { summaryFor, debtPlan, taxEstimate, goals, investments });
// Loan payments already saved take their loan's name (does nothing once they have it).
nameLoanPayments();
applyNames();
installNames(app, { getRecurrings });
installMail(app, { summaryFor });
installScan(app);
installPasskeys(app);
installCashflow(app);
installVipkid(app);
installGig(app);
installGigPay(app);
installRules(app);
installDeposits(app);
installReceipts(app);
installAlerts(app);
installHaSensors(app, { summaryFor });
installPaydays(app);
installPaystub(app);
installStatements(app);
installStatementRemind(app);
installCatSuggest(app);
installOwners(app);
installOffBudget(app);
installOrganize(app);
installBudgetPlan(app);
app.get('/api/currencies', (_req, res) => res.json({ currency: currency(), list: CURRENCIES.map(([code, name]) => ({ code, name })) }));
installUpdateCheck(app);
installPrices(app);
installZero(app);
installAllowance(app);
installTaxHints(app, {
  kids: () => Math.max(Number(getSetting('kids', '0')) || 0, taxMore().dependents.filter((d) => d.kind === 'child').length),
  costs: () => taxMore().costs,
  // Who a question to the tax preparer is signed by: the adults' first names, where they were given.
  names: () => [getSetting('mail_your_name'), getSetting('spouse_name')].filter(Boolean).join(' and '),
  setCost: (kind, amount) => { const m = taxMore(); m.costs[kind] = amount; setSetting('tax_more', JSON.stringify(cleanMore(m))); },
});
installSetup(app);
installGoals(app);
installSplits(app);
installFamily(app);
// The publisher's own look at the project on GitHub (server/repostats.js) is not part of the public copy.
// Where the file is absent the page is told there is nothing to offer, and Settings shows no such section.
try { (await import('./repostats.js')).installRepoStats(app); }
catch (e) { if (e?.code !== 'ERR_MODULE_NOT_FOUND') throw e; app.get('/api/repo', (_req, res) => res.json({ offered: false })); }
// The same for his look at the public demo's traffic and likely cost (server/flystats.js).
try { (await import('./flystats.js')).installFlyStats(app); }
catch (e) { if (e?.code !== 'ERR_MODULE_NOT_FOUND') throw e; app.get('/api/fly', (_req, res) => res.json({ offered: false })); }
installFeedback(app);
installLogos(app);
installLogoFinder(app);

// ---- Bank connection (SimpleFIN) --------------------------------------------

const ACCOUNT_TYPES = ['checking', 'savings', 'credit', 'investment', 'hsa', 'auto', 'mortgage', 'loan', 'insurance'];
// The clock Ledger is working by. "Today", paydays and the email's hour all follow the server's time zone
// (the TZ setting of its container), so this is the way to see which one it really has.
// `needs`: nobody gave this copy a time zone and it has not taken one from a browser yet (server/db.js).
const clock = () => { const now = new Date(); return { zone: Intl.DateTimeFormat().resolvedOptions().timeZone, tz: process.env.TZ || null, today: iso(now), now: now.toString(), given: tzGiven, needs: !tzGiven && !getSetting('time_zone') }; };
app.get('/api/clock', (_req, res) => res.json(clock()));
// The page offers its own zone when `needs` is true. A zone given at start-up always stands; one already
// taken from a browser is only replaced when asked for outright (`change`), so a visitor in another zone
// doesn't move the household's clock.
app.put('/api/clock', (req, res) => {
  const zone = req.body?.zone;
  if (tzGiven) return res.status(409).json({ error: 'This copy was started with a time zone, which is set where Ledger is run.' });
  if (!validZone(zone)) return res.status(400).json({ error: 'That is not a time zone Ledger knows.' });
  if (getSetting('time_zone') && !req.body?.change) return res.json({ ...clock(), changed: false });
  setSetting('time_zone', zone);
  process.env.TZ = zone;
  res.json({ ...clock(), changed: true });
});

// Whether anyone on the network could open this copy with no password. As a Home Assistant add-on nobody
// can: Home Assistant signs people in, and any other address is refused until a Ledger password is set
// (server/auth.js). So no password is asked for there before the bank connection and the rest of Settings.
const openToNetwork = () => HOST !== '127.0.0.1' && process.env.LEDGER_INGRESS !== '1' && !demoMode();   // a demo has no password by design
// `locked`: something already stands between the network and this copy, a Ledger password or, on a family
// copy, the web address's own sign-in (Cloudflare) with no Ledger password. Until 2026-11-24 only a password
// counted, so a household signed in the second way was told to "set a password first" and could not reach
// the token box or most of Settings (found when the owner's mom could not connect her bank).
app.get('/api/simplefin', (_req, res) => res.json({ ...simplefin.status(), passwordSet: passwordSet(), locked: claimed(), networkOpen: openToNetwork(), demo: demoMode() || undefined }));

app.post('/api/simplefin/connect', async (req, res) => {
  // Real bank data shouldn't sit on an app anyone on the Wi-Fi can open.
  if (!claimed() && openToNetwork()) return res.status(400).json({ error: 'Set a password first, since other devices on your network can open this app.' });
  try {
    await simplefin.connect(req.body?.token);
    res.json({ ok: true, result: await simplefin.sync() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post('/api/simplefin/sync', async (_req, res) => {
  try {
    const result = await simplefin.sync();
    setSetting('simplefin_last_error', '');
    res.json({ ok: true, result });
  } catch (e) {
    setSetting('simplefin_last_error', e.message);
    res.status(400).json({ error: e.message });
  }
});
app.post('/api/simplefin/disconnect', (_req, res) => {
  simplefin.disconnect();
  res.json({ ok: true });
});
// ---- File import ------------------------------------------------------------

app.get('/api/import/accounts', (_req, res) => {
  res.json(db.prepare("SELECT id, name, institution, type, balance FROM accounts WHERE type NOT IN ('cash', 'insurance') ORDER BY name").all());
});
app.post('/api/import/preview', (req, res) => {
  try { res.json(importer.preview(req.body?.csv, req.body?.flip)); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/import', (req, res) => {
  try {
    let accountId = req.body?.account_id;
    const fresh = req.body?.new_account;
    if (fresh) {
      const name = String(fresh.name || '').trim().slice(0, 80);
      if (!name) return res.status(400).json({ error: 'Enter a name for the new account.' });
      if (!ACCOUNT_TYPES.includes(fresh.type)) return res.status(400).json({ error: 'Choose an account type.' });
      importer.readFile(req.body?.csv, req.body?.flip); // fail before creating the account if the file is unreadable
      accountId = Number(db.prepare('INSERT INTO accounts (name, institution, type, balance, manual) VALUES (?,?,?,0,1)').run(name, 'Imported from a file', fresh.type).lastInsertRowid);
    }
    res.json(importer.importFile(req.body?.csv, req.body?.flip, accountId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Rename an account. A blank name puts the bank's own name back.
app.patch('/api/accounts/:id/name', (req, res) => {
  const acc = db.prepare('SELECT id, name, bank_name FROM accounts WHERE id = ?').get(Number(req.params.id));
  if (!acc) return res.status(404).json({ error: 'No such account.' });
  const name = String(req.body?.name ?? '').trim().slice(0, 80);
  const original = acc.bank_name ?? acc.name;
  if (!name || name === original) db.prepare('UPDATE accounts SET name = ?, bank_name = NULL WHERE id = ?').run(original, acc.id);
  else db.prepare('UPDATE accounts SET name = ?, bank_name = ? WHERE id = ?').run(name, original, acc.id);
  res.json({ ok: true });
});

app.patch('/api/accounts/:id/type', (req, res) => {
  if (!ACCOUNT_TYPES.includes(req.body?.type)) return res.status(400).json({ error: 'Choose an account type.' });
  db.prepare('UPDATE accounts SET type = ? WHERE id = ?').run(req.body.type, Number(req.params.id));
  res.json({ ok: true });
});

if (process.env.NODE_ENV === 'production') {
  // Which build this is: a fingerprint of the built page, which changes with every deploy. An open
  // copy of the app asks for it now and then and reloads itself when it has changed (src/main.tsx).
  // It says nothing about the household, so it needs no sign-in.
  const page = path.join(root, 'dist', 'index.html');
  const build = crypto.createHash('sha1').update(fs.readFileSync(page)).digest('hex').slice(0, 12);
  app.get('/version.json', (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ build }); });
  // The page itself is always checked with the server, so a reload really gets the new one;
  // its scripts and styles have the build in their names and can be kept.
  const fresh = (res) => res.setHeader('Cache-Control', 'no-cache');
  app.use(express.static(path.join(root, 'dist'), { setHeaders: (res, file) => { if (file.endsWith('.html')) fresh(res); } }));
  // An address under /api that no route answers is a mistake, not a page: say so, so a wrong call in the
  // page shows up as an error and is not handed the app's front page (found by the NAS session's add-on test).
  app.use('/api', (_req, res) => res.status(404).json({ error: "Ledger has nothing at that address." }));
  // A script or style file that no longer exists (its name changes with every build) must say so. Until
  // 2026-11-24 it was answered with the page itself, so a phone holding the page from before an update got
  // the page in place of its script and its styles and showed a blank white screen (his phone, that evening).
  app.use('/assets', (_req, res) => { fresh(res); res.status(404).type('text/plain').send('Not here any more.'); });
  app.use((_req, res) => { fresh(res); res.sendFile(page); });
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true, allowedHosts: ['.local'] }, appType: 'spa' });
  app.use(vite.middlewares);
}

simplefin.upgradeCategories();
startAutoSync();
const server = app.listen(PORT, HOST, () => console.log(`Ledger is running at http://localhost:${PORT}`));

// Asked to stop (a deploy, a Home Assistant backup or update): finish up and leave cleanly. Node running as
// the container's first process takes no notice of the request by default, so it was killed ten seconds
// later, which Home Assistant showed as the add-on being in "error" during every backup (found by the NAS
// session's backup test, 2026-11-24). The database is closed first, which folds its journal into the file.
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    console.log('Ledger is stopping.');
    server.close();
    server.closeAllConnections?.();
    try { db.close(); } catch { /* already closed */ }
    process.exit(0);
  });
}
