// First-run setup for a new household's copy (the screens are src/pages/Setup.tsx).
//
// A copy made for another household is started with LEDGER_SETUP_CODE set (see server/auth.js and
// "Making Ledger shareable" in CLAUDE.md). It begins with the starter categories and no sample
// data, the first visitor sets the password using the code, and then the setup screens walk them
// through their household, accounts, paydays, side gig and budgets. Setting `setup_done` is '0'
// until they finish or skip; every other database has it at '1' and never sees the screens unless
// someone opens "#setup" from Settings.
import { setStart } from './tap.js';
import Anthropic from '@anthropic-ai/sdk';
import { db, iso, getSetting, setSetting } from './db.js';
import { connected } from './simplefin.js';
import { usualDeposit } from './cashflow.js';
import { apiKey, model, readableError } from './recap.js';
import { noteUsage, aiSource, privateCats, homeState } from './ai.js';

// ---- What the household does for work --------------------------------------------------------
// The setup guide asks what each person does for work. That decides whether the classroom-expense
// claims are switched on (setting `educators`), and Claude lists tax breaks worth asking about
// for those jobs. The list is a prompt for a conversation with a tax preparer, not advice, and
// the page says so.
const WORK_TOOL = {
  name: 'record_work',
  description: 'Record what follows from the jobs described.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      educator_you: { type: 'boolean', description: 'True if the first person is a K-12 teacher, instructor, counselor, principal or classroom aide in a school (the federal "eligible educator")' },
      educator_spouse: { type: 'boolean', description: 'The same, for the spouse; false if there is no spouse' },
      retired: { type: 'boolean', description: 'True if either adult says they are retired or living on Social Security, a pension or retirement savings' },
      self_employed: { type: 'boolean', description: 'True if either job sounds like self-employment, contract or gig work with no tax withheld' },
      ideas: {
        type: 'array',
        description: 'Two to five tax deductions or credits that people in these jobs often qualify for and should ask about. Federal and the state the household lives in only. Empty only when no job was described.',
        items: {
          type: 'object',
          properties: { title: { type: 'string', description: 'A few words' }, detail: { type: 'string', description: 'One or two plain sentences: what it is and what to keep or ask' } },
          required: ['title', 'detail'], additionalProperties: false,
        },
      },
    },
    required: ['educator_you', 'educator_spouse', 'retired', 'self_employed', 'ideas'],
    additionalProperties: false,
  },
};
const WORK_SYSTEM = `You help set up a household budgeting app for a family in {WHERE}. Given what each adult does for work, record whether each is a K-12 educator, whether there is self-employment, and up to five tax deductions or credits worth asking a tax preparer about for those jobs (federal and Arkansas). Whenever at least one job is described, give between two and five ideas: this list is the main thing the household gets from answering. Be specific to the jobs given and plain in wording. For example, a K-12 teacher would see the federal educator expense deduction and Arkansas's teacher classroom deduction; someone self-employed would see business expenses, the self-employment health insurance deduction, the home office deduction, mileage, and quarterly estimated payments; many employees would see retirement contributions, an HSA if they have a high-deductible health plan, and the dependent care account; someone retired would see how Social Security is taxed, Arkansas's treatment of Social Security and retirement income, the larger deductions for people 65 and over, required withdrawals from retirement accounts, and giving to charity straight from an IRA. Someone who does several side jobs is self-employed. Only include things that exist in current law. Do not quote dollar limits, percentages or other figures: they change from year to year and yours may be out of date. Word each one as something to ask about or keep records for, and never state that the household qualifies. Leave out things almost everyone gets, such as the standard deduction. If a job description is blank or unclear, make no assumptions about that person.`;
const looksLikeTeacher = (t) => /teach|educator|school counsel|principal|paraprofessional|classroom aide|instructional/i.test(t) && !/college|university|professor|preschool|daycare/i.test(t);

