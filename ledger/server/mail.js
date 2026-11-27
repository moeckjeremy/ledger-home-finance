// The summary email: a short summary sent on the days and at the hour chosen on
// the Connections page (weekdays at 8 in the morning unless changed). It carries totals only (no account numbers, no link back
// to the app, since not everyone who gets it is on the home network).
//
// It is sent through a Gmail account with an "app password", which is saved in
// settings as mail_password and never sent back to the browser or printed.
import { cents as moneyCents, whole } from './money.js';
import { gig } from './gig.js';
import nodemailer from 'nodemailer';
import { db, getSetting, setSetting } from './db.js';
import { outlook } from './cashflow.js';
import { stubReminderText } from './paystub.js';
import { statementReminderText } from './statementremind.js';

const DAY = 86400000;
const round = (n) => Math.round(n * 100) / 100;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (date, n) => { const [y, m, d] = date.split('-').map(Number); return iso(new Date(y, m - 1, d + n)); };
const dayLabel = (date) => { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); };
const weekday = (date) => { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long' }); };
const cents = moneyCents;
const dollars = whole;

/** When to send, by the server's clock (Central time on the NAS): days of the week (0 is Sunday) and an hour. */
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const sendDays = () => { const d = (getSetting('mail_days', '1,2,3,4,5')).split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6); return [...new Set(d)].sort(); };
const sendHour = () => { const h = Number(getSetting('mail_hour', '8')); return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 8; };
/** "weekdays", "every day", or the days by name. */
function daysInWords(days) {
  const key = days.join(',');
  if (key === '1,2,3,4,5') return 'weekdays';
  if (key === '0,1,2,3,4,5,6') return 'every day';
  if (key === '0,6') return 'weekends';
  const names = days.map((d) => `${DAY_NAMES[d]}s`);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] || 'no days';
}
const hourInWords = (h) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;

/** The figures in the email. */
export function weeklyFigures({ summaryFor }) {
  const o = outlook();
  const today = o.today;
  const pay = o.nextPayday;

  // Bills that come out of checking before the next paycheck.
  const bills = o.events
    .filter((e) => e.kind !== 'pay' && !e.onCard && (!pay || e.date < pay.date))
    .map((e) => ({ name: e.name, date: e.date, amount: -e.amount, estimate: !!e.estimate, pending: !!e.alreadyOut }));
  const billsTotal = round(bills.filter((b) => !b.pending).reduce((a, b) => a + b.amount, 0));
  // Anything else the forecast counts before payday (side-gig pay, once tax savings is funded).
  const otherIn = round(o.beforePayday - o.balance + billsTotal);
  const paychecks = o.events.filter((e) => e.kind === 'pay' && e.salary).slice(0, 3).map((e) => ({ name: e.name.replace(/\s*\(.*\)$/, '').replace(/^Your paycheck$/, getSetting('mail_your_name') ? `${getSetting('mail_your_name')}'s paycheck` : 'Your paycheck'), date: e.date, amount: e.amount }));

  // Day-to-day spending over the last seven days, against a typical week (the
  // eight weeks before). Fixed bills and one-off payments of $1,000 or more are
  // left out so a mortgage week doesn't look like a spending spree.
  const from = addDays(today, -6), earlier = addDays(from, -56);
  const rows = db.prepare(`
    SELECT c.name, COALESCE(-SUM(CASE WHEN t.date >= ? THEN t.amount END), 0) week, COALESCE(-SUM(CASE WHEN t.date < ? THEN t.amount END), 0) before
    FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE c.kind = 'expense' AND c.fixed = 0 AND t.amount < 0 AND t.amount > -1000 AND t.date >= ? AND t.date <= ? GROUP BY c.id`).all(from, from, earlier, today);
  const cats = rows.map((r) => ({ name: r.name, spent: round(r.week), usual: round(r.before / 8), change: round(r.week - r.before / 8) }));
  const spent = round(cats.reduce((a, c) => a + c.spent, 0));
  const usual = round(cats.reduce((a, c) => a + c.usual, 0));
  const movers = cats.filter((c) => Math.abs(c.change) >= 10 && (c.spent > 0 || c.usual > 0)).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 3);

  // Budgets that are over, or nearly used up, this month.
  const s = summaryFor(today.slice(0, 7));
  const daysLeft = s.days - s.lastDay;
  const watch = s.categories
    .filter((c) => c.budget > 0 && c.spent >= c.budget * 0.85)
    .map((c) => ({ name: c.name, spent: c.spent, budget: c.budget, over: round(c.spent - c.budget), used: Math.round((c.spent / c.budget) * 100) }))
    .sort((a, b) => b.over - a.over).slice(0, 5);

  return {
    today, left: o.beforePayday, now: o.balance, billsTotal, otherIn, bills, paychecks,
    payday: pay ? { date: pay.date, weekday: weekday(pay.date) } : null,
    vipkidAside: !!o.taxHold?.active, gigName: gig().name,
    week: { spent, usual, change: round(spent - usual), movers },
    watch, daysLeft,
  };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Email programs ignore most page styling, so everything is tables with the
