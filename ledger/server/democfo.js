// The CFO in a public demo (2026-11-27, the owner: "canned options are good... make sure to explain they're
// canned answers and adding an API key will give them more flexibility"). A demo has no AI key, so nobody
// can type a question there. Instead it offers a fixed list of example questions, about money and about the
// app, and each has an answer written ahead of time in the CFO's voice.
//
// The money answers are not frozen text: the sample household's figures move with the calendar, so each
// answer is written here as sentences with the demo's own figures dropped in when it is asked. They are
// still examples, and the page says so plainly. Nothing is sent anywhere and nothing costs anything.
//
// Keep the same line as the real CFO: figures and how things work, never what to claim on taxes, which
// investments to pick, or which debt order is "better". When a feature these answers describe changes,
// change the answer (the app answers repeat what server/howto.js and About say).
import { cents, whole } from './money.js';
import { outlook } from './cashflow.js';
import { cushion } from './cushion.js';
import { demoMode } from './demo.js';

const day = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
const months = (m) => (m == null ? 'not within sight' : m < 12 ? `${m} month${m === 1 ? '' : 's'}` : `${Math.floor(m / 12)} year${m >= 24 ? 's' : ''}${m % 12 ? ` and ${m % 12} month${m % 12 === 1 ? '' : 's'}` : ''}`);
const monthFromNow = (m) => { const d = new Date(); d.setMonth(d.getMonth() + m); return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); };

const MONEY = [
  ['month', 'How am I doing this month?', ({ summaryFor }) => {
    const s = summaryFor();
    const over = s.categories.filter((c) => c.budget > 0 && c.spent > c.budget).sort((a, b) => (b.spent - b.budget) - (a.spent - a.budget));
    const pace = s.paceToday - s.spent;
    return [
      `You've spent ${whole(s.spent)} of your ${whole(s.budget)} budget so far this month, with ${s.days - s.lastDay} day${s.days - s.lastDay === 1 ? '' : 's'} to go. That is ${whole(Math.abs(pace))} ${pace >= 0 ? 'under' : 'over'} where your budget expects you to be by today. Income so far is ${whole(s.income)}.`,
      over.length ? `Over budget already:\n${over.slice(0, 4).map((c) => `- **${c.name}**: ${whole(c.spent)} of ${whole(c.budget)}, so ${whole(c.spent - c.budget)} over`).join('\n')}` : 'No category is over its budget yet.',
      over.length ? 'The Budgets page shows each category\'s bar, and under "Over budget" it suggests which categories have room to cover the difference.' : '',
    ].filter(Boolean).join('\n\n');
  }],
  ['went', 'Where did most of my money go this month?', ({ summaryFor }) => {
    const s = summaryFor();
    const top = [...s.categories].filter((c) => c.spent > 0).sort((a, b) => b.spent - a.spent).slice(0, 5);
    return `Of the ${whole(s.spent)} spent so far this month, the largest shares were:\n${top.map((c) => `- **${c.name}**: ${whole(c.spent)} (${Math.round((c.spent / s.spent) * 100)}%)`).join('\n')}\n\nReports shows the same split month by month and by shop, so you can see whether a category is creeping up.`;
  }],
  ['bills', 'What is coming out of checking in the next few weeks?', () => {
    const o = outlook();
    const bills = o.events.filter((e) => e.amount < 0).slice(0, 6);
    return [
      `Checking has ${cents(o.balance)} now. What Ledger expects to come out next:`,
      bills.map((e) => `- **${e.name}**: ${cents(-e.amount)} on ${day(e.date)}`).join('\n'),
      o.lowest ? `After those, the lowest point in the next five weeks is ${cents(o.lowest.balance)}, on ${day(o.lowest.date)}.` : '',
      'That is the "bank balance outlook" on the Dashboard. Each row there has "Change" for a bill that will be a different amount or date this time.',
    ].filter(Boolean).join('\n\n');
  }],
  ['debt', 'Which debt should I pay off first?', ({ debtPlan }) => {
    const p = debtPlan(), c = p.compare;
    if (!c || !c.count) return 'This household has no debts with a rate and a payment entered, so there is nothing to compare.';
    const gap = c.smallest.interest - c.rate.interest;
    return [
      `Ledger's plan pays the smallest balance first, so **${c.smallest.first}** goes first, with ${whole(c.extra)} a month on top of the regular payments. On that order ${c.count === 1 ? 'it is' : `all ${c.count} are`} paid off in ${months(c.smallest.months)} (${monthFromNow(c.smallest.months || 0)}), paying ${whole(c.smallest.interest)} in interest from here.`,
      c.same ? 'For these debts, paying the highest rate first gives the same order, so the figures are the same.'
        : `Paying the highest rate first would start with **${c.rate.first}** instead: clear in ${months(c.rate.months)}, with ${whole(c.rate.interest)} in interest, which is ${whole(Math.abs(gap))} ${gap >= 0 ? 'less' : 'more'}.`,
      'Smallest first gets one debt out of the way sooner; highest rate first usually costs less interest. Which matters more is yours to weigh. On the Debt page, "Try a different plan" shows both side by side and lets you try a different extra amount.',
    ].join('\n\n');
  }],
  ['cushion', 'How long would my savings last if my income stopped?', () => {
    const c = cushion();
    if (!c.ready) return 'There is not a finished month of spending to measure against yet.';
    return `Your savings of ${whole(c.savings)} would cover about ${c.months} months of your usual spending, which has averaged ${whole(c.monthly)} a month over the last ${c.basedOn === 1 ? 'finished month' : `${c.basedOn} finished months`}. Counting what is in checking as well, about ${c.withChecking} months.\n\nThat figure is on the Accounts page as "Months of expenses covered". It counts everything you spend today, so it would stretch further if you cut back.`;
  }],
];