async function sortOutWork(you, spouse, joint) {
  const fallback = { educators: (looksLikeTeacher(you) ? 1 : 0) + (joint && looksLikeTeacher(spouse) ? 1 : 0), ideas: [], selfEmployed: /self.?employ|freelanc|contractor|1099|gig|own business|side job|odd job/i.test(`${you} ${spouse}`), retired: /retire|social security|pension/i.test(`${you} ${spouse}`), byAi: false };
  if (!apiKey() || (!you && !spouse)) return fallback;
  const source = aiSource();
  try {
    const client = new Anthropic({ apiKey: apiKey(), timeout: 60_000, maxRetries: 1 });
    const response = await client.messages.create({
      model: model(), max_tokens: 2000, system: WORK_SYSTEM.replace('{WHERE}', homeState()), tools: [WORK_TOOL],
      messages: [{ role: 'user', content: `First person's work: ${you || '(not given)'}\n${joint ? `Spouse's work: ${spouse || '(not given)'}` : 'There is no spouse on the tax return.'}\nRecord what follows from this.` }],
    });
    noteUsage('work', response, source, "what you typed about each adult's work");
    const call = response.content.find((b) => b.type === 'tool_use' && b.name === WORK_TOOL.name);
    if (!call) return fallback;
    const r = call.input;
    return {
      educators: (r.educator_you ? 1 : 0) + (joint && r.educator_spouse ? 1 : 0), selfEmployed: !!r.self_employed, retired: !!r.retired, byAi: true,
      ideas: (Array.isArray(r.ideas) ? r.ideas : []).slice(0, 5).map((i) => ({ title: String(i.title || '').slice(0, 80), detail: String(i.detail || '').slice(0, 400) })).filter((i) => i.title),
    };
  } catch (e) {
    console.warn('Work questions:', readableError(e).message);
    return fallback;
  }
}

// ---- Budget suggestions ------------------------------------------------------------------------
// From what the household really spends where the app has at least one full month of purchases
// (a bank connection brings about three), and from take-home pay otherwise. Claude sets the
// amounts when the AI features are on; without them the amounts come from simple arithmetic.
const BUDGET_TOOL = {
  name: 'record_budgets',
  description: 'Record a monthly budget for every category given.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      budgets: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'integer' }, amount: { type: 'number', description: 'Dollars a month, a round number' }, why: { type: 'string', description: 'A few words on the reason' } },
          required: ['id', 'amount', 'why'], additionalProperties: false,
        },
      },
      note: { type: 'string', description: 'One or two sentences on the plan as a whole, including what is left over or short each month' },
    },
    required: ['budgets', 'note'],
    additionalProperties: false,
  },
};
const BUDGET_SYSTEM = `You set a starting monthly budget for a household in a budgeting app. You're given their monthly take-home pay (when known), the household's size, and each spending category with its current starter amount and, where the app has seen their purchases, what they have really spent per month. Give every category an amount. Where real spending is known, base the amount on it: match fixed bills (housing, utilities, insurance, subscriptions, loan payments) to what they actually cost, and for flexible categories set a figure near what they spend, trimmed a little only if the total would exceed take-home pay. Where spending isn't known, spread take-home pay sensibly for a household of that size. Keep the total at or under take-home pay when it is known, leaving some room for savings if that is realistic. Use round numbers. Be plain; do not lecture.`;

const round = (n) => Math.round(n * 100) / 100;
/** About how many times a month a paycheck comes, from its rule. */
function perMonth(rule) {
  const [type, spec] = String(rule).split(':');
  if (type === 'weekly') return 52 / 12;
  if (type === 'every') return 365.25 / Number(spec) / 12;
  if (type === 'monthdays') return spec.split(',').length;
  if (type === 'nthweekday') return 1;
  return 0;
}
/** Monthly take-home pay from the household's paydays, or null when no amount is known. */
function takeHome() {
  let total = 0, known = false;
  for (const s of db.prepare('SELECT * FROM pay_schedules').all()) {
    let amount = s.amount_mode === 'fixed' ? s.amount : null;
    if (amount == null && s.merchant_like) {
      const recent = db.prepare('SELECT amount FROM transactions WHERE merchant LIKE ? AND amount > 0 ORDER BY date DESC LIMIT 8').all(s.merchant_like);
      if (recent.length) amount = s.amount_mode === 'average' ? recent.reduce((a, r) => a + r.amount, 0) / recent.length : usualDeposit(recent);
    }
    if (amount > 0) { total += amount * perMonth(s.rule); known = true; }
  }
  return known ? round(total) : null;
}

const USUAL_SHARES = { Groceries: 600, 'Dining out': 250, 'Gas and car': 200, Shopping: 300, Entertainment: 120, Health: 100, Travel: 200, Rent: 1650, Housing: 1650, Pets: 60, 'Bills and utilities': 225, Subscriptions: 76, Insurance: 118, Other: 50 };

