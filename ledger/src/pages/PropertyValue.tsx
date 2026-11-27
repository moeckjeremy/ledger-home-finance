// How a home's (or other property's) value is kept: typed by hand, or looked up once a month
// (server/homevalue.js). By hand points to Zillow, opened in the person's own browser. Automatic walks them
// through making a free key at RentCast and giving the address, and says plainly what that sends and where.
import { useEffect, useRef, useState } from 'react';
import { api, dayShort, money, useData } from '../lib';
import { Modal } from '../ui';

export type Way = 'hand' | 'auto' | 'dep';

/** A vehicle's odometer readings: the latest, what they come to in a year, and a box for a new one. */
function Mileage({ id, onSaved, hand }: { id: number; onSaved: () => void; hand?: boolean }) {
  const { data: cars, reload } = useData<any[]>('/api/vehicles');
  const [miles, setMiles] = useState('');
  const [said, setSaid] = useState('');
  const [err, setErr] = useState('');
  const car = cars?.find((c) => c.id === id);
  // Kept by hand, a home and a vehicle share this tab: the box shows for what Ledger knows is a vehicle, and behind one link otherwise.
  const [open, setOpen] = useState(false);
  if (hand && !car && !open) return cars ? <p className="sub"><button type="button" className="link" onClick={() => setOpen(true)}>It's a vehicle: keep its mileage here</button></p> : null;
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    try { const r = await api(`/api/vehicles/${id}/odometer`, { method: 'POST', body: { miles } }); setSaid(r.said); setMiles(''); reload(); onSaved(); }
    catch (e: any) { setErr(e.message); }
  };
  return (
    <div className="mileage" data-go="mileage">
      <b>Its mileage</b>
      <p className="sub">{car?.last ? `${Number(car.last.miles).toLocaleString()} miles on ${dayShort(car.last.date)}${car.perYear ? `, about ${Number(car.perYear).toLocaleString()} miles a year over the readings so far` : car.count > 1 ? '. The readings are not yet two months apart, so there is no yearly figure' : '. One more reading in a couple of months gives a yearly figure'}.` : 'No reading yet.'} Ledger also asks for it when you read a fuel receipt. {hand ? "Kelley Blue Book asks for the mileage, so the latest reading is here when you look the value up. It doesn't change the value by itself: that stays as you typed it." : "With two readings a couple of months apart, the rate above follows the real mileage, unless you typed a rate of your own."}</p>
      <form className="rename set-balance" onSubmit={save} noValidate>
        <label>Odometer today, in miles<input type="text" inputMode="numeric" value={miles} onChange={(e) => { setMiles(e.target.value.replace(/[^0-9,]/g, '')); setErr(''); }} /></label>
        <button type="submit" className="primary" disabled={!miles}>Save mileage</button>
      </form>
      {said && <p className="sub good" role="status">{said}</p>}
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}
// The worked-out rule, the same sums as ruleRate in server/depreciate.js: keep the two in step.
const KINDS: [string, string, number][] = [['car', 'Car', 1], ['suv', 'SUV or crossover', 1.1], ['truck', 'Pickup truck', 0.9], ['hybrid', 'Hybrid', 1], ['ev', 'Electric', 1]];
const HOLDS: [string, string, number][] = [['well', 'Well: known for it (most Toyotas, Hondas and Subarus)', 0.75], ['average', 'About average, or not sure', 1], ['poorly', 'Poorly: known for losing value fast (many German luxury cars, some others)', 1.5]];
const mileStep = (kind: string) => (kind === 'truck' || kind === 'ev' ? 0.5 : 0.35);
function ruleRate(modelYear: number, kind: string, miles: number | null, calYear: number, hold = 'average') {
  const age = Math.max(0, calYear - modelYear);
  const base = age < 1 ? 15 : age < 3 ? 8 : age < 7 ? 10 : 13.5;
  const h = HOLDS.find((x) => x[0] === hold)?.[2] || 1, held = age < 7 ? h : 1 + (h - 1) / 2;
  const adj = miles && miles > 0 ? Math.max(-4, Math.min(6, mileStep(kind) * (miles - 12000) / 1000)) : 0;
  return Math.round(Math.max(3, Math.min(30, base * (KINDS.find((k) => k[0] === kind)?.[2] || 1) * held + adj)) * 10) / 10;
}
const ZILLOW = 'https://www.zillow.com/how-much-is-my-home-worth/';
const RENTCAST = 'https://app.rentcast.io/app/api';
// Vehicles have no service an app can ask (Kelley Blue Book licenses its values to dealers), so a car is
// always typed in; this opens KBB's own "what's my car worth" page in the person's browser.
const KBB = 'https://www.kbb.com/whats-my-car-worth/';