// styles written on each cell. Colours are the app's dark theme.
const C = { bg: '#12151b', card: '#1b2029', line: '#2a313d', ink: '#eef1f5', ink2: '#a7b0bd', ink3: '#8d97a5', accent: '#4a93ea', good: '#3ecf8e', bad: '#f0736a', warn: '#e8b34b' };
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const card = (inner) => `<tr><td style="padding:0 0 10px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card};border-radius:14px;"><tr><td style="padding:14px 16px;font-family:${FONT};font-size:14px;line-height:1.5;color:${C.ink};">${inner}</td></tr></table></td></tr>`;
const heading = (text) => `<div style="font-weight:600;margin:0 0 6px 0;">${esc(text)}</div>`;
const line = (left, right, { last = false, color = C.ink } = {}) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:5px 0;${last ? '' : `border-bottom:1px solid ${C.line};`}font-family:${FONT};font-size:14px;color:${C.ink};">${left}</td><td align="right" style="padding:5px 0;${last ? '' : `border-bottom:1px solid ${C.line};`}font-family:${FONT};font-size:14px;color:${color};white-space:nowrap;">${right}</td></tr></table>`;
const small = (text) => `<span style="color:${C.ink3};font-size:12px;white-space:nowrap;">${esc(text)}</span>`;
const bar = (pct, color) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 0 0;"><tr><td style="background:${C.line};border-radius:3px;font-size:0;line-height:0;"><table role="presentation" width="${Math.max(2, Math.min(100, pct))}%" cellpadding="0" cellspacing="0"><tr><td height="6" style="background:${color};border-radius:3px;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr></table>`;
// The app's mark: two rising bars and a tall "L", on a dark tile.
const mark = () => {
  const bar = (h) => `<td valign="bottom" style="padding:0 1px;"><div style="width:4px;height:${h}px;background:#4a93ea;border-radius:2px;font-size:0;line-height:0;">&nbsp;</div></td>`;
  const ell = `<td valign="bottom" style="padding:0 1px;"><div style="width:5px;height:14px;border-left:4px solid #f2f2f5;border-bottom:4px solid #f2f2f5;border-bottom-left-radius:2px;font-size:0;line-height:0;">&nbsp;</div></td>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="background:#0e0f13;border:1px solid ${C.line};border-radius:8px;"><tr><td width="32" height="32" align="center" valign="middle"><table role="presentation" cellpadding="0" cellspacing="0"><tr>${bar(8)}${bar(13)}${ell}</tr></table></td></tr></table>`;
};

export function subjectFor(f) {
  return f.payday ? `Ledger: ${dollars(f.left)} left before ${f.payday.weekday}'s paycheck` : `Ledger: ${dollars(f.now)} in checking`;
}

