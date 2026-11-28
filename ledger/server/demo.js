// Demo mode (2026-11-27, the owner's go-ahead for a public demo with made-up figures).
// A copy started with LEDGER_DEMO=1 is meant to be opened by strangers with no sign-in, so it is locked
// down here, in one place, rather than by trusting each feature to behave:
//
//   - It only ever holds the sample household. Nothing that brings in real data works (bank connection,
//     file import, uploads, readers).
//   - No password can be set, so nobody can lock everyone else out. Nothing under /api/auth changes anything.
//   - Nothing that sends email, calls an AI, or reaches another site at a visitor's request works. (The
//     one outgoing thing left is fetching a shop's logo from the icon services, as on any copy.)
//   - Changing things is allowed only on a short list of everyday routes (ALLOWED below). **Anything not
//     on the list is refused**, so a route added later is closed in the demo until someone lists it.
//   - Everything a visitor changes is thrown away: the database is deleted and the process stops, at most
//     RESET_MIN minutes after the first change, after MAX_CHANGES changes, and whenever the day changes
//     (the sample data is laid out around the day it was made). Whatever runs the container starts it again
//     with a fresh sample household, exactly as "Delete everything" does on a family copy.
//   - Each address is held to a fair number of requests.
//
// It is refused together with a setup code or Home Assistant, which mean a real household.
import fs from 'node:fs';
import { db, dbPath, iso } from './db.js';

export const demoMode = () => process.env.LEDGER_DEMO === '1' && !process.env.LEDGER_SETUP_CODE && process.env.LEDGER_INGRESS !== '1';

const RESET_MIN = Math.max(1, Number(process.env.LEDGER_DEMO_RESET_MIN) || 60);
const MAX_CHANGES = 1500;
const PER_ADDRESS = 900;          // requests per address in WINDOW
const WINDOW = 5 * 60 * 1000;

// Routes that may change something in the demo. Matched against the path under /api.
const ALLOWED = [
  /^\/transactions(\/\d+(\/(income|leave-out|refund|split|unsplit))?|\/categorize|\/deduct|\/restore)?$/,
  /^\/transfers$/, /^\/undo$/,
  /^\/accounts(\/\d+(\/(balance|budget|move|name|owner|statement|type|value-link|depreciate))?)?$/,
  /^\/categories(\/\d+(\/(aside|hide|merge|move|place))?)?$/,
  /^\/category-groups(\/\d+(\/move)?)?$/,
  /^\/budget-plan$/, /^\/zero(\/(assign|fill|move|reset))?$/,
  /^\/recurrings(\/\d+|\/ignore(\/\d+)?)?$/, /^\/bills\/(rename|link)$/, /^\/changes(\/\d+)?$/, /^\/cashflow\/(amount|pending)$/,
  /^\/goals(\/\d+(\/move)?)?$/, /^\/holdings\/\d+$/, /^\/investments\/\d+\/holdings$/,
  /^\/allowance(\/kids(\/\d+(\/entries)?)?|\/entries\/\d+)?$/,
  /^\/paydays(\/\d+(\/calendar)?)?$/, /^\/paystub\/(apply|names|remind|skip|\d+)$/,
  /^\/gig(\/more|\/jobs(\/\d+|\/match)?)?$/, /^\/gigs(\/\d+)?$/,
  /^\/deductions(\/\d+)?$/, /^\/deposits\/review$/, /^\/rules\/forget$/,
  /^\/tax\/(more|on|preparer|hints\/(answer|ask|asked|clear|use)|pack\/notes(\/[\w-]+)?)$/,
  /^\/highlight\/(seen|ignore|another)$/, /^\/vehicles\/\d+\/odometer$/, /^\/budget-month$/, /^\/settings$/, /^\/statements\/remind$/, /^\/ai\/(names|private)$/, /^\/recap\/refresh$/,
  /^\/setup\/(account|done|budgets\/(apply|suggest))$/,
];
// Reading these would reach another site or hand over something the demo shouldn't.
// Each ends at a slash or the end, so "/repo" does not also catch "/reports" (it did for a day: the demo's
// Reports page was refused).
const NO_READ = [/^\/gig\/pay(\/|$)/, /^\/repo(\/|$)/, /^\/fly(\/|$)/, /^\/tax\/docs(\/|$)/];

