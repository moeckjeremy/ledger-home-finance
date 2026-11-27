// A home's value, looked up once a month for a household that asks for it (2026-11-27; the owner: "set up an
// option to enter manually which directs the user to Zillow, or ... automatic which guides them to the other
// site to create a key. Let's have the automatic refresh its figure once a month.").
//
// **Off unless a household sets it up, property by property.** By hand is the ordinary way: a value typed in,
// with a button that opens Zillow in the person's own browser. Automatic needs two things from them: a free
// API key they make themselves at RentCast (rentcast.io; 50 requests a month at no charge when this was
// written), and the home's address. Then, once a calendar month, Ledger asks RentCast for that address's
// estimate and makes it the property's value.
//
// What leaves the copy: the address of each property set to automatic, and the household's key, to
// api.rentcast.io, once a month and when "Check now" is pressed. Nothing else, and nothing at all for a
// property kept by hand. The address is stored in this copy's database (accounts.address) because the
// monthly lookup needs it. The public privacy page and About say so: keep them true.
//
// Guards: at most MONTH_CAP requests in a calendar month across the whole copy (RentCast charges past its
// free allowance), one automatic lookup per property per month, and a value typed by hand switches
// automatic off for that property (the household may know something a model doesn't) until they turn it on
// again. Vehicles have no such service: they stay by hand.
import { db, getSetting, setSetting, iso } from './db.js';
import { setStart } from './tap.js';
import { restartDepreciation } from './depreciate.js';

const MONTH_CAP = 30;
const KEY = /^[A-Za-z0-9_-]{16,128}$/;
const BASE = () => process.env.LEDGER_RENTCAST_URL || 'https://api.rentcast.io';

for (const [c, t] of [['address', 'TEXT'], ['value_auto', 'INTEGER NOT NULL DEFAULT 0'], ['value_at', 'TEXT'], ['value_low', 'REAL'], ['value_high', 'REAL'], ['value_note', 'TEXT']]) {
  if (!db.prepare('PRAGMA table_info(accounts)').all().some((x) => x.name === c)) db.exec(`ALTER TABLE accounts ADD COLUMN ${c} ${t}`);
}

const month = () => iso(new Date()).slice(0, 7);
function used() {
  let u = {}; try { u = JSON.parse(getSetting('rentcast_used') || '{}'); } catch { /* start afresh */ }
  return u.month === month() ? Number(u.n) || 0 : 0;
}
const count = () => setSetting('rentcast_used', JSON.stringify({ month: month(), n: used() + 1 }));

const cleanAddress = (text) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
const looksLikeAddress = (a) => a.length >= 10 && /\d/.test(a) && /,/.test(a) && /^[\p{L}\p{N} ,.'#/-]+$/u.test(a);

/** Asks for one address's estimate. Counts toward the month's cap whether or not a value comes back. */
async function estimate(address) {
  const key = getSetting('rentcast_key');
  if (!key) throw new Error('Add your RentCast key first.');
  if (used() >= MONTH_CAP) throw new Error(`Ledger has asked RentCast ${MONTH_CAP} times this month, which is its own limit, so it will wait until next month.`);
  const u = new URL(`${BASE()}/v1/avm/value`);
  u.searchParams.set('address', address);
  u.searchParams.set('compCount', '5');
  count();
  let r;
  try { r = await fetch(u, { headers: { 'X-Api-Key': key, accept: 'application/json' }, signal: AbortSignal.timeout(25000) }); }
  catch { throw new Error("RentCast couldn't be reached. Try again later."); }
  if (r.status === 401 || r.status === 403) throw new Error("RentCast didn't accept the key. Check it was copied whole, and that a plan is chosen on RentCast's API Dashboard: until one is, it shows the key as Inactive.");
  if (r.status === 404) throw new Error("RentCast doesn't know that address. Check the street, city, state and ZIP.");
  if (r.status === 429) throw new Error('RentCast says its monthly allowance is used up.');
  let body; try { body = await r.json(); } catch { throw new Error("RentCast gave an answer Ledger couldn't read."); }
  const price = Number(body?.price);
  if (!r.ok || !Number.isFinite(price) || price <= 0) throw new Error("RentCast had no estimate for that address.");
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null);
  return { price: Math.round(price), low: num(body.priceRangeLow), high: num(body.priceRangeHigh), found: String(body?.subjectProperty?.formattedAddress || '').slice(0, 200) };
}

