// Recurring bills: ones you add by hand, plus ones found by looking for
// charges from the same merchant, about a month apart, for a similar amount.
import { db, iso } from './db.js';
import { keepForUndo } from './undo.js';

// A bill with a month set is charged once a year, in that month.
if (!db.prepare('PRAGMA table_info(recurrings)').all().some((c) => c.name === 'month')) db.exec('ALTER TABLE recurrings ADD COLUMN month INTEGER');
// A bill added by hand can also come round every so many weeks or months, counted from one known due
// date (`anchor`): every_unit 'week' or 'month', every_n how many. Added 2026-11-23.
for (const [c, t] of [['every_n', 'INTEGER'], ['every_unit', 'TEXT'], ['anchor', 'TEXT']]) {
  if (!db.prepare('PRAGMA table_info(recurrings)').all().some((x) => x.name === c)) db.exec(`ALTER TABLE recurrings ADD COLUMN ${c} ${t}`);
}
db.exec('CREATE TABLE IF NOT EXISTS recurring_ignores (id INTEGER PRIMARY KEY, merchant TEXT NOT NULL, amount REAL NOT NULL)');

// Past bills entered from the utility's own billing history. With these, a
// bill's next amount is exact when it has been issued but not yet paid, and a
// seasonal estimate otherwise.
db.exec(`CREATE TABLE IF NOT EXISTS bill_history (
  id INTEGER PRIMARY KEY, merchant TEXT NOT NULL, bill_date TEXT NOT NULL, amount REAL NOT NULL, due_date TEXT,
  UNIQUE (merchant, bill_date))`);

const DAY = 86400000;
const EVERYDAY = new Set(['Groceries', 'Dining out', 'Gas and car', 'Shopping', 'Entertainment', 'Health', 'Pets', 'Travel']);
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / DAY);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const addDays = (d, n) => iso(new Date(new Date(`${d}T12:00:00`).getTime() + n * DAY));
const shiftMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number); return iso(new Date(y, m - 1 + n, 1)).slice(0, 7); };
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const cents = (n) => Math.round(n * 100) / 100;
const close = (a, b, tolerance) => Math.abs(a - b) <= Math.max(2, Math.abs(b) * tolerance);

/**
 * A bill with billing history: line each past bill up with the payment that
 * settled it, then work out what comes next.
 */
function fromHistory(merchant, payments, history, today) {
  const used = new Set();
  const events = history.map((h) => {
    const i = payments.findIndex((p, idx) => !used.has(idx) && Math.abs(p.amount - h.amount) < 0.015 && p.date >= h.bill_date && days(h.bill_date, p.date) <= 50);
    if (i >= 0) used.add(i);
    return { bill: h.bill_date, amount: h.amount, due: h.due_date, paid: i >= 0 ? payments[i].date : null };
  });
  // How long after the bill date the payment usually leaves the account.
  const lags = events.filter((e) => e.paid).map((e) => days(e.bill, e.paid));
  const lag = lags.length ? median(lags) : 24;
  // Payments with no matching bill (history not yet entered) still count as bills.
  payments.forEach((p, idx) => { if (!used.has(idx)) events.push({ bill: addDays(p.date, -lag), amount: p.amount, due: null, paid: p.date }); });
  events.sort((a, b) => a.bill.localeCompare(b.bill));
  const lastPaid = events.filter((e) => e.paid).at(-1);
  if (!lastPaid || days(lastPaid.paid, today) > 60) return null;

  const byMonth = {};
  for (const e of events) (byMonth[e.bill.slice(0, 7)] ??= []).push(e.amount);
  const monthAmount = (ym) => (byMonth[ym] ? byMonth[ym].reduce((a, x) => a + x, 0) / byMonth[ym].length : null);
  // Trend: how recent bills compare with the same months a year earlier.
  const ratios = events.slice(-6).map((e) => { const prev = monthAmount(shiftMonth(e.bill.slice(0, 7), -12)); return prev ? e.amount / prev : null; }).filter(Boolean);
  const trend = ratios.length >= 3 ? clamp(median(ratios), 0.85, 1.45) : 1;
  const estimate = (ym) => {
    const lastYear = monthAmount(shiftMonth(ym, -12));
    const years = [lastYear, monthAmount(shiftMonth(ym, -24))].filter((x) => x != null);
    if (!years.length) { const recent = events.slice(-3); return cents(recent.reduce((a, e) => a + e.amount, 0) / recent.length); }
    const average = years.reduce((a, x) => a + x, 0) / years.length;
    // Mostly last year's bill for the same month, steadied by the year before.
    return cents(trend * (lastYear != null ? 0.75 * lastYear + 0.25 * average : average));
  };

  // The next four payments: bills already issued but unpaid first (exact),
  // then one estimate per month after that.
  const schedule = events.filter((e) => !e.paid && e.bill > lastPaid.bill && days(e.bill, today) <= 60)
    .map((e) => ({ date: [e.due || addDays(e.bill, lag), today].sort().at(-1), amount: e.amount, known: true, billed: e.bill }));
  const latest = events.at(-1);
  const billDay = Math.min(28, Number(latest.bill.slice(8)));
  for (let n = 1; schedule.length < 4 && n < 18; n++) {
    const ym = shiftMonth(latest.bill.slice(0, 7), n);
    const date = addDays(`${ym}-${String(billDay).padStart(2, '0')}`, lag);
    if (date >= today) schedule.push({ date, amount: estimate(ym), known: false, billed: null });
  }
  const [first, ...later] = schedule;
  return {
    id: `found:${merchant}:history`, source: 'found', name: merchant, merchant, amount: first.amount, next: first.date,
    day: Number(first.date.slice(8)), category_id: lastPaid.category_id ?? payments.at(-1).category_id, count: events.length,
    account_type: payments.at(-1).account_type,
    last: lastPaid.paid, variable: !first.known, known: first.known, billed: first.billed, seasonal: true, forecast: later, previous: null,
  };
}

