// First-run setup: walks a new household through the few things Ledger needs to be useful.
// Shown in place of the app until it is finished or skipped (server/setup.js keeps the state),
// and can be opened again from Settings. Every step saves as you go and can be skipped; nothing
// here is the only place to set something, since each step reuses a section of Settings or Taxes.
import { CurrencyPick } from '../Currency';
import { useState } from 'react';
import { api, cents, forgetLoaded, money, setTaxes, useData, useTaxes } from '../lib';
import { MoneyInput, NumField } from '../ui';
import { LogoFetch, Paydays, SideGig } from './Connections';
import { PayStub, HouseholdNames, StatePick } from './Taxes';
import { TaxMore } from './TaxMore';
import { ZeroGuide } from './ZeroGuide';

const STEPS = ['Welcome', 'Your household', 'Your accounts', 'Paydays', 'Side income', 'Taxes', 'Budgets', 'All set'] as const;
const KIND: Record<string, string> = { checking: 'Checking', savings: 'Savings', credit: 'Credit card' };
// Shown in the list of what has been added; a home or vehicle is added in its own part of the step.
const KIND_SHOWN: Record<string, string> = { ...KIND, property: 'Home or other property', investment: 'Investment or retirement', hsa: 'Health savings' };

/** Step 1: how the household files, children, and what each adult does for work. */
function Household() {
  const taxesOn = useTaxes();
  const { data: s, reload } = useData('/api/settings');
  const { data: w, reload: reloadWork } = useData('/api/setup/work');
  const [you, setYou] = useState<string | null>(null);
  const [spouse, setSpouse] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<any>(null);
  const [err, setErr] = useState('');
  if (!s || !w) return null;
  const joint = s.filing_status === 'joint' || s.filing_status === 'separate';
  const save = (key: string) => async (v: string) => { await api('/api/settings', { method: 'PUT', body: { [key]: v } }); forgetLoaded(); reload(); dispatchEvent(new Event('ledger-gig')); };
  const sortOut = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      setFound(await api('/api/setup/work', { method: 'POST', body: { you: you ?? w.you, spouse: spouse ?? w.spouse } }));
      forgetLoaded(); reloadWork(); dispatchEvent(new Event('ledger-gig'));
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };
  const ideas: any[] = found?.ideas ?? w.ideas ?? [];
  return (
    <>
      <p className="sub first">A few facts about your household. They shape the tax estimate and which parts of the app you see. You can change any of them later on the Taxes page.</p>
      {!taxesOn && <p className="sub">You've said you are not in the United States, so Ledger's tax section is switched off: it only knows US federal and state income tax. Everything else works the same. Choosing a state here switches it back on.</p>}
      <div className="add-grid">
        <StatePick value={s.tax_state} onPick={(v) => save('tax_state')(v)} />
        <CurrencyPick label="Your currency" />
        {taxesOn && <><label className="field"><span>How you file your taxes</span>
          <select value={s.filing_status} onChange={(e) => save('filing_status')(e.target.value)}>
            <option value="joint">Married, filing jointly</option>
            <option value="single">Single</option>
            <option value="hoh">Head of household</option>
            <option value="separate">Married, filing separately</option>
          </select>
        </label>
        <NumField label="Children under 17" value={s.kids} onSave={save('kids')} /></>}
      </div>
      <div className="add-grid"><HouseholdNames joint={joint} /></div>
      <h3 className="setup-sub">Where do you work?</h3>
      <p className="sub">Say what each of you does, in your own words: "nurse at a hospital", "3rd grade teacher", "self-employed electrician", "a few side jobs", "retired". Ledger uses it to switch on the parts that fit your work and to list tax breaks worth asking about.</p>
      <form onSubmit={sortOut} noValidate className="add-grid">
        <label className="field"><span>Your work</span><input type="text" value={you ?? w.you} maxLength={120} placeholder="What you do, and where" onChange={(e) => setYou(e.target.value)} /></label>
        {joint && <label className="field"><span>Your spouse's work</span><input type="text" value={spouse ?? w.spouse} maxLength={120} placeholder="What they do, and where" onChange={(e) => setSpouse(e.target.value)} /></label>}
        <div className="setup-save"><button type="submit" className="primary" disabled={busy}>{busy ? 'Working it out…' : 'Save'}</button></div>
      </form>
      {err && <p className="error" role="alert">{err}</p>}
      {found && (
        <p className="sub" role="status">
          Saved.{found.educators > 0 ? ` Classroom expense claims are switched on for ${found.educators === 2 ? 'both of you' : 'the teacher in the household'}: you can mark school purchases on the Transactions page and Ledger adds them up for tax time.` : ''}
          {found.selfEmployed ? ' It sounds like there is self-employment income: the Side income step, two screens on, is for that.' : ''}
          {found.retired ? " Noted that someone is retired. Budgets, accounts and the forecast all work for you; on the Paydays step you can add Social Security or a pension as 'a set weekday each month'. On the Taxes step you can add Social Security, pensions and retirement withdrawals under 'Retirement and other income' so the tax estimate counts them." : ''}
        </p>
      )}
      {ideas.length > 0 && (
        <>
          <h3 className="setup-sub">Worth asking about at tax time</h3>
          <ul className="setup-ideas">{ideas.map((i) => <li key={i.title}><b>{i.title}</b>{i.detail}</li>)}</ul>
          <p className="sub">These are suggestions to raise with whoever prepares your taxes. Ledger isn't a tax preparer and can't tell you that you qualify.</p>
        </>
      )}
      <p className="sub">The tax estimate covers federal income tax and your state's, which you chose at the top of this step.</p>
    </>
  );
}

