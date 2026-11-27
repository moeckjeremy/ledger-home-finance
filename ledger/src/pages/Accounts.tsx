import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useState } from 'react';
import { api, cents, compact, dayShort, money, monthShort, useData, useOwners } from '../lib';
import { GoalsCard } from './Goals';
import { AllowanceCard } from './Allowance';
import { InvestmentsCard } from './Investments';
import { StatementCheck } from './StatementCheck';
import { Logo, MoneyInput, More, Skeleton, reducedMotion } from '../ui';

const GROUPS = [
  { title: 'Cash', types: ['checking', 'savings'] },
  { title: 'Investments', types: ['investment'] },
  { title: 'Health savings', types: ['hsa'] },
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
    <div className="row" data-go={[canLeaveOut ? 'account-row' : '', byHand ? 'by-hand' : ''].filter(Boolean).join(' ') || undefined}>
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
            {byHand && <> · <button className="link" data-go="set-balance" onClick={() => { setBal(Math.abs(a.balance).toFixed(2)); setErr(''); setSetting(!setting); }}>Set balance</button> · <button className="link" onClick={remove}>Remove</button></>}
            {checkable && <> · <button className="link" onClick={() => setChecking(!checking)}>Check a statement</button></>}
            {canLeaveOut && <> · <button className="link" data-go="off-budget" title={a.off_budget ? 'Count its spending in your budgets and totals again' : "Keep showing its balance, but don't count its spending in your budgets and totals"} onClick={() => setOut(!a.off_budget)}>{a.off_budget ? 'Count in the budget' : 'Leave out of the budget'}</button></>}
          </span></small>
          {a.off_budget ? <small className="sub off-budget-note">Left out of the budget: its spending isn't counted, its balance still is.</small> : null}
          {checkable && a.checked && !checking && <small className={a.checked.gap === 0 ? 'good' : 'sub'}>{a.checked.gap === 0 ? `✓ Matches the statement to ${dayShort(a.checked.end)}` : `The statement to ${dayShort(a.checked.end)} was ${cents(Math.abs(a.checked.gap))} out when last checked`}</small>}
          {byHand && setting && (
            <form className="rename set-balance" onSubmit={saveBalance}>
              <label>{owed ? 'Owed on it today' : "What's in it today"}<MoneyInput value={bal} placeholder="0.00" onChange={setBal} /></label>
              <button type="submit" className="primary">Save</button>
              <button type="button" onClick={() => setSetting(false)}>Cancel</button>
              {err && <small className="error">{err}</small>}
              <small>{a.base_date ? 'From here the balance follows what you enter on this account.' : 'This balance stays as typed until you change it again.'}</small>
            </form>
          )}
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
        byHand && { label: 'Set balance', hint: 'Correct what is in it today', run: () => { setBal(Math.abs(a.balance).toFixed(2)); setErr(''); setSetting(true); } },
        byHand && { label: 'Remove', danger: true, run: remove },
      ]} />}
    </div>
    {checking && <StatementCheck a={a} onClose={() => { setChecking(false); onChanged(); }} />}
    </>
  );
}

const KINDS = [['checking', 'Checking'], ['savings', 'Savings'], ['credit', 'Credit card'], ['investment', 'Investment or retirement'], ['hsa', 'Health savings']];

/** Adds an account you keep yourself, for one the bank connection can't reach or a household without one. */
function AddAccount({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', type: 'checking', balance: '' });
  const [err, setErr] = useState('');
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api('/api/setup/account', { method: 'POST', body: { ...f, balance: f.balance === '' ? 0 : Number(f.balance) } }); setF({ name: '', type: f.type, balance: '' }); setOpen(false); setErr(''); onChanged(); }
    catch (e: any) { setErr(e.message); }
  };
  if (!open) return <div className="add-account"><button onClick={() => setOpen(true)}>Add an account by hand</button><small>For an account the bank connection can't reach, or if you don't use one. Loans and other debts are added on the Debt page.</small></div>;
  return (
    <form className="add-account open" onSubmit={add} noValidate>
      <b>Add an account by hand</b>
      <div className="edit-fields">
        <label>Name<input type="text" value={f.name} maxLength={80} placeholder="Checking" autoFocus onChange={(e) => { setF({ ...f, name: e.target.value }); setErr(''); }} /></label>
        <label>Kind<select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label>{f.type === 'credit' ? 'Owed on it today' : "What's in it today"}<MoneyInput value={f.balance} placeholder="0.00" onChange={(v) => setF({ ...f, balance: v })} /></label>
      </div>
      <small>Its balance then follows the purchases, deposits and transfers you enter on it. You can correct it at any time with "Set balance".</small>
      {err && <p className="error" role="alert">{err}</p>}
      <div className="add-actions"><button type="submit" className="primary">Add account</button><button type="button" onClick={() => setOpen(false)}>Cancel</button></div>
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
              <b>{o.possessive(w)}</b><small>{g.accounts} account{g.accounts === 1 ? '' : 's'}</small>
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
        <AddAccount onChanged={reload} />
      </section>
    </div>
  );
}
