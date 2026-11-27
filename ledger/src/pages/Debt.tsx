import { useEffect, useState } from 'react';
import { celebrate, noteQuietly, once } from '../celebrate';
import { api, cents, duration, money, monthsFromNow, useData, useGig } from '../lib';
import { Fold, Logo, NumField, Skeleton } from '../ui';
import { DebtGraph, DebtsTogether } from './DebtGraphs';
import { StatementReader } from './Statements';

/**
 * "Try a different plan" (2026-11-27): the same debts paid smallest balance first (the plan this page
 * follows) and highest rate first, side by side, with boxes to try another monthly extra or a one-time
 * amount. It reads only and changes nothing, and it never says which order is better: two sets of figures.
 */
function PlanTry({ plan }: { plan: any }) {
  const base = plan.compare;
  const [extra, setExtra] = useState('');
  const [lump, setLump] = useState('');
  const [tried, setTried] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (extra.trim() === '' && lump.trim() === '') { setTried(null); setErr(''); return; }
    const t = setTimeout(async () => {
      try { const r = await api(`/api/debts/try?extra=${encodeURIComponent(extra.trim())}&lump=${encodeURIComponent(lump.trim())}`); setTried(r.tried); setErr(''); }
      catch (e: any) { setErr(e.message); }
    }, 350);
    return () => clearTimeout(t);
  }, [extra, lump]);
  if (!base || base.count === 0) return <p className="sub first">Once a debt other than a mortgage has a rate and a payment, this compares two orders of paying them off.</p>;
  const c = tried || base;
  const when = (m: number | null) => (m == null ? 'Not within 60 years' : m === 0 ? 'Now' : `${monthsFromNow(m)} (${duration(m)})`);
  const col = (title: string, sub: string, x: any, was: any) => (
    <div className="plan-col">
      <h3>{title}</h3><small>{sub}</small>
      <div className="row"><span className="grow">Debt-free</span><b>{when(x.months)}</b></div>
      <div className="row"><span className="grow">Interest from here</span><b>{money(x.interest)}</b></div>
      <div className="row"><span className="grow">Paid first</span><b>{x.first}</b></div>
      {tried && was && x.months != null && was.months != null && (x.months !== was.months || Math.abs(x.interest - was.interest) >= 1) && (
        <small className="good">Against today's plan: {was.months - x.months > 0 ? `${duration(was.months - x.months)} sooner` : was.months - x.months < 0 ? `${duration(x.months - was.months)} later` : 'the same month'}, {was.interest - x.interest >= 0 ? `${money(was.interest - x.interest)} less interest` : `${money(x.interest - was.interest)} more interest`}.</small>
      )}
    </div>
  );
  const gap = c.smallest.interest - c.rate.interest;
  return (
    <div className="plan-try" data-go="plan-try">
      <p className="sub first">Your {base.count === 1 ? 'debt' : `${base.count} debts`} other than a mortgage, with {money(c.extra)} a month on top of the regular payments{c.lump > 0 ? ` and ${money(c.lump)} put in once, now` : ''}. Nothing here changes your plan.</p>
      <div className="add-grid">
        <label className="field"><span>Try another extra each month</span><input inputMode="decimal" value={extra} placeholder={String(Math.round(base.extra))} onChange={(e) => setExtra(e.target.value)} /></label>
        <label className="field"><span>Try a one-time amount, paid now</span><input inputMode="decimal" value={lump} placeholder="0" onChange={(e) => setLump(e.target.value)} /></label>
      </div>
      {err && <p className="error">{err}</p>}
      <div className="plan-cols">
        {col('Smallest balance first', 'The order this page follows', c.smallest, tried ? base.smallest : null)}
        {col('Highest rate first', 'The same money, in a different order', c.rate, tried ? base.rate : null)}
      </div>
      <p className="sub">{c.same ? 'For your debts the two orders are the same, so the figures match.'
        : c.smallest.months == null || c.rate.months == null ? 'At these payments at least one debt is never finished, so the two can\u2019t be compared to the end.'
        : `Highest rate first costs ${money(Math.abs(gap))} ${gap >= 0 ? 'less' : 'more'} in interest${c.rate.months === c.smallest.months ? ' and finishes the same month' : c.rate.months < c.smallest.months ? ` and finishes ${duration(c.smallest.months - c.rate.months)} sooner` : ` and finishes ${duration(c.rate.months - c.smallest.months)} later`}. Smallest balance first clears the first debt sooner. Which suits you is your call.`}
        {' '}A mortgage, a card paid in full each month and a loan kept at its regular payment are left out of both.</p>
      {(extra.trim() !== '' || lump.trim() !== '') && <button className="link" onClick={() => { setExtra(''); setLump(''); }}>Back to today's figures</button>}
    </div>
  );
}

