import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useState } from 'react';
import { api, cents, compact, dayShort, money, monthShort, useData, useOwners } from '../lib';
import { GoalsCard } from './Goals';
import { goTo } from '../go';
import { AllowanceCard } from './Allowance';
import { InvestmentsCard } from './Investments';
import { PropertyValue, KINDS as CAR_KINDS, HOLDS as CAR_HOLDS, ruleRate } from './PropertyValue';
import { StatementCheck } from './StatementCheck';
import { Logo, MoneyInput, More, Skeleton, reducedMotion } from '../ui';

const GROUPS = [
  { title: 'Cash', types: ['checking', 'savings'] },
  { title: 'Investments', types: ['investment'] },
  { title: 'Health savings', types: ['hsa'] },
  { title: 'Home and property', types: ['property'] },
  { title: 'Credit cards', types: ['credit'] },
  { title: 'Loans', types: ['auto', 'loan', 'mortgage'] },
  { title: 'Insurance', types: ['insurance'], note: 'not counted in net worth' },
];

// One account in the list. "Rename" swaps the name for a text box; Enter saves, Escape cancels.
function AccountRow({ a, onChanged, first, last }: { a: any; onChanged: () => void; first?: boolean; last?: boolean }) {
  const move = async (dir: 'up' | 'down') => { try { await api(`/api/accounts/${a.id}/move`, { method: 'POST', body: { dir } }); onChanged(); } catch { /* the row stays where it was */ } };
  const owners = useOwners();
  const setOwner = async (owner: string) => { try { await api(`/api/accounts/${a.id}/owner`, { method: 'PATCH', body: { owner } }); onChanged(); owners.reload(); dispatchEvent(new CustomEvent('ledger-refresh')); } catch { /* the row stays as it was */ } };
  // "Leave out of the budget" (server/offbudget.js): its spending stops counting; the balance still shows.
  const canLeaveOut = ['checking', 'savings', 'credit'].includes(a.type);
  const setOut = async (out: boolean) => { try { await api(`/api/accounts/${a.id}/budget`, { method: 'PATCH', body: { out } }); onChanged(); dispatchEvent(new CustomEvent('ledger-refresh')); } catch { /* the row stays as it was */ } };
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(a.name);
  const [err, setErr] = useState('');
  // An account kept by hand: its balance can be typed in to correct it, and it can be removed while empty.
  const byHand = !!a.manual && a.type !== 'cash' && a.type !== 'insurance';
  const owed = ['credit', 'auto', 'loan', 'mortgage'].includes(a.type);
  const [setting, setSetting] = useState(false);
  const [checking, setChecking] = useState(false);
  const checkable = ['checking', 'savings', 'credit', 'hsa'].includes(a.type);
  const [bal, setBal] = useState('');
  // A home, vehicle or other property: a value typed by hand, and a saved link to wherever it is checked.
  const property = a.type === 'property';
  // Just added with "Look it up each month" chosen: its panel opens by itself, at the lookup's steps.
  const [fresh] = useState<'' | 'auto' | 'dep'>(() => { try { const v = sessionStorage.getItem('ledger-value-how') || ''; const [id, way] = v.split(':'); if (id === String(a.id)) { sessionStorage.removeItem('ledger-value-how'); return way === 'dep' ? 'dep' : 'auto'; } } catch { /* private window */ } return ''; });
  const [how, setHow] = useState(!!fresh);
  const linkSite = (() => { try { return new URL(a.value_link).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const saveBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api(`/api/accounts/${a.id}/balance`, { method: 'PUT', body: { balance: bal === '' ? '' : Number(bal) } }); setSetting(false); setErr(''); onChanged(); }
    catch (e: any) { setErr(e.message || 'Could not save the balance.'); }
  };
  const remove = async () => {
    if (!confirm(`Remove ${a.name}? This can't be undone.`)) return;
    try { await api(`/api/accounts/${a.id}`, { method: 'DELETE' }); onChanged(); } catch (e: any) { alert(e.message); }
  };
  const save = async (value: string) => {
    try { await api(`/api/accounts/${a.id}/name`, { method: 'PATCH', body: { name: value } }); setEditing(false); setErr(''); onChanged(); }
    catch (e: any) { setErr(e.message || 'Could not save the name.'); }
  };
  return (
    <>
    <div className="row" data-acct={a.id} data-go={[canLeaveOut ? 'account-row' : '', byHand ? 'by-hand' : ''].filter(Boolean).join(' ') || undefined}>
      <Logo edit as={`account ${a.id}`} also={[a.name, `${a.name} payment`]} name={`${a.institution} ${a.bank_name || a.name}`} fallback={a.institution[0]} />
      {editing ? (
        <form className="grow rename" onSubmit={(e) => { e.preventDefault(); save(name); }}>
          <input type="text" value={name} maxLength={80} autoFocus onFocus={(e) => e.target.select()} aria-label={`Name for ${a.bank_name || a.name}`}
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { setName(a.name); setEditing(false); } }} />
          <button type="submit" className="primary">Save</button>
          <button type="button" onClick={() => { setName(a.name); setEditing(false); }}>Cancel</button>
          {a.bank_name && <button type="button" className="link" onClick={() => save('')}>Use bank's name</button>}
          {err && <small className="error">{err}</small>}
        </form>
      ) : (
        <span className="grow">{a.name}
          <small>{a.institution}{a.bank_name ? ` · ${a.bank_name}` : ''}<span className="wide-only"> · {!(first && last) && <><span className="order-move"><button className="link" disabled={first} aria-label={`Move ${a.name} up`} title="Move up" onClick={() => move('up')}>↑</button><button className="link" disabled={last} aria-label={`Move ${a.name} down`} title="Move down" onClick={() => move('down')}>↓</button></span> · </>}<button className="link" onClick={() => { setName(a.name); setEditing(true); }}>Rename</button>
            {owners.list.length > 1 && <> · <select className="owner-pick" aria-label={`Whose account ${a.name} is`} value={a.owner || 'joint'} onChange={(e) => setOwner(e.target.value)}>{owners.list.map((w) => <option key={w} value={w}>{owners.possessive(w)}</option>)}</select></>}
            {byHand && <> · <button className="link" data-go="set-balance" onClick={() => { setBal(Math.abs(a.balance).toFixed(2)); setErr(''); setSetting(!setting); }}>{property ? 'Set value' : 'Set balance'}</button> · <button className="link" onClick={remove}>Remove</button></>}
            {property && <> · {a.value_link && <><a className="link" href={a.value_link} target="_blank" rel="noopener noreferrer">Check its value at {linkSite} ↗</a> · </>}<button className="link" data-go="value-link" onClick={() => { setErr(''); setHow(!how); }}>How its value is kept</button></>}
            {checkable && <> · <button className="link" onClick={() => setChecking(!checking)}>Check a statement</button></>}
            {canLeaveOut && <> · <button className="link" data-go="off-budget" title={a.off_budget ? 'Count its spending in your budgets and totals again' : "Keep showing its balance, but don't count its spending in your budgets and totals"} onClick={() => setOut(!a.off_budget)}>{a.off_budget ? 'Count in the budget' : 'Leave out of the budget'}</button></>}
          </span></small>
          {a.off_budget ? <small className="sub off-budget-note">Left out of the budget: its spending isn't counted, its balance still is.</small> : null}
          {checkable && a.checked && !checking && <small className={a.checked.gap === 0 ? 'good' : 'sub'}>{a.checked.gap === 0 ? `✓ Matches the statement to ${dayShort(a.checked.end)}` : `The statement to ${dayShort(a.checked.end)} was ${cents(Math.abs(a.checked.gap))} out when last checked`}</small>}
          {byHand && setting && (
            <form className="rename set-balance" onSubmit={saveBalance}>
              <label>{owed ? 'Owed on it today' : property ? "What it's worth today" : "What's in it today"}<MoneyInput value={bal} placeholder="0.00" onChange={setBal} /></label>
              <button type="submit" className="primary">Save</button>
              <button type="button" onClick={() => setSetting(false)}>Cancel</button>
              {err && <small className="error">{err}</small>}
              <small>{property ? (a.value_auto ? 'Typing a value switches the monthly lookup off for this one, so your figure stays.' : 'It stays at this value until you change it. Net worth follows from the day you change it.') : a.base_date ? 'From here the balance follows what you enter on this account.' : 'This balance stays as typed until you change it again.'}</small>
            </form>
          )}
          {property && a.value_auto ? <small className="sub">Looked up each month at RentCast{a.value_at ? `, last on ${dayShort(a.value_at)}` : ''}.</small> : null}
          {property && a.dep_rate > 0 ? <small className="sub">Lowered a little each month by a rule of thumb: {a.dep_rate}% a year{a.dep_use === 'auto' ? ' for now' : ''}{a.dep_date ? `, from ${money(a.dep_base)} on ${dayShort(a.dep_date)}` : ''}. An estimate, not a Kelley Blue Book value.</small> : null}
          {property && a.value_note === 'typed' ? <small className="sub">The monthly lookup switched off when you typed a value. It can be switched back on under "How its value is kept".</small> : null}
        </span>
      )}
      <span className="num">{cents(a.balance)}</span>
      {/* On a phone the row's links are behind this one button. */}
      {!editing && <More name={a.name} sub={`${a.institution} · ${cents(a.balance)}`} items={() => [
        { label: 'Rename', run: () => { setName(a.name); setEditing(true); } },
        !first && { label: 'Move up', hint: 'One place higher in this list', run: () => move('up') },
        !last && { label: 'Move down', run: () => move('down') },
        ...owners.list.filter((w) => w !== (a.owner || 'joint')).map((w) => ({ label: `Mark as ${owners.possessive(w).toLowerCase() === 'shared' ? 'shared' : owners.possessive(w)}`, hint: 'Whose account this is', run: () => setOwner(w) })),
        { label: 'Change the icon', run: () => dispatchEvent(new CustomEvent('ledger-logo-edit', { detail: { key: `account ${a.id}`, label: a.name } })) },
        canLeaveOut && (a.off_budget
          ? { label: 'Count in the budget', hint: 'Its spending counts in your budgets and totals again', run: () => setOut(false) }
          : { label: 'Leave out of the budget', hint: "Its balance still shows; its spending isn't counted", run: () => setOut(true) }),
        checkable && { label: 'Check a statement', hint: 'Compare a stretch with what the bank printed', run: () => setChecking(true) },
        property && a.value_link && { label: 'Check its value', hint: `Opens ${linkSite} in a new tab`, run: () => { window.open(a.value_link, '_blank', 'noopener,noreferrer'); } },
        byHand && { label: property ? 'Set value' : 'Set balance', hint: property ? 'What it is worth today' : 'Correct what is in it today', run: () => { setBal(Math.abs(a.balance).toFixed(2)); setErr(''); setSetting(true); } },
        property && { label: 'How its value is kept', hint: a.value_auto ? 'Looked up each month' : 'Typed by hand, or looked up each month', run: () => { setErr(''); setHow(true); } },
        byHand && { label: 'Remove', danger: true, run: remove },
      ]} />}
    </div>
    {/* Under the row at the card's full width: inside the row it is squeezed into the name's column. */}
    {property && how && <PropertyValue a={a} start={fresh || undefined} onChanged={onChanged} onClose={() => setHow(false)} />}
    {checking && <StatementCheck a={a} onClose={() => { setChecking(false); onChanged(); }} />}
    </>
  );
}

const KINDS = [['checking', 'Checking'], ['savings', 'Savings'], ['credit', 'Credit card'], ['investment', 'Investment or retirement'], ['hsa', 'Health savings'], ['property', 'A home, vehicle or other property']];

/** Adds an account you keep yourself, for one the bank connection can't reach or a household without one. */
function AddAccount({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', type: 'checking', balance: '' });
  const [err, setErr] = useState('');
  // A property: its value typed here, or left to the monthly lookup, which is set up straight after adding.
  const [how, setHow] = useState<'hand' | 'auto' | 'dep'>('hand');
  const auto = f.type === 'property' && how === 'auto';
  const dep = f.type === 'property' && how === 'dep';
  // A vehicle lowered each month is set up here in one go (the owner: "it has me enter the same information
  // on my car twice" when the form was followed by a second panel asking how its value is kept all over again).
  const [car, setCar] = useState({ year: '', kind: 'car', hold: 'average', miles: '' });
  const [yearTyped, setYearTyped] = useState(false);
  const thisYear = new Date().getFullYear();
  const yearOk = /^\d{4}$/.test(car.year) && Number(car.year) >= 1980 && Number(car.year) <= thisYear + 1;
  const worth = Number(f.balance) || 0;
  const rate = dep && yearOk ? ruleRate(Number(car.year), car.kind, null, thisYear, car.hold) : 0;
  // A year in the name ("2020 RAV4") fills the model year, unless they typed one themselves.
  const setName = (name: string) => {
    const y = name.match(/\b(19[89]\d|20\d\d)\b/)?.[1];
    setF({ ...f, name }); setErr('');
    if (y && !yearTyped && Number(y) <= thisYear + 1) setCar((c) => ({ ...c, year: y }));
  };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (dep && !(worth > 0)) return setErr("Type what it's worth today, so there is a value to lower.");
    if (dep && !yearOk) return setErr('Enter the model year, such as 2021.');
    try {
      const made = await api('/api/setup/account', { method: 'POST', body: { ...f, balance: auto || f.balance === '' ? 0 : Number(f.balance) } });
      if (dep) {
        // Everything was asked for above, so nothing more opens: the lowering and the first odometer reading are saved now.
        try {
          await api(`/api/accounts/${made.id}/depreciate`, { method: 'PUT', body: { on: true, use: 'auto', year: Number(car.year), kind: car.kind, hold: car.hold } });
          if (car.miles) await api(`/api/vehicles/${made.id}/odometer`, { method: 'POST', body: { miles: car.miles } });
        } catch { try { sessionStorage.setItem('ledger-value-how', `${made.id}:dep`); } catch { /* they open it from the row */ } }
      }
      // A home for the monthly lookup still opens "How its value is kept" at its steps (the row reads this as it appears).
      if (auto) { try { sessionStorage.setItem('ledger-value-how', `${made.id}:auto`); } catch { /* private window: they open it from the row */ } }
      setF({ name: '', type: f.type, balance: '' }); setCar({ year: '', kind: 'car', hold: 'average', miles: '' }); setYearTyped(false); setHow('hand'); setOpen(false); setErr(''); onChanged();
    }
    catch (e: any) { setErr(e.message); }
  };
  if (!open) return <div className="add-account"><button onClick={() => setOpen(true)} data-go="add-by-hand">Add an account by hand</button><small>For an account the bank connection can't reach, or if you don't use one, and for a home, vehicle or other property you own. Loans and other debts are added on the Debt page.</small></div>;
  return (
    <form className="add-account open" onSubmit={add} noValidate>
      <b>Add an account by hand</b>
      <div className="edit-fields">
        <label>Name<input type="text" value={f.name} maxLength={80} placeholder={f.type === 'property' ? (how === 'dep' ? 'Family car' : 'Our house') : 'Checking'} autoFocus onChange={(e) => setName(e.target.value)} /></label>
        <label>Kind<select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        {!auto && <label>{f.type === 'credit' ? 'Owed on it today' : f.type === 'property' ? "What it's worth today" : "What's in it today"}<MoneyInput value={f.balance} placeholder="0.00" onChange={(v) => setF({ ...f, balance: v })} /></label>}
      </div>
      {f.type === 'property' && (
        <div className="value-choice" role="radiogroup" aria-label="How its value is kept" data-go="value-choice">
          <label className={how === 'hand' ? 'on' : ''}><input type="radio" name="value-how" checked={how === 'hand'} onChange={() => setHow('hand')} /><span><b>I'll type its value</b><small>For a home, a vehicle or anything else. Buttons open Zillow or Kelley Blue Book in your own browser when you want to check it. Nothing is sent anywhere.</small></span></label>
          <label className={how === 'auto' ? 'on' : ''}><input type="radio" name="value-how" checked={how === 'auto'} onChange={() => setHow('auto')} /><span><b>Look it up each month</b><small>For a home in the United States. Ledger asks RentCast, a property data service, once a month. It needs a free key you make there and the home's address, which is sent to RentCast. The steps come next.</small></span></label>
          <label className={how === 'dep' ? 'on' : ''}><input type="radio" name="value-how" checked={how === 'dep'} onChange={() => setHow('dep')} /><span><b>Lower it a little each month</b><small>For a car or truck. Ledger lowers the value you type each month by a rule of thumb, from the few details asked just below. An estimate, not a Kelley Blue Book value. Nothing is sent anywhere.</small></span></label>
        </div>
      )}
      {dep && (
        <div className="car-facts" data-go="car-facts">
          <div className="add-grid">
            <label className="field"><span>Model year</span><input type="text" inputMode="numeric" maxLength={4} value={car.year} placeholder={String(thisYear - 5)} onChange={(e) => { setYearTyped(true); setCar({ ...car, year: e.target.value.replace(/\D/g, '') }); setErr(''); }} /></label>
            <label className="field"><span>What kind of vehicle</span><select value={car.kind} onChange={(e) => setCar({ ...car, kind: e.target.value })}>{CAR_KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
            <label className="field"><span>Odometer today, in miles (optional)</span><input type="text" inputMode="numeric" value={car.miles} onChange={(e) => setCar({ ...car, miles: e.target.value.replace(/[^0-9,]/g, '') })} /></label>
            <label className="field" style={{ gridColumn: '1 / -1' }}><span>How well does this model hold its value?</span><select value={car.hold} onChange={(e) => setCar({ ...car, hold: e.target.value })}>{CAR_HOLDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          </div>
          {rate > 0 && <small><b>{rate}% a year</b> for now{worth > 0 ? `: ${money(worth)} today would be about ${money(Math.round(worth * (1 - rate / 100)))} in a year` : ''}. That is all Ledger needs: nothing more is asked after you add it. The rate, a VIN lookup and where the figure comes from are under "How its value is kept" on its row.</small>}
        </div>
      )}
      {f.type === 'property'
        ? <small>{auto ? 'Give it a name such as "Our house". The address is asked for in the next step, in its own box, so it needn\'t go in the name.' : 'Your net worth then counts it beside the mortgage or loan that paid for it. Update it whenever you like with "Set value".'} You can switch between the two later with "How its value is kept" on its row.</small>
        : <small>Its balance then follows the purchases, deposits and transfers you enter on it. You can correct it at any time with "Set balance".</small>}
      {err && <p className="error" role="alert">{err}</p>}
      <div className="add-actions"><button type="submit" className="primary">{auto ? 'Add it and set up the lookup' : dep ? 'Add it' : 'Add account'}</button><button type="button" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  );
}

/** What each adult has, owes and has spent this month, once any account has been marked as someone's own. */
/**
 * How long the household's savings would last at its usual spending (server/cushion.js). One figure and
 * how it was worked out. No target and no advice: the page never says how many months is enough.
 */
function CushionCard() {
  const { data: c } = useData<any>('/api/cushion');
  if (!c?.ready) return null;
  const n = (v: number) => (v >= 10 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, ''));
  const word = (v: number) => (Number(n(v)) === 1 ? 'month' : 'months');
  return (
    <section className="card cushion" data-go="cushion">
      <div className="card-head"><h2>Months of expenses covered</h2></div>
      <div className="cushion-row">
        <div className="cushion-figure"><b>{n(c.months)}</b><span>{word(c.months)}</span></div>
        <p className="sub">Your savings of {money(c.savings)} would cover about {n(c.months)} {word(c.months)} of your usual spending, which is {money(c.monthly)} a month ({c.basedOn === 1 ? 'last month' : `the average of the last ${c.basedOn} finished months`}).
          {c.checking > 0 ? ` Counting what is in checking too, about ${n(c.withChecking)} ${word(c.withChecking)}.` : ''}
          {c.taxLeftOut ? ` "${c.taxLeftOut}" is left out, since it is set aside for taxes.` : ''}</p>
      </div>
    </section>
  );
}

function OwnersCard() {
  const o = useOwners();
  // Which groups have their accounts listed (he asked for a clear way to see the accounts behind each figure).
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!o.data || !o.marked) return null;
  return (
    <section className="card">
      <div className="card-head"><h2>Whose is what</h2></div>
      <p className="sub first">From the accounts marked as each person's. Everything else in Ledger still covers the whole household.</p>
      <div className="owner-cols">
        {o.list.map((w) => {
          const g = o.data.groups[w];
          return (
            <div key={w} className="owner-col">
              <b>{o.possessive(w)}</b>
              {g.accounts > 0
                ? <button type="button" className="link owner-show" aria-expanded={!!open[w]} onClick={() => setOpen((was) => ({ ...was, [w]: !was[w] }))}>{open[w] ? 'Hide' : 'Show'} the {g.accounts === 1 ? 'account' : `${g.accounts} accounts`} {open[w] ? '▴' : '▾'}</button>
                : <small>No accounts marked yet</small>}
              {open[w] && (
                <div className="owner-accts">
                  {(g.list || []).map((a: any) => (
                    <button type="button" key={a.id} className="owner-acct" title="Go to this account in the list below" onClick={() => goTo({ page: 'accounts', at: `[data-acct="${a.id}"]` })}>
                      <span className="grow">{a.name}</span><span className={`num ${a.balance < 0 ? 'owed' : ''}`}>{a.balance < 0 ? `owes ${money(-a.balance)}` : money(a.balance)}</span>
                    </button>
                  ))}
                  <small>Tap one to go to it in the list below, where "Mark as…" changes whose it is.</small>
                </div>
              )}
              <div className="row"><span className="grow">Has</span><span className="num">{money(g.has)}</span></div>
              <div className="row"><span className="grow">Owes</span><span className="num">{money(g.owes)}</span></div>
              <div className="row"><span className="grow">Spent this month</span><span className="num">{money(g.spent)}</span></div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function Accounts() {
  const { data, error, reload } = useData('/api/accounts');
  if (error) return <p className="error">{error}</p>;
  if (!data) return <Skeleton cards={2} rows={5} />;
  const { accounts, history } = data;
  const last = history.at(-1);
  const first = history[0];
  const change = last.net - first.net;
  const lo = Math.min(...history.map((h: any) => h.net));
  const hi = Math.max(...history.map((h: any) => h.net));
  const pad = (hi - lo) * 0.15 || 1000;

  return (
    <div className="stack">
      <section className="card">
        <div className="pace-head">
          <div>
            <div className="label">Net worth</div>
            <div className="hero">{money(last.net)}</div>
            <div className="sub"><span className={change >= 0 ? 'good' : 'bad'}>{change >= 0 ? '+' : '-'}{money(Math.abs(change))}</span> over the past 12 months</div>
          </div>
          <div className="legend">
            <span>Assets <b className="num">{money(last.assets)}</b></span>
            <span>Debts <b className="num">{money(last.debts)}</b></span>
          </div>
        </div>
        <div className="chart" style={{ height: 240 }}>
          <ResponsiveContainer>
            <AreaChart data={history} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="date" tickLine={false} axisLine={{ stroke: 'var(--axis)' }} tick={{ fill: 'var(--ink3)', fontSize: 12 }} tickFormatter={monthShort} interval={1} />
              <YAxis width={48} domain={[Math.floor((lo - pad) / 1000) * 1000, Math.ceil((hi + pad) / 1000) * 1000]} tickLine={false} axisLine={false} tick={{ fill: 'var(--ink3)', fontSize: 12 }} tickFormatter={compact} tickCount={4} />
              <Tooltip
                cursor={{ stroke: 'var(--axis)' }}
                content={({ active, payload }: any) =>
                  active && payload?.length ? (
                    <div className="tip">
                      <div className="tip-title">{dayShort(payload[0].payload.date)}</div>
                      <div className="tip-row"><span>Net worth</span><b>{money(payload[0].payload.net)}</b></div>
                      <div className="tip-row"><span>Assets</span><b>{money(payload[0].payload.assets)}</b></div>
                      <div className="tip-row"><span>Debts</span><b>{money(payload[0].payload.debts)}</b></div>
                    </div>
                  ) : null
                }
              />
              <Area dataKey="net" stroke="var(--accent)" strokeWidth={2.5} fill="var(--accent)" fillOpacity={0.1} dot={false} activeDot={{ r: 4, stroke: 'var(--panel)', strokeWidth: 2 }} isAnimationActive={!reducedMotion()} animationDuration={900} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <CushionCard />

      <OwnersCard />

      <GoalsCard />

      <AllowanceCard />

      <InvestmentsCard />

      <section className="card">
        {/* At the top of the list (2026-11-27): at the foot it sat under every account and was missed. */}
        <AddAccount onChanged={reload} />
        {GROUPS.map((g) => {
          const items = accounts.filter((a: any) => g.types.includes(a.type));
          if (!items.length) return null;
          return (
            <div key={g.title}>
              <div className="group-head"><span>{g.title}{'note' in g && g.note ? <small> · {g.note}</small> : null}</span><span className="num">{cents(items.reduce((a: number, x: any) => a + x.balance, 0))}</span></div>
              {items.map((a: any, i: number) => <AccountRow key={a.id} a={a} onChanged={reload} first={i === 0} last={i === items.length - 1} />)}
            </div>
          );
        })}
      </section>
    </div>
  );
}
