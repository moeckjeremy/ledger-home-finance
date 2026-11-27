// Suggested categories for purchases left in "Other" (The owner, 2026-11-23: the gap against the big budget
// apps he picked first; 137 of 469 imported card purchases had landed in Other that day).
//
// Ledger files a purchase from a keyword list and the household's own rules; whatever those miss goes to
// Other. Here Claude is shown the merchant names sitting in Other (names only: no amounts, dates or
// accounts) and the household's own category names, and says which category each most likely belongs in,
// or "Other" when it can't tell. Nothing moves until the person ticks and presses File: each yes refiles
// that merchant's purchases that are still in Other and, when "remember" is on, writes a rule so the next
// one files itself. Payments to people and bank wording are never sent.
import Anthropic from '@anthropic-ai/sdk';
import { db } from './db.js';
import { apiKey, model, readableError } from './recap.js';
import { viaHa, haAskJson } from './haai.js';
import { noteUsage, aiSource, limitMessage, privateCats, homeState } from './ai.js';

const MAX = 120;
const PERSONAL = /venmo|cash ?app|zelle|you paid|paid you|transfer|xfer|\batm\b|withdraw|deposit|payroll|check #|^check\b|interest (charge|paid)|payment thank you|^unknown$/i;
const NOT_SPLIT = 't.split_of IS NULL AND t.left_out IS NULL AND t.id NOT IN (SELECT split_of FROM transactions WHERE split_of IS NOT NULL)';
const round = (n) => Math.round(n * 100) / 100;

const otherId = () => db.prepare("SELECT id FROM categories WHERE COALESCE(key, name) = 'Other'").get()?.id;
const choices = () => db.prepare("SELECT id, name FROM categories WHERE kind = 'expense' AND hidden = 0 AND COALESCE(key, name) != 'Other' ORDER BY sort, name").all();

/** Merchants with purchases still in Other, biggest total first. */
function inOther() {
  const other = otherId();
  if (!other || privateCats().includes(other)) return [];
  return db.prepare(`SELECT t.merchant, COUNT(*) n, ROUND(-SUM(t.amount), 2) total, MAX(t.date) last FROM transactions t
    WHERE t.category_id = ? AND t.amount < 0 AND t.merchant != '' AND t.waiting = 0 AND ${NOT_SPLIT}
    GROUP BY t.merchant ORDER BY total DESC`).all(other).filter((m) => !PERSONAL.test(m.merchant));
}

const tool = (names) => ({
  name: 'record_categories',
  description: 'Record the most likely category for each merchant, in the order given.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      merchants: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            number: { type: 'integer', description: 'The number of the merchant in the list' },
            category: { type: 'string', enum: [...names, 'Other'], description: 'One of the household\'s categories, or Other when unsure' },
          },
          required: ['number', 'category'],
          additionalProperties: false,
        },
      },
    },
    required: ['merchants'],
    additionalProperties: false,
  },
});

const SYSTEM = `You sort purchases into a household's budget categories from the short descriptions banks print on statements. The household is in {WHERE}.

Descriptions are often abbreviated, run together, or carry a store number, city or words like "SQ *", "TST*", "SP " and "PY *" (those prefixes mean a payment processor: read past them to the shop's name). Decide what kind of business each one is and choose the one category from the list that a typical purchase there belongs in.

Choose Other when you do not recognise the business, when the description is a person's name or a generic word, or when the business sells such different things that no single category fits. A wrong category is worse than Other, so do not guess. Use only the category names you are given, spelled exactly.`;