const GROUPS = [
  { type: 'credit', title: 'Credit cards' },
  { type: 'auto', title: 'Car loans' },
  { type: 'loan', title: 'Other loans' },
  { type: 'mortgage', title: 'Mortgage' },
];

function AddDebt({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const [f, setF] = useState({ name: '', institution: '', type: 'mortgage', balance: '', apr: '', min_payment: '' });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: any) => { setF({ ...f, [k]: e.target.value }); setErr(''); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return setErr('Enter a name for the debt.');
    if (!(Number(f.balance) > 0)) return setErr('Enter the balance you owe.');
    if (f.apr === '' || !(Number(f.apr) >= 0)) return setErr('Enter the interest rate.');
    if (!(Number(f.min_payment) > 0)) return setErr('Enter the monthly payment.');
    try {
      await api('/api/accounts', { method: 'POST', body: f });
      onDone();
    } catch (e: any) {
      setErr(e.message);
    }
  };
  return (
    <form className="card" onSubmit={submit} noValidate>
      <div className="card-head"><h2>Add a debt by hand</h2></div>
      <div className="add-grid">
        <label>Name<input type="text" value={f.name} onChange={set('name')} placeholder="Home mortgage" autoFocus /></label>
        <label>Lender<input type="text" value={f.institution} onChange={set('institution')} placeholder="Arvest Bank" /></label>
        <label>Type
          <select value={f.type} onChange={set('type')}>
            {GROUPS.map((g) => <option key={g.type} value={g.type}>{g.title}</option>)}
          </select>
        </label>
        <label>Balance owed<input type="number" min="0" step="0.01" inputMode="decimal" value={f.balance} onChange={set('balance')} placeholder="184000" /></label>
        <label>Interest rate (%)<input type="number" min="0" step="0.01" inputMode="decimal" value={f.apr} onChange={set('apr')} placeholder="6.25" /></label>
        <label>Monthly payment<input type="number" min="0" step="0.01" inputMode="decimal" value={f.min_payment} onChange={set('min_payment')} placeholder="1250" /></label>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      <div className="add-actions">
        <button type="submit" className="primary">Add debt</button>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

/**
 * Loan forgiveness, on a federal student loan's row. A pointer to the program for people who work for a
 * school, government or nonprofit; a count they read off studentaid.gov and type here, shown as progress
 * toward 120; and a switch that keeps the payoff plan from sending spare money to a balance that may be
 * forgiven. Ledger never says who qualifies or works the count out: the rules change and depend on the
 * person's loan type, repayment plan and employer.
 */
function Forgiveness({ d, save }: { d: any; save: (id: number, key: string) => (v: string) => Promise<void> }) {
  const [open, setOpen] = useState(d.min_only || d.forgive_count != null);
  const n = d.forgive_count;
  // If every payment from the day the count was typed has counted, where they stand now and when they reach 120.
  const since = d.forgive_at ? Math.max(0, (new Date().getFullYear() - Number(d.forgive_at.slice(0, 4))) * 12 + new Date().getMonth() + 1 - Number(d.forgive_at.slice(5, 7))) : 0;
  const now = n == null ? null : Math.min(120, n + since), left = now == null ? null : 120 - now;
  if (!open) return <p className="forgive"><button type="button" className="link" onClick={() => setOpen(true)}>Work for a school, government or nonprofit? This loan may be forgivable</button></p>;
  return (
    <div className="forgive">
      <p className="sub"><b>Loan forgiveness.</b> If you work full-time for a public school, a government or a nonprofit, federal Direct Loans can be forgiven after 120 qualifying monthly payments (ten years' worth). Whether a payment counts depends on your loan type, your repayment plan and your employer, and the rules change, so check your own count at <a href="https://studentaid.gov/pslf/" target="_blank" rel="noreferrer">studentaid.gov</a>: it shows your qualifying payments and lets you look up your employer. A fixed payment stretched over more than ten years usually does not count; an income-driven plan does.</p>
      <div className="debt-fields forgive-fields">
        <NumField label="Qualifying payments so far" value={n ?? ''} allowBlank step={1} placeholder="From studentaid.gov" onSave={save(d.id, 'forgive_count')} hint="Type the count studentaid.gov shows" />
        <div className="payoff">
          <span>Progress</span>
          {now == null ? <b className="sub">Enter your count to track it</b> : (
            <>
              <b>{now} of 120</b>
              <div className="track" role="img" aria-label={`${now} of 120 qualifying payments`}><div className="fill" style={{ width: `${(now / 120) * 100}%` }} /></div>
              <small>{left === 0 ? 'That is all 120. Ask your servicer about applying for forgiveness.' : `If every payment from here counts, you reach 120 around ${monthsFromNow(left!)}.`}{since > 0 ? ` (${n} when you typed it, plus ${since} since.)` : ''}</small>
            </>
          )}
        </div>
      </div>
      <label className="hint-every"><input type="checkbox" checked={!!d.min_only} onChange={(e) => save(d.id, 'min_only')(e.target.checked as any)} /> I'm working toward forgiveness: pay only the regular payment on this loan and leave it out of the payoff order</label>
      <small>With this on, the payoff plan never sends spare money here, since paying down a balance that will be forgiven is money wasted. Leave it off if you plan to pay the loan off yourself.</small>
    </div>
  );
}

// What has gone toward a debt this month, in however many payments, against its usual payment.
// On a card, "Record a payment" opens the transfer form with the card chosen (The owner, 2026-11-23:
// he pays cards in parts as side-gig money arrives).
function PaidSoFar({ d }: { d: any }) {
  const p = d.paid;
  const month = new Date().toLocaleDateString(undefined, { month: 'long' });
  const pay = () => { try { sessionStorage.setItem('ledger-pay-debt', String(d.id)); } catch { /* private window */ } location.hash = '#transactions/transfer'; };
  return (
    <div className="debt-paid">
      {p.count > 0 ? (
        <span className="grow">
          <b>{cents(p.total)}</b> paid so far in {month}{p.count > 1 ? `, in ${p.count} payments` : ''}.{' '}
          {p.planned > 0 && (p.over > 0
            ? <span className="good">{cents(p.over)} more than this month's {cents(p.planned)}. Every dollar past the payment comes straight off the balance.</span>
            : p.short > 0 ? <>{cents(p.short)} of this month's {cents(p.planned)} still to go.</> : <>That covers this month's {cents(p.planned)}.</>)}
          {p.planned > 0 && <i className="debt-paid-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, (p.total / p.planned) * 100)}%` }} /></i>}
        </span>
      ) : <span className="grow sub">Nothing paid toward it yet in {month}.</span>}
      {d.type === 'credit' && <button type="button" className="link" onClick={pay}>Record a payment</button>}
    </div>
  );
}

export default function Debt() {
  const gig = useGig();
  const { data: p, error, reload } = useData('/api/debts');
  const [adding, setAdding] = useState(false);
  // The debt whose graph is open in a pop-up.
  const [graph, setGraph] = useState<number | null>(null);
  // Reading a batch of statements, in a pop-up.
  const [reading, setReading] = useState(false);
  const [readFor, setReadFor] = useState<number | null>(null); // the debt whose graph asked for statements
  // The dashboard's statement reminder lands here with the reader open.
  useEffect(() => {
    const open = () => { try { if (sessionStorage.getItem('ledger-upload-debt')) { sessionStorage.removeItem('ledger-upload-debt'); setReading(true); } } catch { /* private window */ } };
    open();
    addEventListener('ledger-upload-debt', open);
    return () => removeEventListener('ledger-upload-debt', open);
  }, []);
  // A debt reaching zero is worth a moment, once. Debts that were already at zero the first time this page is opened aren't news.
  const [cleared, setCleared] = useState<string[]>([]);
  const paid = (p?.debts ?? []).filter((d: any) => d.status === 'paid').map((d: any) => ({ id: `debt-${d.id}`, name: d.name }));
  const paidKey = paid.map((d: any) => d.id).join(',');
  useEffect(() => {
    if (!p || noteQuietly('debts', paid.map((d: any) => d.id))) return;
    const fresh: string[] = [];
    for (const d of paid) once(d.id, () => fresh.push(d.name));
    if (fresh.length) { setCleared(fresh); celebrate(); }
  }, [paidKey, !!p]);
  if (error) return <p className="error">{error}</p>;
  if (!p) return <Skeleton tiles={4} cards={2} rows={4} />;

  const { totals: t, excess: x } = p;
  const saveSetting = (key: string) => async (v: string) => { await api('/api/settings', { method: 'PUT', body: { [key]: v } }); reload(); };
  const saveDebt = (id: number, key: string) => async (v: string) => { await api(`/api/accounts/${id}`, { method: 'PATCH', body: { [key]: v } }); reload(); };
  const remove = async (d: any) => {
    if (!confirm(`Remove ${d.name}? This can't be undone.`)) return;
    await api(`/api/accounts/${d.id}`, { method: 'DELETE' });
    reload();
  };

  const target = p.debts.filter((d: any) => d.status === 'ok' && d.order).sort((a: any, b: any) => a.order - b.order)[0];
  const next = p.debts.find((d: any) => d.order === 2);
  const mortgage = p.debts.find((d: any) => d.type === 'mortgage' && d.status === 'ok');

  return (
    <div className="stack">
      {cleared.length > 0 && <div className="cheer" role="status">🎉 {cleared.join(' and ')} {cleared.length === 1 ? 'is' : 'are'} paid off.</div>}
      <section className="tiles">
        <div className="tile"><div className="label">Total debt</div><div className="value">{money(t.balance)}</div><div className="sub">{p.debts.filter((d: any) => d.balance > 0).length} accounts</div></div>
        <div className="tile"><div className="label">Monthly minimums</div><div className="value">{money(t.minimums)}</div><div className="sub">required payments</div></div>
        <div className="tile">
          <div className="label">Debt-free{mortgage ? ' except the house' : ''}</div>
          <div className="value">{t.debtFreeMonths == null ? 'Not yet' : t.debtFreeMonths === 0 ? 'Now' : monthsFromNow(t.debtFreeMonths)}</div>
          <div className={t.debtFreeMonths != null && t.debtFreeNoExtraMonths != null && t.debtFreeMonths < t.debtFreeNoExtraMonths ? 'good' : 'sub'}>
            {t.debtFreeMonths == null ? 'payments too low to finish' : t.debtFreeNoExtraMonths != null && t.debtFreeMonths < t.debtFreeNoExtraMonths ? `${duration(t.debtFreeNoExtraMonths - t.debtFreeMonths)} sooner than minimums` : 'on minimum payments'}
          </div>
        </div>
        <div className="tile"><div className="label">Interest saved</div><div className="value">{money(t.interestSaved)}</div><div className="sub">{t.interestSavedAtLeast ? 'or more, versus minimums only' : 'versus minimums only'}</div></div>
      </section>

      <div className="cols">
        <section className="card">
          <div className="card-head"><h2>Excess money each month</h2></div>
          <div className="row"><span className="grow">Typical income<small>Average of the last 3 full months</small></span><span className="num">{money(x.income)}</span></div>
          <div className="row"><span className="grow">Monthly budget</span><span className="num">-{money(x.budget)}</span></div>
          {gig.on && <div className="row"><span className="grow">Set aside for {gig.name} taxes<small>From the Taxes page</small></span><span className="num">-{money(x.taxSetAside)}</span></div>}
          <div className="row">
            <span className="grow">Credit card minimums<small>{x.minsInBudget ? 'Already counted in your budget' : 'Loan and mortgage payments are already in your budget'}</small></span>
            <span className="num">{x.minsInBudget ? money(0) : `-${money(x.minimums)}`}</span>
          </div>
          <div className="row total"><span className="grow">Excess</span><span className={`num ${x.amount >= 0 ? 'good' : 'bad'}`}>{x.amount < 0 ? '-' : ''}{money(Math.abs(x.amount))}</span></div>
          <label className="check">
            <input type="checkbox" checked={x.minsInBudget} onChange={(e) => saveSetting('mins_in_budget')(e.target.checked ? '1' : '0')} />
            My budget already includes credit card payments
          </label>
        </section>

        <section className="card">
          <div className="card-head"><h2>Where to put it</h2></div>
          <NumField
            label="Extra toward debt each month" value={p.usingExcess ? '' : p.extra} allowBlank step={25}
            placeholder={`${Math.round(p.extra)} (your excess)`} onSave={saveSetting('extra_payment')}
            hint={p.usingExcess ? 'Using your full excess. Type a different amount to plan with less.' : 'Clear the box to use your full excess again.'}
          />
          {x.amount < 0 && p.usingExcess && <p className="sub">Your budget and minimums are more than your typical income, so there's nothing extra to apply right now.</p>}
          {target ? (
            <div className="advice">
              <p>
                {p.extra + target.min_payment >= target.balance ? (
                  <><b>Pay off {target.name} this month.</b> Its {cents(target.balance)} balance is your smallest, and your {money(p.extra)} extra covers it{next ? `, with the rest going to ${next.name}` : ''}.</>
                ) : (
                  <><b>Put {money(p.extra)} on {target.name}</b> on top of its {money(target.min_payment)} minimum. It's your smallest balance at {cents(target.balance)}, so it goes first.</>
                )}
              </p>
              <p>
                It would be paid off in <b>{monthsFromNow(target.planMonths)}</b> ({duration(target.planMonths)})
                {target.minMonths ? <>, not {monthsFromNow(target.minMonths)} on minimums alone</> : null}.
              </p>
              {next && <p>Then roll that whole payment into <b>{next.name}</b>, which would be gone by <b>{monthsFromNow(next.planMonths)}</b>.</p>}
              {mortgage && t.debtFreeMonths != null && mortgage.planMonths && (
                <p>After that, {money(mortgage.rollover)} a month extra on the mortgage would finish it in <b>{monthsFromNow(mortgage.planMonths)}</b>{mortgage.minMonths ? <>, {duration(mortgage.minMonths - mortgage.planMonths)} early</> : null}.</p>
              )}
            </div>
          ) : (
            <p className="sub">Add a rate and payment to your debts below to get a recommendation.</p>
          )}
          <small>This follows the debt snowball: smallest balance first, regardless of interest rate, with the mortgage last.</small>
        </section>
      </div>

      <Fold id="debt-graph" title="Your debts over time" note="A graph of everything you owe, heading to zero">
        <DebtsTogether />
      </Fold>
      <Fold id="debt-try" title="Try a different plan" note="Two payoff orders side by side, and what an extra amount would do">
        <PlanTry plan={p} />
      </Fold>
      {graph != null && <DebtGraph id={graph} onClose={() => setGraph(null)} onUpload={() => { setReadFor(graph); setGraph(null); setReading(true); }} />}
      {reading && <StatementReader forAccount={readFor ?? undefined} onClose={() => { setReading(false); if (readFor != null) { setGraph(readFor); setReadFor(null); } }} onSaved={reload} />}

      <section className="card">
        <div className="card-head">
          <h2>Your debts</h2>
          <span className="add-actions" style={{ margin: 0 }}>
            <button data-news="upload-debt" onClick={() => setReading(true)}>Upload debt</button>
            {!adding && <button onClick={() => setAdding(true)}>Add a debt by hand</button>}
          </span>
        </div>
        {/* Snowball order: smallest balance first, then anything still missing its rate or payment, the mortgage, and what's paid off. */}
        {[
          { type: 'order', title: 'Payoff order: smallest balance first', items: p.debts.filter((d: any) => d.order).sort((x: any, y: any) => x.order - y.order) },
          { type: 'missing', title: 'Need a rate and payment to join the plan', items: p.debts.filter((d: any) => d.status === 'missing').sort((x: any, y: any) => x.balance - y.balance) },
          { type: 'minimum', title: 'Paying the regular payment only', items: p.debts.filter((d: any) => d.status === 'ok' && !d.order && d.min_only) },
          { type: 'full', title: 'Paid in full every month', items: p.debts.filter((d: any) => d.status === 'full') },
          { type: 'last', title: 'Paid off last', items: p.debts.filter((d: any) => d.status === 'ok' && !d.order && !d.min_only) },
          { type: 'paid', title: 'Paid off', items: p.debts.filter((d: any) => d.status === 'paid') },
        ].map((g) => {
          const items = g.items;
          if (!items.length) return null;
          return (
            <div key={g.type}>
              <div className="group-head"><span>{g.title}</span><span className="num">{cents(items.reduce((a: number, d: any) => a + d.balance, 0))}</span></div>
              {items.map((d: any) => (
                <div key={d.id} className="debt">
                  <div className="debt-main">
                    <Logo edit as={`account ${d.id}`} also={[d.name, `${d.name} payment`]} name={`${d.institution} ${d.name}`} fallback={d.order ?? '·'} />
                    <span className="grow">
                      {d.name}
                      <small>
                        {d.institution} · {GROUPS.find((t) => t.type === d.type)?.title.replace(/s$/, '') ?? 'Loan'}
                        {d.order ? ` · pay off ${d.order === 1 ? 'first' : d.order === 2 ? 'second' : `number ${d.order}`}` : d.min_only || d.status === 'full' ? ' · left out of the payoff order' : d.type === 'mortgage' ? ' · pay off last' : ''}
                        {d.manual ? <> · <button className="link" onClick={() => remove(d)}>Remove</button></> : null}
                      </small>
                    </span>
                    <span className="num debt-bal">{cents(d.balance)}</span>
                  </div>
                  <div className="debt-fields">
                    {d.manual ? <NumField label="Balance" value={d.balance} step={0.01} onSave={saveDebt(d.id, 'balance')} /> : null}
                    <NumField label="Rate (%)" value={d.apr} step={0.01} placeholder="Add" onSave={saveDebt(d.id, 'apr')} />
                    <NumField label="Monthly payment" value={d.min_payment} step={1} placeholder="Add" onSave={saveDebt(d.id, 'min_payment')} hint={d.type === 'mortgage' ? 'Principal and interest only, without escrow' : undefined} />
                    <NumField label="Extra you add every month" value={d.extra_monthly || ''} allowBlank step={5} placeholder="None" onSave={saveDebt(d.id, 'extra_monthly')} hint={d.type === 'mortgage' ? 'Extra principal on top of the payment' : 'On top of the payment, come what may'} />
                    <div className="payoff">
                      <span>Estimated payoff</span>
                      {d.status === 'paid' && <b className="good">Paid off</b>}
                      {d.status === 'missing' && <b className="sub">Add the rate and payment</b>}
                      {d.status === 'full' && <><b className="good">Cleared every month</b><small>What it shows is this month's spending, so it has no payoff date and no place in the payoff order.</small></>}
                      {d.balance > 0 && <button type="button" className="link show-graph" onClick={() => setGraph(d.id)}>Show graph</button>}
                      {d.status === 'ok' && (
                        <>
                          <b>{d.planMonths ? `${monthsFromNow(d.planMonths)} · ${duration(d.planMonths)}` : 'Payment too low to finish'}</b>
                          {d.planMonths && d.minMonths && d.planMonths < (d.standing?.months ?? d.minMonths) && (
                            <small>That is with the payoff plan: when its turn comes, any extra money and what you were paying on the debts cleared before it go here too. If that money goes elsewhere, use the dates below.</small>
                          )}
                          <small>{d.minMonths ? `${d.type === 'mortgage' ? 'Regular payment only' : 'Minimums only'}: ${monthsFromNow(d.minMonths)}` : "Minimums only: never, the payment doesn't cover the interest"}</small>
                          {d.standing && d.standing.months != null && (
                            <small className="good">Your extra {money(d.standing.extra)} a month by itself: paid off {monthsFromNow(d.standing.months)}{d.standing.sooner ? `, ${duration(d.standing.sooner)} sooner` : ''}{d.standing.interestSaved ? `, saving about ${money(d.standing.interestSaved)} in interest` : ''}.</small>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {d.paid && d.balance > 0 && (d.paid.count > 0 || d.type === 'credit') && <PaidSoFar d={d} />}
                  {d.type === 'credit' && d.status !== 'paid' && (
                    <label className="hint-every paid-full"><input type="checkbox" checked={!!d.paid_full} onChange={(e) => saveDebt(d.id, 'paid_full')(e.target.checked as any)} /> I pay this card in full every month</label>
                  )}
                  {d.student && <Forgiveness d={d} save={saveDebt} />}
                </div>
              ))}
            </div>
          );
        })}
        {p.debts.length === 0 && <p className="sub">No debts yet. Add one to see a payoff plan.</p>}
      </section>

      {adding && <AddDebt onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
      <p className="fine">Payoff dates are estimates. They assume fixed rates, no new charges, and the same payment every month.</p>
    </div>
  );
}
