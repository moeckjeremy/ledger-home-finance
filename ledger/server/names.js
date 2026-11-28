// Friendly names for bills. The bank names a payment by who took it ("Benton
// Municipal Collec"), which often says little. A name set here replaces the
// bank's on every matching payment, past and future, and the bank's wording is
// kept as the note. An amount range lets one bank name become two bills (AT&T
// for phones and AT&T for internet).
import { movePayLink } from './recurring.js';
import { moveBillChanges } from './changes.js';
import { db } from './db.js';

db.exec(`CREATE TABLE IF NOT EXISTS bill_names (
  id INTEGER PRIMARY KEY, bank TEXT NOT NULL, min REAL, max REAL, name TEXT NOT NULL)`);

// Tables other files create; a rename skips one that doesn't exist yet.
const has = (table) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
const all = () => db.prepare('SELECT * FROM bill_names ORDER BY id').all();
const fits = (n, amount) => (n.min == null || amount >= n.min) && (n.max == null || amount < n.max);

/** The friendly name for a payment (amount as a positive number), or null. */
export function friendlyName(merchant, amount) {
  const m = String(merchant).toLowerCase();
  return all().find((n) => n.bank.toLowerCase() === m && fits(n, amount))?.name ?? null;
}

/** Gives saved payments their friendly names. Safe to run again. Returns how many rows changed. */
export function applyNames() {
  let changed = 0;
  for (const n of all()) {
    const range = `${n.min == null ? '' : ' AND -amount >= ' + Number(n.min)}${n.max == null ? '' : ' AND -amount < ' + Number(n.max)}`;
    const where = `merchant = ? COLLATE NOCASE AND amount < 0 AND waiting = 0${range}`;
    // Keep the category these payments already have for ones that arrive later.
    const usual = db.prepare(`SELECT category_id, COUNT(*) c FROM transactions WHERE ${where} GROUP BY category_id ORDER BY c DESC LIMIT 1`).get(n.bank);
    if (!usual) continue;
    db.prepare('INSERT OR IGNORE INTO rules (merchant, category_id) VALUES (?, ?)').run(n.name, usual.category_id);
    changed += db.prepare(`UPDATE transactions SET notes = CASE WHEN notes = '' THEN merchant ELSE notes END, merchant = ? WHERE ${where}`).run(n.name, n.bank).changes;
    // Utility history, hidden bills and typed-over outlook amounts follow the name when it covers the whole merchant.
    if (n.min == null && n.max == null) {
      if (has('bill_history')) db.prepare('UPDATE bill_history SET merchant = ? WHERE merchant = ? COLLATE NOCASE').run(n.name, n.bank);
      if (has('recurring_ignores')) db.prepare('UPDATE recurring_ignores SET merchant = ? WHERE merchant = ? COLLATE NOCASE').run(n.name, n.bank);
      if (has('outlook_amounts')) db.prepare("UPDATE outlook_amounts SET name = ? WHERE kind = 'bill' AND name = ? COLLATE NOCASE").run(n.name, n.bank);
    }
  }
  return changed;
}

/** Puts the bank's wording back on payments that carry a friendly name. */
function undo(n) {
  db.prepare("UPDATE transactions SET merchant = ?, notes = CASE WHEN notes = ? THEN '' ELSE notes END WHERE merchant = ?").run(n.bank, n.bank, n.name);
  if (has('bill_history')) db.prepare('UPDATE bill_history SET merchant = ? WHERE merchant = ?').run(n.bank, n.name);
  if (has('recurring_ignores')) db.prepare('UPDATE recurring_ignores SET merchant = ? WHERE merchant = ?').run(n.bank, n.name);
  if (has('outlook_amounts')) db.prepare("UPDATE outlook_amounts SET name = ? WHERE kind = 'bill' AND name = ?").run(n.bank, n.name);
  db.prepare('DELETE FROM bill_names WHERE id = ?').run(n.id);
}

/**
 * Renames a bill. `current` is the name it shows now (the bank's, or a friendly
 * one being changed); a blank new name goes back to the bank's wording. `range`
 * limits it to payments of that size, for a merchant that bills for two things.
 */
export function renameBill(current, name, range = null) {
  const existing = all().find((n) => n.name === current);
  const bank = existing ? existing.bank : current;
  const min = existing ? existing.min : range?.min ?? null, max = existing ? existing.max : range?.max ?? null;
  if (existing) undo(existing);
  if (name && name.toLowerCase() !== bank.toLowerCase()) db.prepare('INSERT INTO bill_names (bank, min, max, name) VALUES (?,?,?,?)').run(bank, min, max, name);
  return applyNames();
}

export function installNames(app, { getRecurrings }) {
  app.post('/api/bills/rename', (req, res) => {
    const current = String(req.body?.current || '').trim(), name = String(req.body?.name || '').trim().slice(0, 60);
    const amount = Number(req.body?.amount);
    if (!current) return res.status(400).json({ error: "That bill can't be renamed." });
    // A bill typed in by hand has no payments to rename; its own name is changed.
    if (req.body?.id && /^\d+$/.test(String(req.body.id))) {
      if (!name) return res.status(400).json({ error: 'Enter a name for the bill.' });
      db.prepare('UPDATE recurrings SET name = ? WHERE id = ?').run(name, Number(req.body.id));
      movePayLink(current, name);
      moveBillChanges(current, name);
      return res.json({ ok: true });
    }
    if (name && db.prepare('SELECT 1 FROM bill_names WHERE name = ? AND name != ?').get(name, current)) return res.status(400).json({ error: `Another bill is already called ${name}.` });
    // When the same merchant shows as two bills, only the one of this size is renamed.
    const twins = getRecurrings().filter((r) => r.source === 'found' && r.merchant === current);
    const others = twins.filter((r) => Math.abs(r.amount - amount) > 0.005).map((r) => r.amount);
    let range = null;
    if (others.length && amount > 0) {
      const below = Math.max(0, ...others.filter((a) => a < amount)), above = Math.min(Infinity, ...others.filter((a) => a > amount));
      range = { min: below ? Math.sqrt(below * amount) : null, max: Number.isFinite(above) ? Math.sqrt(above * amount) : null };
    }
    renameBill(current, name, range);
    if (name) { movePayLink(current, name); moveBillChanges(current, name); }
    res.json({ ok: true });
  });
  app.get('/api/bills/names', (_req, res) => res.json(all().map((n) => ({ name: n.name, bank: n.bank }))));
}
