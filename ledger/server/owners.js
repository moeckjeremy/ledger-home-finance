// Whose account is whose (The owner, 2026-11-23, one of the gaps against the big budget apps he chose to
// close: "shared versus personal views"). Each account can be marked as one adult's or as shared; nothing
// is marked on single purchases, which would be far more to keep up. An account nobody has marked counts
// as shared. The mark is only a label for looking at things: every total, budget and forecast elsewhere in
// Ledger still covers the whole household, and both adults still see everything.
//
//   accounts.owner   '' or 'joint' (shared), 'you' (the first adult), 'spouse'
//   GET   /api/owners                 names, and for each owner what they have, owe and spent this month
//   PATCH /api/accounts/:id/owner     { owner }
//   ?who=you|spouse|joint             on /api/transactions and /api/reports (see ownerWhere)
import { db, iso, getSetting } from './db.js';
import { periodOf, periodBounds } from './period.js';

if (!db.prepare('PRAGMA table_info(accounts)').all().some((c) => c.name === 'owner')) db.exec("ALTER TABLE accounts ADD COLUMN owner TEXT NOT NULL DEFAULT ''");

export const OWNERS = ['you', 'spouse', 'joint'];
const round = (n) => Math.round(n * 100) / 100;
const OWNER_OF = "COALESCE(NULLIF(owner, ''), 'joint')";

/** A WHERE fragment limiting `t.account_id` to one owner's accounts, or '' for everyone. */
export function ownerWhere(who) {
  return OWNERS.includes(who) ? { sql: `t.account_id IN (SELECT id FROM accounts WHERE ${OWNER_OF} = ?)`, args: [who] } : { sql: '', args: [] };
}

function names() {
  const two = !['single', 'hoh'].includes(getSetting('filing_status', 'joint'));
  return { you: getSetting('mail_your_name', '').trim(), spouse: two ? getSetting('spouse_name', '').trim() : '', two };
}

export function installOwners(app) {
  app.get('/api/owners', (_req, res) => {
    const n = names();
    const start = periodBounds(periodOf()).start;   // the budget month now running (server/period.js)
    const groups = {};
    for (const who of OWNERS) {
      if (who === 'spouse' && !n.two) continue;
      const acc = db.prepare(`SELECT id, name, type, balance FROM accounts WHERE type != 'insurance' AND ${OWNER_OF} = ? ORDER BY (balance < 0), ABS(balance) DESC, name`).all(who);
      const spent = db.prepare(`SELECT COALESCE(-SUM(t.amount), 0) s FROM transactions t JOIN categories c ON c.id = t.category_id
        WHERE c.kind = 'expense' AND t.date >= ? AND t.account_id IN (SELECT id FROM accounts WHERE ${OWNER_OF} = ?)`).get(start, who).s;
      groups[who] = {
        accounts: acc.length,
        // Which accounts those are, largest first and what is owed after what is held, for the card to list.
        list: acc.map((a) => ({ id: a.id, name: a.name, type: a.type, balance: round(a.balance) })),
        has: round(acc.filter((a) => a.balance > 0).reduce((a, x) => a + x.balance, 0)),
        owes: round(-acc.filter((a) => a.balance < 0).reduce((a, x) => a + x.balance, 0)),
        spent: round(spent),
      };
    }
    const marked = db.prepare("SELECT COUNT(*) c FROM accounts WHERE owner IN ('you', 'spouse')").get().c;
    res.json({ names: n, groups, marked });
  });

  app.patch('/api/accounts/:id/owner', (req, res) => {
    const owner = String(req.body?.owner || '');
    if (owner && !OWNERS.includes(owner)) return res.status(400).json({ error: 'Choose whose account it is.' });
    const r = db.prepare('UPDATE accounts SET owner = ? WHERE id = ?').run(owner === 'joint' ? '' : owner, Number(req.params.id));
    if (!r.changes) return res.status(404).json({ error: 'That account is no longer there.' });
    res.json({ ok: true });
  });
}