function isMonthly(items) {
  if (items.length < 2) return false;
  const gaps = items.slice(1).map((r, i) => days(items[i].date, r.date));
  return median(gaps) >= 26 && median(gaps) <= 34 && gaps.filter((d) => d >= 24 && d <= 38).length / gaps.length >= 0.8;
}

/**
 * Monthly series inside a merchant's charges: start from a charge, then keep
 * taking the charge closest to a month later for the same amount. Needs three
 * in a row, and skips everyday shopping, where monthly spacing is coincidence.
 */
function monthlyChains(items) {
  if (items.some((r) => EVERYDAY.has(r.category))) return [];
  const free = new Set(items.map((_, i) => i));
  const chains = [];
  for (let i = 0; i < items.length; i++) {
    if (!free.has(i)) continue;
    const chain = [i];
    for (;;) {
      const from = items[chain.at(-1)];
      let best = -1, bestMiss = Infinity;
      for (const k of free) {
        if (k <= chain.at(-1) || chain.includes(k)) continue;
        const gap = days(from.date, items[k].date);
        if (gap < 26 || gap > 35 || !close(items[k].amount, from.amount, 0.03)) continue;
        if (Math.abs(gap - 30.4) < bestMiss) { best = k; bestMiss = Math.abs(gap - 30.4); }
      }
      if (best < 0) break;
      chain.push(best);
    }
    if (chain.length >= 3) { for (const k of chain) free.delete(k); chains.push(chain.map((k) => items[k])); }
  }
  return chains;
}

/**
 * kind 'expense' finds bills. kind 'transfer' finds regular payments out of
 * checking that aren't spending, such as a card's automatic payment.
 */