/** Step 2: where the money is. A bank connection, accounts kept by hand, or both. */
function Accounts() {
  const { data: st, reload } = useData('/api/setup');
  const [token, setToken] = useState('');
  const [f, setF] = useState({ name: '', type: 'checking', balance: '' });
  // A home, vehicle or other property, added at a typed value so net worth counts it.
  const [own, setOwn] = useState({ name: '', balance: '', car: false, year: '', kind: 'car' });
  const [ownErr, setOwnErr] = useState('');
  const addOwn = async (e: React.FormEvent) => {
    e.preventDefault();
    const worth = own.balance === '' ? 0 : Number(own.balance);
    if (own.car && !(worth > 0)) return setOwnErr("Type what the vehicle is worth today, so Ledger has a figure to lower.");
    if (own.car && !/^(19[89]|20)\d\d$/.test(own.year)) return setOwnErr('Enter the vehicle\u2019s model year, such as 2021.');
    try {
      const made = await api('/api/setup/account', { method: 'POST', body: { name: own.name, type: 'property', balance: worth } });
      // A vehicle starts on the average rate; "How its value is kept" on the Accounts page changes or stops it.
      if (own.car && made?.id) await api(`/api/accounts/${made.id}/depreciate`, { method: 'PUT', body: { on: true, use: 'auto', year: Number(own.year), kind: own.kind } });
      setOwn({ name: '', balance: '', car: false, year: '', kind: 'car' }); setOwnErr(''); forgetLoaded(); reload();
    } catch (e: any) { setOwnErr(e.message); }
  };
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  if (!st) return null;
  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return setErr('Paste the setup token from SimpleFIN.');
    setBusy('Connecting and reading your accounts. This can take a minute…'); setErr('');
    try { await api('/api/simplefin/connect', { method: 'POST', body: { token } }); setToken(''); forgetLoaded(); reload(); } catch (e: any) { setErr(e.message); }
    setBusy('');
  };
  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    try { await api('/api/setup/account', { method: 'POST', body: { ...f, balance: f.balance === '' ? 0 : Number(f.balance) } }); setF({ name: '', type: f.type, balance: '' }); forgetLoaded(); reload(); } catch (e: any) { setErr(e.message); }
  };
  return (
    <>
      <p className="sub first">Ledger needs to know where your money is. You can connect your banks so it keeps up by itself, keep accounts by hand, or do both.</p>
      {st.accounts.length > 0 && (
        <div>
          {st.accounts.map((a: any) => <div key={a.id} className="row"><span className="grow">{a.name}<small>{KIND_SHOWN[a.type] || a.type}{a.type === 'property' ? (a.dep_rate > 0 ? ', lowered a little each month from the value you typed' : ', at a value you typed') : a.manual ? ', kept by hand' : ', from your bank'}</small></span><span className="num">{cents(a.balance)}</span></div>)}
        </div>
      )}
      <h3 className="setup-sub">Connect your banks{st.bankConnected && <span className="good"> · Connected</span>}</h3>
      {st.bankConnected ? <p className="sub">Your banks are connected. Ledger reads them every few hours.</p> : (
        <>
          <p className="sub">
            This uses SimpleFIN Bridge, a separate service that costs $1.50 a month or $15 a year, paid to them. Your bank passwords are entered on their site and never reach Ledger.
            It is optional. <b>Good to know:</b> SimpleFIN visits each bank about once a day, so balances and purchases can be up to 24 hours behind your bank's own app.
          </p>
          <p className="sub">Create an account there, connect your banks, then make a setup token for a new app, copy it, and paste it into the box below marked "SimpleFIN setup token". You can also do this later in Settings, "SimpleFIN Sync".</p>
          <p><a className="button-link" href="https://bridge.simplefin.org/" target="_blank" rel="noreferrer">Open SimpleFIN in a new tab</a></p>
          <form onSubmit={connect} noValidate className="token-form">
            <label className="field grow"><span>SimpleFIN setup token</span><input type="text" value={token} autoComplete="off" placeholder="Paste the long token from SimpleFIN here" onChange={(e) => { setToken(e.target.value); setErr(''); }} /></label>
            <button type="submit" className="primary" disabled={!!busy}>Connect</button>
          </form>
        </>
      )}
      {busy && <p className="sub" role="status">{busy}</p>}
      <h3 className="setup-sub">Or keep an account by hand</h3>
      <p className="sub">Add your checking account at least, with what's in it today. You then add purchases as you make them, or import a file from your bank now and then.</p>
      <form onSubmit={add} noValidate className="add-grid">
        <label>Name<input type="text" value={f.name} placeholder="Checking" onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label>Kind<select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>{f.type === 'credit' ? 'Owed on it today' : "What's in it today"}<MoneyInput value={f.balance} placeholder="0.00" onChange={(v) => setF({ ...f, balance: v })} /></label>
        <div style={{ alignSelf: 'end' }}><button type="submit">Add account</button></div>
      </form>
      {err && <p className="error" role="alert">{err}</p>}
      <h3 className="setup-sub">Your home and vehicles (optional)</h3>
      <p className="sub">If you own a home or a car, add it with what it's worth. Your net worth then counts it beside the mortgage or loan that paid for it, instead of showing only the debt. A rough figure is fine, and you can change it any time.</p>
      <form onSubmit={addOwn} noValidate className="add-grid">
        <label>Name<input type="text" value={own.name} placeholder={own.car ? 'Family car' : 'Our house'} onChange={(e) => { setOwn({ ...own, name: e.target.value }); setOwnErr(''); }} /></label>
        <label>What it's worth today<MoneyInput value={own.balance} placeholder="0" onChange={(v) => setOwn({ ...own, balance: v })} /></label>
        <div style={{ alignSelf: 'end' }}><button type="submit">Add it</button></div>
        <label className="setup-tick" style={{ gridColumn: '1 / -1' }}><input type="checkbox" checked={own.car} onChange={(e) => { setOwn({ ...own, car: e.target.checked }); setOwnErr(''); }} /><span>It's a vehicle: lower its value a little each month<small>An estimate worked out from its age and kind, not a Kelley Blue Book value. Nothing is sent anywhere.</small></span></label>
        {own.car && <label>Model year<input type="text" inputMode="numeric" maxLength={4} value={own.year} placeholder="2021" onChange={(e) => { setOwn({ ...own, year: e.target.value.replace(/\D/g, '') }); setOwnErr(''); }} /></label>}
        {own.car && <label>What kind of vehicle<select value={own.kind} onChange={(e) => setOwn({ ...own, kind: e.target.value })}><option value="car">Car</option><option value="suv">SUV or crossover</option><option value="truck">Pickup truck</option><option value="hybrid">Hybrid</option><option value="ev">Electric</option></select></label>}
      </form>
      {ownErr && <p className="error" role="alert">{ownErr}</p>}
      <p className="sub">Ledger looks nothing up and doesn't ask for your address. Later, on the Accounts page, "How its value is kept" can open Zillow or Kelley Blue Book for you, look a home's value up once a month if you choose that, or change how fast a vehicle's value is lowered. If a vehicle is added, your CFO also asks for the odometer reading when you read a fuel receipt.</p>
    </>
  );
}