export function installCatSuggest(app) {
  app.get('/api/categories/suggest', (_req, res) => {
    const rows = inOther();
    res.json({
      merchants: rows.length, purchases: rows.reduce((a, r) => a + r.n, 0), total: round(rows.reduce((a, r) => a + r.total, 0)),
      canAsk: !!apiKey() || viaHa(), why: apiKey() || viaHa() ? '' : (limitMessage() || 'Suggesting categories needs the AI features switched on in Settings.'),
    });
  });

  // The purchases themselves, shop by shop, for someone who would rather look and file them by hand
  // (the owner, 2026-11-27: there was "no clear way to access these particular purchases").
  app.get('/api/categories/other', (_req, res) => {
    const other = otherId();
    if (!other) return res.json({ shops: [] });
    const rows = db.prepare(`SELECT t.id, t.date, t.amount, t.merchant, a.name account FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id
      WHERE t.category_id = ? AND t.amount < 0 AND t.merchant != '' AND t.waiting = 0 AND ${NOT_SPLIT} ORDER BY t.date DESC, t.id DESC`).all(other);
    const by = new Map();
    for (const r of rows) {
      if (!by.has(r.merchant)) by.set(r.merchant, { merchant: r.merchant, count: 0, total: 0, last: r.date, purchases: [] });
      const g = by.get(r.merchant); g.count++; g.total += -r.amount;
      if (g.purchases.length < 40) g.purchases.push({ id: r.id, date: r.date, amount: -r.amount, account: r.account || '' });
    }
    res.json({ shops: [...by.values()].map((g) => ({ ...g, total: Math.round(g.total * 100) / 100 })).sort((a, b) => b.total - a.total) });
  });

  app.post('/api/categories/suggest', async (_req, res) => {
    if (!apiKey() && !viaHa()) return res.status(400).json({ error: limitMessage() || 'Suggesting categories needs the AI features switched on in Settings.' });
    const rows = inOther().slice(0, MAX);
    if (!rows.length) return res.json({ suggestions: [], asked: 0, unsure: 0 });
    const cats = choices();
    if (!cats.length) return res.status(400).json({ error: 'There are no spending categories to choose from yet.' });
    // Through Home Assistant's own AI: the same question, asked for as plain JSON, since nothing there
    // promises the strict form Claude's service does. Anything that doesn't fit is dropped as "unsure".
    if (viaHa()) {
      let list;
      try {
        list = await haAskJson('categories for shops', `${SYSTEM.replace('{WHERE}', homeState())}\n\nThe household's categories: ${cats.map((c) => c.name).join(', ')}.\n\nFor each of these ${rows.length} merchants give a category, as a JSON list of objects like {"number": 1, "category": "Groceries"}. Use a category name exactly as given, or "Other" when unsure.\n\n${rows.map((r, i) => `${i + 1}. ${r.merchant}`).join('\n')}`,
          'categories', `${rows.length} shop names from Other, and the names of your categories`);
      } catch (e) { return res.status(502).json({ error: e.message }); }
      const items = Array.isArray(list) ? list : Array.isArray(list?.merchants) ? list.merchants : [];
      const ids = new Map(cats.map((c) => [c.name.toLowerCase(), c]));
      const out = [], had = new Set();
      for (const m of items) {
        const row = rows[Number(m?.number) - 1], c = ids.get(String(m?.category || '').toLowerCase());
        if (!row || !c || had.has(row.merchant)) continue;
        had.add(row.merchant);
        out.push({ merchant: row.merchant, count: row.n, total: row.total, last: row.last, category_id: c.id, category: c.name });
      }
      return res.json({ suggestions: out, asked: rows.length, unsure: rows.length - out.length });
    }
    const client = new Anthropic({ apiKey: apiKey(), timeout: 120_000, maxRetries: 1 });
    const source = aiSource();
    const t = tool(cats.map((c) => c.name));
    let response;
    try {
      response = await client.messages.create({
        model: model(), max_tokens: 8000, system: SYSTEM.replace('{WHERE}', homeState()), tools: [t],
        messages: [{ role: 'user', content: `The household's categories: ${cats.map((c) => c.name).join(', ')}.\n\nRecord a category for each of these ${rows.length} merchants with the record_categories tool.\n\n${rows.map((r, i) => `${i + 1}. ${r.merchant}`).join('\n')}` }],
      });
    } catch (e) {
      return res.status(502).json({ error: readableError(e).message });
    }
    noteUsage('categories', response, source, `${rows.length} shop names from Other, and the names of your categories`);
    const call = response.content.find((b) => b.type === 'tool_use' && b.name === t.name);
    if (!call || !Array.isArray(call.input?.merchants)) return res.status(502).json({ error: "Claude didn't return a list of categories. Try again." });
    const byName = new Map(cats.map((c) => [c.name, c.id]));
    const suggestions = [];
    const seen = new Set();
    for (const m of call.input.merchants) {
      const row = rows[Number(m.number) - 1];
      const id = byName.get(String(m.category));
      if (!row || !id || seen.has(row.merchant)) continue;
      seen.add(row.merchant);
      suggestions.push({ merchant: row.merchant, count: row.n, total: row.total, last: row.last, category_id: id, category: m.category });
    }
    res.json({ suggestions, asked: rows.length, unsure: rows.length - suggestions.length });
  });

  app.post('/api/categories/suggest/apply', (req, res) => {
    const other = otherId();
    const valid = new Set(choices().map((c) => c.id));
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 300) : [];
    const remember = req.body?.remember !== false;
    if (!other || !items.length) return res.status(400).json({ error: 'Tick at least one to file.' });
    const move = db.prepare(`UPDATE transactions SET category_id = ? WHERE id IN (SELECT t.id FROM transactions t WHERE t.merchant = ? AND t.category_id = ? AND t.amount < 0 AND t.waiting = 0 AND ${NOT_SPLIT})`);
    const rule = db.prepare('INSERT INTO rules (merchant, category_id) VALUES (?, ?) ON CONFLICT(merchant) DO UPDATE SET category_id = excluded.category_id');
    let moved = 0, rules = 0;
    db.exec('BEGIN');
    try {
      for (const it of items) {
        const merchant = String(it?.merchant || ''), id = Number(it?.category_id);
        if (!merchant || !valid.has(id)) continue;
        moved += Number(move.run(id, merchant, other).changes);
        if (remember) { rule.run(merchant, id); rules++; }
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      return res.status(500).json({ error: 'Those could not be filed. Nothing was changed.' });
    }
    res.json({ moved, rules });
  });
}
