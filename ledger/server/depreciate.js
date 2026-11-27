// A vehicle's value, lowered a little each month by a rule of thumb (2026-11-27). The owner asked whether
// cars could follow Kelley Blue Book automatically; they can't (KBB licenses its values and forbids and
// blocks automated reading, and a "bot" to fetch them was asked about and refused). This is what was built
// instead: the household types what the car is worth today, and Ledger lets that figure drift down the way
// a car's value does, so it isn't frozen until someone remembers to update it.
//
// **It is an estimate by a rule of thumb, and every screen that shows it says so. It is not a KBB value and
// must never be worded as one.** Nothing is sent anywhere; no account or key is involved.
//
// The rule: the value falls by a fixed share each year, compounded monthly, from the day it was typed.
// Mileage is the main thing that makes one car lose value faster than another (the owner asked), and a real
// valuation needs the exact odometer reading, which a rule of thumb can't use. So the household says roughly
// how much the vehicle is driven and that picks the yearly rate: lightly driven 12%, about average 15%,
// driven a lot 18%. Or they type a rate of their own. The figures are a common rule of thumb for a used
// car, not a published table; they are the household's to change.
//
// Typing a new value (after checking KBB, say) restarts the lowering from that figure and that day. A
// property is on one automatic way at a time: turning this on turns the monthly RentCast lookup off for it.
import { db, iso } from './db.js';
import { setStart } from './tap.js';

export const RATES = { light: 12, typical: 15, heavy: 18 };

// The rule by age, type and mileage (2026-11-27, after the owner asked for the rule of thumb to be
// researched: "let's estimate it, I'm curious to test how your findings compare with KBB").
// Where the figures come from:
// - By age: the Bureau of Labor Statistics (Monthly Labor Review, January 2024; purchase prices 1996 to
//   2022) found about 24% lost in the first year, 11 to 14% a year to about year six, less after, and
//   10.3% a year on average for used automobiles. Here: 20% in the model year, 12% for ages 1 to 6, 10% after.
// - By type: iSeeCars 2026 study of over 950,000 five-year-old cars: 41.8% lost in five years overall,
//   trucks 34.2%, hybrids 35.4%, SUVs 44.9%, electric 57.2%. Turned into a yearly rate and set against
//   the overall one, that is about 0.8 for trucks and hybrids, 1.1 for SUVs, 1.5 for electric.
// - By mileage: guides adjust by miles above or below a typical 12,000 a year, at roughly 8 to 16 cents a
//   mile. Here: a third of a point of yearly rate for each 1,000 miles a year above or below 12,000 (it was half a point until the KBB check below). This step
//   and the age cut-offs are a blend of those sources, not any one's published formula.
// A single model can differ a great deal from its type (iSeeCars has the RAV4 at 25% against 45% for
// SUVs), so the household can still type a rate of its own. Still an estimate, never a KBB value.
// **Re-fitted the same day (2026-11-27) to Kelley Blue Book values the owner had looked up** for nine models
// (Camry, Civic, RAV4, RAV4 Hybrid, Pilot, F-150, Silverado, Model 3, BMW 5 Series), model years 2016 to
// 2023 at typical mileage, private party, Very Good, plus a mileage sweep of six 2020 models. What a car
// loses from one year to the next once it is used turned out gentler than the studies above (which measure
// from the price new) and nearly the same across kinds: about 8.5% a year from ages 3 to 7 and about 12%
// from 7 to 10, with the BMW at 15 to 20% throughout. So the figures below replace the first ones:
//   base 15% in the model year (a guess from one car), 10% for ages 1 to 6, 13% from 7;
//   kind: car 1, everything else 1.1 (electric 1.15: the one electric looked up, a Tesla, was ordinary,
//   but the studies have electric cars losing the most);
//   holds its value well 0.9 (the Toyotas and Hondas), poorly 1.7 (the BMW);
//   mileage: about 3.5% of value per 10,000 miles for cars and SUVs, about 4.8% for pickups and the Tesla.
// No "average" make was looked up (a Nissan, a Chevrolet or a Hyundai car), so the base of 10 for those
// is the weakest figure here. The lookups are not kept in the app; only these fitted numbers are.
// **Third fit, the same afternoon, with a third file of lookups** (about twenty more models, 2023 against
// 2019 at typical mileage, some 2016, and 2025 against 2024 for four). Private party, per year, ages 3 to 7:
//   models that hold value well (Camry, Civic, Accord, RAV4, CR-V, Lexus ES, Outback, Tundra): about 7.8%
//   ordinary ones (Altima, Sonata, Equinox, CX-5, Explorer, Traverse, Ram, F-150, Silverado, Model 3, Bolt,
//   Audi A4, Lexus RX): about 10.6%
//   ones that lose it fast (BMW 5 Series, Mercedes C-Class, Ford Escape, Kia Sorento, Nissan Leaf): about 16%.
// Within the ordinary group SUVs ran a little above cars and pickups a little below; electric cars were
// ordinary apart from the Leaf. From 7 to 10 years old everything lost more (well about 11.4%, ordinary
// about 13.9%, poorly about 14.3%), so the three groups draw together with age. One- and two-year-old
// vehicles lost less than older ones (about 7% a year across four models). Hence the figures below:
//   base 15% in the model year (still only a guess), 8% for ages 1 and 2, 10% for ages 3 to 6, 13.5% from 7;
//   kind: car, hybrid and electric 1, SUV 1.1, pickup 0.9;
//   holds its value well 0.75, poorly 1.5, with half that effect from 7 years old.
// The Honda Pilot came out ordinary (10.2%), not "well".
export const KINDS = { car: 1, suv: 1.1, truck: 0.9, hybrid: 1, ev: 1 };
const TYPICAL_MILES = 12000;
// How well the model holds its value, the household's own answer. Tuned on the owner's Kelley Blue Book
// lookups of 2026-11-27 (a 2020 RAV4 XLE Premium against a 2019 with 12,000 more miles: 9.3% lower at a
// dealer, where the plain SUV figure here would say 13.2%), so "well" is 0.7; "poorly" at 1.3 mirrors it
// and has not been checked against anything. The same lookups put mileage at about 7.4 cents a mile, a
// third of a percent of the car's value per 1,000 miles, so the mileage step is a third of a point, not a half.
export const HOLDS = { well: 0.75, average: 1, poorly: 1.5 };
const MILE_STEP = { car: 0.35, suv: 0.35, hybrid: 0.35, truck: 0.5, ev: 0.5 };
export function ruleRate(modelYear, kind, miles, onDate = iso(new Date()), hold = 'average') {
  const age = Math.max(0, Number(String(onDate).slice(0, 4)) - Number(modelYear));
  const base = age < 1 ? 15 : age < 3 ? 8 : age < 7 ? 10 : 13.5;
  // How well a model holds its value counts for half as much once it is old.
  const h = HOLDS[hold] || 1, held = age < 7 ? h : 1 + (h - 1) / 2;
  const adj = miles > 0 ? Math.max(-4, Math.min(6, (MILE_STEP[kind] || 0.35) * (miles - TYPICAL_MILES) / 1000)) : 0;
  return Math.round(Math.max(3, Math.min(30, base * (KINDS[kind] || 1) * held + adj)) * 10) / 10;
}

