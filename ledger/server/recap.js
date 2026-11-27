// The dashboard recap: a short written summary of where the month stands.
//
// Two ways to produce it from the same set of facts:
//   - an automatic version assembled from fixed sentences (always available, free)
//   - a version written by Claude, when an Anthropic API key has been added
//
// The Claude version sends the facts below (category totals, bills, debt and tax
// figures, a few merchant names) to Anthropic's API. Nothing else leaves the app.
import { whole, currency, currencyNote } from './money.js';
import Anthropic from '@anthropic-ai/sdk';
import { db, iso, getSetting, setSetting } from './db.js';
import { outlook } from './cashflow.js';
import { status as vipkidStatus } from './vipkid.js';
import { gig } from './gig.js';
import { viaHa, haAsk, aiName } from './haai.js';
import { hideNames, mask, unmask } from './hidenames.js';
import { activeKey, familyCopy, forcedModel, noteUsage, aiSource, limitMessage, notPrivate, privateCats } from './ai.js';

const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'best writing, roughly 3 to 5 cents per recap' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'roughly 2 cents per recap' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'a fraction of a cent per recap' },
];
const DEFAULT_MODEL = 'claude-opus-5-5';
// With the host's included key the host's model applies; with your own key, the one you chose.
export const model = () => forcedModel() || (MODELS.some((m) => m.id === getSetting('recap_model')) ? getSetting('recap_model') : DEFAULT_MODEL);
/** The key in use: your own, else the included one while this month's allowance lasts. See server/ai.js. */
export const apiKey = () => activeKey();

const money = (n) => whole(Math.abs(n));
const monthName = (ym) => new Date(`${ym}-15T12:00:00`).toLocaleDateString('en-US', { month: 'long' });
const shortDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const monthsAhead = (n) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + n); return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); };

const NEEDS_REVIEW = "(c.name = 'Other' OR (c.kind = 'transfer' AND (t.merchant LIKE '%Venmo%' OR t.merchant LIKE '%Cash App%')))";
function reviewCount(start, end) {
  return db.prepare(`
    SELECT COUNT(*) n, COALESCE(SUM(ABS(t.amount)), 0) total FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE ${NEEDS_REVIEW} AND t.date >= ? AND t.date < ?`).get(start, end);
}
function reviewFor(month) {
  const ym = /^\d{4}-\d{2}$/.test(month || '') ? month : iso(new Date()).slice(0, 7);
  const r = reviewCount(`${ym}-01`, iso(new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)), 1)));
  return { count: r.n, total: Math.round(r.total) };
}