const APP = [
  ['plan', 'Can I set next month\'s budget before the month starts?', () => 'Yes. On the Budgets page, while you are looking at the current month, the button at the top reads "Plan next month\'s budget". It opens the coming month so you can type its amounts now.\n\nWhat you type there starts on the 1st and carries on from then. This month\'s budget is left exactly as it is, and a link there puts next month back to this month\'s amounts if you change your mind.'],
  ['out', 'I get paid back for work expenses. How do I keep them out of my budget?', () => 'Two ways, depending on how you pay for them:\n\n- **A category that doesn\'t count.** On the Budgets page, choose "Organise" beside a category and then "Leave it out of the budget". Purchases filed there count in no budget or total, and when the reimbursement arrives you file it in the same category. The page shows what went out and what came back.\n- **A whole card or account.** If the work expenses are all on one card, choose "Leave out of the budget" on that account on the Accounts page. Its balance still shows, and its spending stops counting.'],
  ['bank', 'How does my bank\'s activity get into Ledger?', () => 'Three ways, and you can mix them:\n\n- **A bank connection.** Settings, "SimpleFIN Sync" links your banks through SimpleFIN, a separate paid service. Transactions then arrive by themselves, usually about a day behind.\n- **A file.** Settings, "Import a file" takes your bank\'s CSV export, or reads a PDF statement.\n- **By hand.** The "+" button adds a purchase, a deposit or a transfer, and can read a receipt from your phone\'s camera.\n\nA purchase you type on a connected account waits for the bank\'s own entry and is never counted twice.'],
  ['order', 'Can I put my categories in my own order, or group them?', () => 'Yes, both on the Budgets page. The arrows beside a category (the "⋯" on a phone) move it up or down, and every category menu in Ledger follows the same order.\n\n"Organise" beside a category moves it between flexible spending and fixed bills, or into a group you name yourself, such as Giving or Kids. It can also merge two categories, keeping the history, or hide one you no longer use.'],
  ['more', 'What can Ledger do that I might not have found yet?', () => 'A few that people tend to miss:\n\n- **The bank balance outlook** on the Dashboard walks your checking balance forward through every bill and paycheck, so you see the lowest point before it arrives.\n- **Splitting a purchase** across categories, for a shop where groceries and clothes are on one receipt.\n- **Savings goals** that follow an account\'s balance and say how much to put away each month.\n- **Checking a statement** against an account, to find a missing or doubled entry.\n- **A tax estimate** for United States households, with pay stubs tracked month by month.\n- **Your own look**: holiday scenes, colourways, or a photo of your own behind the app.\n\nThe About page has the full guide, with a search box.'],
];

export function installDemoCfo(app, deps) {
  if (!demoMode()) return;
  const all = [...MONEY.map((q) => ['money', ...q]), ...APP.map((q) => ['app', ...q])];
  app.get('/api/cfo/demo', (_req, res) => res.json({ questions: all.map(([kind, id, q]) => ({ kind, id, q })) }));
  app.get('/api/cfo/demo/:id', (req, res) => {
    const found = all.find((x) => x[1] === req.params.id);
    if (!found) return res.status(404).json({ error: 'That example is not here.' });
    try { res.json({ q: found[2], reply: found[3](deps) }); }
    catch (e) { console.error('Demo CFO example failed:', found[1], e.message); res.status(500).json({ error: 'That example could not be put together just now.' }); }
  });
}
