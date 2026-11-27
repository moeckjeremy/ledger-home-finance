// Feature of the week (2026-11-27, the owner's idea: "a weekly feature highlight ... something that pops up
// every 7 days ... a feature that obviously applies to them ... but haven't taken the time to do so yet").
// One small card under "Ask your CFO" in the side menu, on a computer only. It names one thing this
// household could use and hasn't set up, with "Show me" and "Ignore".
//
// The rules, so it never feels like nagging (changed the same day at the owner's word: "cycles every Monday
// and can stay throughout the week until interacted with"):
//   - One at a time, chosen on Monday (or the first time Ledger is opened on a computer that week). It
//     stays in the side menu all week.
//   - The card only names the feature, with "Tell me more". That opens a pop-up with the description,
//     "Show me" and "Ignore". **Opening the pop-up, "Show me" and "Ignore" each put the card away until the
//     next Monday**, when a different feature takes its place. Nothing new appears sooner.
//   - Only what applies. Each entry in FEATURES has a `when` that is true only if the household could use
//     it AND hasn't yet (no savings goal, no payday, a mortgage but no home counted, children but no
//     allowances...). If they set it up during the week, the card goes too.
//   - "Ignore" is also for good: that feature is never offered again on this copy. Opening the pop-up or
//     "Show me" only ends it for the week; if it still applies it can come round again after the others.
//   - Never-shown features come before repeats, in the order of the list. **A feature added to Ledger later
//     is added to this list and takes its turn before anything already seen comes round again**: that is
//     how new features "cycle in". After everything has had a turn, what still applies comes round again,
//     longest-ago first.
//
// **When a feature is added to Ledger and a household could simply not have set it up, add an entry here**
// (with a `go` that lands on its control, as src/updates.ts does). Keep the text to two short sentences.
// It is a suggestion about the app, never about money: no "you should save more".
//
// Kept per copy, so every device of a household sees the same one: settings `tip_now` ({ id, week, done };
// `week` is that week's Monday),
// `tips_shown` ({ id: date }), `tips_ignored` ([ids]), `tips_off` ('1' switches the whole thing off).
import { db, getSetting, setSetting, iso } from './db.js';
import { demoMode } from './demo.js';
import { apiKey } from './recap.js';
import { viaHa } from './haai.js';

/** The Monday that begins the week a date falls in, by the copy's own clock. */
function monday(d = new Date()) {
  const back = (d.getDay() + 6) % 7;   // Monday 0 ... Sunday 6
  return iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() - back));
}
const one = (sql, ...args) => { try { return db.prepare(sql).get(...args); } catch { return null; } };
const count = (sql, ...args) => Number(one(sql, ...args)?.n) || 0;
const on = (key) => getSetting(key) === '1';
const taxes = () => getSetting('taxes_off') !== '1';
const children = () => { let more = 0; try { more = (JSON.parse(getSetting('tax_more') || '{}').dependents || []).length; } catch { /* none listed */ } return Math.max(Number(getSetting('kids', '0')) || 0, more); };
const twoAdults = () => ['joint', 'separate'].includes(getSetting('filing_status', 'joint')) && !!getSetting('spouse_name');
const aiOn = () => apiKey() !== '' || viaHa();
const sideWork = () => /self|freelanc|tutor|contract|gig|side|driv|uber|lyft|doordash|etsy|consult|babysit|lessons/i.test(`${getSetting('work_you')} ${getSetting('work_spouse')}`);