/** The figures both versions of the recap are written from. */
export function buildFacts(month, { summaryFor, debtPlan, taxEstimate }) {
  const s = summaryFor(month);
  const today = iso(new Date());
  const start = `${s.month}-01`;
  const end = iso(new Date(Number(s.month.slice(0, 4)), Number(s.month.slice(5)), 1));
  const horizon = iso(new Date(Date.now() + 10 * 86400000));
  const largest = db.prepare(`
    SELECT t.merchant, -t.amount amount, t.date, c.name category FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE c.kind = 'expense' AND t.amount < 0 AND t.date >= ? AND t.date < ?${notPrivate()} ORDER BY t.amount LIMIT 5`).all(start, end);
  // Categories the household keeps away from Claude: their names, purchases and bills are left out; the month's totals still include them.
  const hidden = new Set(privateCats());
  const other = reviewCount(start, end);
  const facts = {
    today, month: s.month, month_name: monthName(s.month), is_current_month: s.isCurrent,
    day_of_month: s.lastDay, days_in_month: s.days,
    spent_so_far: s.spent, monthly_budget: s.budget,
    // No budgets yet (a new copy): said in words, so the recap doesn't report "$0 of a $0 budget".
    ...(s.budget > 0 ? {} : { no_budgets_set: 'This household has not set any budgets yet. Do not compare spending with a budget; say once that budgets can be set on the Budgets page.' }),
    expected_spending_by_today: s.isCurrent ? s.paceToday : s.budget,
    income_so_far: s.income,
    last_month: s.cashflow.at(-2) ? { income: s.cashflow.at(-2).income, spending: s.cashflow.at(-2).spending } : null,
    categories: s.categories.filter((c) => !hidden.has(c.id) && (c.spent > 0 || c.budget > 0)).map((c) => ({ name: c.name, spent: c.spent, budget: c.budget, fixed_bill: !!c.fixed })),
    bills_due_next_10_days: s.isCurrent ? s.upcoming.filter((u) => !hidden.has(u.category_id) && u.next <= horizon).map((u) => ({ name: u.name, amount: u.amount, date: u.next, exact: u.known === true || !u.variable })) : [],
    largest_purchases_this_month: largest.map((t) => ({ merchant: t.merchant, amount: Math.round(t.amount * 100) / 100, date: t.date, category: t.category })),
    uncategorized: { count: other.n, total: Math.round(other.total) },
  };
  if (hidden.size) facts.kept_private = `${hidden.size} ${hidden.size === 1 ? 'category is' : 'categories are'} kept from you by the household. The totals include them; their names, purchases and bills are not shown to you.`;
  if (s.isCurrent) {
    const d = debtPlan();
    const order = d.debts.filter((x) => x.status === 'ok' && x.order).sort((a, b) => a.order - b.order);
    // A household with no debts is told so in as many words, with no payoff date and no mention of a
    // mortgage: given "debt free except mortgage: this month" for an empty copy, the recap spoke of a
    // mortgage that didn't exist (found by the NAS session on the add-on, 2026-11-24).
    const owing = d.debts.filter((x) => x.balance > 0);
    const mortgage = owing.some((x) => x.type === 'mortgage');
    facts.debt = !owing.length ? { none: 'This household has no debts recorded in Ledger. Say nothing about debt or payoff dates.' } : {
      total_owed: d.totals.balance, monthly_excess_available: d.excess.amount, typical_monthly_income: d.excess.income,
      next_to_pay_off: order[0] ? { name: order[0].name, balance: order[0].balance, rate: order[0].apr } : null,
      [mortgage ? 'debt_free_except_mortgage' : 'debt_free']: d.totals.debtFreeMonths != null && order.length ? monthsAhead(d.totals.debtFreeMonths) : null,
      debts_missing_details: d.debts.filter((x) => x.status === 'missing').map((x) => x.name),
    };
    // Changes and pressure points that totals alone don't show.
    const monthlyCost = (u) => u.monthly ?? (u.month ? u.amount / 12 : u.amount);
    facts.price_changes = s.upcoming.filter((u) => u.previous && !hidden.has(u.category_id)).map((u) => ({ name: u.name, was: u.previous, now: u.amount }));
    facts.recurring_bills_vs_budget = s.categories.filter((c) => c.fixed && c.budget > 0 && !hidden.has(c.id)).map((c) => {
      const bills = s.upcoming.filter((u) => u.category === c.name);
      return { category: c.name, recurring_per_month: Math.round(bills.reduce((a, u) => a + monthlyCost(u), 0)), budget: c.budget, bills: bills.length };
    }).filter((c) => c.bills > 0);
    const soon = iso(new Date(Date.now() + 45 * 86400000));
    facts.yearly_renewals_next_45_days = s.upcoming.filter((u) => u.month && u.next <= soon && !hidden.has(u.category_id)).map((u) => ({ name: u.name, amount: u.amount, date: u.next }));
    const o = outlook();
    facts.checking_account = {
      balance_today: o.balance, next_payday: o.nextPayday?.date ?? null, balance_before_next_payday_after_bills: o.beforePayday,
      lowest_projected: o.lowest, typical_daily_spending: o.typicalSpendPerDay, balance_before_payday_after_typical_spending: o.afterTypicalSpending,
    };
    const g = gig();
    const v = g.classes ? vipkidStatus() : { totalClasses: 0 };
    if (v.totalClasses > 0) facts.vipkid_class_goal = { target_units: v.goal.target, taught: v.goal.taught, booked_including_taught: v.goal.booked, still_needed: v.goal.remaining, days_left_in_month: v.goal.daysLeft, pay_if_goal_met: v.goal.payAtGoal };
    const t = taxEstimate();
    if (g.on) facts.side_gig = g.name;
    if (g.on) facts.vipkid_tax = { received_this_year: t.ytd, projected_for_year: Math.round(t.vipkidIncome), tax_to_set_aside_for_year: t.extra, set_aside_rate: Math.round(t.setAsideRate * 100) };
  }
  return facts;
}

