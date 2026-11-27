// Alert emails (2026-11-18): a short note between summaries when something needs attention.
//   - checking is forecast to fall below an amount you choose before the next payday
//     (or at its lowest point in the next five weeks, for a household with no regular payday);
//   - a bill comes out of checking tomorrow;
//   - a category has gone over its budget this month.
// Each thing is told once (setting `alerts_sent` remembers what, pruned after two months). They go
// to the summary email's addresses through its sender (server/mail.js), so they need that set up,
// and only between 7 AM and 9 PM by the server's clock. Off until switched on in Settings,
// Summary email. Settings: alerts_on, alert_low (dollars, 100 unless changed).
import { cents } from './money.js';
import { db, iso, getSetting, setSetting } from './db.js';
import { periodOf, periodBounds } from './period.js';
import { outlook } from './cashflow.js';
import { carryInto } from './rollover.js';
import { canSendMail, sendNote } from './mail.js';

const money = cents;
const day = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
const state = () => ({ on: getSetting('alerts_on') === '1', low: Number(getSetting('alert_low', '100')) || 0, canSend: canSendMail() });

/** What is worth telling the household right now, each with a key so it is told once. */
export function findAlerts(now = new Date()) {
  const out = [];
  const today = iso(now), tomorrow = iso(new Date(now.getTime() + 86400000));
  const low = Number(getSetting('alert_low', '100')) || 0;
  let o = null;
  try { o = outlook(); } catch { /* no accounts yet */ }
  if (o && o.accounts.length) {
    const figure = o.nextPayday ? o.beforePayday : o.lowest.balance;
    const when = o.nextPayday ? o.nextPayday.date : o.lowest.date;
    if (figure < low) out.push({ key: `low:${when}`, subject: 'checking is running low', text: o.nextPayday
      ? `Checking is forecast to be down to ${money(figure)} before the next payday on ${day(when)}. It is ${money(o.balance)} now.`
      : `Checking is forecast to reach ${money(figure)} on ${day(when)}. It is ${money(o.balance)} now.` });
    for (const e of o.events) {
      if ((e.kind === 'bill' || e.kind === 'card') && e.date === tomorrow && !e.onCard && !e.alreadyOut) out.push({ key: `due:${e.name}:${e.date}`, subject: `${e.name} is due tomorrow`, text: `${e.name} comes out of checking tomorrow: about ${money(Math.abs(e.amount))}.` });
    }
  }
  const month = periodOf(today), bounds = periodBounds(month);   // the budget month now running (server/period.js)
  // Against what the month really has to spend: a category that carries over counts what it brought with it.
  const carried = carryInto(month);
  const over = db.prepare(`SELECT c.id, c.name, c.budget, COALESCE(-SUM(t.amount), 0) spent FROM categories c
    LEFT JOIN transactions t ON t.category_id = c.id AND t.date >= ? AND t.date < ?
    WHERE c.kind = 'expense' AND c.budget > 0 GROUP BY c.id`).all(bounds.start, bounds.end)
    .map((c) => ({ ...c, budget: c.id in carried ? Math.max(0, Math.round((c.budget + carried[c.id]) * 100) / 100) : c.budget })).filter((c) => c.spent > c.budget);
  for (const c of over) out.push({ key: `over:${c.id}:${month}`, subject: `${c.name} is over budget`, text: `${c.name} is over its budget this month: ${money(c.spent)} of ${money(c.budget)}.` });
  return out;
}

async function tick() {
  const s = state();
  const hour = new Date().getHours();
  if (!s.on || !s.canSend || hour < 7 || hour >= 21) return;
  let sent = {};
  try { sent = JSON.parse(getSetting('alerts_sent', '{}')) || {}; } catch { sent = {}; }
  const cutoff = Date.now() - 62 * 86400000;
  for (const k of Object.keys(sent)) if (sent[k] < cutoff) delete sent[k];
  const fresh = findAlerts().filter((a) => !sent[a.key]);
  if (!fresh.length) return;
  try {
    await sendNote(getSetting('mail_to'), fresh.length === 1 ? `Ledger: ${fresh[0].subject}` : `Ledger: ${fresh.length} things to know`,
      `${fresh.map((a) => `- ${a.text}`).join('\n')}\n\nThese are alerts from Ledger, sent once each. Change or switch them off in Settings, Summary email.`);
    for (const a of fresh) sent[a.key] = Date.now();
    setSetting('alerts_sent', JSON.stringify(sent));
    setSetting('alerts_error', '');
  } catch (e) { setSetting('alerts_error', e.message); }
}

export function installAlerts(app) {
  const answer = () => ({ ...state(), error: getSetting('alerts_error'), now: findAlerts().map((a) => a.text) });
  app.get('/api/alerts', (_req, res) => res.json(answer()));
  app.put('/api/alerts', (req, res) => {
    if (req.body?.on !== undefined) {
      setSetting('alerts_on', req.body.on ? '1' : '0');
      // Switching on doesn't send a backlog: what is true right now counts as already told.
      if (req.body.on) { const sent = {}; for (const a of findAlerts()) sent[a.key] = Date.now(); setSetting('alerts_sent', JSON.stringify(sent)); }
    }
    if (req.body?.low !== undefined) {
      const n = Number(req.body.low);
      if (!Number.isFinite(n) || n < 0 || n > 1e6) return res.status(400).json({ error: 'Enter an amount of 0 or more.' });
      setSetting('alert_low', String(Math.round(n)));
    }
    res.json(answer());
  });
  setInterval(() => tick().catch(() => {}), 20 * 60_000).unref();
}