async function suggestBudgets() {
  const cats = db.prepare("SELECT id, name, COALESCE(key, name) known, icon, budget, fixed FROM categories WHERE kind = 'expense' AND hidden = 0 ORDER BY sort").all();
  // The last three full months that have purchases in them.
  const thisMonth = iso(new Date()).slice(0, 7);
  const months = db.prepare(`SELECT substr(t.date, 1, 7) m, COUNT(*) n FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE c.kind = 'expense' AND t.amount < 0 AND substr(t.date, 1, 7) < ? GROUP BY m HAVING n >= 10 ORDER BY m DESC LIMIT 3`).all(thisMonth).map((r) => r.m);
  const spent = new Map();
  if (months.length) {
    for (const r of db.prepare(`SELECT category_id id, -SUM(amount) total FROM transactions WHERE amount < 0 AND substr(date, 1, 7) IN (${months.map(() => '?').join(',')}) GROUP BY category_id`).all(...months)) spent.set(r.id, round(r.total / months.length));
  }
  const pay = takeHome();
  const basis = months.length ? 'spending' : pay ? 'pay' : 'starter';
  const nice = (n) => (n <= 0 ? 0 : n < 100 ? Math.ceil(n / 5) * 5 : Math.ceil(n / 25) * 25);
  // Arithmetic first; Claude improves on it when it can.
  // How take-home pay is usually shared between the starter categories. These are proportions only: a copy
  // that starts empty has no budgets of its own to take them from (since 2026-11-24), and a category the
  // household made itself gets a share only if it already has a budget.
  const share = (c) => USUAL_SHARES[c.known] ?? c.budget ?? 0;
  const starterTotal = cats.reduce((a, c) => a + share(c), 0) || 1;
  let out = cats.map((c) => ({
    id: c.id, name: c.name, icon: c.icon, current: c.budget, spent: spent.has(c.id) ? spent.get(c.id) : null,
    suggested: basis === 'spending' ? nice(spent.get(c.id) || 0) : basis === 'pay' ? nice((share(c) / starterTotal) * pay * 0.9) : c.budget,
    why: basis === 'spending' ? (spent.has(c.id) ? `you spend about $${Math.round(spent.get(c.id))} a month` : 'nothing spent here yet') : basis === 'pay' ? 'a usual share of your take-home pay' : 'unchanged',
  }));
  let note = basis === 'spending' ? `Based on your spending over ${months.length === 1 ? 'the last full month' : `the last ${months.length} full months`}.`
    : basis === 'pay' ? 'Based on your take-home pay, since Ledger has not seen a full month of your spending yet.'
      : 'Ledger has nothing to go on yet, so it has left your amounts as they are. Add your paydays, or connect your bank and let a month of spending come in, then ask again. Until then, type the amounts yourself below.';
  let byAi = false;
  if (apiKey() && basis !== 'starter') {
    const source = aiSource();
    try {
      const client = new Anthropic({ apiKey: apiKey(), timeout: 90_000, maxRetries: 1 });
      const response = await client.messages.create({
        model: model(), max_tokens: 4000, system: BUDGET_SYSTEM, tools: [BUDGET_TOOL],
        messages: [{ role: 'user', content: JSON.stringify({
          monthly_take_home_pay: pay, months_of_spending_seen: months.length,
          household: { filing: getSetting('filing_status', 'joint'), adults: ['joint', 'separate'].includes(getSetting('filing_status', 'joint')) ? 2 : 1, children_under_17: Number(getSetting('kids', '0')) || 0 },
          categories: out.filter((c) => !privateCats().includes(c.id)).map((c) => ({ id: c.id, name: c.name, fixed_bill: !!cats.find((x) => x.id === c.id).fixed, starter_amount: c.current, spent_per_month: c.spent })),
        }) }],
      });
      noteUsage('budgets', response, source, 'your category names, average monthly spending in each, and take-home pay');
      const call = response.content.find((b) => b.type === 'tool_use' && b.name === BUDGET_TOOL.name);
      const got = new Map((call?.input?.budgets || []).map((b) => [b.id, b]));
      if (got.size) {
        out = out.map((c) => { const g = got.get(c.id); return g && Number.isFinite(g.amount) && g.amount >= 0 ? { ...c, suggested: Math.round(g.amount), why: String(g.why || c.why).slice(0, 120) } : c; });
        note = `${note} ${String(call.input.note || '').slice(0, 400)}`.trim();
        byAi = true;
      }
    } catch (e) {
      console.warn('Budget suggestions:', readableError(e).message);
    }
  }
  return { basis, takeHome: pay, months: months.length, byAi, note, budgets: out, total: out.reduce((a, c) => a + c.suggested, 0) };
}