// In the order they are first offered: getting the basics in, then what the household's own answers point
// to, then the extras. `when` must be cheap: it runs for every entry each time a new one is chosen.
const FEATURES = [
  { id: 'bank', title: 'Connect your bank', text: 'Let your purchases arrive by themselves. It takes a setup token from SimpleFIN, a separate service that costs about $15 a year.',
    go: { page: 'connections', fold: 'bank', at: '[data-go="bank-token"]' }, when: () => !getSetting('simplefin_access') && !demoMode() },
  { id: 'paydays', title: 'Tell Ledger when you are paid', text: 'With your paydays in, the dashboard shows what is left before the next one and walks your checking balance forward through every bill.',
    go: { page: 'connections', fold: 'paydays' }, when: () => count('SELECT COUNT(*) n FROM pay_schedules') === 0 },
  { id: 'budgets', title: 'Set your budgets', text: 'Give each kind of spending a monthly amount and Ledger shows how much of it is used. "Suggest budgets for me" can do the first pass.',
    go: { page: 'budgets', at: '[data-go="cat-list"]' }, when: () => (Number(one("SELECT COALESCE(SUM(budget), 0) n FROM categories WHERE kind = 'expense'")?.n) || 0) === 0 && getSetting('zero_on') !== '1' },
  { id: 'property', title: 'Count your home in your net worth', text: 'Ledger counts your mortgage and car loans. Add the home or car they paid for, at a value you type, and your net worth tells the whole story.',
    go: { page: 'accounts', at: '[data-go="add-by-hand"]' }, when: () => count("SELECT COUNT(*) n FROM accounts WHERE type = 'property'") === 0 && count("SELECT COUNT(*) n FROM accounts WHERE type IN ('mortgage', 'auto')") > 0 },
  { id: 'goals', title: 'Save toward something', text: 'Name what you are saving for and link it to an account. Ledger shows how far along you are and how much to put away each month.',
    go: { page: 'accounts', at: '[data-go="goals"]' }, when: () => count('SELECT COUNT(*) n FROM goals') === 0 && count("SELECT COUNT(*) n FROM accounts WHERE type IN ('savings', 'checking')") > 0 },
  { id: 'debt-rates', title: 'Add your cards\' interest rates', text: 'With a rate and a payment on each debt, the Debt page works out a payoff order, a debt-free date and what the interest will cost.',
    go: { page: 'debt' }, when: () => count("SELECT COUNT(*) n FROM accounts WHERE type IN ('credit', 'auto', 'loan', 'mortgage') AND balance < 0 AND apr IS NULL AND COALESCE(paid_full, 0) = 0") > 0 },
  { id: 'side-gig', title: 'Set up your side income', text: 'You mentioned work with no tax taken out. Switch on the side gig and Ledger totals that income and shows the tax to put aside for it.',
    go: { page: 'connections', fold: 'gig' }, when: () => getSetting('gig_on') !== '1' && sideWork() },
  { id: 'tax-state', title: 'Choose your state for the tax estimate', text: 'The Taxes page estimates this year\'s federal and state income tax as you go. It needs to know which state you file in.',
    go: { page: 'taxes' }, when: () => taxes() && !getSetting('tax_state') },
  { id: 'allowance', title: 'Keep track of allowances', text: 'A notebook of what you hold for each child: a weekly allowance that adds itself, money for chores, and what they spend.',
    go: { page: 'connections', fold: 'allowance', at: '[data-go="allowance-switch"]' }, when: () => children() > 0 && !on('allowance_on') },
  { id: 'summary-email', title: 'Get a summary by email', text: 'A short email on the days you choose: what is left before payday, bills due, and budgets running over. It sends from a Gmail address of yours.',
    go: { page: 'connections', fold: 'email' }, when: () => !getSetting('mail_user') && !demoMode() },
  { id: 'alerts', title: 'Be told before a bill catches you out', text: 'Ledger can email you when checking is forecast to run low, a bill comes out tomorrow, or a category goes over budget.',
    go: { page: 'connections', fold: 'alerts' }, when: () => !!getSetting('mail_user') && !on('alerts_on') },
  { id: 'pay-links', title: 'Save where you pay each bill', text: 'On the Recurring page, give a bill a pay link and "Pay it" opens that company\'s payment page, so you never hunt for it again.',
    go: { page: 'recurring', at: '[data-go="bill-pay"], .more-btn' }, when: () => count('SELECT COUNT(*) n FROM recurrings') > 0 && count('SELECT COUNT(*) n FROM bill_links') === 0 },
  { id: 'owners', title: 'Mark whose account is whose', text: 'Mark an account as yours or your spouse\'s on the Accounts page, and Reports and Transactions can show each person\'s side.',
    go: { page: 'accounts', at: '.owner-pick, .more-btn' }, when: () => twoAdults() && count("SELECT COUNT(*) n FROM accounts WHERE COALESCE(owner, '') != ''") === 0 },
  { id: 'people', title: 'Give each adult a sign-in', text: 'Add a password for your spouse in Settings so each of you signs in as yourself. You both see the same household.',
    go: { page: 'connections', at: '[data-go="password"]' }, when: () => twoAdults() && !!getSetting('password_hash') && count('SELECT COUNT(*) n FROM people') === 0 },
  { id: 'ai', title: 'Switch on Ask your CFO', text: 'With an Anthropic key added, you can ask about your money in plain words, read receipts with your camera, and get a written recap each month.',
    go: { page: 'connections', fold: 'ai', at: '[data-go="ai-route"], [data-go="ai-key"]' }, when: () => !aiOn() && !demoMode() },
  { id: 'hide-names', title: 'Hide names from the AI', text: 'A switch that sends the recap and the CFO plain labels in place of your names, employers, accounts and banks.',
    go: { page: 'connections', fold: ['ai', 'ai-names'], at: '[data-go="ai-names"]' }, when: () => aiOn() && !on('ai_hide_names') },
  { id: 'bill-calendar', title: 'See your bills on a calendar', text: 'On the Recurring page, switch from List to Calendar to see the month laid out by day, with paydays marked. Tap a day to add a bill on it.',
    go: { page: 'recurring', at: '[data-go="bills-view"]' }, when: () => count('SELECT COUNT(*) n FROM recurrings') > 0 || count('SELECT COUNT(*) n FROM transactions') > 30 },
  { id: 'flow', title: 'One picture of where the money went', text: 'Reports opens with a month as a single picture: money in on the left, each kind of spending on the right, and what was left.',
    go: { page: 'reports', at: '[data-go="flow"]' }, when: () => count('SELECT COUNT(*) n FROM transactions') > 30 },
  { id: 'plan-try', title: 'Try a different payoff plan', text: 'On the Debt page, see smallest balance first beside highest rate first, and what an extra payment each month would do.',
    go: { page: 'debt', fold: 'debt-try', at: '[data-go="plan-try"]' }, when: () => count("SELECT COUNT(*) n FROM accounts WHERE type IN ('credit', 'auto', 'loan') AND balance < 0 AND apr IS NOT NULL AND min_payment > 0 AND COALESCE(paid_full, 0) = 0") >= 2 },
  { id: 'plan-ahead', title: 'Plan next month\'s budget early', text: 'At the top of the Budgets page you can open the coming month and set its amounts now. They start on the 1st.',
    go: { page: 'budgets', at: '[data-go="plan-ahead"]' }, when: () => (Number(one("SELECT COALESCE(SUM(budget), 0) n FROM categories WHERE kind = 'expense'")?.n) || 0) > 0 && new Date().getDate() >= 18 },
];