let changes = 0, firstChange = 0;
// Visits, for whoever runs the demo (2026-11-27). A visit is the page itself being opened from an address
// that has not opened it in the last half hour. It is a bare count: nothing about who, and nothing is
// written to disk. It is offered at /metrics in the plain text form a host's own metrics collector reads
// (Fly.io scrapes it and keeps the history), so it survives the wipes, which restart this process.
let visits = 0;
const visitors = new Map();   // address -> when it last opened the page
const VISIT_GAP = 30 * 60 * 1000;
const bootDay = iso(new Date());
const seen = new Map();   // address -> [window start, count]

function reset(why) {
  console.log(`Demo: starting over with fresh sample data (${why}).`);
  try { db.close(); } catch { /* already closed */ }
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(f, { force: true });
  process.exit(0);
}

/**
 * Which version the demo is running and when it was last rebuilt, for its banner (the owner: "Running
 * Version XXXX. Updated XXXX"). The version is the one the image was built as (LEDGER_RELEASE); the date is
 * when its pages were built, read from the built page's own file.
 */
export function demoBuild() {
  let updated = '';
  try { updated = iso(fs.statSync(new URL('../dist/index.html', import.meta.url)).mtime); } catch { /* run from source: no built page */ }
  const v = process.env.LEDGER_RELEASE || '';
  return { version: /^\d+\.\d+\.\d+$/.test(v) ? v : '', updated };
}

/** When the demo will next be wiped, for the banner. Null while nothing has been changed. */
export const demoResetAt = () => (firstChange ? firstChange + RESET_MIN * 60000 : null);

export function installDemo(app) {
  if (!demoMode()) return;
  console.log(`Demo mode: made-up data only, no sign-in, changes wiped ${RESET_MIN} minutes after the first one.`);
  app.get('/metrics', (_req, res) => res.type('text/plain; version=0.0.4').send(`# HELP ledger_demo_visits_total Times the demo's page was opened (one per address per half hour).\n# TYPE ledger_demo_visits_total counter\nledger_demo_visits_total ${visits}\n`));
  app.use((req, _res, next) => {
    if (req.method === 'GET' && (req.path === '/' || req.path === '/index.html')) {
      const from = String(req.headers['fly-client-ip'] || req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '').slice(0, 64);
      const now = Date.now(), last = visitors.get(from) || 0;
      if (now - last > VISIT_GAP) visits++;
      visitors.set(from, now);
      if (visitors.size > 5000) for (const [k, v] of visitors) if (now - v > VISIT_GAP) visitors.delete(k);
    }
    next();
  });
  app.use('/api', (req, res, next) => {
    // A fair share per address. Behind a host's proxy the visitor's own address is in a header.
    const from = String(req.headers['fly-client-ip'] || req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '').slice(0, 64);
    const now = Date.now();
    const s = seen.get(from);
    if (!s || now - s[0] > WINDOW) seen.set(from, [now, 1]);
    else if (++s[1] > PER_ADDRESS) return res.status(429).json({ error: 'The demo is busy with requests from your address. Try again in a few minutes.' });
    if (seen.size > 5000) for (const [k, v] of seen) if (now - v[0] > WINDOW) seen.delete(k);

    const p = req.path.replace(/\/+$/, '');
    const reading = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
    if (reading) return NO_READ.some((r) => r.test(p)) ? res.status(403).json({ error: 'That is switched off in the demo.' }) : next();
    if (!ALLOWED.some((r) => r.test(p))) return res.status(403).json({ error: 'That is switched off in the demo. Install your own copy of Ledger to use it.' });
    // Typed text is kept short: other visitors see it until the next reset.
    if (JSON.stringify(req.body || {}).length > 6000) return res.status(413).json({ error: 'That is too much for the demo.' });
    if (!firstChange) firstChange = now;
    if (++changes >= MAX_CHANGES) { res.on('finish', () => reset('a great many changes')); }
    next();
  });
  setInterval(() => {
    if (firstChange && Date.now() - firstChange >= RESET_MIN * 60000) reset(`changes were made ${RESET_MIN} minutes ago or more`);
    else if (iso(new Date()) !== bootDay) reset('a new day');
  }, 30_000);
}
