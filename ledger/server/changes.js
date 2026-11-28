// Changes that start on a date (2026-11-27, the owner's go-ahead; the idea came from a comment on another
// budget app: "a price increase hits, I need to revise the liability with an effective date"). A bill or a
// paycheck can be told that its amount changes from a day: "from March 1 the rent is 1,300", "from January
// 1 each paycheck is 2,150". Until that day nothing changes. From it on, the checking forecast and the
// bills calendar use the new amount for every occurrence on or after the day.
//
// It is only ever a figure the household typed. Once the day arrives the change settles into the ordinary
// place and is forgotten here: a bill added by hand, or a paycheck with a set amount, takes the new amount
// as its own; a bill found in transactions, or a paycheck that follows its deposits, drops the change as
// soon as a payment or deposit dated on or after the day has been seen, since the real figure has then
// taken over. Several changes can wait on one bill; the latest one on or before a date is the one used.
//
// Bills are kept by their shown name in lower case (as pay links are), paychecks by their id.
import { db, iso } from './db.js';

db.exec(`CREATE TABLE IF NOT EXISTS planned_changes (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, ref TEXT NOT NULL, from_date TEXT NOT NULL, amount REAL NOT NULL,
  UNIQUE(kind, ref, from_date))`);

const round = (n) => Math.round(n * 100) / 100;
const DAY = 86400000;
export const billRef = (name) => String(name || '').trim().toLowerCase();

/** Changes whose day has come settle into the bill or paycheck itself and are forgotten here. */
export function settleChanges() {
  const today = iso(new Date());
  const due = db.prepare('SELECT * FROM planned_changes WHERE from_date <= ? ORDER BY from_date').all(today);
  const drop = (id) => db.prepare('DELETE FROM planned_changes WHERE id = ?').run(id);
  for (const c of due) {
    if (c.kind === 'pay') {
      const s = db.prepare('SELECT id, merchant_like, amount_mode FROM pay_schedules WHERE id = ?').get(Number(c.ref));
      if (!s) { drop(c.id); continue; }
      if (s.amount_mode === 'fixed') { db.prepare('UPDATE pay_schedules SET amount = ? WHERE id = ?').run(c.amount, s.id); drop(c.id); continue; }
      if (s.merchant_like && db.prepare('SELECT 1 FROM transactions WHERE merchant LIKE ? AND amount > 0 AND date >= ? LIMIT 1').get(s.merchant_like, c.from_date)) drop(c.id);
    } else {
      const own = db.prepare('SELECT id FROM recurrings WHERE lower(name) = ?').get(c.ref);
      if (own) { db.prepare('UPDATE recurrings SET amount = ? WHERE lower(name) = ?').run(c.amount, c.ref); drop(c.id); continue; }
      if (db.prepare('SELECT 1 FROM transactions WHERE lower(merchant) = ? AND amount < 0 AND date >= ? LIMIT 1').get(c.ref, c.from_date)) { drop(c.id); continue; }
    }
    // Nothing has taken it over in two months (the bill or paycheck is gone): let it go.
    if (c.from_date < iso(new Date(Date.now() - 60 * DAY))) drop(c.id);
  }
}

/** Every waiting change of one kind: ref -> [{ id, from, amount }], earliest first. */
export function changesOf(kind) {
  try { settleChanges(); } catch { /* the list below is still right */ }
  const map = new Map();
  for (const c of db.prepare('SELECT id, ref, from_date, amount FROM planned_changes WHERE kind = ? ORDER BY from_date').all(kind)) {
    map.set(c.ref, [...(map.get(c.ref) || []), { id: c.id, from: c.from_date, amount: c.amount }]);
  }
  return map;
}

/** The changed amount in force on a date, or null when no change has started by then. */
export function amountOn(map, ref, date) {
  let found = null;
  for (const c of map.get(String(ref)) || []) if (c.from <= date) found = c.amount;
  return found;
}

/** A renamed bill keeps the changes waiting on it. */
export function moveBillChanges(from, to) {
  const a = billRef(from), b = billRef(to);
  if (!a || !b || a === b) return;
  db.prepare("UPDATE OR REPLACE planned_changes SET ref = ? WHERE kind = 'bill' AND ref = ?").run(b, a);
}

export function installChanges(app) {
  app.post('/api/changes', (req, res) => {
    const kind = req.body?.kind === 'pay' ? 'pay' : req.body?.kind === 'bill' ? 'bill' : '';
    if (!kind) return res.status(400).json({ error: "That can't be changed this way." });
    const ref = kind === 'pay' ? String(Math.round(Number(req.body?.id)) || '') : billRef(req.body?.name);
    if (!ref || ref.length > 120) return res.status(400).json({ error: kind === 'pay' ? 'That payday is no longer there.' : "That bill can't be changed this way." });
    if (kind === 'pay' && !db.prepare('SELECT 1 FROM pay_schedules WHERE id = ?').get(Number(ref))) return res.status(400).json({ error: 'That payday is no longer there.' });
    const from = String(req.body?.from || ''), today = iso(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || Number.isNaN(Date.parse(from)) || iso(new Date(`${from}T12:00:00`)) !== from) return res.status(400).json({ error: 'Choose the day the new amount starts.' });
    if (from <= today) return res.status(400).json({ error: kind === 'pay' ? 'Choose a day after today. To change it from now on, use "Change" on the payday.' : 'Choose a day after today. To change it from now on, edit the bill, or use "Change" on the dashboard for one month.' });
    if (from > iso(new Date(Date.now() + 731 * DAY))) return res.status(400).json({ error: 'Choose a day within the next two years.' });
    const amount = round(Number(req.body?.amount));
    if (!(amount > 0) || amount > 1e6) return res.status(400).json({ error: 'Enter the new amount, above 0.' });
    db.prepare('INSERT INTO planned_changes (kind, ref, from_date, amount) VALUES (?,?,?,?) ON CONFLICT(kind, ref, from_date) DO UPDATE SET amount = excluded.amount').run(kind, ref, from, amount);
    res.json({ ok: true, changes: changesOf(kind).get(ref) || [] });
  });
  app.delete('/api/changes/:id', (req, res) => {
    db.prepare('DELETE FROM planned_changes WHERE id = ?').run(Number(req.params.id) || 0);
    res.json({ ok: true });
  });
}