/** Step 5: yearly pay, typed or read from a pay stub. Optional. */
function TaxStep() {
  const { data: s, reload } = useData('/api/settings');
  const taxesOn = useTaxes();
  if (!s) return null;
  if (!taxesOn) return (
    <>
      <p className="sub first">Nothing to do here. The tax section is switched off, because you said you are not in the United States, and Ledger's estimate only covers US federal and state income tax.</p>
      <p className="sub">If that was a mistake, <button type="button" className="link" onClick={() => setTaxes(true)}>switch the tax section back on</button>. It is also in Settings, "Tax section".</p>
    </>
  );
  const joint = s.filing_status === 'joint' || s.filing_status === 'separate';
  const save = (key: string) => async (v: string) => { await api('/api/settings', { method: 'PUT', body: { [key]: v } }); forgetLoaded(); reload(); };
  return (
    <>
      <p className="sub first">Optional. With your yearly pay, the Taxes page estimates what you'll owe and whether your paychecks are withholding enough. Type it, or upload a pay stub and let Ledger read it.</p>
      <div className="add-grid">
        <NumField label="Your pay for the year" value={s.your_salary} step={500} onSave={save('your_salary')} hint="Before tax" />
        {joint && <NumField label="Your spouse's pay for the year" value={s.spouse_salary} step={500} onSave={save('spouse_salary')} hint="Before tax" />}
      </div>
      <PayStub joint={joint} onSaved={reload} />
      <TaxExtras />
    </>
  );
}