/** The automatic recap: fixed sentences filled in from the facts. */
function writeFromRules(f) {
  const paras = [], bullets = [];
  const diff = f.expected_spending_by_today - f.spent_so_far;
  // No budgets set yet (a new copy): say what was spent and earned, and where to set them, not "$0 of $0".
  const none = !(f.monthly_budget > 0);
  if (none) {
    paras.push(f.is_current_month ? `You've spent ${money(f.spent_so_far)} so far in ${f.month_name}, and income so far is ${money(f.income_so_far)}.` : `In ${f.month_name} you spent ${money(f.spent_so_far)}. Income was ${money(f.income_so_far)}.`);
    paras.push('No budgets are set yet. Give each kind of spending a monthly amount on the Budgets page, or have Ledger suggest them there, and this summary will say how you are doing against them.');
  } else if (f.is_current_month) {
    paras.push(`You've spent ${money(f.spent_so_far)} of your ${money(f.monthly_budget)} budget so far in ${f.month_name}. That's ${money(diff)} ${diff >= 0 ? 'under' : 'over'} where your budget expects you to be by day ${f.day_of_month}. Income so far this month is ${money(f.income_so_far)}.`);
  } else {
    const d = f.monthly_budget - f.spent_so_far;
    paras.push(`In ${f.month_name} you spent ${money(f.spent_so_far)} against a ${money(f.monthly_budget)} budget, ${money(d)} ${d >= 0 ? 'under' : 'over'}. Income was ${money(f.income_so_far)}.`);
  }
  const flexible = f.categories.filter((c) => !c.fixed_bill && c.budget > 0);
  const over = flexible.filter((c) => c.spent > c.budget).sort((a, b) => b.spent - b.budget - (a.spent - a.budget));
  const close = flexible.filter((c) => c.spent <= c.budget && c.spent >= c.budget * 0.8);
  if (over.length) paras.push(`Already over budget: ${over.slice(0, 3).map((c) => `${c.name} (${money(c.spent)} of ${money(c.budget)})`).join(', ')}.${close.length ? ` Close to the limit: ${close.slice(0, 2).map((c) => c.name).join(' and ')}.` : ''}`);
  else if (close.length) paras.push(`Nothing is over budget yet. Closest to the limit: ${close.slice(0, 3).map((c) => `${c.name} (${money(c.spent)} of ${money(c.budget)})`).join(', ')}.`);
  else if (!none) paras.push('Every category is comfortably inside its budget.');

  if (f.checking_account?.next_payday) {
    const c = f.checking_account;
    bullets.push(`Checking has ${money(c.balance_today)} today and about ${c.balance_before_next_payday_after_bills < 0 ? '-' : ''}${money(c.balance_before_next_payday_after_bills)} left after bills before payday on ${shortDate(c.next_payday)}.`);
  }
  if (f.bills_due_next_10_days.length) {
    const total = f.bills_due_next_10_days.reduce((a, b) => a + b.amount, 0);
    bullets.push(`${f.bills_due_next_10_days.length} bills due in the next 10 days, about ${money(total)}: ${f.bills_due_next_10_days.slice(0, 4).map((b) => `${b.name} ${money(b.amount)} on ${shortDate(b.date)}`).join(', ')}.`);
  }
  if (f.largest_purchases_this_month[0]) {
    const t = f.largest_purchases_this_month[0];
    bullets.push(`Largest purchase this month: ${t.merchant}, ${money(t.amount)} on ${shortDate(t.date)}.`);
  }
  for (const p of (f.price_changes || []).slice(0, 2)) bullets.push(`${p.name} went ${p.now > p.was ? 'up' : 'down'} from ${money(p.was)} to ${money(p.now)}.`);
  for (const c of f.recurring_bills_vs_budget || []) {
    // Only worth a line when the bills themselves no longer fit the budget.
    if (c.recurring_per_month > c.budget * 1.02) bullets.push(`${c.category}: recurring charges alone come to ${money(c.recurring_per_month)}, more than the ${money(c.budget)} budget.`);
  }
  for (const r of (f.yearly_renewals_next_45_days || []).slice(0, 2)) bullets.push(`${r.name} renews for ${money(r.amount)} on ${shortDate(r.date)}.`);
  if (f.uncategorized.count >= 5) bullets.push(`${f.uncategorized.count} transactions (${money(f.uncategorized.total)}) still need a category.`);
  if (f.debt?.next_to_pay_off) {
    bullets.push(f.debt.monthly_excess_available > 0
      ? `Debt: ${money(f.debt.monthly_excess_available)} a month is free to put toward ${f.debt.next_to_pay_off.name} (${money(f.debt.next_to_pay_off.balance)} at ${f.debt.next_to_pay_off.rate}%).`
      : `Debt: your budget leaves nothing extra this month, so ${f.debt.next_to_pay_off.name} (${money(f.debt.next_to_pay_off.balance)}) is on minimum payments.`);
  }
  if (f.vipkid_class_goal) {
    const g = f.vipkid_class_goal;
    bullets.push(g.still_needed > 0
      ? `${gig().name} goal: ${g.booked_including_taught} of ${g.target_units} class units taught or booked, ${g.still_needed} to go with ${g.days_left_in_month} days left.`
      : `${gig().name} goal reached: ${g.booked_including_taught} class units this month.`);
  }
  if (f.vipkid_tax?.received_this_year > 0) bullets.push(`${gig().name}: ${money(f.vipkid_tax.received_this_year)} received this year; about ${money(f.vipkid_tax.tax_to_set_aside_for_year)} to set aside for taxes.`);
  bullets.splice(8);
  return paras.join('\n\n') + (bullets.length ? `\n\n${bullets.map((b) => `- ${b}`).join('\n')}` : '');
}