function detect(kind = 'expense') {
  const transfers = kind === 'transfer';
  const since = iso(new Date(Date.now() - 400 * DAY));
  const rows = db.prepare(`
    SELECT t.merchant, -t.amount amount, t.date, t.category_id, c.fixed, c.name category, a.type account_type
    FROM transactions t JOIN categories c ON c.id = t.category_id JOIN accounts a ON a.id = t.account_id
    WHERE c.kind = ? AND t.amount < 0 AND t.date >= ? ${transfers ? "AND a.type = 'checking'" : ''} ORDER BY t.date`).all(kind, since);
  const byMerchant = new Map();
  for (const r of rows) (byMerchant.get(r.merchant) ?? byMerchant.set(r.merchant, []).get(r.merchant)).push(r);

  const today = iso(new Date());
  const history = new Map();
  for (const h of db.prepare('SELECT merchant, bill_date, amount, due_date FROM bill_history ORDER BY bill_date').all()) (history.get(h.merchant) ?? history.set(h.merchant, []).get(h.merchant)).push(h);
  const found = [];
  for (const [merchant, list] of byMerchant) {
    if (!transfers && history.has(merchant)) {
      const bill = fromHistory(merchant, list, history.get(merchant), today);
      if (bill) found.push(bill);
      continue;
    }
    // One merchant can bill twice a month for different things (two phone
    // lines, say), so split its charges into groups of similar amounts first.
    const groups = [];
    for (const r of [...list].sort((a, b) => a.amount - b.amount)) {
      const g = groups.at(-1);
      if (g && close(r.amount, g.mean, 0.3)) { g.items.push(r); g.mean = g.items.reduce((a, x) => a + x.amount, 0) / g.items.length; }
      else groups.push({ items: [r], mean: r.amount });
    }
    for (const g of groups) {
      const sorted = g.items.sort((a, b) => a.date.localeCompare(b.date));
      // Usually the whole group is one monthly series. When it isn't, the
      // merchant may be charging more than once a month (two subscriptions at
      // the same price, or a subscription plus one-off purchases), so look for
      // monthly series hiding inside it.
      for (const items of isMonthly(sorted) ? [sorted] : transfers ? [] : monthlyChains(sorted)) {
      if (items.length < (transfers ? 3 : 2)) continue;
      const gaps = items.slice(1).map((r, i) => days(items[i].date, r.date));
      const monthly = gaps.filter((d) => d >= 24 && d <= 38).length;
      const last = items.at(-1), prev = items.at(-2);
      if (median(gaps) < 26 || median(gaps) > 34 || monthly / gaps.length < 0.8) continue;
      // Two charges is thin evidence: skip everyday shopping categories, and
      // require near-identical amounts unless it's a bill-type category.
      if (items.length === 2 && (EVERYDAY.has(last.category) || (!last.fixed && !close(last.amount, prev.amount, 0.1)))) continue;
      // A bill that hasn't come round in 45 days has probably been cancelled.
      if (days(last.date, today) > 45) continue;
      const amounts = items.map((r) => r.amount);
      // A price change: every earlier charge matched, and only the latest differs.
      const stepped = items.length >= 3 && !close(last.amount, prev.amount, 0.05) && amounts.slice(0, -1).every((a) => close(a, prev.amount, 0.05));
      const variable = !stepped && !amounts.every((a) => close(a, last.amount, 0.05));
      const recent = amounts.slice(-3);
      found.push({
        id: `found:${merchant}:${Math.round(g.mean)}:${last.date.slice(8)}`, source: 'found', name: merchant, merchant,
        amount: Math.round((variable ? recent.reduce((a, x) => a + x, 0) / recent.length : last.amount) * 100) / 100,
        day: Number(last.date.slice(8)), category_id: last.category_id, count: items.length, last: last.date, variable,
        account_type: last.account_type,
        previous: stepped ? prev.amount : null,
      });
      }
    }
  }
  return found;
}

/** Every date a bill on its own rhythm falls due, from `from` to `to` inclusive. Empty for an ordinary bill. */
export function occurrences(r, from, to) {
  if (!r.every_unit || !/^\d{4}-\d{2}-\d{2}$/.test(r.anchor || '')) return [];
  const n = Math.max(1, Math.round(r.every_n) || 1), out = [];
  if (r.every_unit === 'week') {
    const step = 7 * n;
    for (let k = Math.ceil(days(r.anchor, from) / step); out.length < 60; k++) {
      const d = addDays(r.anchor, k * step);
      if (d > to) break;
      if (d >= from) out.push(d);
    }
    return out;
  }
  const [ay, am, ad] = r.anchor.split('-').map(Number);
  // The same day of the month each time; a 31st falls on the last day of a shorter month.
  const at = (k) => iso(new Date(ay, am - 1 + k * n, Math.min(ad, new Date(ay, am + k * n, 0).getDate())));
  const [fy, fm] = from.split('-').map(Number);
  for (let k = Math.floor(((fy - ay) * 12 + (fm - am)) / n) - 1; out.length < 60; k++) {
    const d = at(k);
    if (d > to) break;
    if (d >= from) out.push(d);
  }
  return out;
}
const rhythmText = (r) => { const n = Math.max(1, r.every_n || 1); return n === 1 ? `every ${r.every_unit}` : `every ${n} ${r.every_unit}s`; };
/** What a bill comes to in an average month, whatever its rhythm. */
export const perMonth = (r) => (r.every_unit === 'week' ? (r.amount * (365.25 / 7 / 12)) / Math.max(1, r.every_n || 1)
  : r.every_unit === 'month' ? r.amount / Math.max(1, r.every_n || 1) : r.month ? r.amount / 12 : r.amount);
/** The days of one month a bill falls on, with its amount each time: none for a yearly bill out of its month. */
export function inMonth(r, y, mo) {
  if (r.every_unit) return occurrences(r, iso(new Date(y, mo - 1, 1)), iso(new Date(y, mo, 0))).map((d) => ({ day: Number(d.slice(8)), amount: r.amount }));
  return !r.month || r.month === mo ? [{ day: r.day, amount: r.amount }] : [];
}

