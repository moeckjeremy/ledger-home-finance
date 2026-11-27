// Hiding names from the AI (2026-11-27, the owner's go-ahead after looking at another app that does it).
// Off until a household switches it on (setting `ai_hide_names`). On, the figures that go to the recap and
// to Ask your CFO have the household's own names swapped for plain labels before they leave ("Adult 1",
// "Employer 1", "Checking account 2", "Bank 1"), and the labels are swapped back in the answer before it is
// shown, so the person reads their own names and the AI never saw them.
//
// What is swapped: the two adults' first names, each payday's name and the words that mark its deposits
// (employers), side gigs' names and their deposit words, every account's name and the bank's own name for
// it, and each bank or lender. What is NOT: shops, bills, categories, savings goals, amounts and dates (the
// AI needs the amounts to answer at all). A photo of a receipt, a statement or a pay stub goes whole, and
// the logo and category helpers send shop names: none of those are covered, and Settings says so.
//
// It is a word swap, not a guarantee: a name typed some other way in a note or a question is not caught.
import { db, getSetting, setSetting } from './db.js';

export const hideNames = () => getSetting('ai_hide_names') === '1';

const KINDS = { checking: 'Checking account', savings: 'Savings account', credit: 'Credit card', mortgage: 'Mortgage', auto: 'Car loan', loan: 'Loan', investment: 'Investment account', hsa: 'Health savings account', insurance: 'Insurance policy', cash: 'Cash account' };
// The app's own wording for an account nobody's bank reported: nothing to hide.
const OURS = new Set(['added by you', 'kept by hand', 'cash']);

/** Pairs of [real name, label], in the order found: the name the household sees comes before other wordings of it. */
function listed() {
  const out = [];
  const seen = new Set();
  const add = (real, label) => {
    const r = String(real || '').trim();
    if (r.length < 3 || OURS.has(r.toLowerCase()) || seen.has(r.toLowerCase())) return;
    seen.add(r.toLowerCase()); out.push([r, label]);
  };
  add(getSetting('mail_your_name'), 'Adult 1');
  add(getSetting('spouse_name'), 'Adult 2');
  try {
    db.prepare('SELECT id, name, merchant_like FROM pay_schedules ORDER BY id').all().forEach((p, i) => {
      add(p.name, `Employer ${i + 1}`);
      String(p.merchant_like || '').split(',').forEach((w) => add(w, `Employer ${i + 1}`));
    });
  } catch { /* no paydays table yet */ }
  if (getSetting('gig_on') === '1') {
    add(getSetting('gig_name'), 'Side gig 1');
    String(getSetting('gig_match') || '').split(',').forEach((w) => add(w, 'Side gig 1'));
    try {
      db.prepare('SELECT name, match FROM extra_gigs ORDER BY id').all().forEach((g, i) => {
        add(g.name, `Side gig ${i + 2}`);
        String(g.match || '').split(',').forEach((w) => add(w, `Side gig ${i + 2}`));
      });
    } catch { /* none */ }
  }
  const accounts = db.prepare('SELECT id, name, bank_name, institution, type FROM accounts ORDER BY id').all();
  const banks = [...new Set(accounts.map((a) => String(a.institution || '').trim()).filter(Boolean))];
  accounts.forEach((a, i) => {
    const label = `${KINDS[a.type] || 'Account'} ${i + 1}`;
    add(a.name, label); add(a.bank_name, label);
  });
  banks.forEach((b, i) => add(b, `Bank ${i + 1}`));
  return out;
}
const pairs = () => listed();

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Every swap is made in ONE pass over the text, longest first, so a label just written ("Savings account 5")
// can never be matched again by another name (an account called "Savings").
const oneOf = (words) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map(esc).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
function swap(text, table) {
  const keys = [...table.keys()].sort((x, y) => y.length - x.length);
  if (!keys.length) return text;
  return text.replace(oneOf(keys), (hit) => table.get(hit.toLowerCase()) ?? hit);
}

/** Text on its way out: names become labels. Unchanged while the switch is off. */
export function mask(text) {
  if (!hideNames() || typeof text !== 'string' || !text) return text;
  return swap(text, new Map(pairs().map(([real, label]) => [real.toLowerCase(), label])));
}

/** Text on its way back: labels become the household's own names again. */
export function unmask(text) {
  if (!hideNames() || typeof text !== 'string' || !text) return text;
  // One real name per label: the first listed, which is the name the household sees (a person's or a
  // payday's name before its deposit words, an account's own name before the bank's wording for it).
  const back = new Map();
  for (const [real, label] of listed()) if (!back.has(label.toLowerCase())) back.set(label.toLowerCase(), real);
  return swap(text, back);
}

/** What the AI asks a lookup for, turned back into real names so the lookup finds them. */
export function unmaskInput(input) {
  if (!hideNames() || input == null) return input;
  try { return JSON.parse(unmask(JSON.stringify(input))); } catch { return input; }
}

export function installHideNames(app) {
  const view = () => {
    const on = hideNames();
    // Shown whether or not it is on, so the household can see what would be swapped before choosing.
    const list = pairs();
    const labels = new Map();
    for (const [real, label] of list) labels.set(label, [...(labels.get(label) || []), real]);
    return { on, swaps: [...labels].map(([label, names]) => ({ label, names })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })) };
  };
  app.get('/api/ai/names', (_req, res) => res.json(view()));
  app.put('/api/ai/names', (req, res) => {
    setSetting('ai_hide_names', req.body?.on ? '1' : '0');
    res.json(view());
  });
}