const SYSTEM = () => `You write the short recap at the top of a household budgeting app's dashboard. ${gig().on ? `The household also earns self-employment income from a side gig they call ${gig().name}, with no tax withheld; in the figures, "vipkid_tax" is the tax on that income and "vipkid_class_goal", when present, is its monthly goal. ` : ''}They are working through their debts smallest balance first.

You'll be given today's figures as JSON. Besides spending against the budget, they include the checking balance and where it's headed before the next payday, price changes on recurring bills, how much of each bill category's budget recurring charges already take, yearly renewals coming up, and, where there is one, progress toward a monthly side-gig goal. Write what someone opening the app would most want to know right now: how the month is going against the budget, what stands out, and what's coming up. Lead with the overall position. Pick the two or three things that matter most today; you don't need to mention everything in the data. Be plain and direct, in the second person, like a clear-headed friend who has looked at the numbers. Use the actual dollar figures, rounded to whole dollars.

Stay with what the numbers show. You can point at where money is going or what changed, but don't tell them what they should do with their money, and don't suggest financial products.

Format, because the app displays your text as-is: one or two short paragraphs, then optionally up to four lines that each start with "- " for specific items worth a look. Plain text only, with no headings, bold, or other markup. Keep the whole thing under about 140 words.`;

/** Turns an API failure into a message that says what to do about it. */
export function readableError(e) {
  if (e instanceof Anthropic.AuthenticationError) return new Error("Anthropic didn't accept the API key. Check it on the Settings page.");
  if (e instanceof Anthropic.PermissionDeniedError) return new Error("This API key isn't allowed to use that model. Try another model on the Settings page.");
  if (e instanceof Anthropic.NotFoundError) return new Error("That model isn't available to this API key. Try another model on the Settings page.");
  if (e instanceof Anthropic.RateLimitError) return new Error('Anthropic is rate-limiting requests right now. Try again in a few minutes.');
  if (e instanceof Anthropic.BadRequestError) return new Error(`Anthropic rejected the request: ${e.message}`);
  if (e instanceof Anthropic.APIConnectionError) return new Error("Couldn't reach Anthropic. Check the NAS's internet connection.");
  if (e instanceof Anthropic.APIError) return new Error(`Anthropic returned an error (${e.status}). Try again later.`);
  return e;
}

/** The Claude-written recap. Throws a readable Error if it can't be produced. */
async function writeWithClaude(facts) {
  const client = new Anthropic({ apiKey: apiKey(), timeout: 120_000, maxRetries: 1 });
  const id = model();
  const source = aiSource();
  const params = {
    model: id,
    max_tokens: 16000,
    system: SYSTEM() + (currencyNote() ? '\n\n' + currencyNote() : ''),
    // A short, routine summary: low effort keeps it quick and inexpensive.
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: `Today's figures:\n${mask(JSON.stringify(facts, null, 1))}` }],
  };
  try {
    // If the model declines a request, the API retries it on a fallback model
    // in the same call. Haiku has no server-side fallback, so it goes direct.
    const response = id === 'claude-haiku-5-5'
      ? await client.messages.create(params)
      : await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    noteUsage('recap', response, source, "this month's totals by category, bills due soon, the five largest purchases, and your debt and checking figures");
    if (response.stop_reason === 'refusal') throw new Error('Claude declined to write the recap.');
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (!text) throw new Error('Claude returned an empty recap.');
    return { text: unmask(text), model: response.model };
  } catch (e) {
    throw readableError(e);
  }
}

