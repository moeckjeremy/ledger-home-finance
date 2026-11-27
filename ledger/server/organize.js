// Putting things in the household's own order (2026-11-26, after someone moving over from another budget
// app could not rearrange their categories). Everything here changes where something sits or how it is
// grouped, never what it adds up to:
//
//   categories   move up or down; flexible or fixed; a group of the household's own; hide one that is no
//                longer used (its past stays in every total and report); merge one into another
//                or leave one out of the budget altogether (kind 'aside', below)
//   accounts     move up or down within their kind on the Accounts page
//
// A category's `fixed` flag is still what the rest of the app reads (the pace line, the recap, the summary
// email), whatever group it is shown under. A group is only a heading on the Budgets page.
import { db, getSetting } from './db.js';
import { gig, extraGigs } from './gig.js';
import { settleBudgets } from './rollover.js';
import { forgetPlans } from './budgetplan.js';

const has = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
if (!has('categories', 'hidden')) db.exec('ALTER TABLE categories ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0');
if (!has('categories', 'group_id')) db.exec('ALTER TABLE categories ADD COLUMN group_id INTEGER');
if (!has('accounts', 'sort')) db.exec('ALTER TABLE accounts ADD COLUMN sort REAL');
db.exec('CREATE TABLE IF NOT EXISTS cat_groups (id INTEGER PRIMARY KEY, name TEXT NOT NULL, sort REAL NOT NULL DEFAULT 0)');

const groups = () => db.prepare('SELECT id, name FROM cat_groups ORDER BY sort, id').all();
const groupIds = () => new Set(groups().map((g) => g.id));

/** The list a spending category is shown in on the Budgets page: one of the household's groups, or flexible or fixed. */
const listOf = (c, ids) => (c.group_id && ids.has(c.group_id) ? `g${c.group_id}` : c.fixed ? 'fixed' : 'flex');

/** Why the app won't let a category be hidden or merged away, or '' when it may be. */
function needed(cat) {
  if (['Other', 'Income', 'Transfer', 'Deposit'].includes(cat.key || cat.name) || cat.kind !== 'expense') return `${cat.name} can't be changed that way: Ledger files things there itself.`;
  if (extraGigs().some((x) => x.categoryId === cat.id) || (String(cat.id) === getSetting('vipkid_category_id') && gig().on)) return `${cat.name} is a side gig's category.`;
  return '';
}

/** Swap one row with its neighbour in the same section, then number every row 1, 2, 3 in the new order. */
function step(rows, id, dir, same, table) {
  const at = rows.findIndex((r) => r.id === id);
  if (at < 0) return { status: 404, error: 'That is no longer there.' };
  let to = at + dir;
  while (rows[to] && !same(rows[at], rows[to])) to += dir;
  if (!rows[to]) return { ok: true, moved: false };   // already first or last
  [rows[at], rows[to]] = [rows[to], rows[at]];
  db.exec('BEGIN');
  try {
    const set = db.prepare(`UPDATE ${table} SET sort = ? WHERE id = ?`);
    rows.forEach((r, i) => set.run(i + 1, r.id));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return { status: 500, error: `That couldn't be moved: ${e.message}` };
  }
  return { ok: true, moved: true };
}
const dirOf = (body) => (body?.dir === 'up' ? -1 : body?.dir === 'down' ? 1 : 0);
const send = (res, r) => (r.error ? res.status(r.status || 400).json({ error: r.error }) : res.json(r));

// The kinds of account the Accounts page lists together.
const KINDS = [['checking', 'savings'], ['investment'], ['hsa'], ['property'], ['credit'], ['auto', 'loan', 'mortgage'], ['insurance']];
const kindOf = (type) => { const i = KINDS.findIndex((k) => k.includes(type)); return i < 0 ? type : i; };