// 'property' (2026-11-27): a home, a vehicle or anything else owned, kept as a value typed by hand so net
// worth counts what a mortgage or car loan paid for. Nothing is ever bought or paid "on" it.
const HAND_TYPES = ['checking', 'savings', 'credit', 'investment', 'hsa', 'property'];

export function installSetup(app) {
  // Where things stand, so the screens can show what's already been done.
  app.get('/api/setup', (_req, res) => {
    res.json({
      done: getSetting('setup_done', '1') !== '0',
      bankConnected: connected(),
      accounts: db.prepare("SELECT id, name, type, balance, manual, dep_rate FROM accounts WHERE type NOT IN ('cash') ORDER BY id").all(),
      paydays: db.prepare('SELECT COUNT(*) n FROM pay_schedules').get().n,
      budgets: db.prepare("SELECT id, name, icon, budget, fixed FROM categories WHERE kind = 'expense' AND hidden = 0 ORDER BY sort").all(),
    });
  });

  // An account kept by hand, for a household with no bank connection (or a bank the feed can't reach).
  app.post('/api/setup/account', (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 80);
    const type = String(req.body?.type || '');
    const balance = Number(req.body?.balance);
    if (!name) return res.status(400).json({ error: 'Give the account a name, such as Checking.' });
    if (!HAND_TYPES.includes(type)) return res.status(400).json({ error: 'Choose what kind of account it is.' });
    if (!Number.isFinite(balance) || balance < 0) return res.status(400).json({ error: type === 'credit' ? 'Enter what you owe on it today, or 0.' : type === 'property' ? "Enter what it's worth today." : "Enter what's in it today, or 0." });
    // What's owed on a card is kept as a negative balance, like every other debt.
    const signed = type === 'credit' ? -balance : balance;
    const id = Number(db.prepare("INSERT INTO accounts (name, institution, type, balance, manual) VALUES (?, 'Added by you', ?, ?, 1)").run(name, type, signed).lastInsertRowid);
    setStart(id, signed);   // from here its balance follows what is entered on it
    // Something owned was owned yesterday too: carry its value back through the net worth history, so the
    // chart doesn't show the household becoming richer overnight (the same is done for a debt added by hand).
    if (type === 'property') {
      const ins = db.prepare('INSERT OR IGNORE INTO balance_history (account_id, date, balance) VALUES (?,?,?)');
      for (const { date } of db.prepare('SELECT DISTINCT date FROM balance_history').all()) ins.run(id, date, signed);
    }
    res.json({ id });
  });

  // What each adult does for work: saved, and sorted out into what it switches on.
  app.get('/api/setup/work', (_req, res) => {
    let ideas = [];
    try { ideas = JSON.parse(getSetting('work_ideas') || '[]'); } catch { /* none kept */ }
    res.json({ you: getSetting('work_you'), spouse: getSetting('work_spouse'), ideas, educators: Number(getSetting('educators', '0')) || 0 });
  });
  app.post('/api/setup/work', async (req, res) => {
    const joint = ['joint', 'separate'].includes(getSetting('filing_status', 'joint'));
    const you = String(req.body?.you || '').trim().slice(0, 120), spouse = joint ? String(req.body?.spouse || '').trim().slice(0, 120) : '';
    setSetting('work_you', you); setSetting('work_spouse', spouse);
    const r = await sortOutWork(you, spouse, joint);
    setSetting('educators', r.educators);
    setSetting('retired', r.retired ? '1' : '0');
    setSetting('work_ideas', JSON.stringify(r.ideas));
    res.json({ you, spouse, ...r });
  });

  // Suggested budgets, for checking; and saving the ones the household keeps.
  app.post('/api/setup/budgets/suggest', async (_req, res) => res.json(await suggestBudgets()));
  app.post('/api/setup/budgets/apply', (req, res) => {
    const rows = Array.isArray(req.body?.budgets) ? req.body.budgets : [];
    const set = db.prepare("UPDATE categories SET budget = ? WHERE id = ? AND kind = 'expense'");
    let n = 0;
    for (const r of rows) if (Number.isFinite(Number(r?.amount)) && Number(r.amount) >= 0) n += set.run(Math.round(Number(r.amount) * 100) / 100, Number(r.id)).changes;
    res.json({ saved: n });
  });

  app.post('/api/setup/done', (_req, res) => { setSetting('setup_done', '1'); res.json({ ok: true }); });
}