/** The next date a monthly item falls due: its own date if known, else its usual day. */
export function nextDue(r, today = iso(new Date())) {
  if (r.next) return r.next;
  const [y, m] = today.split('-').map(Number);
  if (r.month) {
    const thisYear = iso(new Date(y, r.month - 1, r.day));
    return thisYear >= today ? thisYear : iso(new Date(y + 1, r.month - 1, r.day));
  }
  const thisMonth = iso(new Date(y, m - 1, r.day));
  if (thisMonth >= today) return thisMonth;
  // Its day passed within the last week and this month's payment hasn't shown up
  // yet (weekends and bank delays): it is still on its way, so it's due now, not next month.
  const [ly, lm, ld] = (r.last || '').split('-').map(Number);
  const daysLate = Math.round((new Date(y, m - 1, Number(today.slice(8))) - new Date(y, m - 1, r.day)) / 86400000);
  const seenThisMonth = r.last && new Date(ly, lm - 1, ld) >= new Date(y, m - 1, r.day - 10);
  if (r.last && !seenThisMonth && daysLate <= 7) return today;
  return iso(new Date(y, m, r.day));
}

/** Regular payments out of checking that aren't bills, such as card autopay. */
export function getRegularTransfers() {
  return detect('transfer');
}

// A pay link for a bill (2026-11-27, the owner: a way to get to the right website without hunting for it).
// Ledger never pays anything: this is only the address of the company's own payment page, typed in by the
// household, opened in a new tab. Kept by the bill's name (as shown), so it works for bills found in
// transactions and bills added by hand alike. https only.
db.exec('CREATE TABLE IF NOT EXISTS bill_links (name TEXT PRIMARY KEY, url TEXT NOT NULL)');
const linkKey = (name) => String(name || '').trim().toLowerCase();
export function cleanPayLink(text) {
  let t = String(text || '').trim();
  if (!t) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(t)) t = `https://${t}`;
  let u; try { u = new URL(t); } catch { return null; }
  if (u.protocol !== 'https:' || !u.hostname.includes('.') || u.username || u.password || t.length > 400) return null;
  return u.href;
}
/** Carries a bill's pay link to its new name when the bill is renamed. */
export function movePayLink(from, to) {
  const a = linkKey(from), b = linkKey(to);
  if (!a || !b || a === b) return;
  const row = db.prepare('SELECT url FROM bill_links WHERE name = ?').get(a);
  if (!row) return;
  db.prepare('DELETE FROM bill_links WHERE name = ?').run(a);
  db.prepare('INSERT OR REPLACE INTO bill_links (name, url) VALUES (?, ?)').run(b, row.url);
}

export function getRecurrings() {
  const today = iso(new Date());
  const manual = db.prepare('SELECT * FROM recurrings').all().map((r) => {
    if (!r.every_unit) return { ...r, source: 'manual', monthly: perMonth(r) };
    const next = occurrences(r, today, addDays(today, 800))[0] || r.anchor;
    return { ...r, source: 'manual', next, day: Number(next.slice(8)), rhythm: rhythmText(r), monthly: perMonth(r) };
  });
  const ignores = db.prepare('SELECT merchant, amount FROM recurring_ignores').all();
  const names = new Set(manual.map((r) => r.name.toLowerCase()));
  const found = detect().filter((r) => !names.has(r.name.toLowerCase()) && !ignores.some((i) => i.merchant === r.merchant && close(r.amount, i.amount, 0.3)));
  const links = new Map(db.prepare('SELECT name, url FROM bill_links').all().map((l) => [l.name, l.url]));
  return [...manual, ...found].map((r) => (links.has(linkKey(r.name)) ? { ...r, pay_url: links.get(linkKey(r.name)) } : r));
}

// "How often" from the form: '' for monthly or yearly, or 'week:2', 'month:3' with the next due date.
function rhythmOf(body, was) {
  if (body?.every === undefined) return was ? { n: was.every_n, unit: was.every_unit, anchor: was.anchor } : { n: null, unit: null, anchor: null };
  const m = /^(week|month):(\d{1,2})$/.exec(String(body.every || ''));
  if (!m) return { n: null, unit: null, anchor: null };
  const anchor = String(body.anchor || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor) || Number.isNaN(Date.parse(anchor))) return { error: 'Choose the next date it is due.' };
  const n = Number(m[2]);
  if (!(n >= 1 && n <= 26)) return { error: 'Choose how often it comes round.' };
  return { n, unit: m[1], anchor };
}