/** The email as a web page. */
export function renderHtml(f) {
  const parts = [];

  parts.push(card(`
    <div style="font-size:12px;color:${C.ink2};">${f.payday ? 'Left before the next paycheck' : 'In checking now'}</div>
    <div style="font-size:32px;font-weight:600;line-height:1.2;color:${f.left < 0 ? C.bad : C.ink};">${cents(f.payday ? f.left : f.now)}</div>
    ${f.payday ? `<div style="margin-top:10px;border-top:1px solid ${C.line};padding-top:6px;">
      ${line(`<span style="color:${C.ink2};">In checking now</span>`, cents(f.now), { last: true })}
      ${line(`<span style="color:${C.ink2};">Bills due first</span>`, f.billsTotal ? `&minus;${cents(f.billsTotal)}` : cents(0), { last: true })}
      ${Math.abs(f.otherIn) >= 0.01 ? line(`<span style="color:${C.ink2};">Other deposits expected</span>`, `+${cents(f.otherIn)}`, { last: true }) : ''}
    </div>` : ''}`));

  if (f.payday) {
    parts.push(card(heading('Bills before the next paycheck') + (f.bills.length
      ? f.bills.map((b, i) => line(`${esc(b.name)} ${small(`${dayLabel(b.date)}${b.estimate ? ' · estimate' : ''}${b.pending ? ' · already taken out' : ''}`)}`, cents(b.amount), { last: i === f.bills.length - 1 })).join('')
      : `<div style="color:${C.ink2};">Nothing is due before then.</div>`)));
  }

  if (f.paychecks.length) {
    parts.push(card(heading('Next paychecks')
      + f.paychecks.map((p, i) => line(`${esc(p.name)} ${small(dayLabel(p.date))}`, `+${cents(p.amount)}`, { last: i === f.paychecks.length - 1, color: C.good })).join('')
      + (f.vipkidAside ? `<div style="font-size:12px;color:${C.ink3};margin-top:6px;">${esc(f.gigName)} pay isn't counted. It goes to tax savings.</div>` : '')));
  }

  const w = f.week;
  parts.push(card(`
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-family:${FONT};font-size:14px;font-weight:600;color:${C.ink};">Spent in the last 7 days</td><td align="right" style="font-family:${FONT};font-size:18px;font-weight:600;color:${C.ink};">${dollars(w.spent)}</td></tr></table>
    <div style="font-size:13px;color:${C.ink2};margin:0 0 8px 0;">${Math.abs(w.change) < 10 ? 'About the same as a typical week.' : `${dollars(Math.abs(w.change))} ${w.change > 0 ? 'more' : 'less'} than a typical week.`} Day-to-day spending; regular bills aren't included.</div>
    ${w.movers.map((m) => line(esc(m.name), `${dollars(m.spent)} <span style="font-size:12px;color:${m.change > 0 ? C.bad : C.good};">${m.change > 0 ? 'up' : 'down'} ${dollars(Math.abs(m.change))}</span>`, { last: true })).join('')}`));

  parts.push(card(heading('Budget watch') + (f.watch.length
    ? f.watch.map((c, i) => `<div style="${i ? 'margin-top:10px;' : ''}">${line(`<span style="font-size:13px;">${esc(c.name)}</span>`, c.over > 0 ? `<span style="font-size:13px;">${dollars(c.over)} over</span>` : `<span style="font-size:13px;">${c.used}% used, ${f.daysLeft} day${f.daysLeft === 1 ? '' : 's'} left</span>`, { last: true, color: c.over > 0 ? C.bad : C.warn })}${bar(c.used, c.over > 0 ? C.bad : C.warn)}</div>`).join('')
    : `<div style="color:${C.ink2};">Every budget has room left so far this month.</div>`)));

  if (f.stub) parts.push(card(heading('A reminder') + `<div style="font-size:13px;color:${C.ink2};">${esc(f.stub)}</div>`));

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>Ledger summary</title></head>
<body style="margin:0;padding:0;background:${C.bg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};"><tr><td align="center" style="padding:22px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;">
<tr><td style="padding:0 0 16px 0;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td>${mark()}</td><td style="padding-left:10px;font-family:${FONT};"><div style="font-size:16px;font-weight:600;color:${C.ink};">Ledger</div><div style="font-size:12px;color:${C.ink3};">${esc(dayLabel(f.today))}</div></td></tr></table></td></tr>
${parts.join('\n')}
<tr><td align="center" style="padding:8px 0 0 0;font-family:${FONT};font-size:12px;color:${C.ink3};">Sent by Ledger on ${esc(daysInWords(sendDays()))} at ${hourInWords(sendHour())}. Totals only, no account numbers.</td></tr>
</table></td></tr></table></body></html>`;
}

/** The same figures as plain text, for mail programs that don't show the styled version. */
export function renderText(f) {
  const out = [];
  if (f.payday) {
    out.push(`Left before the next paycheck: ${cents(f.left)}`, `  In checking now: ${cents(f.now)}`, `  Bills due first: ${cents(f.billsTotal)}`, '');
    out.push('Bills before the next paycheck', ...(f.bills.length ? f.bills.map((b) => `  ${b.name} (${dayLabel(b.date)}${b.estimate ? ', estimate' : ''}${b.pending ? ', already taken out' : ''}): ${cents(b.amount)}`) : ['  Nothing is due before then.']), '');
  } else out.push(`In checking now: ${cents(f.now)}`, '');
  if (f.paychecks.length) out.push('Next paychecks', ...f.paychecks.map((p) => `  ${p.name} (${dayLabel(p.date)}): +${cents(p.amount)}`), ...(f.vipkidAside ? [`  ${f.gigName} pay isn't counted. It goes to tax savings.`] : []), '');
  out.push(`Spent in the last 7 days: ${dollars(f.week.spent)} (typical week ${dollars(f.week.usual)})`, ...f.week.movers.map((m) => `  ${m.name}: ${dollars(m.spent)}, ${m.change > 0 ? 'up' : 'down'} ${dollars(Math.abs(m.change))}`), '');
  out.push('Budget watch', ...(f.watch.length ? f.watch.map((c) => `  ${c.name}: ${c.over > 0 ? `${dollars(c.over)} over` : `${c.used}% used, ${f.daysLeft} days left`}`) : ['  Every budget has room left so far this month.']));
  if (f.stub) out.push('', 'A reminder', `  ${f.stub}`);
  return out.join('\n');
}

