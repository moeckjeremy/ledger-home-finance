import { GO, jump } from '../go';
import { useState } from 'react';
import { api, cents, dayShort, daysUntil, money, useData } from '../lib';
import { CategoryPicker, Logo, LogoPicker, More, Skeleton, offerUndo } from '../ui';
import { ChangeAhead } from '../ChangeAhead';
import { BillCalendar } from './BillCalendar';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Adds a bill, or with `bill` changes one you added by hand.
// `on` is a day chosen on the calendar (YYYY-MM-DD): the form starts on that day of the month, with that
// date as the next due date should a rhythm of its own be picked, and sits inside the calendar's card.
function AddBill({ cats, onDone, onClose, bill, on }: { cats: any[]; onDone: () => void; onClose: () => void; bill?: any; on?: string }) {
  const [f, setF] = useState(bill
    ? { name: String(bill.name), amount: Number(bill.amount).toFixed(2), day: String(bill.day), how: bill.every_unit ? `${bill.every_unit}:${bill.every_n || 1}` : bill.month ? `y:${bill.month}` : '', anchor: bill.every_unit ? String(bill.next || bill.anchor || '') : '', category_id: String(bill.category_id) }
    : { name: '', amount: '', day: on ? String(Number(on.slice(8))) : '', how: '', anchor: on || '', category_id: String(cats.find((c) => c.fixed)?.id ?? cats[0]?.id ?? '') });
  // Its own rhythm (every so many weeks or months) is counted from a date; monthly and yearly bills go by the day of the month.
  const rhythm = /^(week|month):/.test(f.how);
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: any) => { setF({ ...f, [k]: e.target.value }); setErr(''); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return setErr('Enter a name for the bill.');
    if (!(Number(f.amount) > 0)) return setErr('Enter an amount above 0.');
    if (rhythm && !f.anchor) return setErr('Choose the next date it is due.');
    if (!rhythm && !(Number(f.day) >= 1 && Number(f.day) <= 31)) return setErr('Enter the day of the month it is due, from 1 to 31.');
    try {
      const body = { name: f.name, amount: f.amount, category_id: f.category_id, day: f.day, month: f.how.startsWith('y:') ? f.how.slice(2) : '', every: rhythm ? f.how : '', anchor: f.anchor };
      await api(bill ? `/api/recurrings/${bill.id}` : '/api/recurrings', { method: bill ? 'PATCH' : 'POST', body });
      onDone();
    } catch (e: any) {
      setErr(e.message);
    }
  };
  return (
    <form className={on ? 'bill-cal-add add-form' : 'card'} onSubmit={submit} noValidate>
      <div className="card-head"><h2>{bill ? `Change ${bill.name}` : on ? `Add a bill due on the ${Number(on.slice(8))}${['th', 'st', 'nd', 'rd'][(Number(on.slice(8)) % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][Number(on.slice(8)) % 100] || 'th'}` : 'Add a bill'}</h2></div>
      {on && <p className="sub first">It starts as a bill that comes every month on that day. Change "How often" if it comes less or more often.</p>}
      <div className="add-grid">
        <label>Name<input type="text" value={f.name} onChange={set('name')} placeholder="Water bill" autoFocus /></label>
        <label>Amount<input type="number" min="0" step="0.01" inputMode="decimal" value={f.amount} onChange={set('amount')} placeholder="45.00" /></label>
        <label>How often
          <select value={f.how} onChange={set('how')}>
            <option value="">Every month</option>
            <optgroup label="More or less often">
              <option value="week:1">Every week</option>
              <option value="week:2">Every 2 weeks</option>
              <option value="week:4">Every 4 weeks</option>
              <option value="week:8">Every 8 weeks</option>
              <option value="month:2">Every 2 months</option>
              <option value="month:3">Every 3 months</option>
              <option value="month:6">Every 6 months</option>
            </optgroup>
            <optgroup label="Once a year">
              {MONTHS.map((m, i) => <option key={m} value={`y:${i + 1}`}>Once a year, in {m}</option>)}
            </optgroup>
          </select>
        </label>
        {rhythm
          ? <label>Next due date<input type="date" value={f.anchor} onChange={set('anchor')} /></label>
          : <label>Day of the month<input type="number" min="1" max="31" step="1" inputMode="numeric" value={f.day} onChange={set('day')} placeholder="15" /></label>}
        <label>Category
          <CategoryPicker cats={cats} value={f.category_id} onChange={(id) => setF({ ...f, category_id: id })} />
        </label>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      <div className="add-actions">
        <button type="submit" className="primary">{bill ? 'Save' : 'Add bill'}</button>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

export default function Recurring() {
  const { data: s, error, reload } = useData('/api/summary');
  const { data: cats } = useData<any[]>('/api/categories');
  const { data: ignored, reload: reloadIgnored } = useData<any[]>('/api/recurrings/ignored');
  const [adding, setAdding] = useState(false);
  // The hand-added bill being changed, if any.
  const [editing, setEditing] = useState<any>(null);
  const [renaming, setRenaming] = useState<string | number | null>(null);
  const [newName, setNewName] = useState('');
  // The bills as a list, or laid out on a month's calendar. Remembered on this device.
  const [view, setView] = useState<'list' | 'calendar'>(() => { try { return localStorage.getItem('ledger-bills-view') === 'calendar' ? 'calendar' : 'list'; } catch { return 'list'; } });
  const choose = (v: 'list' | 'calendar') => { setView(v); try { localStorage.setItem('ledger-bills-view', v); } catch { /* private window */ } };
  // The bill whose pay link is being typed (the address of the company's own payment page).
  const [linking, setLinking] = useState<string | number | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  // The bill whose "amount is changing" form is open (src/ChangeAhead.tsx).
  const [changing, setChanging] = useState<string | number | null>(null);
  const [linkErr, setLinkErr] = useState('');
  const [renameErr, setRenameErr] = useState('');
  if (error) return <p className="error">{error}</p>;
  if (!s) return <Skeleton tiles={0} cards={2} rows={6} />;

  const refresh = () => { reload(); reloadIgnored(); };
  // A yearly bill counts as a twelfth of its price each month.
  const monthly = s.upcoming.reduce((a: number, r: any) => a + (r.monthly ?? (r.month ? r.amount / 12 : r.amount)), 0);
  const yearlyOnes = s.upcoming.filter((r: any) => r.month);
  const yearlyTotal = yearlyOnes.reduce((a: number, r: any) => a + r.amount, 0);
  const yearlyNext = yearlyOnes[0];
  // Bills that cost more than last time (a subscription's price rise is the usual reason).
  const risen = s.upcoming.filter((r: any) => r.previous && r.amount > r.previous);
  const fullMonths = s.cashflow.slice(0, -1);
  const typicalIncome = fullMonths.reduce((a: number, m: any) => a + m.income, 0) / (fullMonths.length || 1);
  const week = s.upcoming.filter((r: any) => daysUntil(r.next) <= 7);
  // A new name is used everywhere this bill's payments appear; the bank's wording stays as the note.
  const rename = async (r: any) => {
    try {
      await api('/api/bills/rename', { method: 'POST', body: { current: r.name, name: newName, amount: r.amount, id: r.source === 'manual' ? r.id : undefined } });
      setRenaming(null); refresh();
    } catch (e: any) { setRenameErr(e.message); }
  };
  const saveLink = async (r: any, url: string) => {
    try { await api('/api/bills/link', { method: 'PUT', body: { name: r.name, url } }); setLinking(null); refresh(); }
    catch (e: any) { setLinkErr(e.message); }
  };
  const openLink = (r: any) => { setLinking(r.id); setLinkUrl(r.pay_url || ''); setLinkErr(''); };
  const site = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'its website'; } };
  const hide = async (r: any) => { await api('/api/recurrings/ignore', { method: 'POST', body: { merchant: r.merchant, amount: r.amount } }); refresh(); };
  const remove = async (r: any) => { const x = await api(`/api/recurrings/${r.id}`, { method: 'DELETE' }); refresh(); offerUndo(`${r.name} removed.`, x.undo); };
  const restore = async (id: number) => { await api(`/api/recurrings/ignore/${id}`, { method: 'DELETE' }); refresh(); };

  return (
    <div className="stack">
      <section className="tiles">
        <div className="tile"><div className="label">Monthly total</div><div className="value">{money(monthly)}</div><div className="sub">{s.upcoming.length} recurring charges{yearlyOnes.length ? `, ${yearlyOnes.length} yearly spread across the year` : ''}</div></div>
        <div className="tile"><div className="label">Yearly total</div><div className="value">{money(monthly * 12)}</div><div className="sub">at current prices</div></div>
        <div className="tile"><div className="label">Due in 7 days</div><div className="value">{money(week.reduce((a: number, r: any) => a + r.amount, 0))}</div><div className="sub">{week.length} charge{week.length === 1 ? '' : 's'}</div></div>
        <div className="tile"><div className="label">Share of income</div><div className="value">{typicalIncome ? Math.round((monthly / typicalIncome) * 100) : 0}%</div><div className="sub">of typical monthly pay</div></div>
      </section>

      {/* Two things worth a glance: bills whose price went up, and what the once-a-year bills come to each month. */}
      {(risen.length > 0 || yearlyOnes.length > 0) && (
        <section className="card">
          <div className="card-head"><h2>Worth knowing</h2></div>
          {risen.length > 0 && (
            <>
              <div className="group-head"><span>Prices that went up</span><span className="num">{money(risen.reduce((a: number, r: any) => a + (r.amount - r.previous), 0))} more a month</span></div>
              {risen.map((r: any) => <div key={`up-${r.id}`} className="row"><Logo edit name={r.name} fallback={r.icon} /><span className="grow wrap">{r.name}<small>was {cents(r.previous)}, now {cents(r.amount)}</small></span><span className="num bad">+{cents(r.amount - r.previous)}</span></div>)}
            </>
          )}
          {yearlyOnes.length > 0 && (
            <>
              <div className="group-head"><span>Once-a-year bills</span><span className="num">{money(yearlyTotal)} a year</span></div>
              <p className="sub">Putting <b>{money(yearlyTotal / 12)} a month</b> aside covers all {yearlyOnes.length} of them without a scramble when each comes round. The next is {yearlyNext.name}, {cents(yearlyNext.amount)}, due {dayShort(yearlyNext.next)}. A savings goal on the <a href="#accounts" onClick={jump(GO.goals)}>Accounts</a> page is a good place to keep it.</p>
            </>
          )}
        </section>
      )}

      <div className="seg demo-pick bills-view" role="group" aria-label="How to show your bills" data-go="bills-view">
        <button type="button" className={view === 'list' ? 'on' : ''} onClick={() => choose('list')}>List</button>
        <button type="button" className={view === 'calendar' ? 'on' : ''} onClick={() => choose('calendar')}>Calendar</button>
      </div>
      {view === 'calendar' && (
        <section className="card">
          <BillCalendar addForm={cats ? (date, close, done) => <AddBill key={date} on={date} cats={cats.filter((c) => c.kind === 'expense')} onClose={close} onDone={() => { done(); refresh(); }} /> : undefined} />
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Next charges</h2>
          {!adding && <button data-tour="add-bill" onClick={() => setAdding(true)}>Add a bill</button>}
        </div>
        {s.upcoming.length === 0 && (
          <p className="sub first">No recurring bills found yet. Ledger looks for charges from the same merchant about a month apart, so it needs at least two months of history. You can also add one yourself.</p>
        )}
        {s.upcoming.map((r: any) => {
          const n = daysUntil(r.next);
          return (
            <div key={r.id} className="row">
              <Logo edit name={r.name} fallback={r.icon} />
              <span className="grow wrap">
                {renaming === r.id ? (
                  <form className="bill-rename" onSubmit={(e) => { e.preventDefault(); rename(r); }}>
                    <input value={newName} autoFocus maxLength={60} aria-label={`New name for ${r.name}`} placeholder="Leave blank for the bank's name"
                      onChange={(e) => setNewName(e.target.value)} onFocus={(e) => e.target.select()} onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)} />
                    <button type="submit" className="primary">Save</button>
                    <button type="button" onClick={() => setRenaming(null)}>Cancel</button>
                  </form>
                ) : r.name}
                {renaming === r.id && renameErr && <small className="bad" role="alert">{renameErr}</small>}
                <small>
                  {renaming !== r.id && <span className="wide-only"><button className="link" onClick={() => { setRenaming(r.id); setNewName(r.name); setRenameErr(''); }} aria-label={`Rename ${r.name}`}>Rename</button> · <LogoPicker name={r.name} /> · </span>}
                  {r.category} · {r.rhythm ? r.rhythm : r.month ? `once a year, ${MONTHS[r.month - 1]} ${r.day}` : `around day ${r.day}`}
                  {r.seasonal
                    ? <> · {r.known ? `exact amount, from the bill dated ${dayShort(r.billed)}` : 'estimated from past bills for this time of year'}<span className="wide-only"> · <button className="link" onClick={() => hide(r)}>Not a bill</button></span></>
                    : r.source === 'found'
                    ? <> · found in your transactions ({r.count} payments{r.variable ? ', amount varies' : ''})<span className="wide-only"> · <button className="link" onClick={() => hide(r)}>Not a bill</button></span></>
                    : <> · added by you<span className="wide-only"> · <button className="link" onClick={() => { setAdding(false); setEditing(r); scrollTo({ top: 0, behavior: 'smooth' }); }}>Edit</button> · <button className="link" onClick={() => remove(r)}>Remove</button></span></>}
                </small>
                {r.forecast?.length > 0 && (
                  <small>Then {r.forecast.map((f: any, i: number) => `${i ? ', ' : ''}${f.known ? '' : 'about '}${money(f.amount)} on ${dayShort(f.date)}`).join('')}</small>
                )}
                {linking === r.id ? (
                  <form className="bill-rename bill-link" onSubmit={(e) => { e.preventDefault(); saveLink(r, linkUrl); }}>
                    <input type="url" inputMode="url" autoFocus value={linkUrl} placeholder="https://… the page where you pay it" aria-label={`Where ${r.name} is paid`}
                      onChange={(e) => setLinkUrl(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setLinking(null)} />
                    <button type="submit" className="primary">Save</button>
                    {r.pay_url && <button type="button" onClick={() => saveLink(r, '')}>Remove</button>}
                    <button type="button" onClick={() => setLinking(null)}>Cancel</button>
                  </form>
                ) : (
                  <small className="wide-only bill-pay" data-go="bill-pay">
                    {r.pay_url ? <><a className="link" href={r.pay_url} target="_blank" rel="noopener noreferrer">Pay it at {site(r.pay_url)} ↗</a> · <button className="link" onClick={() => openLink(r)}>Change the link</button></>
                      : <button className="link" onClick={() => openLink(r)}>Add a pay link</button>}
                  </small>
                )}
                {linking === r.id && linkErr && <small className="bad" role="alert">{linkErr}</small>}
                {linking === r.id && <small>Ledger doesn't pay anything. This only opens the company's own page in a new tab.</small>}
                {changing !== r.id && !r.seasonal && <small className="wide-only"><button className="link" data-go="bill-change" onClick={() => setChanging(r.id)}>Its amount is changing</button></small>}
                <ChangeAhead kind="bill" name={r.name} changes={r.changes} open={changing === r.id} onClose={() => setChanging(null)} onChanged={refresh} />
                {r.previous && <small className={r.amount > r.previous ? 'bad' : 'good'}>{r.amount > r.previous ? 'Up' : 'Down'} from {cents(r.previous)} last time</small>}
              </span>
              <span style={{ textAlign: 'right' }}>
                <span className="num">{r.variable ? '~' : ''}{cents(r.amount)}</span>
                <small>{n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : dayShort(r.next)}</small>
              </span>
              {/* On a phone the row's links are behind this one button. */}
              <More name={r.name} sub={`${cents(r.amount)} · ${r.category}`} items={() => [
                r.pay_url && { label: 'Pay it', hint: `Opens ${site(r.pay_url)} in a new tab`, run: () => { window.open(r.pay_url, '_blank', 'noopener,noreferrer'); } },
                { label: r.pay_url ? 'Change the pay link' : 'Add a pay link', hint: 'The page where you pay this bill', run: () => openLink(r) },
                !r.seasonal && { label: 'Its amount is changing', hint: 'A new amount that starts on a day ahead', run: () => setChanging(r.id) },
                { label: 'Rename', hint: "Used everywhere this bill's payments appear", run: () => { setRenaming(r.id); setNewName(r.name); setRenameErr(''); } },
                { label: 'Change the icon', run: () => dispatchEvent(new CustomEvent('ledger-logo-edit', { detail: { key: r.name, label: String(r.name).trim() } })) },
                r.source === 'manual' && !r.seasonal && { label: 'Edit', hint: 'Amount, day or category', run: () => { setAdding(false); setEditing(r); scrollTo({ top: 0 }); } },
                r.source === 'manual' && !r.seasonal ? { label: 'Remove', danger: true, run: () => remove(r) } : { label: 'Not a bill', hint: 'Hides it from this list', run: () => hide(r) },
              ]} />
            </div>
          );
        })}
      </section>

      {adding && cats && <AddBill cats={cats.filter((c) => c.kind === 'expense')} onClose={() => setAdding(false)} onDone={() => { setAdding(false); refresh(); }} />}
      {editing && cats && <AddBill key={editing.id} bill={editing} cats={cats.filter((c) => c.kind === 'expense')} onClose={() => setEditing(null)} onDone={() => { setEditing(null); refresh(); }} />}

      {ignored && ignored.length > 0 && (
        <section className="card">
          <div className="card-head"><h2>Hidden</h2></div>
          <p className="sub first">Charges you marked as not a bill.</p>
          {ignored.map((i) => (
            <div key={i.id} className="row">
              <span className="grow">{i.merchant}</span>
              <span className="num sub">{cents(i.amount)}</span>
              <button className="link" onClick={() => restore(i.id)}>Show again</button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
