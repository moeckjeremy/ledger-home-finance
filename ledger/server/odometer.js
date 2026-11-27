// A vehicle's mileage, noted when a fuel receipt is read (2026-11-27, the owner: "If someone scans a gas
// receipt, CFO should ask if the user wants to plug in current mileage of their vehicle to better update the
// asset"). Filling up is the one moment a household is standing by the odometer with Ledger open.
//
// What the readings are used for, and only this: once two readings are at least 60 days apart, Ledger knows
// roughly how many miles a year the vehicle really does, and where its value is being lowered each month by
// how much it is driven (server/depreciate.js), that choice follows the real figure: under 8,000 a year is
// "lightly", over 15,000 is "a lot", in between "about average". A household that typed a rate of its own
// keeps it. It is still a rule of thumb, never a Kelley Blue Book value; mileage only makes the rule fit
// the car better.
//
// Which properties are vehicles: one whose value is being lowered each month, one that already has a
// reading, or one whose name says so (a home on the monthly lookup never is). Nothing is sent anywhere.
import { db, iso } from './db.js';
import { RATES, ruleRate } from './depreciate.js';

db.exec('CREATE TABLE IF NOT EXISTS odometer (id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, date TEXT NOT NULL, miles INTEGER NOT NULL)');
db.exec('CREATE INDEX IF NOT EXISTS odometer_account ON odometer (account_id, date)');

const NAMED = /\b(car|truck|van|suv|jeep|pickup|motorcycle|bike|vehicle|auto|sedan|toyota|honda|ford|chevy|chevrolet|gmc|dodge|ram|nissan|hyundai|kia|subaru|mazda|volkswagen|vw|tesla|bmw|audi|lexus|acura|buick|cadillac|chrysler|volvo|rav4|pilot|civic|accord|camry|corolla|f-?150|silverado|tacoma|highlander|odyssey|sienna|cr-?v|explorer|escape|altima|outback|wrangler)\b/i;
const MIN_DAYS = 60;
const tierFor = (perYear) => (perYear < 8000 ? 'light' : perYear > 15000 ? 'heavy' : 'typical');
const WORDS = { light: 'lightly driven', typical: 'about average', heavy: 'driven a lot' };

function readings(id) { return db.prepare('SELECT date, miles FROM odometer WHERE account_id = ? ORDER BY date, id').all(id); }

/** Miles a year from the first and the latest reading, once they are far enough apart to mean something. */
function perYear(rs) {
  if (rs.length < 2) return null;
  const a = rs[0], b = rs[rs.length - 1];
  const days = Math.round((Date.parse(b.date) - Date.parse(a.date)) / 86400000);
  if (days < MIN_DAYS || b.miles <= a.miles) return null;
  return Math.round(((b.miles - a.miles) / days) * 365 / 100) * 100;
}

export function vehicles() {
  const withReading = new Set(db.prepare('SELECT DISTINCT account_id id FROM odometer').all().map((r) => r.id));
  return db.prepare("SELECT id, name, balance, dep_rate, dep_use, value_auto FROM accounts WHERE type = 'property' ORDER BY COALESCE(sort, id), id").all()
    .filter((a) => !a.value_auto && (a.dep_rate > 0 || withReading.has(a.id) || NAMED.test(a.name)))
    .map((a) => { const rs = readings(a.id); return { id: a.id, name: a.name, lowering: a.dep_rate > 0, use: a.dep_use || '', rate: a.dep_rate || null, last: rs.length ? rs[rs.length - 1] : null, count: rs.length, perYear: perYear(rs) }; });
}

export function installOdometer(app) {
  app.get('/api/vehicles', (_req, res) => res.json(vehicles()));
  app.post('/api/vehicles/:id/odometer', (req, res) => {
    const acc = db.prepare("SELECT id, name, balance, dep_rate, dep_use, dep_year, dep_kind, dep_miles, dep_hold FROM accounts WHERE id = ? AND type = 'property'").get(Number(req.params.id));
    if (!acc) return res.status(400).json({ error: 'Choose a vehicle.' });
    const miles = Math.round(Number(String(req.body?.miles ?? '').replace(/,/g, '')));
    if (!Number.isFinite(miles) || miles < 1 || miles > 2_000_000) return res.status(400).json({ error: 'Enter the odometer reading in miles.' });
    const today = iso(new Date());
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.date || '') && req.body.date <= today ? req.body.date : today;
    const before = readings(acc.id);
    const earlier = before.filter((r) => r.date <= date).at(-1);
    if (earlier && miles < earlier.miles) return res.status(400).json({ error: `That is lower than the last reading (${earlier.miles.toLocaleString('en-US')} on ${earlier.date}). Check the number.` });
    // One reading a day per vehicle: a second fill-up the same day replaces the first.
    db.prepare('DELETE FROM odometer WHERE account_id = ? AND date = ?').run(acc.id, date);
    db.prepare('INSERT INTO odometer (account_id, date, miles) VALUES (?, ?, ?)').run(acc.id, date, miles);
    const rs = readings(acc.id), year = perYear(rs);
    let changed = null;
    // Where the value is being lowered by how much it is driven, that follows the real mileage. The lowering
    // starts again from today's value at the new rate, so nothing jumps.
    if (year != null && acc.dep_rate > 0 && acc.dep_use === 'auto' && acc.dep_year) {
      // On the worked-out rule the real miles a year go straight into the rate.
      if (acc.dep_miles !== year) {
        const rate = ruleRate(acc.dep_year, acc.dep_kind, year, today, acc.dep_hold);
        db.prepare('UPDATE accounts SET dep_miles = ?, dep_rate = ?, dep_base = ?, dep_date = ? WHERE id = ?').run(year, rate, Math.max(0, acc.balance), today, acc.id);
        if (rate !== acc.dep_rate) changed = { from: acc.dep_rate, to: 'auto', rate };
      }
    } else if (year != null && acc.dep_rate > 0 && acc.dep_use !== 'custom') {
      const tier = tierFor(year);
      if (tier !== acc.dep_use) {
        db.prepare('UPDATE accounts SET dep_use = ?, dep_rate = ?, dep_base = ?, dep_date = ? WHERE id = ?').run(tier, RATES[tier], Math.max(0, acc.balance), today, acc.id);
        changed = { from: acc.dep_use, to: tier, rate: RATES[tier] };
      }
    }
    const since = rs[0].date;
    const said = year == null
      ? (rs.length < 2 ? `Saved: ${miles.toLocaleString('en-US')} miles for ${acc.name}. With another reading in a couple of months, Ledger can tell how much it is really driven.`
        : `Saved: ${miles.toLocaleString('en-US')} miles for ${acc.name}. Once the readings are at least two months apart, Ledger can tell how much it is really driven.`)
      : `Saved: ${miles.toLocaleString('en-US')} miles for ${acc.name}. Since ${since} that is about ${year.toLocaleString('en-US')} miles a year, which is ${WORDS[tierFor(year)]}.`
        + (changed ? ` Its value is now lowered at ${changed.rate}% a year to match.` : acc.dep_rate > 0 && acc.dep_use !== 'custom' ? ` Its value keeps being lowered at ${acc.dep_rate}% a year.` : acc.dep_rate > 0 ? ' You set its rate yourself, so that is left as it is.' : '');
    res.json({ ok: true, miles, perYear: year, changed, said });
  });
  app.delete('/api/vehicles/:id/odometer', (req, res) => {
    db.prepare('DELETE FROM odometer WHERE account_id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });
}