// `start` opens it on one of the two ways (a property just added for the monthly lookup starts there).
export function PropertyValue({ a, onChanged, onClose, start }: { a: any; onChanged: () => void; onClose: () => void; start?: Way }) {
  const { data: hv, reload } = useData<any>('/api/home-value');
  const [mode, setMode] = useState<Way>(start || (a.value_auto ? 'auto' : a.dep_rate > 0 ? 'dep' : 'hand'));
  // How much the vehicle is driven picks the yearly rate; "own" is a rate they type.
  const [use, setUse] = useState<string>(a.dep_use === 'custom' ? 'custom' : 'auto');
  const [modelYear, setModelYear] = useState<string>(a.dep_year ? String(a.dep_year) : '');
  const [kind, setKind] = useState<string>(a.dep_kind || 'car');
  const [hold, setHold] = useState<string>(a.dep_hold || 'average');
  // Filling the two boxes in from the VIN: optional, sent to the U.S. vehicle safety agency's decoder, never kept.
  const [vinOpen, setVinOpen] = useState(false);
  const [vin, setVin] = useState('');
  const [vinSaid, setVinSaid] = useState('');
  const [vinErr, setVinErr] = useState('');
  const [vinBusy, setVinBusy] = useState(false);
  const decode = async (e: React.FormEvent) => {
    e.preventDefault(); setVinErr(''); setVinSaid(''); setVinBusy(true);
    try {
      const r = await api('/api/vehicles/vin', { method: 'POST', body: { vin } });
      setModelYear(String(r.year)); setKind(r.kind); setVin('');
      setVinSaid(`Found: ${r.name}. The model year and kind are filled in below; change them if they look wrong.`);
    } catch (e: any) { setVinErr(e.message || 'That did not work.'); }
    setVinBusy(false);
  };
  const { data: cars } = useData<any[]>('/api/vehicles');
  const driven: number | null = cars?.find((c) => c.id === a.id)?.perYear ?? null;
  const thisYear = new Date().getFullYear();
  const yearOk = /^\d{4}$/.test(modelYear) && Number(modelYear) >= 1980 && Number(modelYear) <= thisYear + 1;
  const [rate, setRate] = useState<string>(a.dep_use === 'custom' && a.dep_rate ? String(a.dep_rate) : '');
  const yearly = use === 'custom' ? Number(rate) : yearOk ? ruleRate(Number(modelYear), kind, driven, thisYear, hold) : 0;
  const worth = Math.abs(Number(a.balance) || 0);
  // A year or two on, stepped by the month as the server does: the worked-out rate eases as the vehicle ages.
  const after = (years: number) => { const m0 = new Date().getMonth(); let v = worth; for (let m = 0; m < years * 12; m++) v *= Math.pow(1 - (use === 'custom' ? yearly : ruleRate(Number(modelYear), kind, driven, thisYear + Math.floor((m0 + m) / 12), hold)) / 100, 1 / 12); return Math.round(v); };
  const age = yearOk ? Math.max(0, thisYear - Number(modelYear)) : 0;
  // "Where this figure comes from": the sum for this vehicle, the studies behind it, and how to check it.
  const [why, setWhy] = useState(false);
  const baseRate = age < 1 ? 15 : age < 3 ? 8 : age < 7 ? 10 : 13.5;
  const kindRow = KINDS.find((k) => k[0] === kind) || KINDS[0];
  const milesAdj = driven && driven > 0 ? Math.max(-4, Math.min(6, mileStep(kind) * (driven - 12000) / 1000)) : 0;
  const holdRow = HOLDS.find((h) => h[0] === hold) || HOLDS[1];
  const holdMult = age < 7 ? holdRow[2] : Math.round((1 + (holdRow[2] - 1) / 2) * 1000) / 1000;
  // Opened by itself for a property just added: brought into view once.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (start) box.current?.scrollIntoView({ block: 'center' }); }, []);
  const [link, setLink] = useState(a.value_link || '');
  const [key, setKey] = useState('');
  const [address, setAddress] = useState(a.address || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [said, setSaid] = useState('');
  const run = async (fn: () => Promise<any>, ok?: (r: any) => string) => {
    setBusy(true); setErr(''); setSaid('');
    try { const r = await fn(); if (ok) setSaid(ok(r)); onChanged(); reload(); } catch (e: any) { setErr(e.message || 'That did not work.'); }
    setBusy(false);
  };
  const range = (lo: number, hi: number) => (lo && hi ? ` (RentCast's range is ${money(lo)} to ${money(hi)})` : '');
  return (
    <div className="value-how" data-go="value-how" ref={box}>
      <b>How {a.name}'s value is kept</b>
      <div className="seg demo-pick" role="group" aria-label="How the value is kept">
        <button type="button" className={mode === 'hand' ? 'on' : ''} onClick={() => setMode('hand')}>I'll type it in</button>
        <button type="button" className={mode === 'auto' ? 'on' : ''} onClick={() => setMode('auto')}>Look it up each month</button>
        <button type="button" className={mode === 'dep' ? 'on' : ''} onClick={() => setMode('dep')}>Lower it each month</button>
      </div>

      {mode === 'hand' && (
        <>
          <p className="sub">Look it up yourself, then type the figure with "Set value". It stays as typed until you change it.</p>
          <div className="add-actions">
            <a className="button" href={ZILLOW} target="_blank" rel="noopener noreferrer">A home: look it up on Zillow ↗</a>
            <a className="button" href={KBB} target="_blank" rel="noopener noreferrer">A vehicle: look it up on Kelley Blue Book ↗</a>
            {a.value_link && <a className="button" href={a.value_link} target="_blank" rel="noopener noreferrer">Open your saved page ↗</a>}
          </div>
          <p className="sub" data-go="kbb-tip"><b>A tip for a vehicle:</b> when Kelley Blue Book asks about condition, be honest with yourself. By its own count only about 2 in 100 cars it values are “Excellent”; half are “Good” and about a quarter “Very Good”. The private-party figure is the one to type here.</p>
          <form className="rename set-balance value-link" onSubmit={(e) => { e.preventDefault(); run(() => api(`/api/accounts/${a.id}/value-link`, { method: 'PUT', body: { url: link } }), () => (link ? 'Saved. That page now opens from this property.' : 'Removed.')); }}>
            <label>Save the page where you check it (optional)<input type="url" inputMode="url" value={link} placeholder="https://… your home's page on Zillow, your lender's report, a car value site" onChange={(e) => setLink(e.target.value)} /></label>
            <button type="submit" className="primary" disabled={busy}>Save</button>
          </form>
          {!a.value_auto && <Mileage id={a.id} onSaved={onChanged} hand />}
          <p className="sub"><b>For your privacy,</b> Ledger sends nothing anywhere for a property kept this way, and never asks for its address. Zillow and Kelley Blue Book open in your own browser, as they would if you went there yourself.</p>
          {a.value_auto ? <p className="sub">Automatic is on for this one. <button className="link" disabled={busy} onClick={() => run(() => api(`/api/accounts/${a.id}/value-auto`, { method: 'PUT', body: { on: false } }), () => 'Automatic is off, and its address has been forgotten.')}>Switch it off and keep it by hand</button></p> : null}
        </>
      )}

      {mode === 'auto' && (
        <>
          <p className="sub">For a home in the United States. Once a month Ledger asks RentCast, a property data service, what the home is estimated to be worth, and makes that its value. Vehicles and other property stay by hand.</p>
          {!hv?.hasKey ? (
            <ol className="key-guide">
              <li>Create a free account at RentCast. It opens on a page called "API Dashboard".<br /><a className="button" href={RENTCAST} target="_blank" rel="noopener noreferrer">Open RentCast ↗</a></li>
              <li><b>Choose the free plan.</b> On that page, find "API Billing", press "Select Plan" and choose <b>Developer</b>, which is $0 a month for 50 lookups. A key does nothing until a plan is chosen: RentCast shows it as "Inactive". <b>RentCast asks for a card even for the free plan</b>, and shows "Total billed now: $0.00": the card is only charged if you go past 50 lookups in a month, at 20 cents each. Ledger stops itself at 30. Tick the box to agree to their terms and press "Activate Plan".</li>
              <li><b>Create the key.</b> Under "API Keys" press "Create API Key". Give it a name such as "Ledger" (the description can stay empty), leave the Security tab as it is, and press "Create API Key". It then appears in the list as a row of dots: press the copy icon beside it.</li>
              <li><b>Paste it here.</b>
                <form className="token-form" onSubmit={(e) => { e.preventDefault(); run(async () => { await api('/api/home-value/key', { method: 'PUT', body: { key } }); setKey(''); }, () => 'Key saved. Now enter the address below.'); }}>
                  <label className="field"><span>RentCast API key</span><input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} /></label>
                  <button type="submit" className="primary" disabled={busy || key.trim().length < 16}>Save key</button>
                </form>
              </li>
            </ol>
          ) : (
            <>
              {a.value_auto ? (
                <p className="sub good">On. {a.value_at ? `Last looked up ${dayShort(a.value_at)}${range(a.value_low, a.value_high)}.` : ''} It is looked up again once each month.</p>
              ) : null}
              <form className="rename set-balance value-link" onSubmit={(e) => { e.preventDefault(); run(() => api(`/api/accounts/${a.id}/value-auto`, { method: 'PUT', body: { on: true, address } }), (r) => `RentCast estimates ${money(r.price)}${range(r.low, r.high)}${r.found ? ` for ${r.found}` : ''}. That is now this property's value, and it will be looked up again each month.`); }}>
                <label>The home's address<input type="text" autoComplete="off" value={address} placeholder="Street, City, State, ZIP" onChange={(e) => setAddress(e.target.value)} /></label>
                <button type="submit" className="primary" disabled={busy || address.trim().length < 10}>{busy ? 'Looking it up…' : a.value_auto ? 'Save and look it up' : 'Turn on and look it up'}</button>
              </form>
              <div className="add-actions">
                {a.value_auto ? <button disabled={busy} onClick={() => run(() => api(`/api/accounts/${a.id}/value-check`, { method: 'POST' }), (r) => `RentCast now estimates ${money(r.price)}${range(r.low, r.high)}.`)}>Check now</button> : null}
                {a.value_auto ? <button disabled={busy} onClick={() => run(() => api(`/api/accounts/${a.id}/value-auto`, { method: 'PUT', body: { on: false } }), () => 'Automatic is off, and its address has been forgotten.')}>Switch it off</button> : null}
                <button className="link" disabled={busy} onClick={() => { if (confirm('Remove your RentCast key from Ledger? Every property goes back to being kept by hand.')) run(() => api('/api/home-value/key', { method: 'DELETE' }), () => 'The key is removed. Nothing more will be looked up.'); }}>Remove my RentCast key</button>
              </div>
              <p className="sub">Ledger has asked RentCast {hv.used} time{hv.used === 1 ? '' : 's'} this month, and stops itself at {hv.cap}.</p>
            </>
          )}
          <p className="sub"><b>What this sends:</b> switched on, this home's address and your key go to RentCast once a month and when you press "Check now", and the address is kept in your Ledger so it can ask. Nothing else is sent, and nothing at all for a property kept by hand. If you later type a value yourself, automatic switches off for that property.</p>
        </>
      )}
      {mode === 'dep' && (
        <>
          <p className="sub">For a car, truck or other vehicle. Ledger lowers the value you typed a little each month, the way a vehicle loses value, so it isn't frozen until you next update it. <b>It is an estimate by a rule of thumb, not a Kelley Blue Book value.</b> Nothing is sent anywhere.</p>
          {worth <= 0 && <p className="error">Type what it's worth today first, with "Set value". The Kelley Blue Book button is under "I'll type it in".</p>}
          <div className="value-choice dep-choice" role="radiogroup" aria-label="How the rate is set">
            <label className={use === 'auto' ? 'on' : ''}><input type="radio" name={`driven-${a.id}`} checked={use === 'auto'} onChange={() => setUse('auto')} /><span><b>Work the rate out for me</b><small>From its model year, what kind of vehicle it is and, once Ledger has two odometer readings a couple of months apart, how much it's really driven.</small></span></label>
            <label className={use === 'custom' ? 'on' : ''}><input type="radio" name={`driven-${a.id}`} checked={use === 'custom'} onChange={() => setUse('custom')} /><span><b>My own rate</b><small><input type="number" min="1" max="40" step="0.5" inputMode="decimal" value={rate} placeholder="12" aria-label="Yearly rate, percent" onFocus={() => setUse('custom')} onChange={(e) => { setRate(e.target.value); setUse('custom'); }} /> % a year</small></span></label>
          </div>
          {use === 'auto' && (
            <>
              {!vinOpen
                ? <p className="sub"><button type="button" className="link" data-go="dep-vin" onClick={() => setVinOpen(true)}>Fill these in from the VIN</button> (optional)</p>
                : (
                  <form className="dep-vin" onSubmit={decode} noValidate>
                    <label>VIN (17 letters and digits)<input type="text" value={vin} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={20} placeholder="On the registration or the driver's door frame" onChange={(e) => { setVin(e.target.value.toUpperCase()); setVinErr(''); }} /></label>
                    <div className="add-actions"><button type="submit" className="primary" disabled={vinBusy || vin.replace(/[\s-]/g, '').length !== 17}>{vinBusy ? 'Looking it up…' : 'Look it up'}</button><button type="button" onClick={() => { setVinOpen(false); setVin(''); setVinErr(''); }}>Never mind</button></div>
                    <small>This sends the VIN, and nothing else, to the U.S. government's vehicle safety agency (NHTSA), whose free decoder returns the year, make, model and type. A VIN identifies one particular vehicle. Ledger doesn't keep it.</small>
                    {vinErr && <small className="error" role="alert">{vinErr}</small>}
                  </form>
                )}
              {vinSaid && <p className="sub good" role="status">{vinSaid}</p>}
              <div className="add-grid dep-facts">
                <label>Model year<input type="text" inputMode="numeric" maxLength={4} value={modelYear} placeholder={String(thisYear - 5)} onChange={(e) => setModelYear(e.target.value.replace(/\D/g, ''))} /></label>
                <label>What kind of vehicle<select value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
                <label style={{ gridColumn: '1 / -1' }}>How well does this model hold its value?<select value={hold} onChange={(e) => setHold(e.target.value)}>{HOLDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
              </div>
              {yearOk && <p className="sub"><b>{yearly}% a year</b> for now: {age < 1 ? 'a vehicle in its first year loses the most' : age < 7 ? `at ${age} ${age === 1 ? 'year' : 'years'} old the usual figure is about ${age < 3 ? 8 : 10}%` : `at ${age} years old the usual figure is about 13.5%, as age and miles add up`}{hold === 'well' ? ', less for a model that holds its value well' : hold === 'poorly' ? ', more for a model that loses value fast' : ''}{kind === 'suv' ? ', a little more for an SUV' : kind === 'truck' ? ', a little less for a pickup' : ''}{driven ? `, and about ${driven.toLocaleString()} miles a year ${driven > 12500 ? 'is more than' : driven < 11500 ? 'is less than' : 'is close to'} the typical 12,000` : ', at a typical 12,000 miles a year until Ledger has odometer readings'}.</p>}
              <p className="sub"><button type="button" className="link" data-go="dep-why" disabled={!yearOk} onClick={() => setWhy(true)}>Where does this figure come from?</button> It is an average for vehicles like yours, so compare it with Kelley Blue Book. A model known for holding its value, or losing it, may suit a rate of your own.</p>
              {why && yearOk && (
                <Modal title="Where this figure comes from" onClose={() => setWhy(false)}>
                  <p className="sub first">Ledger doesn't look your vehicle up anywhere. It works a yearly rate out from what you told it, using averages from published studies and your own answer about the model, and lowers the value you typed by that much, a little each month.</p>
                  <div className="dep-sum">
                    <div className="row"><span className="grow">Its age<small>{age < 1 ? 'In its first year, when a vehicle loses the most' : `${age} ${age === 1 ? 'year' : 'years'} old: ${age < 3 ? 'ages 1 and 2' : age < 7 ? 'ages 3 to 6' : 'age 7 and over, when age and miles add up'}`}</small></span><span className="num">{baseRate}%</span></div>
                    <div className="row"><span className="grow">Its kind<small>{kindRow[1]}{kindRow[2] === 1 ? ': no change' : kindRow[2] > 1 ? ': loses a little more than a car' : ': holds a little better than a car'}</small></span><span className="num">× {kindRow[2]}</span></div>
                    <div className="row"><span className="grow">How this model holds its value<small>{hold === 'well' ? `You said well: such models lose about a quarter less${age < 7 ? '' : ', half that once they are seven or older'}` : hold === 'poorly' ? `You said poorly: such models lose about half more${age < 7 ? '' : ', half that once they are seven or older'}` : 'About average, or not sure: no change'}</small></span><span className="num">× {holdMult}</span></div>
                    <div className="row"><span className="grow">Its mileage<small>{driven ? `About ${driven.toLocaleString()} miles a year from your odometer readings, against a typical 12,000` : 'No two readings a couple of months apart yet, so a typical 12,000 miles a year is assumed'}</small></span><span className="num">{milesAdj > 0 ? '+' : milesAdj < 0 ? '−' : '+'} {Math.abs(Math.round(milesAdj * 10) / 10)}</span></div>
                    <div className="row total"><span className="grow"><b>Lowered by</b><small>Kept between 3% and 30%</small></span><span className="num"><b>{yearly}% a year</b></span></div>
                  </div>
                  {worth > 0 && <p className="sub">On {money(worth)} today that is about {money(after(1))} in a year and {money(after(2))} in two.</p>}
                  <p className="sub"><b>Where the numbers come from</b></p>
                  <ul className="dep-src">
                    <li><b>The starting point</b> was two published studies of what vehicles lose from new: the U.S. Bureau of Labor Statistics (<a href="https://www.bls.gov/opub/mlr/2024/article/a-consumption-measure-for-automobiles.htm" target="_blank" rel="noopener noreferrer">read it ↗</a>) and iSeeCars' 2026 study of over 950,000 five-year-old vehicles (<a href="https://www.iseecars.com/cars-that-hold-their-value-study" target="_blank" rel="noopener noreferrer">read it ↗</a>).</li>
                    <li><b>The figures were then fitted to Kelley Blue Book values</b> looked up by hand in November 2026 for about thirty popular models, model years 2016 to 2025, at typical mileage. From one year to the next an ordinary used vehicle lost about 8% a year at one and two years old, about 10% from three to six, and about 13 to 14% from seven on. SUVs ran a little above cars and pickups a little below.</li>
                    <li><b>Mileage:</b> in the same lookups, each 10,000 miles took about 3.5% off a car or SUV and nearly 5% off a pickup or an electric car. Ledger adds or takes off about a third of a point for each 1,000 miles a year above or below 12,000 (half a point for a pickup or electric).</li>
                    <li><b>How the model holds its value:</b> your own answer, and the one that matters most. Models that held up well (most Toyotas and Hondas, a Subaru, a Lexus sedan) lost about a quarter less than ordinary ones; the ones that did poorly (two German luxury sedans and three others) lost about half more. The gap narrows as vehicles get old. These are Ledger's own fitted figures, not Kelley Blue Book's method, and a particular model can still sit outside them.</li>
                  </ul>
                  <p className="sub"><b>Please check it against Kelley Blue Book.</b> These are averages, and one model can differ a great deal from its kind: in the same iSeeCars study a Toyota RAV4 lost about 25% in five years where SUVs as a whole lost about 45%. To compare, look up your vehicle on Kelley Blue Book (choosing its condition honestly: it rates only about 2 in 100 cars “Excellent”, and most are “Good” or “Very Good”), then the same model one year older with about 12,000 more miles. The gap between the two is Kelley Blue Book's year of lowering, to set beside Ledger's{worth > 0 ? ` ${money(worth - after(1))}` : ''}. If they are far apart, type a rate of your own, or simply type Kelley Blue Book's value with "Set value" now and then: the lowering carries on from whatever you type.</p>
                  <div className="add-actions">
                    <a className="button primary" href={KBB} target="_blank" rel="noopener noreferrer">Compare on Kelley Blue Book ↗</a>
                    <button type="button" onClick={() => setWhy(false)}>Close</button>
                  </div>
                  <p className="sub">This is an estimate, not a Kelley Blue Book value, and nothing about your vehicle is sent anywhere.</p>
                </Modal>
              )}
            </>
          )}
          {worth > 0 && yearly >= 1 && yearly <= 40 && <p className="sub">At {yearly}% a year, {money(worth)} today would be about {money(after(1))} in a year and {money(after(2))} in two.</p>}
          <div className="add-actions">
            <button className="primary" disabled={busy || worth <= 0 || !(yearly >= 1 && yearly <= 40)} onClick={() => run(() => api(`/api/accounts/${a.id}/depreciate`, { method: 'PUT', body: use === 'auto' ? { on: true, use: 'auto', year: Number(modelYear), kind, hold } : { on: true, use: 'custom', rate: yearly } }), () => `On. It will be lowered a little each month at ${yearly}% a year, starting from ${money(worth)} today.`)}>{a.dep_rate > 0 ? 'Save' : 'Turn on'}</button>
            {a.dep_rate > 0 ? <button disabled={busy} onClick={() => run(() => api(`/api/accounts/${a.id}/depreciate`, { method: 'PUT', body: { on: false } }), () => 'Off. It stays at its value until you change it.')}>Switch it off</button> : null}
          </div>
          {a.dep_rate > 0 && a.dep_date ? <p className="sub good">On: {a.dep_rate}% a year{a.dep_use === 'auto' ? ' for now' : ''}, from {money(a.dep_base)} on {dayShort(a.dep_date)}.{a.dep_use && a.dep_use !== 'auto' && a.dep_use !== 'custom' ? ' That is the earlier flat rate: choose "Work the rate out for me" and Save to use its age and kind.' : ''}</p> : null}
          <Mileage id={a.id} onSaved={onChanged} />
          <p className="sub"><b>Checking it:</b> look the vehicle up on Kelley Blue Book once or twice a year and type the figure with "Set value". The monthly lowering then carries on from there. To see how this rule compares, look up the same model one year older with about 12,000 more miles: the gap is a year of lowering.</p>
        </>
      )}
      {a.value_note && a.value_note !== 'typed' && mode === 'auto' && <p className="error">The last monthly lookup did not work: {a.value_note}</p>}
      {said && <p className="sub good" role="status">{said}</p>}
      {err && <p className="error" role="alert">{err}</p>}
      <div className="add-actions"><button type="button" onClick={onClose}>Done</button></div>
    </div>
  );
}
