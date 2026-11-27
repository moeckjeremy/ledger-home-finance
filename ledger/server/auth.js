// Password protection. Once a password is set, every API request needs a
// signed-in session cookie. The password is stored only as a salted hash.
import { demoMode, demoResetAt } from './demo.js';
import { currency } from './money.js';
import crypto from 'node:crypto';
import os from 'node:os';
import fs from 'node:fs';
import { db, getSetting, setSetting } from './db.js';
import { installPasskeyLogin, passkeyOrigins } from './passkeys.js';
import { hostAi } from './ai.js';
import { copyActivity, noteActive } from './activity.js';
import { accessConfigured, accessIdentity, accessLogin, setAccess } from './access.js';
import { eraseEverything } from './erase.js';

// Browsers keep cookies per host, not per port, and every copy on the NAS shares one address, so with
// one cookie name signing in to a second copy (the trial, say) signed the first one out (found by the
// NAS session's review, 2026-11-18). Each copy now names its cookie after itself: a short id made once
// and kept in its database. The old name is still read, so nobody was signed out by this change.
const OLD_COOKIE = 'ledger_session';
if (!getSetting('copy_id')) setSetting('copy_id', crypto.randomBytes(4).toString('hex'));
const COOKIE = `ledger_session_${getSetting('copy_id')}`;
const SESSION_DAYS = 90;
const hash = (password, salt) => crypto.scryptSync(password, salt, 32).toString('hex');
export const passwordSet = () => getSetting('password_hash') !== '';
// A copy made for another household is started with a one-time setup code (LEDGER_SETUP_CODE). Until
// its first password is set, nothing in the app can be reached, and the code is what lets the
// household set that password from their own device. After that the code does nothing.
const setupCode = () => String(process.env.LEDGER_SETUP_CODE || '').trim();
// A family copy can also be claimed, and signed in to, with Cloudflare's check alone (server/access.js).
// "Claimed" means somebody has made it theirs: by setting a password, or by choosing that.
export const claimed = () => passwordSet() || accessLogin();
export const awaitingSetupCode = () => setupCode() !== '' && !claimed();
const sameText = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

function setPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  setSetting('password_hash', `${salt}:${hash(password, salt)}`);
}
const matches = (password, saved) => {
  const [salt, stored] = String(saved || '').split(':');
  if (!salt || !stored) return false;
  return crypto.timingSafeEqual(Buffer.from(hash(password, salt), 'hex'), Buffer.from(stored, 'hex'));
};
const checkPassword = (password) => matches(password, getSetting('password_hash'));

// A sign-in for each person (added 2026-11-18, the owner's request after comparing with other budget apps).
// The first password stays where it always was (setting `password_hash`) and is "the first sign-in": it can
// add and remove the others. Each other person has a name and a password of their own in `people`. There
// are no user names to type: the sign-in screen takes a password and Ledger sees whose it is, so no two
// people may have the same one. Everyone sees the same household; this is about who can get in, changing
// your own password without telling anyone else's, and taking one person's access away.
db.exec('CREATE TABLE IF NOT EXISTS people (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, hash TEXT NOT NULL, created INTEGER NOT NULL)');
for (const col of ['person INTEGER NOT NULL DEFAULT 0', "who TEXT NOT NULL DEFAULT ''"]) { try { db.exec(`ALTER TABLE sessions ADD COLUMN ${col}`); } catch { /* already there */ } }
/** Whose password this is: 0 for the first sign-in, a person's id, or null for nobody's. */
function whose(password) {
  if (checkPassword(password)) return 0;
  for (const p of db.prepare('SELECT id, hash FROM people').all()) if (matches(password, p.hash)) return p.id;
  return null;
}
const newHash = (password) => { const salt = crypto.randomBytes(16).toString('hex'); return `${salt}:${hash(password, salt)}`; };