const inFlight = new Map();
async function recap(month, deps, force) {
  const facts = buildFacts(month, deps);
  // Home Assistant's own AI, where the household chose it; otherwise Claude by key; otherwise fixed sentences.
  const useHa = viaHa();
  const useClaude = !useHa && apiKey() !== '';
  // The leading number changes whenever the recap's ingredients do, so old cached text isn't reused.
  const key = `2|${facts.month}|${facts.is_current_month ? facts.today : 'final'}|${useHa ? 'ha' : useClaude ? model() : 'rules'}${currency() === 'USD' ? '' : `|${currency()}`}${hideNames() ? '|hidden' : ''}`;   // a recap written in another currency is not reused (dollar households keep their cached one)
  let cache = {};
  try { cache = JSON.parse(getSetting('recap_cache', '{}')); } catch { /* start fresh */ }
  if (!force && cache[key]) return cache[key];
  if (inFlight.has(key)) return inFlight.get(key);
  const job = (async () => {
    let result;
    if (useHa) {
      try {
        const text = await haAsk('the dashboard recap', `${SYSTEM()}${currencyNote() ? '\n\n' + currencyNote() : ''}\n\nToday's figures:\n${mask(JSON.stringify(facts, null, 1))}`, 'recap', "this month's totals by category, bills due soon, the five largest purchases, and your debt and checking figures");
        result = { text: unmask(text), source: 'ha', by: aiName(), at: Date.now() };
      } catch (e) {
        result = { text: writeFromRules(facts), source: 'automatic', error: e.message, at: Date.now() };
      }
    } else if (useClaude) {
      try {
        const written = await writeWithClaude(facts);
        result = { text: written.text, source: 'claude', model: written.model, at: Date.now() };
      } catch (e) {
        result = { text: writeFromRules(facts), source: 'automatic', error: e.message, at: Date.now() };
      }
    } else {
      result = { text: writeFromRules(facts), source: 'automatic', at: Date.now() };
    }
    // Keep only the most recent few recaps.
    const kept = Object.fromEntries(Object.entries({ ...cache, [key]: result }).sort((a, b) => b[1].at - a[1].at).slice(0, 8));
    setSetting('recap_cache', JSON.stringify(kept));
    return result;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}

export function installRecap(app, deps) {
  const settings = () => ({ viaHa: viaHa(), aiName: aiName(), hasKey: apiKey() !== '', model: model(), models: MODELS, limitNote: limitMessage(), modelFixed: familyCopy() });
  // The review count is read fresh each time, so it drops as you categorize.
  const reply = async (req, force) => ({ ...(await recap(req.query.month, deps, force)), hasKey: apiKey() !== '' || viaHa(), review: reviewFor(req.query.month) });
  app.get('/api/recap', async (req, res) => res.json(await reply(req, false)));
  app.post('/api/recap/refresh', async (req, res) => res.json(await reply(req, true)));
  app.get('/api/recap/settings', (_req, res) => res.json(settings()));
  // Tries a key with the smallest possible question before it is saved, so a mistyped key or an account
  // with no credit is found now and not the first time the CFO is asked something.
  const tryKey = async (k) => {
    try {
      await new Anthropic({ apiKey: k, timeout: 20_000, maxRetries: 0 }).messages.create({ model: 'claude-haiku-5-5', max_tokens: 1, messages: [{ role: 'user', content: 'Hi' }] });
      return '';
    } catch (e) {
      const said = String(e?.error?.error?.message || e?.message || '');
      if (e?.status === 401) return "Anthropic didn't accept that key. Copy it again from the page where you made it; it is only shown once, so you may need to make a new one.";
      if (/credit balance/i.test(said)) return 'The key is right, but the account has no credit yet. On Anthropic\'s site open Billing, add a card and buy credit ($5 is the least), then press this again.';
      if (e?.status === 403) return "Anthropic refused that key (it may be switched off or limited). Make a new one and try again.";
      if (e?.status === 429 || e?.status >= 500) return '';   // busy, not wrong: let it through
      if (e?.status) return `Anthropic answered with a problem (${e.status}). ${said}`.trim();
      return "Couldn't reach Anthropic to check the key. Try again in a minute.";
    }
  };
  app.post('/api/recap/settings', async (req, res) => {
    const { key, model: chosen } = req.body || {};
    if (key !== undefined) {
      const k = String(key).trim();
      if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k)) return res.status(400).json({ error: "That doesn't look like an Anthropic API key. They start with sk-ant-." });
      if (k.startsWith('sk-ant-admin')) return res.status(400).json({ error: 'That is an admin key. Create a regular API key instead.' });
      if (req.body.check) { const problem = await tryKey(k); if (problem) return res.status(400).json({ error: problem }); }
      setSetting('anthropic_api_key', k);
    }
    if (chosen !== undefined) {
      if (!MODELS.some((m) => m.id === chosen)) return res.status(400).json({ error: 'Choose one of the listed models.' });
      setSetting('recap_model', chosen);
    }
    res.json(settings());
  });
  app.delete('/api/recap/key', (_req, res) => {
    setSetting('anthropic_api_key', '');
    res.json(settings());
  });
}
