// Paydays, entered by the household (Settings, "Paydays"). Each row of pay_schedules is one
// paycheck: a name, the words that mark its deposits at the bank, how often it comes, and how the
// amount is worked out. The checking forecast (server/cashflow.js) reads the same table.
//
// How often (the `rule` column):
//   monthdays:15,last        set days of the month ("last" is the last day); a weekend moves to Friday
//   weekly:5                 every week on that weekday (0 is Sunday)
//   nthweekday:2:3           the second Wednesday of each month, as Social Security pays (or last:5)
//   every:14:2026-11-06      every 14 days counted from a known payday
// Amount (`amount_mode`): 'last' (the last matching deposit), 'average' (of recent ones) or
// 'fixed' (the typed `amount`, for a household without a bank feed).
//
// An employer's published pay calendar can be loaded for a paycheck (table pay_dates). It
// replaces the rule for the years it covers, since it knows about bank holidays. The dates can be
// typed, or read by Claude from a photo or PDF of the calendar and then checked before saving.
import Anthropic from '@anthropic-ai/sdk';
import { db, iso } from './db.js';
import { payDates } from './cashflow.js';
import { isGigPay } from './gig.js';
import { changesOf } from './changes.js';
import { apiKey, model, readableError } from './recap.js';
import { noteUsage, aiSource, limitMessage } from './ai.js';

const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00`)) && iso(new Date(`${d}T12:00:00`)) === d;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;

/** A rule in words: "the 15th and the last day of each month". */
export function describeRule(rule) {
  const [type, spec, anchor] = String(rule).split(':');
  if (type === 'weekly') return `every ${WEEKDAYS[Number(spec)] || 'week'}`;
  if (type === 'nthweekday') return `the ${spec === 'last' ? 'last' : ['first', 'second', 'third', 'fourth'][Number(spec) - 1]} ${WEEKDAYS[Number(anchor)]} of each month`;
  if (type === 'every') return Number(spec) === 14 ? `every two weeks (counted from ${anchor})` : `every ${spec} days (counted from ${anchor})`;
  if (type === 'monthdays') {
    const days = spec.split(',').map((d) => (d === 'last' ? 'the last day' : `the ${ordinal(Number(d))}`));
    return `${days.join(' and ')} of each month`;
  }
  return rule;
}

/** Checks a rule and returns it tidied, or null when it isn't one. */
function cleanRule(rule) {
  const [type, spec, anchor] = String(rule || '').split(':');
  if (type === 'weekly' && /^[0-6]$/.test(spec)) return `weekly:${spec}`;
  if (type === 'nthweekday' && /^([1-4]|last)$/.test(spec) && /^[0-6]$/.test(anchor || '')) return `nthweekday:${spec}:${anchor}`;
  if (type === 'every' && [7, 14, 28].includes(Number(spec)) && isDate(anchor || '')) return `every:${Number(spec)}:${anchor}`;
  if (type === 'monthdays') {
    const days = [...new Set(String(spec || '').split(',').map((d) => d.trim()).filter(Boolean))];
    if (!days.length || days.length > 4 || !days.every((d) => d === 'last' || (/^\d{1,2}$/.test(d) && Number(d) >= 1 && Number(d) <= 31))) return null;
    return `monthdays:${days.sort((a, b) => (a === 'last' ? 99 : Number(a)) - (b === 'last' ? 99 : Number(b))).join(',')}`;
  }
  return null;
}

// The words a household types ("connections academy") are kept as a LIKE pattern.
const toPattern = (words) => { const w = String(words || '').trim().replace(/[%_]/g, '').slice(0, 60); return w ? `%${w}%` : ''; };
const fromPattern = (p) => String(p || '').replace(/%/g, '').trim();

function list() {
  const today = iso(new Date());
  const ahead = iso(new Date(Date.now() + 70 * 86400000));
  const coming = changesOf('pay');   // amounts said to change from a day (server/changes.js)
  return db.prepare('SELECT * FROM pay_schedules ORDER BY id').all().map((s) => {
    const last = s.merchant_like ? db.prepare('SELECT date, amount FROM transactions WHERE merchant LIKE ? AND amount > 0 ORDER BY date DESC LIMIT 1').get(s.merchant_like) : null;
    const years = db.prepare('SELECT substr(date, 1, 4) year, COUNT(*) n FROM pay_dates WHERE schedule_id = ? GROUP BY year ORDER BY year').all(s.id);
    return {
      id: s.id, name: s.name, match: fromPattern(s.merchant_like), rule: s.rule, pattern: describeRule(s.rule),
      amount_mode: s.amount_mode, amount: s.amount ?? null, gig: isGigPay(s), kind: KINDS.includes(s.kind) ? s.kind : 'job',
      lastDeposit: last || null, next: payDates(s.rule, today, ahead, s.id).slice(0, 3),
      calendars: years.map((y) => ({ year: y.year, dates: y.n })),
      changes: coming.get(String(s.id)) || [],
    };
  });
}

/** What a payday is. Only a job comes with pay stubs. */
export const KINDS = ['job', 'benefits', 'pension', 'other'];

function read(body) {
  const name = String(body?.name || '').trim().slice(0, 60);
  if (!name) return { error: 'Give it a name, such as your employer or "Pension".' };
  const kind = KINDS.includes(body?.kind) ? body.kind : 'job';
  const rule = cleanRule(body?.rule);
  if (!rule) return { error: 'Choose how often it is paid.' };
  const mode = ['last', 'average', 'fixed'].includes(body?.amount_mode) ? body.amount_mode : 'last';
  const amount = Number(body?.amount);
  if (mode === 'fixed' && !(amount > 0)) return { error: 'Enter the amount that arrives each time.' };
  const match = toPattern(body?.match);
  if (mode !== 'fixed' && !match) return { error: "Enter a word from the deposit's name at your bank, or choose a set amount." };
  return { name, rule, mode, amount: mode === 'fixed' ? Math.round(amount * 100) / 100 : null, match, kind };
}

const TOOL = {
  name: 'record_pay_dates',
  description: 'Record every pay date shown on the payroll calendar.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      pay_dates: { type: 'array', items: { type: 'string', description: 'A pay date as YYYY-MM-DD' } },
      unsure: { type: 'string', description: 'Anything a person should double-check, in one short sentence; empty if nothing' },
    },
    required: ['pay_dates', 'unsure'],
    additionalProperties: false,
  },
};
const SYSTEM = `You read an employer's payroll calendar (a photo, screenshot or PDF) and list its pay dates: the days employees are paid. Calendars often also mark other days, such as timesheet deadlines, payroll due dates, pay period start and end dates, and holidays. Leave those out. If a legend or shading shows which days are pay dates, follow it. Give each date as YYYY-MM-DD, using the year printed on the calendar. If something is ambiguous (a date that could be a pay date or a deadline, an unclear year), include your best reading and say what to check in "unsure".`;