export function installOrganize(app) {
  // ---- categories: one place up or down in its own list ----
  app.post('/api/categories/:id/move', (req, res) => {
    const dir = dirOf(req.body);
    if (!dir) return res.status(400).json({ error: 'Say which way to move it.' });
    const all = db.prepare('SELECT id, kind, fixed, group_id FROM categories ORDER BY sort, id').all();
    const me = all.find((c) => c.id === Number(req.params.id));
    if (!me) return res.status(404).json({ error: 'That category is gone.' });
    if (me.kind !== 'expense') return res.status(400).json({ error: 'Only spending categories have an order to change.' });
    const ids = groupIds();
    send(res, step(all, me.id, dir, (a, b) => b.kind === 'expense' && listOf(a, ids) === listOf(b, ids), 'categories'));
  });

  // ---- which list it sits in, and whether it is a fixed bill ----
  // `list` is 'flex', 'fixed' or a group's id. In a group of the household's own, `fixed` says which it is.
  app.post('/api/categories/:id/place', (req, res) => {
    const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(req.params.id));
    if (!cat) return res.status(404).json({ error: 'That category is gone.' });
    if (cat.kind !== 'expense') return res.status(400).json({ error: 'Only spending categories sit in these lists.' });
    const list = String(req.body?.list ?? '');
    let group = null, fixed = cat.fixed ? 1 : 0;
    if (list === 'flex') fixed = 0;
    else if (list === 'fixed') fixed = 1;
    else {
      group = Number(list);
      if (!groupIds().has(group)) return res.status(400).json({ error: 'Choose a list for it.' });
      if (req.body?.fixed !== undefined) fixed = req.body.fixed ? 1 : 0;
    }
    // It goes to the foot of the list it joins.
    const last = db.prepare('SELECT MAX(sort) m FROM categories').get().m ?? 0;
    const moved = (cat.group_id || null) !== group || (!group && !!cat.fixed !== !!fixed);
    db.prepare('UPDATE categories SET group_id = ?, fixed = ?, sort = ? WHERE id = ?').run(group, fixed, moved ? last + 1 : cat.sort, cat.id);
    res.json({ ok: true });
  });

  // ---- hide one that is no longer used, or show it again ----
  // Nothing filed in it changes, and its past stays in every total and report. Its budget goes to 0, since a
  // category nobody sees should not be holding money back; menus stop offering it.
  app.post('/api/categories/:id/hide', (req, res) => {
    const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(req.params.id));
    if (!cat) return res.status(404).json({ error: 'That category is gone.' });
    const on = req.body?.on !== false;
    if (on) {
      const why = needed(cat);
      if (why) return res.status(400).json({ error: why });
      settleBudgets();   // earlier months keep the budget they had
      db.prepare('UPDATE categories SET hidden = 1, budget = 0 WHERE id = ?').run(cat.id);
      forgetPlans(cat.id);
    } else db.prepare('UPDATE categories SET hidden = 0 WHERE id = ?').run(cat.id);
    res.json({ ok: true });
  });

  // ---- a category that doesn't count in the budget (asked for by someone who puts work expenses on his own
  // card and is paid back) ----
  // Its kind becomes 'aside'. Every total in the app adds up kind 'expense' or 'income' by name, so what is
  // filed there is in no budget, total, pace line, report or recap, with nothing else to change; and it is not
  // a transfer either, so its rows can still be split, edited and searched like any purchase. Money that comes
  // back (the reimbursement) can be filed there too, and the Budgets page shows both sides.
  app.post('/api/categories/:id/aside', (req, res) => {
    const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(req.params.id));
    if (!cat) return res.status(404).json({ error: 'That category is gone.' });
    if (req.body?.on === false) {
      if (cat.kind !== 'aside') return res.json({ ok: true });
      db.prepare("UPDATE categories SET kind = 'expense' WHERE id = ?").run(cat.id);
      return res.json({ ok: true });
    }
    if (cat.kind === 'aside') return res.json({ ok: true });
    const why = needed(cat);
    if (why) return res.status(400).json({ error: why });
    settleBudgets();   // earlier months keep the budget they had
    db.prepare("UPDATE categories SET kind = 'aside', budget = 0, hidden = 0 WHERE id = ?").run(cat.id);
    forgetPlans(cat.id);
    try { db.prepare('DELETE FROM zero_assign WHERE category_id = ?').run(cat.id); } catch { /* the zero-based tables aren't in this copy */ }
    res.json({ ok: true });
  });

  // ---- merge one into another: everything it held moves, then it is removed ----
  app.post('/api/categories/:id/merge', (req, res) => {
    const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(req.params.id));
    const into = db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(req.body?.into));
    if (!cat) return res.status(404).json({ error: 'That category is gone.' });
    if (!into || into.id === cat.id || into.kind !== 'expense') return res.status(400).json({ error: 'Choose the category to merge it into.' });
    const why = needed(cat);
    if (why) return res.status(400).json({ error: why });
    db.exec('BEGIN');
    try {
      const moved = db.prepare('UPDATE transactions SET category_id = ? WHERE category_id = ?').run(into.id, cat.id).changes;
      // A purchase that is left out, or on an account left out of the budget, remembers the category it had.
      for (const col of ['left_out', 'acct_out']) if (has('transactions', col)) db.prepare(`UPDATE transactions SET ${col} = ? WHERE ${col} = ?`).run(into.id, cat.id);
      db.prepare('UPDATE recurrings SET category_id = ? WHERE category_id = ?').run(into.id, cat.id);
      db.prepare('UPDATE rules SET category_id = ? WHERE category_id = ?').run(into.id, cat.id);
      for (const t of ['budget_months', 'zero_assign']) { try { db.prepare(`DELETE FROM ${t} WHERE category_id = ?`).run(cat.id); } catch { /* that table isn't in this copy yet */ } }
      db.prepare('DELETE FROM categories WHERE id = ?').run(cat.id);
      forgetPlans(cat.id);
      db.exec('COMMIT');
      res.json({ ok: true, moved, to: into.name });
    } catch (e) {
      db.exec('ROLLBACK');
      res.status(500).json({ error: `Those couldn't be merged: ${e.message}` });
    }
  });

  // ---- the household's own groups ----
  const clean = (v) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  app.get('/api/category-groups', (_req, res) => res.json(groups()));
  app.post('/api/category-groups', (req, res) => {
    const name = clean(req.body?.name);
    if (!name) return res.status(400).json({ error: 'Give the group a name.' });
    if (db.prepare('SELECT 1 FROM cat_groups WHERE lower(name) = lower(?)').get(name)) return res.status(400).json({ error: `You already have a group called ${name}.` });
    if (groups().length >= 20) return res.status(400).json({ error: 'That is as many groups as Ledger keeps.' });
    const last = db.prepare('SELECT MAX(sort) m FROM cat_groups').get().m ?? 0;
    res.json({ id: Number(db.prepare('INSERT INTO cat_groups (name, sort) VALUES (?, ?)').run(name, last + 1).lastInsertRowid), name });
  });
  app.patch('/api/category-groups/:id', (req, res) => {
    const id = Number(req.params.id), name = clean(req.body?.name);
    if (!groupIds().has(id)) return res.status(404).json({ error: 'That group is gone.' });
    if (!name) return res.status(400).json({ error: 'Give the group a name.' });
    if (db.prepare('SELECT 1 FROM cat_groups WHERE lower(name) = lower(?) AND id != ?').get(name, id)) return res.status(400).json({ error: `You already have a group called ${name}.` });
    db.prepare('UPDATE cat_groups SET name = ? WHERE id = ?').run(name, id);
    res.json({ ok: true });
  });
  // Removing a group removes only the heading: its categories go back under flexible or fixed.
  app.delete('/api/category-groups/:id', (req, res) => {
    const id = Number(req.params.id);
    db.prepare('UPDATE categories SET group_id = NULL WHERE group_id = ?').run(id);
    db.prepare('DELETE FROM cat_groups WHERE id = ?').run(id);
    res.json({ ok: true });
  });
  app.post('/api/category-groups/:id/move', (req, res) => {
    const dir = dirOf(req.body);
    if (!dir) return res.status(400).json({ error: 'Say which way to move it.' });
    send(res, step(db.prepare('SELECT id FROM cat_groups ORDER BY sort, id').all(), Number(req.params.id), dir, () => true, 'cat_groups'));
  });

  // ---- accounts: one place up or down among accounts of the same kind ----
  app.post('/api/accounts/:id/move', (req, res) => {
    const dir = dirOf(req.body);
    if (!dir) return res.status(400).json({ error: 'Say which way to move it.' });
    const all = db.prepare('SELECT id, type FROM accounts ORDER BY COALESCE(sort, id), id').all();
    send(res, step(all, Number(req.params.id), dir, (a, b) => kindOf(a.type) === kindOf(b.type), 'accounts'));
  });
}