/** Looks one property up and makes the estimate its value. */
async function refresh(acc) {
  const e = await estimate(acc.address);
  setStart(acc.id, e.price);
  db.prepare('UPDATE accounts SET value_at = ?, value_low = ?, value_high = ?, value_note = ? WHERE id = ?').run(iso(new Date()), e.low, e.high, '', acc.id);
  return e;
}

/** A value typed by hand takes over: automatic goes off for that property until it is switched on again. */
export function typedByHand(accountId) {
  // A vehicle being lowered each month carries on from the figure just typed.
  restartDepreciation(accountId);
  const acc = db.prepare("SELECT value_auto FROM accounts WHERE id = ? AND type = 'property'").get(accountId);
  if (!acc?.value_auto) return false;
  db.prepare("UPDATE accounts SET value_auto = 0, value_note = 'typed' WHERE id = ?").run(accountId);
  return true;
}

let running = false;
async function monthly() {
  if (running || !getSetting('rentcast_key')) return;
  running = true;
  try {
    const due = db.prepare("SELECT id, address FROM accounts WHERE type = 'property' AND value_auto = 1 AND COALESCE(address, '') != '' AND (value_at IS NULL OR substr(value_at, 1, 7) < ?)").all(month());
    for (const acc of due) {
      try { await refresh(acc); }
      catch (e) {
        // Marked as looked at for this month, so a bad key or address isn't asked about every hour; the reason is kept to show.
        db.prepare('UPDATE accounts SET value_at = ?, value_note = ? WHERE id = ?').run(iso(new Date()), String(e.message).slice(0, 200), acc.id);
        console.warn('Home value: the monthly lookup for one property failed:', e.message);
      }
    }
  } finally { running = false; }
}

export function installHomeValue(app) {
  const state = () => ({ hasKey: !!getSetting('rentcast_key'), used: used(), cap: MONTH_CAP });
  app.get('/api/home-value', (_req, res) => res.json(state()));
  app.put('/api/home-value/key', (req, res) => {
    const key = String(req.body?.key || '').trim();
    if (!KEY.test(key)) return res.status(400).json({ error: "That doesn't look like a RentCast key. Copy the whole key from RentCast's API page." });
    setSetting('rentcast_key', key);
    res.json(state());
  });
  // Removing the key stops every lookup: each property goes back to being kept by hand, at the value it has.
  app.delete('/api/home-value/key', (_req, res) => {
    setSetting('rentcast_key', '');
    db.prepare("UPDATE accounts SET value_auto = 0 WHERE type = 'property'").run();
    res.json(state());
  });
  // Automatic on (with the address) or off, for one property. Turning it on looks the value up at once,
  // so a wrong address or key is found out now and not next month.
  app.put('/api/accounts/:id/value-auto', async (req, res) => {
    const acc = db.prepare("SELECT id, address FROM accounts WHERE id = ? AND type = 'property'").get(Number(req.params.id));
    if (!acc) return res.status(400).json({ error: 'Only a home can have its value looked up.' });
    if (!req.body?.on) {
      // The address is forgotten too unless they say to keep it: with automatic off there is no reason to hold it.
      db.prepare('UPDATE accounts SET value_auto = 0, value_note = ?, address = ? WHERE id = ?').run('', req.body?.keepAddress ? acc.address : null, acc.id);
      return res.json({ ok: true });
    }
    const address = cleanAddress(req.body?.address ?? acc.address);
    if (!looksLikeAddress(address)) return res.status(400).json({ error: 'Enter the full address: street, city, state and ZIP, with commas between them.' });
    if (!getSetting('rentcast_key')) return res.status(400).json({ error: 'Add your RentCast key first.' });
    try {
      const e = await refresh({ id: acc.id, address });
      // One automatic way at a time: a property on the monthly lookup is not also lowered by the vehicle rule.
      db.prepare('UPDATE accounts SET value_auto = 1, address = ?, dep_rate = NULL, dep_base = NULL, dep_date = NULL, dep_use = NULL WHERE id = ?').run(address, acc.id);
      res.json({ ok: true, ...e });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.post('/api/accounts/:id/value-check', async (req, res) => {
    const acc = db.prepare("SELECT id, address FROM accounts WHERE id = ? AND type = 'property' AND value_auto = 1 AND COALESCE(address, '') != ''").get(Number(req.params.id));
    if (!acc) return res.status(400).json({ error: 'Automatic is not switched on for this one.' });
    try { res.json({ ok: true, ...(await refresh(acc)) }); } catch (e) { res.status(400).json({ error: e.message }); }
  });
  // Once a month per property: looked at a minute after start-up and every six hours after.
  setTimeout(monthly, 60_000).unref?.();
  setInterval(monthly, 6 * 3600 * 1000).unref?.();
}