/** The optional extras from the Taxes page (children's ages, other jobs, retirement income, costs), folded, inside the guide. */
function TaxExtras() {
  const { data: t, reload } = useData('/api/tax');
  if (!t) return null;
  return <TaxMore t={t} reload={() => { forgetLoaded(); reload(); }} />;
}

/** Suggested budgets, from real spending where Ledger has seen a month of it, otherwise from take-home pay. */
export function BudgetSuggest({ onApplied }: { onApplied: () => void }) {
  const [r, setR] = useState<any>(null);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const ask = async () => {
    setBusy(true); setErr(''); setNote('');
    try {
      const got = await api('/api/setup/budgets/suggest', { method: 'POST' });
      setR(got); setAmounts(Object.fromEntries(got.budgets.map((b: any) => [b.id, String(b.suggested)])));
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };
  const use = async () => {
    try {
      await api('/api/setup/budgets/apply', { method: 'POST', body: { budgets: r.budgets.map((b: any) => ({ id: b.id, amount: Number(amounts[b.id]) || 0 })) } });
      setR(null); setNote('Saved. Those are your budgets now.'); forgetLoaded(); onApplied();
    } catch (e: any) { setErr(e.message); }
  };
  const total = r ? r.budgets.reduce((a: number, b: any) => a + (Number(amounts[b.id]) || 0), 0) : 0;
  return (
    <div className="budget-suggest">
      {!r && <div className="add-actions"><button className="primary" disabled={busy} onClick={ask}>{busy ? 'Working it out…' : 'Suggest budgets for me'}</button></div>}
      {note && <p className="good" role="status">{note}</p>}
      {err && <p className="error" role="alert">{err}</p>}
      {r && (
        <>
          <p className="sub">{r.note}</p>
          <table className="table suggest-table">
            <thead><tr><th>Category</th><th className="r">Now</th>{r.basis === 'spending' && <th className="r">You spend</th>}<th className="r">Suggested</th></tr></thead>
            <tbody>
              {r.budgets.map((b: any) => (
                <tr key={b.id}>
                  <td>{b.icon} {b.name}<small>{b.why}</small></td>
                  <td className="r num sub">{money(b.current)}</td>
                  {r.basis === 'spending' && <td className="r num sub">{b.spent != null ? money(b.spent) : ''}</td>}
                  <td className="r"><input type="number" min="0" step="5" inputMode="decimal" aria-label={`Suggested budget for ${b.name}`} value={amounts[b.id] ?? ''} onChange={(e) => setAmounts({ ...amounts, [b.id]: e.target.value })} style={{ width: 120, textAlign: 'right' }} /></td>
                </tr>
              ))}
              <tr className="total-row"><td>Together{r.takeHome ? <small>Take-home pay is about {money(r.takeHome)} a month</small> : null}</td><td></td>{r.basis === 'spending' && <td></td>}<td className={`r num ${r.takeHome && total > r.takeHome ? 'bad' : ''}`}>{money(total)}</td></tr>
            </tbody>
          </table>
          <div className="add-actions"><button className="primary" onClick={use}>Use these amounts</button><button onClick={() => setR(null)}>Cancel</button></div>
        </>
      )}
    </div>
  );
}

/** Step 6: a monthly amount for each kind of spending. Starter figures are filled in. */
function Budgets() {
  const { data: st, reload } = useData('/api/setup');
  const { data: z, reload: reloadZero } = useData<any>('/api/zero');
  const [guide, setGuide] = useState(false);
  const [start, setStart] = useState('');
  if (!st) return null;
  const zero = !!z?.on;
  const choose = async (on: boolean) => { await api('/api/zero', { method: 'PUT', body: { on } }); forgetLoaded(); reloadZero(); };
  const total = st.budgets.reduce((a: number, c: any) => a + c.budget, 0);
  const save = (id: number) => async (v: string) => { await api(`/api/categories/${id}`, { method: 'PATCH', body: { budget: Number(v) } }); forgetLoaded(); reload(); };
  return (
    <>
      <h3 className="setup-sub" style={{ marginTop: 0 }}>Choose your budgeting method</h3>
      <p className="sub first">Ledger can budget in two ways. Choose the one that suits you; you can change your mind any time at the foot of the Budgets page, and nothing is lost either way.</p>
      <div className="budget-ways" role="radiogroup" aria-label="How you want to budget">
        <button type="button" role="radio" aria-checked={!zero} className={`budget-way ${!zero ? 'on' : ''}`} onClick={() => choose(false)}>
          <b>A set amount for each category</b>
          <span>Decide once what each kind of spending gets per month. Ledger shows how you are doing against it.</span>
          <small>Least upkeep. Suits you if you mostly want to see where the money went.</small>
        </button>
        <button type="button" role="radio" aria-checked={zero} className={`budget-way ${zero ? 'on' : ''}`} onClick={() => choose(true)}>
          <b>Give every dollar a job</b>
          <span>As pay arrives it waits to be assigned, and you hand it out to categories until none is left.</span>
          <small>A few minutes each payday. Suits you if money is tight, pay comes in pieces, or you want to stop a balance creeping up.</small>
        </button>
      </div>
      <p className="sub"><button type="button" className="link" onClick={() => setGuide(true)}>See how "give every dollar a job" works</button></p>
      {guide && <ZeroGuide onClose={() => setGuide(false)} />}
      {zero && <>
        <div className="add-grid">
          <label className="field"><span>Money you already have to hand out</span>
            <MoneyInput value={start || (z?.start ? String(z.start) : '')} onChange={setStart} placeholder="0" label="Money you already have to hand out" />
            <small>Optional: for example what is in checking today. <button type="button" className="link" onClick={async () => { await api('/api/zero', { method: 'PUT', body: { start: Number(String(start).replace(/,/g, '')) || 0 } }); reloadZero(); }}>Save</button>{z?.start ? ` Saved: ${money(z.start)}.` : ''}</small></label>
        </div>
        <p className="sub">The amounts below are your <b>usual</b> amounts. On the Budgets page, "Fill empty ones with my usual amounts" hands them out for a month in one press, and you adjust from there.</p>
      </>}
      <p className="sub">{zero ? 'Usual amounts' : 'A monthly amount'} for each kind of spending. Ledger can suggest them: from what you really spend if your bank is connected and it has seen a full month, otherwise from the paydays you entered. It works without an AI key (with one, Claude fine-tunes the amounts), and with neither spending nor paydays to go on it leaves the amounts for you to type. You can ask again any time on the Budgets page, and the suggestions get better once a month or two of your spending is in.</p>
      <BudgetSuggest onApplied={reload} />
      <h3 className="setup-sub">{zero ? 'Your usual amounts' : 'Your budgets now'}</h3>
      <div className="add-grid setup-budgets">
        {st.budgets.map((c: any) => <NumField key={c.id} label={`${c.icon} ${c.name}`} value={c.budget} step={25} onSave={save(c.id)} />)}
      </div>
      <p className="sub">Together: <b>{money(total)}</b> a month.</p>
    </>
  );
}

export default function Setup({ first, onDone }: { first: boolean; onDone: () => void }) {
  const [step, setStep] = useState(first ? 0 : 1);
  // A copy someone was invited to (it came with a setup code) lives on that person's server; any other is the reader's own.
  const { data: auth } = useData<any>('/api/auth/status');
  const invited = !!auth?.invited;
  const last = STEPS.length - 1;
  // With the tax section off (someone not in the United States) the Taxes step is passed over, both ways,
  // and the count and dots are one shorter.
  const taxesOn = useTaxes();
  const TAX = STEPS.indexOf('Taxes');
  const skipped = (n: number) => !taxesOn && n === TAX;
  const go = (by: 1 | -1) => { let n = step + by; if (skipped(n)) n += by; setStep(n); };
  const shown = STEPS.map((_, i) => i).filter((i) => i > 0 && i < last && !skipped(i));
  const finish = async () => { await api('/api/setup/done', { method: 'POST' }); forgetLoaded(); onDone(); };
  return (
    <div className="setup">
      <div className="setup-inner">
        <div className="setup-top">
          <span className="setup-count">{step === 0 || step === last ? 'Ledger' : `Step ${shown.indexOf(step) + 1} of ${shown.length}`}</span>
          <div className="setup-dots" aria-hidden="true">{shown.map((i) => <i key={i} className={i <= step ? 'on' : ''} />)}</div>
          {step < last && <button className="link" onClick={finish}>{first ? 'Skip setup' : 'Close'}</button>}
        </div>
        <section className="card setup-card">
          <h1 className="setup-title">{step === 0 ? 'Welcome to Ledger' : STEPS[step]}</h1>
          {step === 0 && (
            <>
              <p className="sub first">Ledger keeps your household's money in one place: what you have, what's coming out before payday, where it goes each month, and what to set aside.</p>
              <p className="sub">The next few screens set it up for you. It takes about five minutes, every step can be skipped, and everything here can be changed later in Settings.</p>
              {invited
                ? <p className="sub">This copy is your household's alone. It is kept apart from every other household's and opens only for you. It lives on the home server of the person who invited you, who looks after it and its backups.</p>
                : <p className="sub">This copy is yours alone. It lives on the machine you installed it on, and what you enter stays there: your figures are sent nowhere unless you choose to connect a bank, switch on the AI features, or ask for a home's value to be looked up.</p>}
            </>
          )}
          {step === 1 && <Household />}
          {step === 2 && <Accounts />}
          {step === 3 && <><p className="sub first">Add each paycheck in the household. Ledger uses them to show what's left in checking before the next one.</p><Paydays /></>}
          {step === 4 && <><p className="sub first">If anyone earns money with no tax taken out, such as tutoring, deliveries or freelance work, switch this on. Its pay gets its own category, the Taxes page works out the extra tax and how much of each payment to set aside, and you can claim purchases as its business expenses. Otherwise skip this step.</p><SideGig /></>}
          {step === 5 && <TaxStep />}
          {step === 6 && <Budgets />}
          {step === last && (
            <>
              <p className="sub first">That's everything Ledger needs to start. The dashboard fills in as your accounts and purchases come in.</p>
              <h3 className="setup-sub">One thing that reaches the internet</h3>
              <p className="sub">Ledger keeps your figures on this machine. The one thing it does by itself that goes outside is fetch shops' logos, so your transactions are easier to scan. You can leave it on or switch it off here, and change your mind later in Settings.</p>
              <LogoFetch />
              <p className="sub">Three things worth knowing: the round "+" button adds a purchase from any page; Settings holds everything you just entered; and "Ask your CFO" under the menu answers questions about your money in plain words.</p>
            </>
          )}
        </section>
        <div className="setup-nav">
          {step > 0 && <button onClick={() => go(-1)}>Back</button>}
          <span className="grow" />
          {step < last ? <button className="primary" onClick={() => go(1)}>{step === 0 ? "Let's start" : 'Continue'}</button> : <button className="primary" onClick={finish}>Open Ledger</button>}
        </div>
      </div>
    </div>
  );
}