const sessionToken = (req) => {
  const all = (req.headers.cookie || '').split(';').map((c) => c.trim().split('='));
  return all.find(([k]) => k === COOKIE)?.[1] || all.find(([k]) => k === OLD_COOKIE)?.[1];
};
// Running as a Home Assistant add-on (LEDGER_INGRESS=1): Home Assistant has already signed the person in
// before a request reaches Ledger through its sidebar, and every such request comes from the Supervisor's
// own address. Those count as signed in. Anything arriving another way (a port opened by hand) gets
// nothing until a Ledger password has been set, and then needs it.
const INGRESS = process.env.LEDGER_INGRESS === '1';
const INGRESS_FROM = process.env.LEDGER_INGRESS_FROM || '172.30.32.2';
export const viaIngress = (req) => INGRESS && String(req?.socket?.remoteAddress || '').replace(/^::ffff:/, '') === INGRESS_FROM;
function signedIn(req) {
  if (viaIngress(req)) return true;
  const token = sessionToken(req);
  if (!token) return false;
  return !!db.prepare('SELECT 1 FROM sessions WHERE token = ? AND expires > ?').get(token, Date.now());
}
// A sign-in lasts SESSION_DAYS from the last day it was used, not from the day it was made: someone who
// opens Ledger regularly is never signed out (The owner, 2026-11-23). At most once a day per device, the
// session's end date and its cookie are pushed out again.
function renew(req, res) {
  const token = sessionToken(req);
  if (!token) return;
  const row = db.prepare('SELECT expires FROM sessions WHERE token = ? AND expires > ?').get(token, Date.now());
  if (!row || row.expires - Date.now() > (SESSION_DAYS - 1) * 86400000) return;
  db.prepare('UPDATE sessions SET expires = ? WHERE token = ?').run(Date.now() + SESSION_DAYS * 86400000, token);
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}
const sessionOf = (req) => { const token = sessionToken(req); return token ? db.prepare('SELECT person, who FROM sessions WHERE token = ? AND expires > ?').get(token, Date.now()) : undefined; };
function startSession(res, req, person = 0, who = '') {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token, expires, person, who) VALUES (?, ?, ?, ?)').run(token, Date.now() + SESSION_DAYS * 86400000, person, String(who).slice(0, 120));
  // On the secure address the cookie is marked so it never travels over plain http.
  const secure = req?.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}

// A request is from this Mac if it comes from localhost or from one of the
// Mac's own network addresses (as when you open the .local address here).
//
// Inside a container that test can never pass: a browser on the very computer that runs Docker reaches
// Ledger through Docker's own network, so it arrives from an address that is neither localhost nor one of
// the container's own. Found on 2026-11-25 on a Windows PC: a plain Docker install said "open Ledger on
// the Mac that runs it" and could never set a password, which also kept most of Settings hidden. So in a
// container, a request from a private address (the home network, Docker's bridge, a Tailscale address)
// counts: whoever opens a brand-new copy first sets its password, as on other self-hosted apps. This only
// ever matters while no password exists. An add-on and a hosted copy have stricter rules of their own.
const inContainer = fs.existsSync('/.dockerenv') || !!process.env.LEDGER_RELEASE;
const privateAddress = (from) => {
  if (from === '::1' || /^f[cd][0-9a-f]{2}:/i.test(from) || /^fe80:/i.test(from)) return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(from);
  if (!m) return false;
  const a = Number(m[1]), b = Number(m[2]);
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
};
const isThisMac = (req) => {
  if (demoMode()) return false;   // nobody is "at the computer" on a public demo: no first password can be set
  const from = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (from === '127.0.0.1' || from === '::1') return true;
  if (inContainer && privateAddress(from)) return true;
  return Object.values(os.networkInterfaces()).flat().some((n) => n && n.address === from);
};