async function readCalendar(mediaType, data) {
  const client = new Anthropic({ apiKey: apiKey(), timeout: 120_000, maxRetries: 1 });
  const source = aiSource();
  const file = mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: mediaType, data } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
  let response;
  try {
    response = await client.messages.create({
      model: model(), max_tokens: 8000, system: SYSTEM, tools: [TOOL],
      messages: [{ role: 'user', content: [file, { type: 'text', text: `Today is ${iso(new Date())}. Record the pay dates on this payroll calendar.` }] }],
    });
  } catch (e) {
    throw readableError(e);
  }
  noteUsage('paydays', response, source, 'a pay calendar you uploaded');
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to read that file.');
  const call = response.content.find((b) => b.type === 'tool_use' && b.name === TOOL.name);
  if (!call || !Array.isArray(call.input?.pay_dates)) throw new Error("Claude couldn't find pay dates in that file.");
  return { dates: [...new Set(call.input.pay_dates.filter(isDate))].sort(), unsure: String(call.input.unsure || '') };
}

export function installPaydays(app) {
  app.get('/api/paydays', (_req, res) => res.json(list()));

  app.post('/api/paydays', (req, res) => {
    const p = read(req.body);
    if (p.error) return res.status(400).json({ error: p.error });
    db.prepare('INSERT INTO pay_schedules (name, merchant_like, rule, amount_mode, amount, kind) VALUES (?,?,?,?,?,?)').run(p.name, p.match, p.rule, p.mode, p.amount, p.kind);
    res.json(list());
  });

  app.put('/api/paydays/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM pay_schedules WHERE id = ?').get(id)) return res.status(404).json({ error: 'That paycheck is no longer there.' });
    const p = read(req.body);
    if (p.error) return res.status(400).json({ error: p.error });
    db.prepare('UPDATE pay_schedules SET name = ?, merchant_like = ?, rule = ?, amount_mode = ?, amount = ?, kind = ? WHERE id = ?').run(p.name, p.match, p.rule, p.mode, p.amount, p.kind, id);
    res.json(list());
  });

  app.delete('/api/paydays/:id', (req, res) => {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM pay_dates WHERE schedule_id = ?').run(id);
    db.prepare('DELETE FROM pay_schedules WHERE id = ?').run(id);
    res.json(list());
  });

  // A published pay calendar: the dates given replace whatever was held for the years they fall in.
  // An empty list with a year removes that year's calendar.
  app.put('/api/paydays/:id/calendar', (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM pay_schedules WHERE id = ?').get(id)) return res.status(404).json({ error: 'That paycheck is no longer there.' });
    const raw = Array.isArray(req.body?.dates) ? req.body.dates.map((d) => String(d).trim()).filter(Boolean) : [];
    const bad = raw.filter((d) => !isDate(d));
    if (bad.length) return res.status(400).json({ error: `These aren't dates the app can read: ${bad.slice(0, 3).join(', ')}. Use the form 2027-01-15.` });
    const years = new Set([...raw.map((d) => d.slice(0, 4)), ...(/^\d{4}$/.test(String(req.body?.year || '')) ? [String(req.body.year)] : [])]);
    if (!years.size) return res.status(400).json({ error: 'Enter the pay dates, one on each line.' });
    if (raw.length > 120) return res.status(400).json({ error: 'That is more dates than one pay calendar holds.' });
    for (const y of years) db.prepare('DELETE FROM pay_dates WHERE schedule_id = ? AND date LIKE ?').run(id, `${y}-%`);
    const add = db.prepare('INSERT OR IGNORE INTO pay_dates (schedule_id, date) VALUES (?, ?)');
    for (const d of raw) add.run(id, d);
    res.json(list());
  });

  // Reads a photo or PDF of a pay calendar and returns the dates for checking. Saves nothing.
  app.post('/api/paydays/read-calendar', async (req, res) => {
    if (!apiKey()) return res.status(400).json({ error: limitMessage() || 'Reading a calendar needs the AI features switched on in Settings. You can type the dates instead.' });
    const m = /^data:(image\/(?:png|jpeg|webp|gif)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.file || ''));
    if (!m) return res.status(400).json({ error: "That file isn't one the app can read. Use a PDF, or a PNG or JPEG picture." });
    if (m[2].length > 7_500_000) return res.status(400).json({ error: 'That file is too large. Try a screenshot of just the calendar.' });
    try {
      res.json(await readCalendar(m[1], m[2]));
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });
}