// ---- Sending ----------------------------------------------------------------

const ADDRESS = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
const recipients = () => (getSetting('mail_to') || '').split(',').map((s) => s.trim()).filter(Boolean);
const ready = () => !!getSetting('mail_user') && !!getSetting('mail_password') && recipients().length > 0;

function transport() {
  // LEDGER_SMTP_URL points at a stand-in mail server when testing; otherwise it's Gmail.
  const test = process.env.LEDGER_SMTP_URL;
  const auth = { user: getSetting('mail_user'), pass: getSetting('mail_password') };
  if (test) { const u = new URL(test); return nodemailer.createTransport({ host: u.hostname, port: Number(u.port), secure: false, ignoreTLS: true, auth }); }
  return nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth, connectionTimeout: 20000, socketTimeout: 30000 });
}

/** Whether the app can send email at all (a sending address and its app password are saved). */
export const canSendMail = () => !!getSetting('mail_user') && !!getSetting('mail_password');
/** A short plain email, from the same address the summary goes out from. `to` blank sends it to that address itself. */
/** A plain email with files attached (the tax pack). `files` is a list of { filename, content, contentType }. */
/** `fromName` signs the email with a person's name instead of "Ledger" (a question to their tax preparer, which they should be able to reply to). */
// Every recipient must be one plain address (2026-11-27). The routes check what people type, each with its
// own pattern; this is the last look before the mail library, which will dig an address out of almost
// any text it is handed. Anything else is refused, never tidied.
function plain(to, user) {
  const list = String(to || user || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!list.length || list.some((x) => x.length > 200 || !ADDRESS.test(x))) throw new Error("That email address doesn't look right.");
  return list.join(', ');
}

