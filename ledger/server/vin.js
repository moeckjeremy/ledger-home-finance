// Filling in a vehicle's model year and kind from its VIN (2026-11-27, the owner: "so they don't have to
// type in vehicle stats one by one"). Optional, and only when someone presses the button.
//
// The decoder is the U.S. National Highway Traffic Safety Administration's free public one (vPIC): no
// account, no key. **What leaves the copy: the VIN, to that government service, once per press.** A VIN
// identifies one particular vehicle, so the screen says so before the button, and Ledger never stores the
// VIN or writes it to a log: it is used for the one request and dropped. Nothing about the household goes
// with it. What comes back is the year, make, model, body type and fuel type; it gives no value, and
// cannot say how well the model holds its value.
//
//   POST /api/vehicles/vin  { vin }  ->  { year, make, model, kind, name }
//
// It is not on the demo's allowed list, so the public demo refuses it. LEDGER_VIN_URL stands in for the
// service in tests and is ignored in a container.
import fs from 'node:fs';

const inContainer = fs.existsSync('/.dockerenv');
const BASE = (!inContainer && process.env.LEDGER_VIN_URL) || 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues';
// A VIN is 17 letters and digits and never uses I, O or Q.
const SHAPE = /^[A-HJ-NPR-Z0-9]{17}$/;
const tidy = (s) => String(s || '').trim().replace(/\s+/g, ' ').slice(0, 40);
const title = (s) => (s === s.toUpperCase() && s.length > 3 ? s.charAt(0) + s.slice(1).toLowerCase() : s);

/** Which of Ledger's five kinds a decoded vehicle is. */
export function kindOf(r) {
  const body = `${r.BodyClass || ''} ${r.VehicleType || ''}`.toLowerCase();
  const fuel = String(r.FuelTypePrimary || '').toLowerCase(), second = String(r.FuelTypeSecondary || '').toLowerCase();
  const level = String(r.ElectrificationLevel || '').toLowerCase();
  if (/\bbev\b|battery electric/.test(level) || (fuel === 'electric' && !second)) return 'ev';
  if (/hev|hybrid/.test(level) || second === 'electric' || (fuel === 'electric' && second)) return 'hybrid';
  if (/pickup|truck/.test(body) && !/sport utility|multipurpose/.test(body)) return 'truck';
  if (/sport utility|suv|crossover|multipurpose|mpv|van/.test(body)) return 'suv';
  return 'car';
}

export function installVin(app) {
  app.post('/api/vehicles/vin', async (req, res) => {
    const vin = String(req.body?.vin || '').toUpperCase().replace(/[\s-]/g, '');
    if (!SHAPE.test(vin)) return res.status(400).json({ error: 'A VIN is 17 letters and digits, with no I, O or Q. It is on the registration, the insurance card, and the driver’s door frame.' });
    let r;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 12000);
      const answer = await fetch(`${BASE}/${vin}?format=json`, { signal: ctl.signal, headers: { accept: 'application/json' } });
      clearTimeout(timer);
      if (!answer.ok) throw new Error('refused');
      r = (await answer.json())?.Results?.[0];
    } catch {
      // Never the VIN or the service's own words in a message or a log.
      return res.status(502).json({ error: 'The VIN service did not answer just now. Try again in a minute, or fill the boxes in by hand.' });
    }
    const year = Math.round(Number(r?.ModelYear));
    const thisYear = new Date().getFullYear();
    if (!r || !Number.isFinite(year) || year < 1980 || year > thisYear + 1 || !tidy(r.Make)) {
      return res.status(404).json({ error: 'That VIN was not recognised. Check it against the registration, or fill the boxes in by hand.' });
    }
    const make = title(tidy(r.Make)), model = tidy(r.Model);
    res.json({ year, make, model, kind: kindOf(r), name: [year, make, model].filter(Boolean).join(' ') });
  });
}