/** Miles a year from a vehicle's first and latest odometer readings, once they are 60 days apart (server/odometer.js keeps them). */
export function milesPerYear(accountId) {
  let rs = [];
  try { rs = db.prepare('SELECT date, miles FROM odometer WHERE account_id = ? ORDER BY date, id').all(accountId); } catch { return null; }
  if (rs.length < 2) return null;
  const a = rs[0], b = rs[rs.length - 1];
  const days = Math.round((Date.parse(b.date) - Date.parse(a.date)) / 86400000);
  if (days < 60 || b.miles <= a.miles) return null;
  return Math.round(((b.miles - a.miles) / days) * 365 / 100) * 100;
}

for (const [c, t] of [['dep_rate', 'REAL'], ['dep_base', 'REAL'], ['dep_date', 'TEXT'], ['dep_use', 'TEXT'], ['dep_year', 'INTEGER'], ['dep_kind', 'TEXT'], ['dep_miles', 'INTEGER'], ['dep_hold', 'TEXT']]) {
  if (!db.prepare('PRAGMA table_info(accounts)').all().some((x) => x.name === c)) db.exec(`ALTER TABLE accounts ADD COLUMN ${c} ${t}`);
}

/** Whole months from one date to another (a month is complete on the same day of the next month). */
function monthsBetween(from, to) {
  const [y1, m1, d1] = from.split('-').map(Number), [y2, m2, d2] = to.split('-').map(Number);
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0));
}

/** What a value typed on `date` has become by `today` at a yearly rate (a percentage), in whole dollars. */
export function valueNow(base, rate, date, today = iso(new Date())) {
  const months = monthsBetween(date, today);
  return Math.max(0, Math.round(base * Math.pow(1 - rate / 100, months / 12)));
}