export async function sendWithFiles(to, subject, text, files, fromName = '') {
  const user = getSetting('mail_user');
  to = plain(to, user);
  const name = String(fromName).replace(/[^\p{L}\p{M}' .-]/gu, '').trim();
  try { await transport().sendMail({ from: `${name || 'Ledger'} <${user}>`, replyTo: user, to: to || user, subject, text, attachments: files }); } catch (e) { throw new Error(readable(e)); }
}

export async function sendNote(to, subject, text, html) {
  const user = getSetting('mail_user');
  to = plain(to, user);
  // Pictures a letter uses travel inside the email itself (by content id), so they show without the
  // mail program having to fetch anything.
  const attachments = html && html.includes('cid:google-g') ? [{ filename: 'google.png', path: GOOGLE_G, cid: 'google-g' }] : [];
  try { await transport().sendMail({ from: `Ledger <${user}>`, to: to || user, subject, text, ...(html ? { html, attachments } : {}) }); } catch (e) { throw new Error(readable(e)); }
}
// Google's "G", on a white tile as Google's own sign-in buttons show it (server/google-g.png, drawn from
// Google's published mark, unaltered). Used only to label the Google sign-in option in the welcome email.
const GOOGLE_G = new URL('./google-g.png', import.meta.url).pathname;

/**
 * A letter in the same look as the summary email (added 2026-11-18, the owner: the welcome email should be
 * laid out like the daily one, not plain text). `parts` is a list of blocks:
 *   { p: 'a paragraph' }                       { steps: ['first', 'second'] }  (numbered)
 *   { button: { label, url } }                 { code: 'ABCD-EFGH', label: 'Your setup code' }
 *   { note: 'small grey print' }                 { heading: 'A section title' }
 *   { or: true }   a line with OR in the middle, between two options
 *   { option: { title, logo, tag, intro, steps: [...] } }   (logo: 'google' puts Google's G after the title)   a boxed choice with its own numbered steps (tag is a small badge)
 * Text is escaped here, so callers pass plain words. The plain-text version is still sent alongside.
 */
export function letterHtml({ title, greeting, parts = [], foot = '' }) {
  const p = (t, color = C.ink) => `<div style="margin:0 0 10px 0;color:${color};">${esc(t).replace(/\n/g, '<br>')}</div>`;
  const block = (b) => {
    if (b.p) return p(b.p);
    if (b.note) return `<div style="margin:0 0 10px 0;color:${C.ink3};font-size:12.5px;">${esc(b.note)}</div>`;
    if (b.or) return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px 0;"><tr><td style="border-bottom:1px solid ${C.line};font-size:0;line-height:0;" height="9">&nbsp;</td><td width="54" rowspan="2" align="center" style="font-family:${FONT};font-size:13px;font-weight:700;letter-spacing:1.5px;color:${C.ink2};">OR</td><td style="border-bottom:1px solid ${C.line};font-size:0;line-height:0;" height="9">&nbsp;</td></tr><tr><td height="9" style="font-size:0;line-height:0;">&nbsp;</td><td height="9" style="font-size:0;line-height:0;">&nbsp;</td></tr></table>`;
    if (b.heading) return `<div style="margin:16px 0 10px 0;padding-top:14px;border-top:1px solid ${C.line};font-size:15px;font-weight:600;color:${C.ink};">${esc(b.heading)}</div>`;
    if (b.option) {
      const o = b.option;
      // A step is plain words, or { text, code, codeLabel } when a code belongs to that step and nowhere else.
      const inStep = (s) => (typeof s === 'string' ? esc(s) : `${esc(s.text)}${s.code ? `<div style="margin:8px 0 3px 0;color:${C.ink3};font-size:12px;">${esc(s.codeLabel || 'Code')}</div><div style="margin:0 0 4px 0;padding:8px 12px;background:${C.card};border:1px solid ${C.line};border-radius:9px;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:16px;letter-spacing:1px;color:${C.ink};">${esc(s.code)}</div>` : ''}`);
      const rows = (o.steps || []).map((s, i) => `<tr><td width="24" valign="top" style="padding:0 0 7px 0;font-family:${FONT};font-size:13px;font-weight:700;color:${C.accent};">${i + 1}.</td><td valign="top" style="padding:0 0 7px 0;font-family:${FONT};font-size:14px;line-height:1.45;color:${C.ink};">${inStep(s)}</td></tr>`).join('');
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px 0;background:#0e0f13;border:1px solid ${C.line};border-radius:12px;"><tr><td style="padding:13px 15px 8px 15px;font-family:${FONT};">
<div style="margin:0 0 3px 0;font-size:15px;font-weight:700;color:${C.ink};">${esc(o.title)}${o.logo === 'google' ? ` <img src="cid:google-g" width="22" height="22" alt="Google" style="display:inline-block;vertical-align:-5px;border:0;border-radius:5px;">` : ''}${o.tag ? ` <span style="display:inline-block;margin-left:6px;padding:2px 8px;border-radius:9px;background:${C.accent};color:#0e0f13;font-size:11px;font-weight:700;vertical-align:2px;">${esc(o.tag)}</span>` : ''}</div>
${o.intro ? `<div style="margin:0 0 9px 0;font-size:13px;line-height:1.45;color:${C.ink2};">${esc(o.intro)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr></table>`;
    }
    if (b.steps) return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 6px 0;">${b.steps.map((s, i) => `<tr><td width="30" valign="top" style="padding:0 0 10px 0;"><div style="width:22px;height:22px;border-radius:11px;background:${C.accent};color:#0e0f13;font-family:${FONT};font-size:12px;font-weight:700;line-height:22px;text-align:center;">${i + 1}</div></td><td valign="top" style="padding:1px 0 10px 0;font-family:${FONT};font-size:14px;line-height:1.5;color:${C.ink};">${esc(s)}</td></tr>`).join('')}</table>`;
    if (b.button) return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 14px 0;"><tr><td style="background:#f2f2f4;border-radius:10px;"><a href="${esc(b.button.url)}" style="display:inline-block;padding:11px 20px;font-family:${FONT};font-size:14px;font-weight:600;color:#17120f;text-decoration:none;">${esc(b.button.label)}</a></td></tr></table><div style="margin:0 0 12px 0;color:${C.ink3};font-size:12px;word-break:break-all;">${esc(b.button.url)}</div>`;
    if (b.code) return `<div style="margin:0 0 4px 0;color:${C.ink3};font-size:12px;">${esc(b.label || 'Code')}</div><div style="margin:0 0 12px 0;padding:10px 14px;background:#0e0f13;border:1px solid ${C.line};border-radius:10px;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:17px;letter-spacing:1px;color:${C.ink};">${esc(b.code)}</div>`;
    return '';
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};"><tr><td align="center" style="padding:22px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:500px;">
<tr><td style="padding:0 0 16px 0;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td>${mark()}</td><td style="padding-left:10px;font-family:${FONT};"><div style="font-size:16px;font-weight:600;color:${C.ink};">Ledger</div><div style="font-size:12px;color:${C.ink3};">${esc(title)}</div></td></tr></table></td></tr>
${card(`${greeting ? `<div style="font-size:17px;font-weight:600;margin:0 0 10px 0;">${esc(greeting)}</div>` : ''}${parts.map(block).join('')}`)}
${foot ? `<tr><td align="center" style="padding:8px 0 0 0;font-family:${FONT};font-size:12px;color:${C.ink3};">${esc(foot)}</td></tr>` : ''}
</table></td></tr></table></body></html>`;
}

/** Turns a mail server's complaint into something that says what to do. */
function readable(e) {
  if (e.code === 'EAUTH' || e.responseCode === 535) return "Gmail didn't accept that address and app password. Check both; an app password is 16 letters and isn't your normal Gmail password.";
  if (['ESOCKET', 'ECONNECTION', 'ETIMEDOUT', 'EDNS', 'ECONNREFUSED'].includes(e.code)) return "Couldn't reach Gmail's mail server. Check the NAS's internet connection and try again.";
  return `The email couldn't be sent: ${String(e.message || e).slice(0, 200)}`;
}

// The pay stub reminder rides along with the summary email, but only about once a month: said every
// morning it would be a nag. Setting `stub_mail_last` holds the day it last went out.
const STUB_EVERY_DAYS = 30;
// The reminder card's text: the pay stub line and, when statements are due, the statements line.
const reminderText = () => [stubReminderText(), statementReminderText()].filter(Boolean).join(' ');
function stubNote() {
  const text = reminderText();
  if (!text) return '';
  const last = Date.parse(getSetting('stub_mail_last') || '');
  return Number.isFinite(last) && Date.now() - last < STUB_EVERY_DAYS * 86400000 ? '' : text;
}

async function send(deps, to, scheduled = false) {
  const f = weeklyFigures(deps);
  // A test email shows the reminder too, when there is one, without using up the month.
  f.stub = scheduled ? stubNote() : reminderText();
  const user = getSetting('mail_user');
  try {
    await transport().sendMail({ from: { name: 'Ledger', address: user }, to, subject: subjectFor(f), text: renderText(f), html: renderHtml(f) });
  } catch (e) {
    throw new Error(readable(e));
  }
  if (scheduled && f.stub) setSetting('stub_mail_last', new Date().toISOString());
}

/** A send is tried from the chosen hour until four hours after it, so a short outage doesn't lose the day. */
const WINDOW_HOURS = 4;
const dueNow = (now) => sendDays().includes(now.getDay()) && now.getHours() >= sendHour() && now.getHours() < sendHour() + WINDOW_HOURS && getSetting('mail_last') !== iso(now);

function nextSend(now = new Date()) {
  const days = sendDays();
  if (!days.length) return null;
  if (dueNow(now)) return now.getTime();
  for (let i = 0; i <= 7; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, sendHour());
    if (days.includes(d.getDay()) && d > now) return d.getTime();
  }
  return null;
}
/** After the schedule changes or the email is switched on, today's send is skipped if its hour has already come, so nothing goes out unexpectedly. */
function skipTodayIfPast() {
  const now = new Date(), today = iso(now);
  if (now.getHours() >= sendHour()) { setSetting('mail_last', today); return; }
  // The hour is still ahead. If today was only marked as done by an earlier skip (switching it on
  // after the old hour, say) and nothing was really sent, let today's email go out at the new hour.
  const sent = Number(getSetting('mail_sent_at')) || 0;
  if (getSetting('mail_last') === today && (!sent || iso(new Date(sent)) !== today)) setSetting('mail_last', '');
}

export function installMail(app, deps) {
  const state = () => ({
    user: getSetting('mail_user') || '', hasPassword: !!getSetting('mail_password'), to: recipients(), on: getSetting('mail_on') === '1',
    days: sendDays(), hour: sendHour(), schedule: `${daysInWords(sendDays())} at ${hourInWords(sendHour())}`,
    lastSent: Number(getSetting('mail_sent_at')) || null, lastError: getSetting('mail_error') || '', nextSend: getSetting('mail_on') === '1' && ready() ? nextSend() : null,
  });
  app.get('/api/mail', (_req, res) => res.json(state()));

  app.put('/api/mail', (req, res) => {
    const b = req.body || {};
    if (b.user !== undefined) {
      const user = String(b.user).trim();
      if (user && !ADDRESS.test(user)) return res.status(400).json({ error: 'Enter the Gmail address the summary is sent from.' });
      setSetting('mail_user', user);
    }
    if (b.password) {
      // Google shows app passwords in groups of four with spaces between.
      const p = String(b.password).replace(/\s+/g, '');
      if (p.length < 8 || p.length > 64) return res.status(400).json({ error: "That doesn't look like an app password. It's 16 letters, shown by Google in four groups." });
      setSetting('mail_password', p);
    }
    if (b.to !== undefined) {
      const list = [...new Set((Array.isArray(b.to) ? b.to : String(b.to).split(/[,;\s]+/)).map((s) => String(s).trim()).filter(Boolean))];
      const wrong = list.find((a) => !ADDRESS.test(a));
      if (wrong) return res.status(400).json({ error: `${wrong} isn't a complete email address.` });
      if (list.length > 6) return res.status(400).json({ error: 'Up to six addresses.' });
      setSetting('mail_to', list.join(', '));
      // With nobody to send to, it can't stay on.
      if (!list.length) setSetting('mail_on', '');
    }
    if (b.days !== undefined || b.hour !== undefined) {
      const days = b.days === undefined ? sendDays() : [...new Set((Array.isArray(b.days) ? b.days : []).map(Number))].sort();
      const hour = b.hour === undefined ? sendHour() : Number(b.hour);
      if (!days.length || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return res.status(400).json({ error: 'Choose at least one day.' });
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) return res.status(400).json({ error: 'Choose a time.' });
      setSetting('mail_days', days.join(',')); setSetting('mail_hour', String(hour));
      skipTodayIfPast();
    }
    if (b.on !== undefined) {
      if (b.on && getSetting('mail_on') !== '1' && ready()) skipTodayIfPast();
      if (b.on && !ready()) return res.status(400).json({ error: 'Add the Gmail address, its app password and at least one address to send to first.' });
      setSetting('mail_on', b.on ? '1' : '');
    }
    setSetting('mail_error', '');
    res.json(state());
  });

  app.delete('/api/mail/password', (_req, res) => { setSetting('mail_password', ''); setSetting('mail_on', ''); res.json(state()); });

  // What this week's email would look like right now.
  app.get('/api/mail/preview', (_req, res) => {
    const f = weeklyFigures(deps);
    res.json({ subject: subjectFor(f), html: renderHtml(f) });
  });

  // A test goes only to the sending address, so nobody else gets practice runs.
  app.post('/api/mail/test', async (_req, res) => {
    if (!getSetting('mail_user') || !getSetting('mail_password')) return res.status(400).json({ error: 'Save the Gmail address and app password first.' });
    try { await send(deps, getSetting('mail_user')); setSetting('mail_error', ''); res.json({ ...state(), sentTo: getSetting('mail_user') }); } catch (e) { res.status(502).json({ error: e.message }); }
  });

  // Checked every five minutes; three tries a day if Gmail is unreachable.
  let tries = 0, triedOn = '';
  const tick = async () => {
    const now = new Date(), today = iso(now);
    if (getSetting('mail_on') !== '1' || !ready() || !dueNow(now)) return;
    if (triedOn !== today) { triedOn = today; tries = 0; }
    if (tries >= 3) return;
    tries++;
    try {
      await send(deps, recipients(), true);
      setSetting('mail_last', today); setSetting('mail_sent_at', String(Date.now())); setSetting('mail_error', '');
    } catch (e) {
      setSetting('mail_error', e.message);
    }
  };
  setInterval(tick, 5 * 60000).unref();
}