const read = (key, fallback) => { try { return JSON.parse(getSetting(key) || '') ?? fallback; } catch { return fallback; } };
const applies = (f) => { try { return !!f.when(); } catch { return false; } };
const shape = (f, week) => ({ id: f.id, title: f.title, text: f.text, go: f.go, week });

/** This week's feature, or null. A new one is chosen only when a new week (Monday) has begun. */
export function highlight() {
  if (on('tips_off')) return null;
  const ignored = new Set(read('tips_ignored', []));
  const now = read('tip_now', null);
  const week = monday();
  if (now && now.week === week) {
    const f = FEATURES.find((x) => x.id === now.id);
    // Still this week's: shown until it is opened, shown or ignored, or set up. Then the spot stays empty until Monday.
    return f && !now.done && !ignored.has(f.id) && applies(f) ? shape(f, week) : null;
  }
  const shown = read('tips_shown', {});
  const open = FEATURES.filter((f) => !ignored.has(f.id) && applies(f));
  if (!open.length) return null;
  const fresh = open.find((f) => !shown[f.id]);
  const pick = fresh || [...open].sort((a, b) => String(shown[a.id]).localeCompare(String(shown[b.id])))[0];
  setSetting('tip_now', JSON.stringify({ id: pick.id, week, done: false }));
  setSetting('tips_shown', JSON.stringify({ ...shown, [pick.id]: iso(new Date()) }));
  return shape(pick, week);
}

/**
 * "Show me another feature of the week" in Settings: the next one that applies, straight away, whatever
 * the day. It skips the one already chosen this week, takes its place as this week's, and is marked as
 * dealt with (it is being read in a pop-up right there), so the side menu stays clear until Monday.
 */
function another() {
  const ignored = new Set(read('tips_ignored', []));
  const now = read('tip_now', null);
  const shown = read('tips_shown', {});
  const open = FEATURES.filter((f) => !ignored.has(f.id) && f.id !== now?.id && applies(f));
  if (!open.length) return null;
  const pick = open.find((f) => !shown[f.id]) || [...open].sort((a, b) => String(shown[a.id]).localeCompare(String(shown[b.id])))[0];
  setSetting('tip_now', JSON.stringify({ id: pick.id, week: monday(), done: true }));
  // Stamped with the time as well as the day, so asking several times in a row walks through them in turn.
  setSetting('tips_shown', JSON.stringify({ ...shown, [pick.id]: new Date().toISOString() }));
  return shape(pick, monday());
}

/** Puts this week's card away until the next Monday (the pop-up was opened, or "Show me" or "Ignore" pressed). */
function putAway(id) {
  const now = read('tip_now', null);
  if (now && now.id === id && now.week === monday()) setSetting('tip_now', JSON.stringify({ ...now, done: true }));
}

export function installHighlights(app) {
  const state = () => ({ on: !on('tips_off'), tip: highlight() });
  app.get('/api/highlight', (_req, res) => res.json(state()));
  // The pop-up was opened, or "Show me" was pressed: that is this week's card dealt with.
  app.post('/api/highlight/seen', (req, res) => {
    const id = String(req.body?.id || '');
    if (!FEATURES.some((f) => f.id === id)) return res.status(400).json({ error: 'That is not a feature Ledger highlights.' });
    putAway(id);
    res.json(state());
  });
  // "Ignore": never offered again, and put away for this week.
  app.post('/api/highlight/ignore', (req, res) => {
    const id = String(req.body?.id || '');
    if (!FEATURES.some((f) => f.id === id)) return res.status(400).json({ error: 'That is not a feature Ledger highlights.' });
    setSetting('tips_ignored', JSON.stringify([...new Set([...read('tips_ignored', []), id])]));
    putAway(id);
    res.json(state());
  });
  app.post('/api/highlight/another', (_req, res) => {
    res.json({ tip: another() });
  });
  // The whole thing on or off, and "show the ignored ones again", from Settings.
  app.put('/api/highlight', (req, res) => {
    if (req.body?.on != null) setSetting('tips_off', req.body.on ? '0' : '1');
    if (req.body?.forget) setSetting('tips_ignored', '[]');
    res.json({ ...state(), ignored: read('tips_ignored', []).length });
  });
}