/** `n` months after a date, as the first of that month (only its year matters to the rule). */
function monthsOn(date, n) {
  const [y, m] = date.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`;
}

/** A value on the worked-out rule, stepped month by month so the rate follows the vehicle as it ages. */
export function steppedValue(base, from, months, year, kind, miles, hold) {
  let v = base;
  for (let i = 0; i < months; i++) v *= Math.pow(1 - ruleRate(year, kind, miles, monthsOn(from, i), hold) / 100, 1 / 12);
  return Math.max(0, Math.round(v));
}

/** What a vehicle on either rule is worth today. */
function worthToday(r, today = iso(new Date())) {
  if (r.dep_use === 'auto' && r.dep_year) return steppedValue(r.dep_base, r.dep_date, monthsBetween(r.dep_date, today), r.dep_year, r.dep_kind, r.dep_miles, r.dep_hold);
  return valueNow(r.dep_base, r.dep_rate, r.dep_date, today);
}

/** Brings every vehicle on the rule up to date. Cheap, and safe to call often: it only writes when a month has turned. */
export function applyDepreciation() {
  const rows = db.prepare("SELECT id, balance, dep_rate, dep_base, dep_date, dep_use, dep_year, dep_kind, dep_miles, dep_hold FROM accounts WHERE type = 'property' AND dep_rate > 0 AND dep_base > 0 AND dep_date IS NOT NULL").all();
  let changed = 0;
  for (const r of rows) {
    const v = worthToday(r);
    // The rate shown is today's: it eases as the vehicle gets older.
    if (r.dep_use === 'auto' && r.dep_year) { const now = ruleRate(r.dep_year, r.dep_kind, r.dep_miles, undefined, r.dep_hold); if (now !== r.dep_rate) db.prepare('UPDATE accounts SET dep_rate = ? WHERE id = ?').run(now, r.id); }
    if (Math.abs(v - r.balance) >= 0.5) { setStart(r.id, v); changed++; }
  }
  return changed;
}

/** A value typed by hand on a vehicle that is on the rule: the lowering starts again from it, today. */
export function restartDepreciation(accountId) {
  const acc = db.prepare("SELECT balance, dep_rate FROM accounts WHERE id = ? AND type = 'property'").get(accountId);
  if (!acc || !(acc.dep_rate > 0)) return false;
  db.prepare('UPDATE accounts SET dep_base = ?, dep_date = ? WHERE id = ?').run(Math.max(0, acc.balance), iso(new Date()), accountId);
  return true;
}

export function installDepreciation(app) {
  app.put('/api/accounts/:id/depreciate', (req, res) => {
    const acc = db.prepare("SELECT id, balance FROM accounts WHERE id = ? AND type = 'property'").get(Number(req.params.id));
    if (!acc) return res.status(400).json({ error: 'Only a vehicle or other property can be lowered this way.' });
    if (!req.body?.on) {
      db.prepare('UPDATE accounts SET dep_rate = NULL, dep_base = NULL, dep_date = NULL, dep_use = NULL, dep_miles = NULL WHERE id = ?').run(acc.id);
      return res.json({ ok: true });
    }
    const today = iso(new Date());
    if (req.body?.use === 'auto') {
      // Worked out from the model year, the type of vehicle and, once there are readings, its real mileage.
      const year = Math.round(Number(req.body?.year)), kind = String(req.body?.kind || 'car');
      if (!Number.isFinite(year) || year < 1980 || year > Number(today.slice(0, 4)) + 1) return res.status(400).json({ error: 'Enter the model year, such as 2021.' });
      if (!Object.hasOwn(KINDS, kind)) return res.status(400).json({ error: 'Choose what kind of vehicle it is.' });
      if (!(acc.balance > 0)) return res.status(400).json({ error: 'Type what it is worth today first, with "Set value".' });
      const hold = Object.hasOwn(HOLDS, String(req.body?.hold)) ? String(req.body.hold) : 'average';
      const miles = milesPerYear(acc.id), rate = ruleRate(year, kind, miles, today, hold);
      db.prepare("UPDATE accounts SET dep_rate = ?, dep_use = 'auto', dep_year = ?, dep_kind = ?, dep_hold = ?, dep_miles = ?, dep_base = ?, dep_date = ?, value_auto = 0, address = NULL, value_note = '' WHERE id = ?")
        .run(rate, year, kind, hold, miles, acc.balance, today, acc.id);
      return res.json({ ok: true, rate, miles, inAYear: steppedValue(acc.balance, today, 12, year, kind, miles, hold), inTwo: steppedValue(acc.balance, today, 24, year, kind, miles, hold) });
    }
    const use = Object.hasOwn(RATES, String(req.body?.use)) ? String(req.body.use) : 'custom';
    const rate = use === 'custom' ? Number(req.body?.rate) : RATES[use];
    if (!Number.isFinite(rate) || rate < 1 || rate > 40) return res.status(400).json({ error: 'Enter a yearly rate between 1 and 40 percent.' });
    if (!(acc.balance > 0)) return res.status(400).json({ error: 'Type what it is worth today first, with "Set value".' });
    // One automatic way at a time: the monthly lookup, which is for a home, is switched off and its address forgotten.
    db.prepare("UPDATE accounts SET dep_rate = ?, dep_use = ?, dep_base = ?, dep_date = ?, value_auto = 0, address = NULL, value_note = '' WHERE id = ?")
      .run(Math.round(rate * 10) / 10, use, acc.balance, iso(new Date()), acc.id);
    res.json({ ok: true, rate, inAYear: Math.round(acc.balance * (1 - rate / 100)), inTwo: Math.round(acc.balance * Math.pow(1 - rate / 100, 2)) });
  });
  try { applyDepreciation(); } catch (e) { console.warn('Vehicle values could not be brought up to date:', e.message); }
  setInterval(() => { try { applyDepreciation(); } catch (e) { console.warn('Vehicle values could not be brought up to date:', e.message); } }, 6 * 3600 * 1000);
}