// Slow down password guessing: after 8 wrong tries, wait 15 minutes.
// Counted per address since 2026-11-18 (the NAS session's review): before, eight wrong tries from any one
// device locked everyone out of the copy. Behind Cloudflare every request arrives from the tunnel, so on a
// family copy the visitor's address is the one Cloudflare reports; anywhere else it is the connection's own.
// Someone on the home network could make that header up, which is why the whole copy still has a ceiling.
let failures = [];
const fromWhere = (req) => String((setupCode() !== '' && req?.headers?.['cf-connecting-ip']) || req?.socket?.remoteAddress || '').replace(/^::ffff:/, '').slice(0, 60);
const tooManyFailures = (req) => {
  failures = failures.filter((f) => f.t > Date.now() - 15 * 60000);
  const a = fromWhere(req);
  return failures.length >= 40 || failures.filter((f) => f.a === a).length >= 8;
};
const noteFailure = (req) => { failures.push({ t: Date.now(), a: fromWhere(req) }); };

export function installAuth(app) {
  app.get('/api/auth/status', async (req, res) => {
    // On a family copy behind Cloudflare: who Cloudflare says this is, and whether that alone signs them in here.
    const offered = setupCode() !== '' && accessConfigured();
    const who = offered ? await accessIdentity(req) : null;
    res.json({ demo: demoMode() ? { resetAt: demoResetAt(), repo: /^[\w.-]+\/[\w.-]+$/.test(process.env.LEDGER_REPO || '') ? process.env.LEDGER_REPO : '' } : undefined, ingress: viaIngress(req), invited: setupCode() !== '', passwordSet: passwordSet(), signedIn: awaitingSetupCode() ? false : !claimed() || signedIn(req),
      access: offered ? { email: who?.email || null, login: accessLogin() } : null, needsSetupCode: awaitingSetupCode(), setupDone: getSetting('setup_done', '1') !== '0', thisMac: isThisMac(req), passkeyOrigins: passkeyOrigins(),
      // The look a device starts with before anyone chooses one in Settings: plain Onyx on a family copy
      // (The owner's choice, 2026-11-18), the holiday scenes on his own. Family copies are the ones with a setup code.
      // Every other copy starts plain as well (2026-11-24, after he saw the add-on open on the holiday scenes:
      // "Ledger should be starting with standard background"). A copy starts on the scenes only where its
      // setting `start_look` says 'auto', which is set on the owner's own copy and nowhere else.
      currency: currency(),
      look: !process.env.LEDGER_SETUP_CODE && getSetting('start_look') === 'auto' ? 'auto' : 'none',
      // A family copy's sign-in screen offers "Forgot your password?" (a reset code from whoever runs the copies).
      canReset: setupCode() !== '' && claimed(),
      // Whether "Email me a reset code" can work here (the copy knows how to reach the request service).
      // "Delete everything" in Settings: a family copy's household can wipe its own copy (never the host's own).
      canErase: setupCode() !== '' && claimed(),
      canEmailReset: setupCode() !== '' && claimed() && !!process.env.LEDGER_FEEDBACK_URL && !!process.env.LEDGER_FEEDBACK_KEY });
  });

  // The first password can only be created from the Mac running the app.
  app.post('/api/auth/setup', (req, res) => {
    if (passwordSet()) return res.status(400).json({ error: 'A password is already set.' });
    // A copy claimed with Cloudflare's check alone can add a password later, from a signed-in device.
    if (accessLogin()) {
      if (!signedIn(req)) return res.status(401).json({ error: 'Sign in first.' });
      const password = String(req.body?.password || '');
      if (password.length < 8) return res.status(400).json({ error: 'Use at least 8 characters.' });
      setPassword(password);
      return res.json({ ok: true });
    }
    if (awaitingSetupCode()) {
      if (tooManyFailures(req)) return res.status(429).json({ error: 'Too many wrong tries. Wait 15 minutes and try again.' });
      if (!sameText(String(req.body?.code || '').trim(), setupCode())) { noteFailure(req); return res.status(401).json({ error: "That setup code isn't right. It's the one you were given with the link." }); }
    } else if (INGRESS) {
      // As an add-on, the first password is set from inside Home Assistant and nowhere else: "this machine"
      // means nothing useful inside a container, and an opened port must never be a way to claim the copy.
      if (!viaIngress(req)) return res.status(403).json({ error: 'Set the password from Ledger inside Home Assistant: Settings, Password.' });
    } else if (!isThisMac(req)) return res.status(403).json({ error: 'Set the password from the computer that runs Ledger, or from a device on the same home network.' });
    const password = String(req.body?.password || '');
    if (password.length < 8) return res.status(400).json({ error: 'Use at least 8 characters.' });
    setPassword(password);
    startSession(res, req);
    res.json({ ok: true });
  });

  app.post('/api/auth/login', (req, res) => {
    if (tooManyFailures(req)) return res.status(429).json({ error: 'Too many wrong tries. Wait 15 minutes and try again.' });
    const person = whose(String(req.body?.password || ''));
    if (person === null) {
      noteFailure(req);
      return res.status(401).json({ error: "That password isn't right." });
    }
    startSession(res, req, person);
    res.json({ ok: true });
  });

  installPasskeyLogin(app, { startSession, tooManyFailures, noteFailure });

  // ---- Signing in with Cloudflare's check alone, on a family copy (server/access.js) ----
  // Claiming a brand-new copy this way: no setup code is asked for, because Cloudflare only lets through
  // an email the host approved for this copy, which is what the code was proving.
  app.post('/api/auth/access/claim', async (req, res) => {
    if (!awaitingSetupCode()) return res.status(400).json({ error: 'This copy has already been set up.' });
    const who = await accessIdentity(req);
    if (!who) return res.status(401).json({ error: "Cloudflare's sign-in couldn't be confirmed here. Open Ledger from the link in your welcome email, or set a password with your setup code." });
    setSetting('access_login', '1');
    startSession(res, req, 0, who.email);
    res.json({ ok: true, email: who.email });
  });
  // Every later visit: a session is started from the same check.
  app.post('/api/auth/access/login', async (req, res) => {
    if (setupCode() === '' || !accessLogin()) return res.status(400).json({ error: "This copy doesn't sign in that way." });
    const who = await accessIdentity(req);
    if (!who) return res.status(401).json({ error: "Cloudflare's sign-in couldn't be confirmed here. Open Ledger at its web address." });
    startSession(res, req, 0, who.email);
    res.json({ ok: true, email: who.email });
  });
  // The host's Ledger tells a copy which Cloudflare team and application it sits behind (setup code, like host-ai).
  app.post('/api/auth/host-access', (req, res) => {
    if (!setupCode()) return res.status(400).json({ error: 'Not a family copy.' });
    if (tooManyFailures(req)) return res.status(429).json({ error: 'Too many wrong tries. Wait 15 minutes and try again.' });
    if (!sameText(String(req.headers['x-setup-code'] || ''), setupCode())) { noteFailure(req); return res.status(401).json({ error: 'Not allowed.' }); }
    if (req.body?.team !== undefined && !setAccess(req.body)) return res.status(400).json({ error: 'Those details are not usable.' });
    res.json({ configured: accessConfigured(), login: accessLogin(), passwordSet: passwordSet() });
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = sessionToken(req);
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });

  // ---- A forgotten password, on a family copy (added 2026-11-18) ----
  // The household can't reset it by themselves: the person who runs the copies opens a reset from
  // their own Ledger (Settings, Family requests), which calls reset-open here with this copy's setup
  // code, known only to the two servers. That returns a one-time reset code, good for a day, which is
  // emailed to the family member; with it they choose a new password on the sign-in screen. Every
  // device is signed out when the password changes.
  const resetHash = (code) => crypto.createHash('sha256').update(`ledger-reset:${code}`).digest('hex');
  app.post('/api/auth/reset-open', (req, res) => {
    // Also for a copy with no password that opens with Cloudflare's check alone: the code then lets the
    // household set a first password, their way back in if that check ever can't be confirmed.
    if (!setupCode() || !claimed()) return res.status(400).json({ error: "This copy hasn't been set up by anyone yet." });
    if (tooManyFailures(req)) return res.status(429).json({ error: 'Too many wrong tries. Wait 15 minutes and try again.' });
    if (!sameText(String(req.headers['x-setup-code'] || ''), setupCode())) { noteFailure(req); return res.status(401).json({ error: 'Not allowed.' }); }
    // Easy to read aloud or type from an email: three groups of four, no look-alike characters.
    const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const code = Array.from(crypto.randomBytes(12), (b, i) => (i && i % 4 === 0 ? '-' : '') + letters[b % letters.length]).join('');
    setSetting('reset_hash', resetHash(code));
    setSetting('reset_until', String(Date.now() + 24 * 3600_000));
    res.json({ code, hours: 24 });
  });
  // The host's Ledger says whether this copy may use the host's AI key, and reads how much of it has been
  // used this month (a dollar figure, nothing else). Let in by this copy's setup code, like reset-open, and
  // it works before a password exists, because the choice is made when the copy is handed out.
  app.post('/api/auth/host-ai', (req, res) => {
    if (!setupCode()) return res.status(400).json({ error: 'Not a family copy.' });
    if (tooManyFailures(req)) return res.status(429).json({ error: 'Too many wrong tries. Wait 15 minutes and try again.' });
    if (!sameText(String(req.headers['x-setup-code'] || ''), setupCode())) { noteFailure(req); return res.status(401).json({ error: 'Not allowed.' }); }
    res.json(hostAi(req.body));
  });
  // How much this copy is used, for the host's Family requests section: days opened, setup finished, bank
  // connected (yes or no), devices, AI cost, file size, build. Nothing of what is in it; see server/activity.js.
  app.post('/api/auth/host-activity', (req, res) => {
    if (!setupCode()) return res.status(400).json({ error: 'Not a family copy.' });
    if (tooManyFailures(req)) return res.status(429).json({ error: 'Too many wrong tries. Wait 15 minutes and try again.' });
    if (!sameText(String(req.headers['x-setup-code'] || ''), setupCode())) { noteFailure(req); return res.status(401).json({ error: 'Not allowed.' }); }
    res.json(copyActivity());
  });
  // "Email me a reset code": the household asks by themselves. This copy can't send email, so it
  // hands the request to the request service, and the host's Ledger sends the code within a minute
  // to the email addresses this copy was set up with. The answer here is the same whether or not
  // that works, and nothing typed on this screen decides where the code goes.
  let lastForgot = 0;
  app.post('/api/auth/forgot', async (_req, res) => {
    const url = String(process.env.LEDGER_FEEDBACK_URL || '').replace(/\/+$/, ''), key = String(process.env.LEDGER_FEEDBACK_KEY || '');
    if (!setupCode() || !claimed() || !url || !key) return res.status(400).json({ error: 'This copy can\'t email a reset code. Ask the person who set it up for one.' });
    if (Date.now() - lastForgot < 120000) return res.json({ ok: true });
    lastForgot = Date.now();
    try {
      await fetch(`${url}/reset-request`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-feedback-key': key }, body: JSON.stringify({ source: process.env.LEDGER_HOUSEHOLD || '' }), signal: AbortSignal.timeout(8000) });
    } catch { /* the same answer either way */ }
    res.json({ ok: true });
  });
  app.post('/api/auth/reset', (req, res) => {
    if (tooManyFailures(req)) return res.status(429).json({ error: 'Too many wrong tries. Wait 15 minutes and try again.' });
    const open = getSetting('reset_hash') !== '' && Number(getSetting('reset_until', '0')) > Date.now();
    const code = String(req.body?.code || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!open || !sameText(resetHash(code), getSetting('reset_hash'))) { noteFailure(req); return res.status(401).json({ error: "That reset code isn't right, or it has run out. Ask for a new one." }); }
    const password = String(req.body?.password || '');
    if (password.length < 8) return res.status(400).json({ error: 'Use at least 8 characters.' });
    if (whose(password) !== null && !checkPassword(password)) return res.status(400).json({ error: 'Choose a different password.' });
    setPassword(password);
    setSetting('reset_hash', ''); setSetting('reset_until', '0');
    db.prepare('DELETE FROM sessions').run();
    startSession(res, req);
    res.json({ ok: true });
  });

  app.use('/api', (req, res, next) => {
    if (INGRESS && !viaIngress(req) && !claimed()) return res.status(401).json({ error: 'Open Ledger from Home Assistant. To use this address as well, set a Ledger password in Settings first.' });
    if (!awaitingSetupCode() && (!claimed() || signedIn(req))) { if (claimed()) { noteActive(); renew(req, res); } return next(); }
    res.status(401).json({ error: 'Sign in to continue.' });
  });

  // ---- Signed in: change the password, or sign every other device out ----
  // Changing the password signs out every other device, so a lost phone can't stay in.
  app.post('/api/auth/password', (req, res) => {
    if (!passwordSet()) return res.status(400).json({ error: 'No password is set yet.' });
    if (tooManyFailures(req)) return res.status(429).json({ error: 'Too many wrong tries. Wait 15 minutes and try again.' });
    const me = sessionOf(req)?.person || 0;
    const mine = me ? db.prepare('SELECT hash FROM people WHERE id = ?').get(me)?.hash : getSetting('password_hash');
    if (!matches(String(req.body?.current || ''), mine)) { noteFailure(req); return res.status(401).json({ error: "Your current password isn't right." }); }
    const password = String(req.body?.password || '');
    if (password.length < 8) return res.status(400).json({ error: 'Use at least 8 characters for the new one.' });
    const taken = whose(password);
    if (taken !== null && taken !== me) return res.status(400).json({ error: 'Choose a different password.' });
    if (me) db.prepare('UPDATE people SET hash = ? WHERE id = ?').run(newHash(password), me); else setPassword(password);
    // Your other devices are signed out, so a lost phone can't stay in. Other people's devices are left alone.
    const others = db.prepare('DELETE FROM sessions WHERE token != ? AND person = ?').run(sessionToken(req) || '', me).changes;
    res.json({ ok: true, signedOut: others });
  });
  // ---- "Delete everything" (Settings, on a family copy): see server/erase.js ----
  // Only the first sign-in may, with the password where there is one, or else while Cloudflare is vouching
  // for them at this moment; and the words typed out, so it can't happen by a slip.
  let erasing = false;
  app.post('/api/auth/erase', async (req, res) => {
    if (setupCode() === '') return res.status(400).json({ error: "This copy can't be erased from here." });
    if (!claimed() || !signedIn(req)) return res.status(401).json({ error: 'Sign in first.' });
    if ((sessionOf(req)?.person || 0) !== 0) return res.status(403).json({ error: 'Only the first sign-in can delete everything.' });
    if (tooManyFailures(req)) return res.status(429).json({ error: 'Too many wrong tries. Wait 15 minutes and try again.' });
    if (String(req.body?.confirm || '').trim().toLowerCase() !== 'delete everything') return res.status(400).json({ error: 'Type the words "delete everything" to go ahead.' });
    if (passwordSet()) {
      if (!checkPassword(String(req.body?.password || ''))) { noteFailure(req); return res.status(401).json({ error: "That password isn't right." }); }
    } else if (!(await accessIdentity(req))) return res.status(401).json({ error: "Your sign-in at the web address couldn't be confirmed. Sign out, sign in again and try once more." });
    if (erasing) return res.json({ ok: true });
    erasing = true;
    res.json({ ok: true });
    setTimeout(() => { eraseEverything(); }, 400);
  });
  // ---- The people who can sign in ----
  const first = (req) => (sessionOf(req)?.person || 0) === 0;
  app.get('/api/auth/people', (req, res) => {
    const me = sessionOf(req);
    const devices = (id) => db.prepare('SELECT COUNT(*) n FROM sessions WHERE person = ? AND expires > ?').get(id, Date.now()).n;
    res.json({
      passwordSet: passwordSet(), you: me?.person || 0, canManage: first(req), firstName: getSetting('first_name'), firstDevices: devices(0),
      people: db.prepare('SELECT id, name, created FROM people ORDER BY id').all().map((p) => ({ ...p, devices: devices(p.id) })),
    });
  });
  app.put('/api/auth/people/first', (req, res) => {
    if (!first(req)) return res.status(403).json({ error: 'Only the first sign-in can change this.' });
    setSetting('first_name', String(req.body?.name || '').trim().slice(0, 40));
    res.json({ ok: true });
  });
  app.post('/api/auth/people', (req, res) => {
    if (!passwordSet()) return res.status(400).json({ error: 'Set a password for this Ledger first.' });
    if (!first(req)) return res.status(403).json({ error: 'Only the first sign-in can add people.' });
    const name = String(req.body?.name || '').trim().slice(0, 40), password = String(req.body?.password || '');
    if (!name) return res.status(400).json({ error: 'Enter their name.' });
    if (db.prepare('SELECT 1 FROM people WHERE lower(name) = lower(?)').get(name)) return res.status(400).json({ error: `${name} already has a sign-in.` });
    if (db.prepare('SELECT COUNT(*) n FROM people').get().n >= 8) return res.status(400).json({ error: 'That is as many people as one Ledger takes.' });
    if (password.length < 8) return res.status(400).json({ error: 'Use at least 8 characters for their password.' });
    if (whose(password) !== null) return res.status(400).json({ error: 'Choose a different password for them.' });
    const id = Number(db.prepare('INSERT INTO people (name, hash, created) VALUES (?, ?, ?)').run(name, newHash(password), Date.now()).lastInsertRowid);
    res.json({ id });
  });
  app.delete('/api/auth/people/:id', (req, res) => {
    if (!first(req)) return res.status(403).json({ error: 'Only the first sign-in can remove people.' });
    const id = Number(req.params.id);
    if (!db.prepare('DELETE FROM people WHERE id = ?').run(id).changes) return res.status(400).json({ error: 'That person is not there.' });
    db.prepare('DELETE FROM sessions WHERE person = ?').run(id);
    res.json({ ok: true });
  });
  app.post('/api/auth/signout-others', (req, res) => {
    res.json({ signedOut: db.prepare('DELETE FROM sessions WHERE token != ? AND (person = ? OR ? = 0)').run(sessionToken(req) || '', sessionOf(req)?.person || 0, sessionOf(req)?.person || 0).changes });
  });
  // Switching "Cloudflare's check alone signs me in" on or off, from a signed-in device. It can't be switched
  // off while there is no password, or nobody could get back in.
  app.put('/api/auth/access', async (req, res) => {
    if (setupCode() === '' || !accessConfigured()) return res.status(400).json({ error: "This copy can't sign in that way." });
    const on = !!req.body?.on;
    if (!on && !passwordSet()) return res.status(400).json({ error: 'Set a password first, or there would be no way back in.' });
    if (on && !(await accessIdentity(req))) return res.status(400).json({ error: "Switch this on from Ledger's web address, after signing in there with Google or the emailed code." });
    setSetting('access_login', on ? '1' : '0');
    res.json({ login: accessLogin() });
  });
  app.get('/api/auth/devices', (req, res) => res.json({ others: Math.max(0, db.prepare('SELECT COUNT(*) n FROM sessions WHERE expires > ?').get(Date.now()).n - (sessionToken(req) ? 1 : 0)) }));
}