export function installRecurring(app) {
  app.put('/api/bills/link', (req, res) => {
    const name = linkKey(req.body?.name);
    if (!name || name.length > 120) return res.status(400).json({ error: "That bill can't be given a link." });
    const url = cleanPayLink(req.body?.url);
    if (url === null) return res.status(400).json({ error: 'Enter the web address of the page where you pay it, starting with https://.' });
    if (!url) db.prepare('DELETE FROM bill_links WHERE name = ?').run(name);
    else db.prepare('INSERT OR REPLACE INTO bill_links (name, url) VALUES (?, ?)').run(name, url);
    res.json({ ok: true, url });
  });
  app.post('/api/recurrings', (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 80);
    const amount = Number(req.body?.amount);
    const every = rhythmOf(req.body);
    if (every.error) return res.status(400).json({ error: every.error });
    const day = every.unit ? Number(every.anchor.slice(8)) : Math.round(Number(req.body?.day));
    if (!name) return res.status(400).json({ error: 'Enter a name for the bill.' });
    if (!(amount > 0)) return res.status(400).json({ error: 'Enter an amount above 0.' });
    if (!(day >= 1 && day <= 31)) return res.status(400).json({ error: 'Enter the day of the month it is due, from 1 to 31.' });
    if (!db.prepare("SELECT 1 FROM categories WHERE id = ? AND kind = 'expense'").get(Number(req.body?.category_id))) return res.status(400).json({ error: 'Choose a category.' });
    const month = !every.unit && req.body?.month ? Math.round(Number(req.body.month)) : null;
    if (month != null && !(month >= 1 && month <= 12)) return res.status(400).json({ error: 'Choose the month it renews.' });
    db.prepare('INSERT INTO recurrings (name, amount, day, category_id, month, every_n, every_unit, anchor) VALUES (?,?,?,?,?,?,?,?)').run(name, amount, day, Number(req.body.category_id), month, every.n, every.unit, every.anchor);
    res.json({ ok: true });
  });
  // Change a bill you added by hand: its name, amount, day, how often and category.
  app.patch('/api/recurrings/:id', (req, res) => {
    const r = db.prepare('SELECT * FROM recurrings WHERE id = ?').get(Number(req.params.id));
    if (!r) return res.status(404).json({ error: "That bill isn't one you added by hand." });
    const name = String(req.body?.name ?? r.name).trim().slice(0, 80);
    const amount = Number(req.body?.amount ?? r.amount);
    const every = rhythmOf(req.body, r);
    if (every.error) return res.status(400).json({ error: every.error });
    const day = every.unit ? Number(every.anchor.slice(8)) : Math.round(Number(req.body?.day ?? r.day));
    const category = Number(req.body?.category_id ?? r.category_id);
    const month = every.unit ? null : req.body?.month === undefined ? r.month : req.body.month ? Math.round(Number(req.body.month)) : null;
    if (!name) return res.status(400).json({ error: 'Enter a name for the bill.' });
    if (!(amount > 0)) return res.status(400).json({ error: 'Enter an amount above 0.' });
    if (!(day >= 1 && day <= 31)) return res.status(400).json({ error: 'Enter the day of the month it is due, from 1 to 31.' });
    if (!db.prepare("SELECT 1 FROM categories WHERE id = ? AND kind = 'expense'").get(category)) return res.status(400).json({ error: 'Choose a category.' });
    if (month != null && !(month >= 1 && month <= 12)) return res.status(400).json({ error: 'Choose the month it renews.' });
    db.prepare('UPDATE recurrings SET name = ?, amount = ?, day = ?, category_id = ?, month = ?, every_n = ?, every_unit = ?, anchor = ? WHERE id = ?').run(name, amount, day, category, month, every.n, every.unit, every.anchor, r.id);
    res.json({ ok: true });
  });

  app.delete('/api/recurrings/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM recurrings WHERE id = ?').get(Number(req.params.id));
    db.prepare('DELETE FROM recurrings WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true, ...(row ? { undo: keepForUndo(row.name, [{ table: 'recurrings', row }]), label: row.name } : {}) });
  });
  // "Not a bill": hide a detected charge from the list.
  app.post('/api/recurrings/ignore', (req, res) => {
    const merchant = String(req.body?.merchant || ''), amount = Number(req.body?.amount);
    if (!merchant || !(amount > 0)) return res.status(400).json({ error: 'Nothing to hide.' });
    db.prepare('INSERT INTO recurring_ignores (merchant, amount) VALUES (?, ?)').run(merchant, amount);
    res.json({ ok: true });
  });
  app.get('/api/recurrings/ignored', (_req, res) => res.json(db.prepare('SELECT * FROM recurring_ignores ORDER BY merchant').all()));
  app.delete('/api/recurrings/ignore/:id', (req, res) => {
    db.prepare('DELETE FROM recurring_ignores WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });
}
