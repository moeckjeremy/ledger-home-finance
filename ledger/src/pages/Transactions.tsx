import { CfoOwl } from './Cfo';
import { Hint } from '../GoLinks';
import { GO, jump } from '../go';
import { at } from '../base';
import { EmojiPick } from '../icons';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, cents, dayLong, dayShort, useData, useGig, useOwners, handoff } from '../lib';
import { CategoryPicker, Logo, LogoPicker, Roll, Sheet, SwipeRow, TxAmount, isPhone, offerUndo, pickReceipt, shrinkPicture } from '../ui';
import type { SheetItem } from '../ui';

// Payment apps and checks cover many unrelated things (a haircut one week,
// groceries the next), so a category chosen for one should never spread to the rest.
const MIXED_PAYEE = /venmo|cash ?app|paypal|square|zelle|apple pay|check #|check first|teller|withdrawal|deposit|transfer/i;

type ToastAction = { label: string; run: () => void };
type Toast = { text: string; actions?: ToastAction[] } | null;

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const daysAgo = (date: string) => Math.floor((Date.parse(todayIso()) - Date.parse(date)) / 86400000);
// Matches WAITING_DAYS in server/waiting.js.
const WAITING_DAYS = 10;
const LAST_ACCOUNT = 'ledger-add-account';

function AddForm({ cats, accounts, onAdded, onClose, onNewCategory, start = 'out' }: { cats: any[]; accounts: any[]; onAdded: (name: string, waiting: boolean) => void; onClose: () => void; onNewCategory?: () => void; start?: 'in' | 'out' }) {
  // Which way the money went. Until 2026-11-18 the category decided (an income category meant money
  // in), so a refund or a reimbursement filed under a spending category could only be entered as a
  // purchase. Now it is asked outright, and "Add a deposit" in the + menu starts on money in.
  const [dir, setDir] = useState<'in' | 'out'>(start);
  const firstOf = (kind: string) => String(cats.find((c) => c.kind === kind)?.id ?? cats[0]?.id ?? '');
  // Money in starts as a plain deposit, which counts as neither income nor spending; pay is chosen on purpose.
  const firstIn = () => String(cats.find((c) => c.key === 'Deposit')?.id ?? firstOf('income'));
  // A category made on the spot ("New category…" in the menu): its name and icon, created when the transaction is added.
  const [newCat, setNewCat] = useState({ name: '', icon: '' });
  // Start on the account used last time, so a debit card purchase is two fields and a tap.
  let last = '';
  try { last = localStorage.getItem(LAST_ACCOUNT) ?? ''; } catch { /* private window */ }
  const cash = accounts.find((a) => String(a.id) === last) ?? accounts.find((a) => a.type === 'cash') ?? accounts[0];
  const [dup, setDup] = useState(false);
  const [f, setF] = useState({ date: todayIso(), merchant: '', amount: '', category_id: start === 'in' ? firstIn() : firstOf('expense'), account_id: String(cash?.id ?? ''), notes: '' });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: any) => { setF({ ...f, [k]: e.target.value }); setErr(''); setDup(false); };
  // Switching direction picks that direction's usual category; any category can then be chosen.
  const turn = (to: 'in' | 'out') => { setDir(to); setErr(''); setDup(false); setF((x) => ({ ...x, category_id: x.category_id === 'new' ? x.category_id : to === 'in' ? firstIn() : firstOf('expense') })); };
  // Choosing an income category means money in. (Money in under a spending category is a refund or reimbursement.)
  const pickCategory = (e: any) => { const c = cats.find((x) => String(x.id) === e.target.value); if (c?.kind === 'income') setDir('in'); set('category_id')(e); };
  const chosen = cats.find((c) => String(c.id) === f.category_id);
  const paidWith = accounts.find((a) => String(a.id) === f.account_id);
  const willWait = paidWith && paidWith.type !== 'cash' && !paidWith.manual;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.merchant.trim()) return setErr(dir === 'in' ? 'Enter where the money came from.' : 'Enter where the money went.');
    if (!(Number(f.amount) > 0)) return setErr('Enter an amount above 0.');
    if (!f.date) return setErr('Choose a date.');
    if (f.category_id === 'new' && !newCat.name.trim()) return setErr('Give the new category a name.');
    try {
      let categoryId = Number(f.category_id);
      if (f.category_id === 'new') {
        // Made first; if the transaction then can't be added, the category is kept and already chosen for the next try.
        const c = await api('/api/categories', { method: 'POST', body: newCat });
        categoryId = c.id;
        setF({ ...f, category_id: String(c.id) });
        onNewCategory?.();
      }
      const r = await api('/api/transactions', { method: 'POST', body: { ...f, amount: Number(f.amount), category_id: categoryId, account_id: Number(f.account_id), direction: dir, force: dup } });
      try { localStorage.setItem(LAST_ACCOUNT, f.account_id); } catch { /* private window */ }
      onAdded(f.merchant.trim(), r.waiting);
    } catch (e: any) {
      setErr(e.message);
      setDup(/already lists/.test(e.message));
    }
  };

  return (
    <form className="card add-form" onSubmit={submit} noValidate>
      <div className="card-head"><h2>Add a transaction</h2></div>
      <div className="seg dir-pick" role="group" aria-label="Which way the money went">
        <button type="button" className={dir === 'out' ? 'on' : ''} aria-pressed={dir === 'out'} onClick={() => turn('out')}>Money out</button>
        <button type="button" className={dir === 'in' ? 'on' : ''} aria-pressed={dir === 'in'} onClick={() => turn('in')}>Money in</button>
      </div>
      <div className="add-grid">
        <label>{dir === 'in' ? 'From' : 'Description'}<input type="text" value={f.merchant} onChange={set('merchant')} placeholder={dir === 'in' ? 'Paycheck, refund, reimbursement' : 'Farmers market'} autoFocus /></label>
        <label>Amount<input type="number" min="0" step="0.01" inputMode="decimal" value={f.amount} onChange={set('amount')} placeholder="24.50" /></label>
        <label>Date<input type="date" value={f.date} max={todayIso()} onChange={set('date')} /></label>
        <label>Category
          <select value={f.category_id} onChange={pickCategory}>
            {cats.filter((c) => !c.hidden || String(c.id) === String(f.category_id)).map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}{c.kind === 'aside' ? ' (not counted)' : ''}</option>)}
            <option value="new">＋ New category…</option>
          </select>
        </label>
        {f.category_id === 'new' && (
          <div className="new-cat-inline">
            <label>New category's name<input type="text" value={newCat.name} maxLength={40} placeholder="Haircuts" autoFocus onChange={(e) => { setNewCat({ ...newCat, name: e.target.value }); setErr(''); }} /></label>
            <EmojiPick value={newCat.icon} onChange={(v) => setNewCat({ ...newCat, icon: v })} />
          </div>
        )}
        <label>{dir === 'in' ? 'Into' : 'Paid with'}
          <select value={f.account_id} onChange={set('account_id')}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label>Note<input type="text" value={f.notes} onChange={set('notes')} placeholder="Split with Sam" /></label>
      </div>
      {dir === 'in' && chosen?.kind === 'expense' && <p className="sub">Filed under {chosen.name}, this counts against that spending, the way a refund or a reimbursement should. Pay goes under Income.</p>}
      {dir === 'in' && chosen?.key === 'Deposit' && <p className="sub">A plain deposit: it doesn't count as income or as spending. Use it for a gift, card rewards, money you moved, or anything you're unsure of. Choose Income for pay, or a spending category for a refund or reimbursement.</p>}
      {willWait && dir === 'out' && <p className="sub">The bank will list this purchase itself in a day or two. Until then it shows as waiting for the bank, and the bank's entry replaces it, keeping your category and note. It doesn't change the account balance.</p>}
      {willWait && dir === 'in' && <p className="sub">The bank will list this deposit itself in a day or two. Until then it shows as waiting for the bank and counts toward your checking estimate; the bank's entry then replaces it, keeping your category and note. If the bank holds part of a deposit, the estimate runs ahead until the hold clears.</p>}
      {err && <p className="error" role="alert">{err}</p>}
      <div className="add-actions">
        <button type="submit" className="primary">{dup ? 'Add anyway' : dir === 'in' ? 'Add deposit' : 'Add transaction'}</button>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

/**
 * Deposits that were filed as income before Ledger stopped assuming every deposit is pay, and that
 * don't match a payday or a side gig. The household says which really are income; the rest move to
 * "Other deposits". Nothing moves until they choose. Shown only while there are some.
 */
function DepositReview({ onChanged }: { onChanged: () => void }) {
  const { data, reload } = useData<{ rows: any[]; count: number; total: number }>('/api/deposits/review');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!data?.count) return null;
  const answer = async (ids: number[], income: boolean) => {
    setBusy(true);
    try { await api('/api/deposits/review', { method: 'POST', body: { ids, income } }); reload(); onChanged(); } finally { setBusy(false); }
  };
  const all = data.rows.map((r) => r.id);
  return (
    <section className="card deposit-review">
      <div className="row">
        <span className="grow wrap"><b>{data.count} deposit{data.count === 1 ? ' is' : 's are'} counted as income but {data.count === 1 ? "doesn't" : "don't"} match a paycheck</b>
          <small>{cents(data.total)} in all. Ledger used to treat every deposit as income. Say which of these really are; the rest become "Other deposits", which count as neither income nor spending.</small></span>
        <button onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Review them'}</button>
      </div>
      {open && <>
        {data.rows.map((r) => (
          <div key={r.id} className="row">
            <span className="grow wrap">{r.merchant}<small>{dayShort(r.date)} · {r.account}{r.notes ? ` · ${r.notes}` : ''}</small></span>
            <span className="num good">+{cents(r.amount)}</span>
            <span className="review-answers">
              <button disabled={busy} onClick={() => answer([r.id], true)}>Income</button>
              <button disabled={busy} onClick={() => answer([r.id], false)}>Not income</button>
            </span>
          </div>
        ))}
        <div className="add-actions">
          <button disabled={busy} onClick={() => { if (confirm(`Move all ${all.length} to "Other deposits"? They will stop counting as income.`)) answer(all, false); }}>None of these are income</button>
          <button disabled={busy} onClick={() => answer(all, true)}>All of these are income</button>
        </div>
      </>}
    </section>
  );
}

/**
 * Purchases left in "Other" (server/catsuggest.js): Claude is shown the merchant names and the household's
 * categories and suggests where each belongs. Nothing moves until File is pressed.
 */
function OtherReview({ cats, onChanged }: { cats: any[]; onChanged: () => void }) {
  const { data, reload } = useData<{ merchants: number; purchases: number; total: number; canAsk: boolean; why: string }>('/api/categories/suggest');
  const [rows, setRows] = useState<any[] | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [remember, setRemember] = useState(true);
  const [hidden, setHidden] = useState(() => { try { return Number(localStorage.getItem('ledger-other-hide') || 0) > Date.now(); } catch { return false; } });
  if (!data || data.purchases < 5 || (hidden && !rows)) return null;
  const ask = async () => {
    setErr(''); setNote(''); setBusy('Asking Claude…');
    try {
      const r = await api('/api/categories/suggest', { method: 'POST' });
      setRows(r.suggestions.map((s: any) => ({ ...s, on: true })));
      if (!r.suggestions.length) setNote("Claude didn't recognise any of them well enough to suggest a category.");
      else if (r.unsure) setNote(`${r.unsure} it wasn't sure about were left in Other.`);
    } catch (e: any) { setErr(e.message); }
    setBusy('');
  };
  const set = (m: string, change: any) => setRows((rows || []).map((r) => (r.merchant === m ? { ...r, ...change } : r)));
  const picked = (rows || []).filter((r) => r.on);
  const file = async () => {
    setErr(''); setBusy('Filing…');
    try {
      const r = await api('/api/categories/suggest/apply', { method: 'POST', body: { items: picked.map((p) => ({ merchant: p.merchant, category_id: Number(p.category_id) })), remember } });
      setRows(null); setNote(`${r.moved} purchase${r.moved === 1 ? '' : 's'} filed${r.rules ? `, and Ledger will file those shops the same way from now on` : ''}.`);
      reload(); onChanged(); dispatchEvent(new CustomEvent('ledger-refresh'));
    } catch (e: any) { setErr(e.message); }
    setBusy('');
  };
  const expense = cats.filter((c) => c.kind === 'expense' || c.kind === 'aside');
  return (
    <section className="card deposit-review other-review">
      <div className="row">
        <span className="grow wrap"><b>{data.purchases} purchases from {data.merchants} shops are filed under "Other"</b>
          <small>{cents(data.total)} in all. Claude can suggest a category for each from the shop's name (only the names are sent). You check them before anything moves.</small></span>
        {!rows && data.canAsk && <button disabled={!!busy} onClick={ask}>{busy || 'Suggest categories'}</button>}
        {!rows && <button className="link" onClick={() => { try { localStorage.setItem('ledger-other-hide', String(Date.now() + 30 * 86400000)); } catch { /* private window */ } setHidden(true); }}>Hide for a month</button>}
      </div>
      {!data.canAsk && <p className="sub"><Hint text={data.why} /></p>}
      {rows && rows.length > 0 && <>
        {rows.map((r) => (
          <div key={r.merchant} className="row">
            <label className="grow wrap other-pick"><input type="checkbox" checked={r.on} onChange={(e) => set(r.merchant, { on: e.target.checked })} /> <span>{r.merchant}<small>{r.count} purchase{r.count === 1 ? '' : 's'} · {cents(r.total)} · last {dayShort(r.last)}</small></span></label>
            <span className="review-answers"><CategoryPicker cats={expense} value={r.category_id} onChange={(id) => set(r.merchant, { category_id: id })} label={`Category for ${r.merchant}`} allowNew={false} /></span>
          </div>
        ))}
        <label className="hint-every"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> File these shops the same way from now on</label>
        <div className="add-actions">
          <button className="primary" disabled={!!busy || !picked.length} onClick={file}>{busy || `File ${picked.length} shop${picked.length === 1 ? '' : 's'}`}</button>
          <button disabled={!!busy} onClick={() => setRows(null)}>Cancel</button>
        </div>
      </>}
      {note && <p className="sub" role="status">{note}</p>}
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  );
}

/** Correcting an entry you typed in: its name, amount and date. The bank's own entries can't be changed. */
function EditForm({ t, onDone, onClose }: { t: any; onDone: () => void; onClose: () => void }) {
  const [f, setF] = useState({ merchant: t.merchant, amount: Math.abs(t.amount).toFixed(2), date: t.date });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: any) => { setF({ ...f, [k]: e.target.value }); setErr(''); };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api(`/api/transactions/${t.id}`, { method: 'PATCH', body: { merchant: f.merchant, amount: Number(f.amount), date: f.date } }); onDone(); } catch (e: any) { setErr(e.message); }
  };
  return (
    <form className="split-form edit-form" onSubmit={save} noValidate>
      <b>Change this {t.amount > 0 ? 'deposit' : 'entry'}</b>
      <div className="edit-fields">
        <label>Name<input type="text" value={f.merchant} maxLength={120} onChange={set('merchant')} autoFocus /></label>
        <label>Amount<input type="number" min="0" step="0.01" inputMode="decimal" value={f.amount} onChange={set('amount')} /></label>
        <label>Date<input type="date" value={f.date} max={todayIso()} onChange={set('date')} /></label>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      <div className="add-actions"><button type="submit" className="primary">Save</button><button type="button" onClick={onClose}>Cancel</button></div>
    </form>
  );
}

/**
 * A transfer you've already made in your bank's app, entered here so the
 * balances and forecast catch up before the bank reports it.
 */
function TransferForm({ accounts, onAdded, onClose }: { accounts: any[]; onAdded: (text: string) => void; onClose: () => void }) {
  const own = accounts.filter((a) => ['checking', 'savings'].includes(a.type));
  const cards = accounts.filter((a) => a.type === 'credit');
  const checking = own.find((a) => a.type === 'checking');
  // "Record a payment" on the Debt page lands here with the card already chosen.
  const [f, setF] = useState(() => {
    let card = '';
    try { card = sessionStorage.getItem('ledger-pay-debt') || ''; } catch { /* private window */ }
    if (card && cards.some((a) => String(a.id) === card)) return { from: String(checking?.id ?? own[0]?.id ?? ''), to: card, amount: '', date: todayIso() };
    return { from: String(own.filter((a) => a.type === 'savings').sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0))[0]?.id ?? ''), to: String(checking?.id ?? ''), amount: '', date: todayIso() };
  });
  useEffect(() => { try { sessionStorage.removeItem('ledger-pay-debt'); } catch { /* private window */ } }, []);
  const paying = cards.some((a) => String(a.id) === f.to);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: any) => { setF({ ...f, [k]: e.target.value }); setErr(''); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.from || !f.to) return setErr('Choose both accounts.');
    if (f.from === f.to) return setErr('Choose two different accounts.');
    if (!(Number(f.amount) > 0)) return setErr('Enter an amount above 0.');
    setBusy(true);
    try {
      const r = await api('/api/transfers', { method: 'POST', body: { from: Number(f.from), to: Number(f.to), amount: Number(f.amount), date: f.date } });
      onAdded(`${cents(r.amount)} from ${r.from} to ${r.to} recorded. The bank's entries will replace it when they arrive.`);
    } catch (x: any) { setErr(x.message); setBusy(false); }
  };
  return (
    <form className="card add-form" onSubmit={submit} noValidate>
      <div className="card-head"><h2>{paying ? 'Record a card payment' : 'Record a transfer'}</h2></div>
      <p className="sub first">{paying
        ? "Ledger can't move money. Make the payment with your bank or card, then enter it here: it comes out of your checking forecast straight away and counts toward what you've paid on the card this month. Any amount, as often as you like."
        : "Ledger can't move money. Make the transfer in your bank's app, then enter it here so the balance and forecast are right straight away."}</p>
      <div className="add-grid">
        <label>From
          <select value={f.from} onChange={set('from')}>
            {own.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label>To
          <select value={f.to} onChange={set('to')}>
            {own.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            {cards.length > 0 && <optgroup label="Pay a card">{cards.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>}
          </select>
        </label>
        <label>Amount<input type="number" min="0" step="0.01" inputMode="decimal" value={f.amount} onChange={set('amount')} placeholder="250.00" autoFocus /></label>
        <label>Date<input type="date" value={f.date} max={todayIso()} onChange={set('date')} /></label>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      <div className="add-actions">
        <button type="submit" className="primary" disabled={busy}>{paying ? 'Record payment' : 'Record transfer'}</button>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

const shrink = shrinkPicture;

/**
 * Several purchases at once: Claude reads a screenshot of the bank's list and
 * the rows come back here to check before anything is added.
 */
/**
 * While a picture is being read: the CFO's owl looking over a receipt (2026-11-27, the owner's idea on the
 * way home from a shop). The owl's own reading motion is the only thing that moves; the receipt is a still
 * drawing, in keeping with going easy on a phone.
 */
function OwlReading() {
  return (
    <div className="owl-reading" role="status">
      <span className="owl-reading-art">
        <CfoOwl size={84} thinking />
        <svg className="owl-receipt" viewBox="0 0 40 56" width="40" height="56" aria-hidden="true">
          <path d="M3 2h34v50l-5-3-6 3-6-3-6 3-6-3-5 3z" fill="#fff" stroke="#c9ccd6" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M9 12h22M9 19h16M9 26h22M9 33h12M9 41h22" stroke="#9aa0ad" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
      <span>Your CFO is reading your receipt<span className="cfo-dots"><i /><i /><i /></span></span>
    </div>
  );
}

/**
 * What was just read, said in a sentence before the rows that can be corrected: where, how much, what for
 * and which account. Nothing is added until the button below is pressed, and the sentence says so.
 */
function ReadSummary({ rows, cats, account }: { rows: any[]; cats: any[]; account: string }) {
  const name = (id: any) => cats.find((c) => String(c.id) === String(id))?.name || 'Other';
  const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  const one = rows.length === 1 ? rows[0] : null;
  let said: React.ReactNode;
  if (one) {
    const lines: any[] = one.lines || [];
    const kinds = [...new Set(lines.map((x) => String(x.category_id)))];
    const what = lines.length === 1 ? <>for <b>{lines[0].name}</b> ({name(lines[0].category_id)})</>
      : kinds.length > 1 ? <>for {lines.length} items across <b>{list(kinds.map(name))}</b></>
      : lines.length > 1 ? <>for {lines.length} items of <b>{name(kinds[0])}</b></>
      : <>under <b>{name(one.category_id)}</b></>;
    const money = cents(Math.abs(Number(one.amount) || 0));
    said = one.direction === 'in'
      ? <>You received <b>{money}</b> from <b>{one.merchant}</b>{account ? <>, into your <b>{account}</b></> : null}.</>
      : <>You made a purchase at <b>{one.merchant}</b> {what} for <b>{money}</b>{one.date ? <> on {dayShort(one.date)}</> : null}{account ? <>, using your <b>{account}</b></> : null}.</>;
  } else {
    const fresh = rows.filter((r) => !r.already).length;
    said = <>I found <b>{rows.length} transactions</b>{account ? <> for your <b>{account}</b></> : null}{fresh < rows.length ? <>; {rows.length - fresh} {rows.length - fresh === 1 ? 'is' : 'are'} already in Ledger and left unticked</> : null}.</>;
  }
  const known = one?.already;
  return (
    <div className="read-summary" data-go="read-summary">
      <CfoOwl size={52} />
      <p><b>{one ? 'Receipt read!' : 'All read!'}</b> {said} {known ? `${known === 'bank' ? 'Your bank has' : 'You have'} already recorded this one, so nothing new will be added.` : 'Nothing is added yet: change anything below that I got wrong, then add it.'}</p>
    </div>
  );
}

function ScanForm({ cats, accounts, onAdded, onClose }: { cats: any[]; accounts: any[]; onAdded: (added: number, failed: number) => void; onClose: () => void }) {
  const banks = accounts.filter((a) => a.type !== 'cash' && a.type !== 'insurance' && !a.manual);
  let last = '';
  try { last = localStorage.getItem(LAST_ACCOUNT) ?? ''; } catch { /* private window */ }
  const [accountId, setAccountId] = useState(String((banks.find((a) => String(a.id) === last) ?? banks.find((a) => a.type === 'checking') ?? banks[0])?.id ?? ''));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  // The picture just read. A receipt's picture is kept with its purchase; a bank screenshot's is not.
  const [picture, setPicture] = useState('');
  const keep = (id: number) => api(`/api/transactions/${id}/receipt`, { method: 'POST', body: { image: picture } }).catch(() => {});
  const { data: ai } = useData<any>('/api/recap/settings');

  const read = async (file: Blob | null | undefined) => {
    if (!file || busy) return;
    setErr(''); setRows(null); setBusy(true);
    try {
      const image = await shrink(file).catch(() => { throw new Error("That file isn't a picture the app can read. Use a PNG or JPEG screenshot."); });
      setPicture(image);
      const r = await api('/api/transactions/scan', { method: 'POST', body: { image, account_id: Number(accountId) } });
      if (!r.items.length) setErr("Claude didn't find any transactions in that picture.");
// A receipt arrives with its items (`lines`: name, amount, category). The suggested split is worked
      // out from them, so moving an item to another category here changes the split.
      else setRows(r.items.map((it: any, i: number) => { const lines = (it.lines ?? []).map((x: any) => ({ ...x, category_id: String(x.category_id) })); return { ...it, key: i, on: !it.already, lines, split: new Set(lines.map((x: any) => x.category_id)).size > 1, showLines: false }; }));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  // A photo just taken from the "+" menu arrives here and is read at once.
  useEffect(() => {
    const take = () => { const photo = handoff.photo; if (photo) { handoff.photo = null; read(photo); } };
    take();
    addEventListener('ledger-photo', take);
    return () => removeEventListener('ledger-photo', take);
  }, []);

  // A screenshot on the clipboard can be pasted straight in.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      if (item) { e.preventDefault(); read(item.getAsFile()); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  const edit = (key: number, change: object) => setRows((rs) => rs!.map((r) => (r.key === key ? { ...r, ...change } : r)));
  const chosen = rows?.filter((r) => r.on) ?? [];
  // The parts of a split, worked out from the receipt's items: one per category, largest first.
  const partsOf = (r: any): { category_id: string; amount: number }[] => {
    const by = new Map<string, number>();
    for (const x of r.lines) by.set(x.category_id, (by.get(x.category_id) || 0) + x.amount);
    return [...by].map(([category_id, amount]) => ({ category_id, amount: Math.round(amount * 100) / 100 })).sort((a, b) => b.amount - a.amount);
  };
  // The first part is "the rest": the total less the other parts (so it follows the total if you correct it).
  const restOf = (r: any) => Math.round((Number(r.amount) - partsOf(r).slice(1).reduce((a, p) => a + p.amount, 0)) * 100) / 100;
  // Move one item, or every item of a category, to another category.
  const moveLine = (r: any, n: number, to: string) => { const lines = r.lines.map((x: any, j: number) => (j === n ? { ...x, category_id: to } : x)); edit(r.key, { lines, split: new Set(lines.map((x: any) => x.category_id)).size > 1 }); };
  const movePart = (r: any, from: string, to: string) => { const lines = r.lines.map((x: any) => (x.category_id === from ? { ...x, category_id: to } : x)); edit(r.key, { lines, split: new Set(lines.map((x: any) => x.category_id)).size > 1 }); };
  const catName = (id: string) => { const c = cats.find((x) => String(x.id) === String(id)); return c ? `${c.icon} ${c.name}` : 'a category'; };

  // A receipt for a purchase the bank has already listed: split that purchase as suggested, without adding anything.
  const splitExisting = async (r: any) => {
    if (!(restOf(r) > 0)) return setErr(`The items of ${r.merchant} add up to more than its total. Check the amount.`);
    setBusy(true); setErr('');
    try {
      await api('/api/transactions/categorize', { method: 'POST', body: { ids: [r.existing_id], category_id: Number(partsOf(r)[0].category_id) } });
      await api(`/api/transactions/${r.existing_id}/split`, { method: 'POST', body: { parts: partsOf(r).slice(1).map((p) => ({ category_id: Number(p.category_id), amount: p.amount })) } });
      if (picture) await keep(r.existing_id);
      edit(r.key, { done: true });
      dispatchEvent(new Event('ledger-refresh'));
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };

  const addAll = async () => {
    for (const r of chosen) {
      if (!r.merchant.trim()) return setErr('Every row you add needs a description.');
      if (!(Number(r.amount) > 0)) return setErr(`Enter an amount above 0 for ${r.merchant}.`);
      if (!r.date) return setErr(`Choose a date for ${r.merchant}.`);
      if (r.split) {
        if (!(restOf(r) > 0)) return setErr(`The items of ${r.merchant} add up to more than its total. Check the amount.`);
      }
    }
    setBusy(true);
    let added = 0, failed = 0;
    for (const r of chosen) {
      try {
        const made = await api('/api/transactions', { method: 'POST', body: { date: r.date, merchant: r.merchant, amount: Number(r.amount), category_id: Number(r.split ? partsOf(r)[0].category_id : r.category_id), account_id: Number(accountId), direction: r.direction, force: true } });
        added++;
        // The split is made straight after the purchase. If that step fails the purchase is still there, as one.
        if (r.lines.length && picture && made?.id) await keep(made.id);
        if (r.split && made?.id) await api(`/api/transactions/${made.id}/split`, { method: 'POST', body: { parts: partsOf(r).slice(1).map((p) => ({ category_id: Number(p.category_id), amount: p.amount })) } }).catch(() => {});
      } catch { failed++; }
    }
    try { localStorage.setItem(LAST_ACCOUNT, accountId); } catch { /* private window */ }
    setBusy(false);
    onAdded(added, failed);
  };

  return (
    <section className="card add-form">
      <div className="card-head"><h2>Add from a receipt</h2></div>
      {ai && !ai.hasKey ? (
        <p className="sub first">{ai.limitNote || <>This uses Claude to read the picture, so it needs an Anthropic API key. Add one in <a href="#connections" onClick={jump(GO.ai)}>Settings, "AI recap and logos"</a>.</>}</p>
      ) : (
        <>
          <p className="sub first">Photograph a paper receipt, or upload a picture you already have: a receipt, or a screenshot of your bank's list of pending or recent purchases. Claude reads it for you to check before anything is added. The picture is sent to Anthropic to be read. A receipt's picture is then kept with its purchase, in your own copy of Ledger, so you can look at it later; a bank screenshot isn't kept.</p>
          <div className="add-grid">
            <label>{rows ? 'Account to add these to' : 'Account in the picture'}
              <select value={accountId} disabled={busy} onChange={(e) => setAccountId(e.target.value)}>
                {banks.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label>Upload a receipt
              <input type="file" accept="image/*" disabled={busy} onChange={(e) => { read(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            {typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && (
              <label className="pick-photo">Read a receipt
                <input type="file" accept="image/*" capture="environment" disabled={busy} onChange={(e) => { read(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
            )}
          </div>
          {!rows && !busy && <p className="sub">Or copy a picture and paste it here.</p>}
          {busy && !rows && <OwlReading />}
        </>
      )}
      {rows && <ReadSummary rows={rows} cats={cats} account={accounts.find((a) => String(a.id) === accountId)?.name || ''} />}
      {rows && (
        <div className="scan-rows">
          {rows.map((r) => (
            <div key={r.key} className="scan-item">
            <div className={`scan-row ${r.on ? '' : 'off'}`}>
              <input type="checkbox" checked={r.on} onChange={(e) => edit(r.key, { on: e.target.checked })} aria-label={`Add ${r.merchant}`} />
              <input type="date" value={r.date} max={todayIso()} onChange={(e) => edit(r.key, { date: e.target.value })} aria-label={`Date for ${r.merchant}`} />
              <span className="scan-name">
                <input type="text" value={r.merchant} onChange={(e) => edit(r.key, { merchant: e.target.value })} aria-label="Description" />
                {r.already === 'bank' && <small>Already in your transactions from the bank</small>}
                {r.already === 'typed' && <small>You already added this one</small>}
                {!r.already && r.direction === 'in' && <small>Money in</small>}
              </span>
              {r.split ? <span className="scan-splitnote">Split below</span> : <CategoryPicker cats={cats} value={r.category_id} onChange={(id) => edit(r.key, { category_id: id })} label={`Category for ${r.merchant}`} />}
              <input type="number" min="0" step="0.01" inputMode="decimal" value={r.amount} onChange={(e) => edit(r.key, { amount: e.target.value })} aria-label={`Amount for ${r.merchant}`} />
            </div>
            {(() => {
              const parts = partsOf(r);
              const forBank = !r.on && r.already === 'bank' && !!r.existing_id;
              if (r.done) return <p className="scan-split-off good" role="status">Done. The purchase already in your transactions is now split across {parts.length} categories.</p>;
              if (!r.lines.length || !(r.on || forBank)) return r.lines.length && r.already === 'bank' ? <p className="scan-split-off">This purchase is already in your transactions and has been split before, so there is nothing to add.</p> : null;
              // Every item on the receipt, each with its category: change one and the split follows.
              const review = (
                <>
                  <button type="button" className="scan-lines-toggle" aria-expanded={r.showLines} onClick={() => edit(r.key, { showLines: !r.showLines })}>{`Review the ${r.lines.length} item${r.lines.length === 1 ? '' : 's'}`}</button>
                  {r.showLines && createPortal(
                    // The items open in their own glass window, so the form underneath stays short.
                    <div className="about-overlay" onClick={() => edit(r.key, { showLines: false })}>
                      <div className="about-pop scan-pop" role="dialog" aria-modal="true" aria-label={`Items on the ${r.merchant} receipt`} onClick={(e) => e.stopPropagation()}>
                        <header className="about-pop-head">
                          <h2>{r.merchant}</h2>
                          <button className="about-close" onClick={() => edit(r.key, { showLines: false })} aria-label="Close">×</button>
                        </header>
                        <div className="about-page">
                          <p className="sub">{r.lines.length} item{r.lines.length === 1 ? '' : 's'}, {cents(Number(r.amount))} in all. Change where any item is filed; amounts include each item's tax.</p>
                          <div className="scan-lines">
                            {r.lines.map((x: any, n: number) => (
                              <div key={n} className="scan-line">
                                <span className="scan-line-name">{x.name}</span>
                                <span className="num">{cents(x.amount)}</span>
                                <CategoryPicker cats={cats.filter((c) => c.kind === 'expense' || c.kind === 'aside')} value={x.category_id} onChange={(id) => moveLine(r, n, id)} label={`Category for ${x.name}`} />
                              </div>
                            ))}
                          </div>
                        </div>
                        <footer className="about-pop-foot scan-pop-foot">
                          <span className="scan-pop-sum">{parts.map((p, i) => <span key={p.category_id}>{catName(p.category_id)} <b>{cents(i === 0 ? Math.max(0, restOf(r)) : p.amount)}</b></span>)}</span>
                          <button className="primary" onClick={() => edit(r.key, { showLines: false })}>Done</button>
                        </footer>
                      </div>
                    </div>,
                    document.body,
                  )}
                </>
              );
              if (!r.split) return <div className="scan-split-off">{parts.length > 1 ? <>Kept as one purchase. <button type="button" className="link" onClick={() => edit(r.key, { split: true })}>Split it as suggested</button></> : <>Everything on this receipt was filed under {catName(parts[0].category_id)}.</>} {review}</div>;
              return (
                <div className="scan-split">
                  <div className="scan-split-head"><b>{forBank ? 'Suggested split for the purchase already there' : 'Suggested split'}</b>{r.on && <button type="button" className="link" onClick={() => edit(r.key, { split: false, category_id: parts[0].category_id })}>Keep it as one purchase</button>}</div>
                  {parts.map((p, i) => (
                    <div key={p.category_id} className="split-part">
                      <span className="num scan-rest">{cents(i === 0 ? Math.max(0, restOf(r)) : p.amount)}</span>
                      <CategoryPicker cats={cats.filter((c) => c.kind === 'expense' || c.kind === 'aside')} value={p.category_id} onChange={(id) => movePart(r, p.category_id, id)} label={`Category of part ${i + 1}`} />
                      <small>{r.lines.filter((x: any) => x.category_id === p.category_id).length} item{r.lines.filter((x: any) => x.category_id === p.category_id).length === 1 ? '' : 's'}</small>
                    </div>
                  ))}
                  {review}
                  {forBank && <div><button type="button" className="primary" disabled={busy} onClick={() => splitExisting(r)}>Split that purchase this way</button></div>}
                  <small className="sub">{forBank && 'Your bank has already listed this purchase, so nothing new is added: this splits the one that is there. '}Ledger sorted the receipt's items into your categories and put each tax line with the items it was charged on, as far as the receipt shows. Changing a category here moves every item in it; open the items to move just one.</small>
                </div>
              );
            })()}
            </div>
          ))}
          <p className="sub">Check the amounts against the picture. Each one you add shows as waiting for the bank and is replaced by the bank's entry when it posts.</p>
        </div>
      )}
      {err && <p className="error" role="alert">{err}</p>}
      <div className="add-actions">
        {rows && <button type="button" className="primary" disabled={busy || !chosen.length} onClick={addAll}>{busy ? 'Adding…' : `Add ${chosen.length} transaction${chosen.length === 1 ? '' : 's'}`}</button>}
        <button type="button" onClick={onClose}>{rows ? 'Cancel' : 'Close'}</button>
      </div>
    </section>
  );
}

/**
 * Splits one purchase across categories. Each part takes an amount and a category; whatever is left
 * stays on the original in its own category. Nothing changes until "Split it".
 */
function SplitForm({ t, cats, onDone, onClose }: { t: any; cats: any[]; onDone: () => void; onClose: () => void }) {
  const [parts, setParts] = useState([{ category_id: '', amount: '' }]);
  const [err, setErr] = useState('');
  const own = Math.abs(t.amount);
  const taking = parts.reduce((a, p) => a + (Number(p.amount) || 0), 0);
  const left = Math.round((own - taking) * 100) / 100;
  const set = (i: number, k: 'category_id' | 'amount', v: string) => { setParts(parts.map((p, j) => (j === i ? { ...p, [k]: v } : p))); setErr(''); };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const filled = parts.filter((p) => p.amount !== '' || p.category_id !== '');
    if (!filled.length || filled.some((p) => !(Number(p.amount) > 0) || !p.category_id)) return setErr('Give each part an amount and a category.');
    if (left <= 0) return setErr('Leave something for the original category. To move the whole purchase, change its category instead.');
    try {
      await api(`/api/transactions/${t.id}/split`, { method: 'POST', body: { parts: filled.map((p) => ({ category_id: Number(p.category_id), amount: Number(p.amount) })) } });
      onDone();
    } catch (e: any) { setErr(e.message); }
  };
  return (
    <form className="split-form" onSubmit={save} noValidate>
      <p className="sub first">Split {t.merchant}, {cents(own)}. Say how much belongs somewhere else; the rest stays in {t.category}.</p>
      {parts.map((p, i) => (
        <div key={i} className="split-part">
          <input type="number" min="0" step="0.01" inputMode="decimal" placeholder="Amount" aria-label={`Amount of part ${i + 1}`} value={p.amount} onChange={(e) => set(i, 'amount', e.target.value)} autoFocus={i === 0} />
          <CategoryPicker cats={cats.filter((c) => c.kind === t.kind || c.kind === 'transfer' || (c.kind === 'aside' && t.kind === 'expense') || (c.kind === 'expense' && t.kind === 'aside'))} value={p.category_id} onChange={(id) => set(i, 'category_id', id)} label={`Category of part ${i + 1}`} blank="Choose a category" allowNew={t.kind === 'expense'} />
          {parts.length > 1 && <button type="button" className="link" onClick={() => setParts(parts.filter((_, j) => j !== i))}>Remove</button>}
        </div>
      ))}
      <div className="split-part"><span className={`num ${left <= 0 ? 'bad' : ''}`}>{cents(Math.max(0, left))}</span><span className="sub">stays in {t.category}</span></div>
      <div className="add-actions">
        <button type="submit" className="primary">Split it</button>
        {parts.length < 8 && <button type="button" onClick={() => setParts([...parts, { category_id: '', amount: '' }])}>Add another part</button>}
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
    </form>
  );
}

export default function Transactions({ month, review = false, start = '' }: { month: string; review?: boolean; start?: string }) {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [account, setAccount] = useState('');
  const owners = useOwners();
  const [range, setRange] = useState<'month' | 'all'>('month');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [bulkCat, setBulkCat] = useState('');
  const [toast, setToast] = useState<Toast>(null);
  const [adding, setAdding] = useState(start === 'add' || start === 'deposit');
  const [addDir, setAddDir] = useState<'in' | 'out'>(start === 'deposit' ? 'in' : 'out');
  const [scanning, setScanning] = useState(start === 'scan');
  const [transferring, setTransferring] = useState(start === 'transfer');
  // The row whose fine print is showing (phone layout).
  const [open, setOpen] = useState<number | null>(null);
  // The purchase being split across categories, if any.
  const [splitting, setSplitting] = useState<number | null>(null);
  // The hand-added entry being corrected, if any.
  const [editing, setEditing] = useState<number | null>(null);
  // The purchase whose receipt picture is being looked at.
  const [receipt, setReceipt] = useState<number | null>(null);
  // Keeps a picture with a purchase the bank brought in, or any other without one.
  const addReceipt = (t: any) => pickReceipt(t.split_of || t.id, (error) => { if (error) alert(error); else reload(); });
  // The round "+" button asks this page to open a form.
  useEffect(() => {
    const onAdd = (e: Event) => { const what = (e as CustomEvent).detail; setAddDir(what === 'deposit' ? 'in' : 'out'); setAdding(what === 'add' || what === 'deposit'); setScanning(what === 'scan'); setTransferring(what === 'transfer'); };
    addEventListener('ledger-add', onAdd);
    return () => removeEventListener('ledger-add', onAdd);
  }, []);
  // Arriving by #transactions/add opens the form once; tidy the address so a reload doesn't reopen it.
  useEffect(() => { if (start === 'add' || start === 'deposit' || start === 'scan' || start === 'transfer') history.replaceState(null, '', '#transactions'); }, [start]);
  const [claimedOnly, setClaimedOnly] = useState(false);
  const [reviewOnly, setReviewOnly] = useState(review);
  // A new category being created for one transaction.
  const [creating, setCreating] = useState<any>(null);
  const [newCat, setNewCat] = useState({ name: '', icon: '' });
  const [searching, setSearching] = useState(false);
  const filtersOn = [q.trim(), range === 'all', category, account, reviewOnly, claimedOnly].filter(Boolean).length;
  const [newErr, setNewErr] = useState('');

  const params = new URLSearchParams();
  if (range === 'month') params.set('month', month);
  if (q.trim()) params.set('q', q.trim());
  if (category) params.set('category', category);
  if (account.startsWith('who:')) params.set('who', account.slice(4)); else if (account) params.set('account', account);
  if (claimedOnly) params.set('claimed', '1');
  if (reviewOnly) params.set('review', '1');
  const { data: txs, error, reload: reloadTxs } = useData<any[]>(`/api/transactions?${params}`);
  // The same checking estimate the dashboard shows; refreshed whenever the list changes.
  const { data: est, reload: reloadEst } = useData<any>('/api/checking');
  const reload = () => { reloadTxs(); reloadEst(); };
  const { data: cats, reload: reloadCats } = useData<any[]>('/api/categories');
  const { data: acc } = useData<any>('/api/accounts');

  useEffect(() => setPicked(new Set()), [month, q, category, account, range, claimedOnly, reviewOnly]);
  useEffect(() => {
    if (!toast) return;
    // Messages with buttons stay up longer, so there's time to press Undo.
    const t = setTimeout(() => setToast(null), toast.actions?.length ? 20000 : 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const days = useMemo(() => {
    const out: { date: string; items: any[] }[] = [];
    for (const t of txs ?? []) {
      if (out.at(-1)?.date !== t.date) out.push({ date: t.date, items: [] });
      out.at(-1)!.items.push(t);
    }
    return out;
  }, [txs]);

  /** Change categories on the server. Returns how many changed and what to send back to undo it. */
  const categorize = async (body: object): Promise<{ changed: number; undo: any }> => {
    try {
      const r = await api('/api/transactions/categorize', { method: 'POST', body });
      reload();
      return r;
    } catch (e: any) {
      setToast({ text: e.message });
      return { changed: 0, undo: null };
    }
  };
  const undoAction = (undo: any): ToastAction => ({
    label: 'Undo',
    run: async () => {
      try {
        await api('/api/transactions/restore', { method: 'POST', body: undo });
        reload();
        setToast({ text: 'Undone.' });
      } catch (e: any) {
        setToast({ text: e.message });
      }
    },
  });

  /**
   * After one transaction is moved: always offer Undo, and offer to apply the
   * same category to the merchant's other transactions unless it's a payment
   * app or similar, where each payment is for something different.
   */
  const afterMove = async (t: any, category_id: number, name: string, first: { undo: any }, text: string) => {
    if (!first.undo) return;
    const { n } = await api(`/api/merchant-count?merchant=${encodeURIComponent(t.merchant)}`);
    const actions: ToastAction[] = [];
    if (n > 1 && !MIXED_PAYEE.test(t.merchant)) {
      actions.push({
        label: `Apply to all ${n} from ${t.merchant}`,
        run: async () => {
          const all = await categorize({ category_id, applyToMerchant: t.merchant });
          if (!all.undo) return;
          // Undoing this should also put the first transaction back where it started.
          const original = new Map(first.undo.items.map((it: any) => [it.id, it.category_id]));
          const items = all.undo.items.map((it: any) => (original.has(it.id) ? { id: it.id, category_id: original.get(it.id) } : it));
          setToast({ text: `${all.changed} transactions from ${t.merchant} are now ${name}. Future ones will follow.`, actions: [undoAction({ items, rule: all.undo.rule })] });
        },
      });
    }
    actions.push(undoAction(first.undo));
    setToast({ text, actions });
  };

  const changeOne = async (t: any, category_id: number) => {
    const name = cats?.find((c) => c.id === category_id)?.name ?? 'the new category';
    const first = await categorize({ ids: [t.id], category_id });
    await afterMove(t, category_id, name, first, `${t.merchant} moved to ${name}.`);
  };

  const createAndApply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCat.name.trim()) return setNewErr('Enter a name for the category.');
    try {
      const c = await api('/api/categories', { method: 'POST', body: newCat });
      reloadCats();
      const t = creating;
      setCreating(null);
      setNewCat({ name: '', icon: '' });
      const first = await categorize({ ids: [t.id], category_id: c.id });
      await afterMove(t, c.id, c.name, first, `${c.name} created and applied to ${t.merchant}.`);
    } catch (e: any) {
      setNewErr(e.message);
    }
  };

  const applyBulk = async () => {
    if (!bulkCat) return;
    const r = await categorize({ ids: [...picked], category_id: Number(bulkCat) });
    if (r.undo) setToast({ text: `${r.changed} transactions recategorized.`, actions: [undoAction(r.undo)] });
    setPicked(new Set());
    setBulkCat('');
  };

  // Claim a purchase, or a share of it, as a business expense of the side gig (stored as kind 'vipkid').
  const gig = useGig();
  const claim = async (t: any, pct: number, kind: 'vipkid' | 'teaching' = t.deduct_kind) => {
    const label = kind === 'teaching' ? 'teaching' : gig.name;
    try {
      await api('/api/transactions/deduct', { method: 'POST', body: { id: t.id, pct, kind } });
      reload();
      const { n } = await api(`/api/merchant-count?merchant=${encodeURIComponent(t.merchant)}`);
      const what = pct > 0 ? `${pct}% of ${t.merchant} claimed for ${label}.` : `${t.merchant} is no longer claimed.`;
      const actions: ToastAction[] = [];
      if (n > 1 && !MIXED_PAYEE.test(t.merchant)) {
        actions.push({
          label: pct > 0 ? `Claim all ${n} from ${t.merchant}` : `Unclaim all ${n} from ${t.merchant}`,
          run: async () => {
            const r = await api('/api/transactions/deduct', { method: 'POST', body: { pct, kind, applyToMerchant: t.merchant } });
            reload();
            setToast({ text: pct > 0 ? `${r.changed} purchases from ${t.merchant} claimed at ${pct}%. Future ones will follow.` : `${r.changed} purchases from ${t.merchant} unclaimed.` });
          },
        });
      }
      // Undo puts this one purchase back to how it was claimed before.
      actions.push({
        label: 'Undo',
        run: async () => {
          await api('/api/transactions/deduct', { method: 'POST', body: { id: t.id, pct: t.deduct_pct, kind: t.deduct_kind } });
          reload();
          setToast({ text: 'Undone.' });
        },
      });
      setToast({ text: what, actions });
    } catch (e: any) {
      setToast({ text: e.message });
    }
  };

  // Puts a split purchase back together as one.
  const unsplit = async (t: any) => {
    try { await api(`/api/transactions/${t.id}/unsplit`, { method: 'POST' }); reload(); } catch (e: any) { setToast({ text: e.message }); }
  };
  // Leave a transaction out of spending and income (a double-posted charge, say), or put it back.
  const leaveOut = async (t: any, on: boolean) => {
    if (on && !confirm(`Leave ${t.merchant} (${cents(Math.abs(t.amount))}) out of your ${t.amount > 0 ? 'income' : 'spending and budgets'}? It stays in the list, and "Put back" undoes this.`)) return;
    try {
      await api(`/api/transactions/${t.id}/leave-out`, { method: 'POST', body: { on } });
      reload();
      setToast({ text: on ? `${t.merchant} is left out of your totals.` : `${t.merchant} counts again.` });
    } catch (e: any) { setToast({ text: e.message }); }
  };
  const asIncome = async (t: any) => {
    try { await api(`/api/transactions/${t.id}/income`, { method: 'POST' }); reload(); setToast({ text: `${t.merchant} now counts as income.` }); } catch (e: any) { setToast({ text: e.message }); }
  };
  const asRefund = async (t: any) => {
    try { const r = await api(`/api/transactions/${t.id}/refund`, { method: 'POST' }); alert(`Filed as a refund under ${r.category}, so it comes off that spending${r.from ? ` (matched to ${r.from})` : ''}.`); reload(); } catch (e: any) { alert(e.message); }
  };
  const remove = async (t: any) => {
    // No "are you sure": Undo is offered for a few seconds, and for ten minutes the server can put it back.
    try {
      const r = await api(`/api/transactions/${t.id}`, { method: 'DELETE' });
      reload();
      setToast(null);
      offerUndo(r.both ? 'Transfer removed, both sides of it.' : `${t.merchant} removed.`, r.undo);
    } catch (e: any) {
      setToast({ text: e.message });
    }
  };

  // The bank never listed a purchase you typed in: keep it as an ordinary hand-added transaction.
  const keep = async (t: any) => {
    try {
      await api(`/api/transactions/${t.id}`, { method: 'PATCH', body: { waiting: false } });
      reload();
      setToast({ text: `${t.merchant} kept.` });
    } catch (e: any) {
      setToast({ text: e.message });
    }
  };

  // What sliding a row left uncovers on a phone.
  const swipeActions = (t: any) => {
    const canClaim = t.amount < 0 && t.kind === 'expense' && (gig.on || gig.teachers > 0 || t.deduct_pct > 0);
    if (!canClaim && !t.manual) return null;
    return (
      <>
        {canClaim && (t.deduct_pct > 0
          ? <button className="quiet" onClick={() => claim(t, 0)}>Unclaim</button>
          : <>{gig.on && <button onClick={() => claim(t, 100, 'vipkid')}>Claim for {gig.name}</button>}{gig.teachers > 0 && <button onClick={() => claim(t, 100, 'teaching')}>Claim for teaching</button>}</>)}
        {t.manual ? <button className="danger" onClick={() => remove(t)}>Remove</button> : null}
      </>
    );
  };

  // On a phone, tapping a row (or its "⋯") opens one sheet of large buttons in place of the fine print's
  // small links. The conditions here mirror the links further down: change them together.
  const [sheet, setSheet] = useState<number | null>(null);
  // On a phone the checking card is one line until tapped.
  const [estOpen, setEstOpen] = useState(false);
  const sheetFor = (t: any): SheetItem[] => {
    const whole = !t.split_of && !t.parts && t.kind !== 'transfer';
    const stale = t.waiting && daysAgo(t.date) > WAITING_DAYS;
    const expense = t.amount < 0 && t.kind === 'expense';
    return [
      !t.split_of && !t.parts && !t.pending && !t.waiting && t.kind !== 'transfer' && Math.abs(t.amount) >= 0.02 && { label: 'Split across categories', run: () => { setSplitting(t.id); setOpen(t.id); } },
      t.parts > 0 && { label: 'Split again', run: () => setSplitting(t.id) },
      (t.split_of || t.parts > 0) && { label: 'Undo the split', run: () => unsplit(t) },
      expense && !t.deduct_pct && gig.on && { label: `Claim for ${gig.name}`, hint: 'A business expense on your taxes', run: () => claim(t, 100, 'vipkid') },
      expense && !t.deduct_pct && gig.teachers > 0 && { label: 'Claim for teaching', hint: 'A classroom expense on your taxes', run: () => claim(t, 100, 'teaching') },
      expense && t.deduct_pct > 0 && { label: 'Unclaim', hint: `${t.deduct_pct}% is claimed for ${t.deduct_kind === 'teaching' ? 'teaching' : gig.name}`, run: () => claim(t, 0) },
      t.cat_key === 'Deposit' && t.amount > 0 && !t.pending && !t.split_of && { label: "It's income", hint: 'Not counted as income now', run: () => asIncome(t) },
      t.amount > 0 && t.kind !== 'expense' && (t.kind !== 'transfer' || t.cat_key === 'Deposit') && !t.pending && !t.split_of && { label: "It's a refund", hint: 'Comes off the spending it refunds', run: () => asRefund(t) },
      stale && { label: 'Keep it', hint: `Not found at the bank after ${WAITING_DAYS} days`, run: () => keep(t) },
      (t.waiting || t.manual) && !stale && whole && { label: 'Edit', hint: 'Name, amount or date', run: () => { setEditing(t.id); setOpen(t.id); } },
      t.receipt && { label: 'See the receipt', run: () => setReceipt(t.split_of || t.id) },
      !t.receipt && t.amount < 0 && !t.pending && { label: 'Add a receipt', hint: 'A picture kept with this purchase', run: () => addReceipt(t) },
      { label: 'Change the icon', run: () => dispatchEvent(new CustomEvent('ledger-logo-edit', { detail: { key: t.merchant, label: String(t.merchant).trim() } })) },
      t.left_out ? { label: 'Put back in your totals', run: () => leaveOut(t, false) }
        : !t.pending && whole && { label: 'Leave out of your totals', hint: 'For a charge posted twice, or one that should not count', run: () => leaveOut(t, true) },
      (t.waiting || t.manual) && { label: 'Remove', danger: true, run: () => remove(t) },
    ];
  };
  const sheetSub = (t: any) => [
    dayLong(t.date), t.account, t.notes,
    t.pending && 'pending', t.waiting && 'waiting for the bank', !t.waiting && t.manual && 'added by you',
    t.left_out && 'left out of your totals',
    t.split_of && `part of a ${cents(Math.abs(t.whole))} purchase`, t.parts > 0 && `split: ${cents(Math.abs(t.amount))} of a ${cents(Math.abs(t.whole))} purchase`,
  ].filter(Boolean).join(' · ');
  const sheetTx = sheet == null ? null : txs?.find((t: any) => t.id === sheet);

  const toggle = (id: number) =>
    setPicked((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  return (
    <div>
      {/* A kept receipt, shown in the same glass window as the About topics. */}
      {receipt != null && createPortal(
        <div className="about-overlay" onClick={() => setReceipt(null)}>
          <div className="about-pop scan-pop" role="dialog" aria-modal="true" aria-label="Receipt" onClick={(e) => e.stopPropagation()}>
            <header className="about-pop-head"><h2>Receipt</h2><button className="about-close" onClick={() => setReceipt(null)} aria-label="Close">×</button></header>
            <div className="about-page receipt-view"><img src={at(`/api/transactions/${receipt}/receipt`)} alt="The receipt kept for this purchase" /></div>
            <footer className="about-pop-foot scan-pop-foot">
              <button onClick={async () => { if (confirm('Remove this picture? The purchase itself stays.')) { await api(`/api/transactions/${receipt}/receipt`, { method: 'DELETE' }); setReceipt(null); reload(); } }}>Remove the picture</button>
              <button className="primary" onClick={() => setReceipt(null)}>Done</button>
            </footer>
          </div>
        </div>,
        document.body,
      )}
      <div className={`filters ${searching ? 'open' : ''}`}>
        {/* On a phone the search box and filters sit behind this one button. */}
        <button className="search-toggle" aria-expanded={searching} onClick={() => setSearching(!searching)}>
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <span>Search transactions</span>
          {filtersOn > 0 && <b className="count">{filtersOn}</b>}
          <svg className="chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </button>
        <input type="search" placeholder="Search names, notes or an amount" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search transactions" />
        <select value={range} onChange={(e) => setRange(e.target.value as any)} aria-label="Date range">
          <option value="month">This month</option>
          <option value="all">All time</option>
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {cats?.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}{c.kind === 'aside' ? ' (not counted)' : ''}</option>)}
        </select>
        <select value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Account">
          <option value="">All accounts</option>
          {owners.marked && owners.list.map((w) => <option key={w} value={`who:${w}`}>{owners.possessive(w)} accounts</option>)}
          {acc?.accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <label className="check inline">
          <input type="checkbox" checked={reviewOnly} onChange={(e) => setReviewOnly(e.target.checked)} />
          Needs a category
        </label>
        <label className="check inline">
          <input type="checkbox" checked={claimedOnly} onChange={(e) => setClaimedOnly(e.target.checked)} />
          Tax deductions only
        </label>
        {filtersOn > 0 && <button className="link clear-filters" onClick={() => { setQ(''); setRange('month'); setCategory(''); setAccount(''); setReviewOnly(false); setClaimedOnly(false); }}>Clear search</button>}
        {/* On a phone the round "+" button does these two. */}
        {!adding && <button className="primary add-btn" onClick={() => { setAddDir('out'); setAdding(true); setScanning(false); setTransferring(false); }}>Add transaction</button>}
        {!scanning && <button className="add-btn" onClick={() => { setScanning(true); setAdding(false); setTransferring(false); }}>Add from a receipt</button>}
        {!transferring && <button className="add-btn" onClick={() => { setTransferring(true); setAdding(false); setScanning(false); }}>Record a transfer</button>}
      </div>

      {adding && cats && acc && (
        <AddForm
          key={addDir}
          start={addDir}
          onNewCategory={reloadCats}
          cats={cats.filter((c) => c.kind !== 'transfer' || c.key === 'Deposit')}
          accounts={acc.accounts}
          onClose={() => setAdding(false)}
          onAdded={(name, waiting) => { setAdding(false); reload(); setToast({ text: waiting ? `${name} added. It will be replaced by the bank's entry when that arrives.` : `${name} added.` }); }}
        />
      )}

      {transferring && acc && (
        <TransferForm accounts={acc.accounts} onClose={() => setTransferring(false)} onAdded={(text) => { setTransferring(false); reload(); reloadEst(); setToast({ text }); }} />
      )}

      {scanning && cats && acc && (
        <ScanForm
          cats={cats}
          accounts={acc.accounts}
          onClose={() => setScanning(false)}
          onAdded={(added, failed) => {
            setScanning(false); reload();
            setToast({ text: `${added} transaction${added === 1 ? '' : 's'} added.${failed ? ` ${failed} couldn't be added.` : ''} They'll be replaced by the bank's entries as those arrive.` });
          }}
        />
      )}

      <DepositReview onChanged={reload} />
      <OtherReview cats={cats || []} onChanged={reload} />
      {est && est.accounts.length > 0 && (
        <section className={`card estimate ${estOpen ? 'open' : ''}`}>
          <div className="estimate-top" onClick={() => isPhone() && setEstOpen(!estOpen)}>
            <div className="label">Estimated in checking</div>
            <div className="value"><Roll value={est.estimate} format={cents} /></div>
            <button type="button" className="estimate-more" aria-expanded={estOpen} aria-label="How this figure is worked out"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></button>
          </div>
          {est.byHand ? (
            <div className="estimate-how">
              <small>You keep this account yourself, so this is the balance you gave it plus everything entered on it since. To correct it, use "Set balance" on the <a href="#accounts" onClick={jump(GO.setBalance)}>Accounts</a> page.</small>
            </div>
          ) : (
          <div className="estimate-how">
            <div><span>Posted at the bank</span><span className="num">{cents(est.posted)}</span></div>
            <div className={est.basis === 'bank' ? 'used' : ''}><span>Pending purchases and payments at the bank</span><span className="num">{(est.bankOut ?? est.bankPending) > 0 ? `-${cents(est.bankOut ?? est.bankPending)}` : cents(0)}</span></div>
            <div className={est.basis === 'waiting' ? 'used' : ''}><span>Entered by you, waiting for the bank{est.waitingCount ? ` (${est.waitingCount})` : ''}</span><span className="num">{est.waiting > 0 ? `-${cents(est.waiting)}` : est.waiting < 0 ? `+${cents(-est.waiting)}` : cents(0)}</span></div>
            {est.fileOut > 0 && <div className={est.basis === 'waiting' ? 'used' : ''}><span>From your bank's file, newer than the bank's last reading{est.fileCount ? ` (${est.fileCount})` : ''}</span><span className="num">-{cents(est.fileOut)}</span></div>}
            {est.incoming > 0 && <div className="used"><span>Money in you've recorded, waiting for the bank{est.incomingCount ? ` (${est.incomingCount})` : ''}</span><span className="num">+{cents(est.incoming)}</span></div>}
            <small>
              The pending and waiting lines mostly cover the same purchases, so only the larger one is taken off.
              {est.bankAsOf || est.syncedAt ? ` The bank's figures are from ${new Date(est.bankAsOf ?? est.syncedAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}; anything since then only counts if you've entered it.` : ''}
            </small>
          </div>
          )}
        </section>
      )}

      {creating && (
        <form className="card add-form" onSubmit={createAndApply} noValidate>
          <div className="card-head"><h2>New category for {creating.merchant}</h2></div>
          <div className="add-grid">
            <label>Name<input type="text" value={newCat.name} autoFocus placeholder="Haircuts" onChange={(e) => { setNewCat({ ...newCat, name: e.target.value }); setNewErr(''); }} /></label>
            <EmojiPick value={newCat.icon} onChange={(v) => setNewCat({ ...newCat, icon: v })} />
          </div>
          {newErr && <p className="error" role="alert">{newErr}</p>}
          <div className="add-actions">
            <button type="submit" className="primary">Create and apply</button>
            <button type="button" onClick={() => setCreating(null)}>Cancel</button>
          </div>
        </form>
      )}

      {reviewOnly && (
        <p className="sub" style={{ margin: '0 0 12px' }}>
          Showing what still needs a category: everything in "Other", plus Venmo and Cash App transfers. The bank doesn't pass along Venmo's notes, so those need you to say what each was.
        </p>
      )}

      <section className="card">
        {error && <p className="error">{error}</p>}
        {!txs && !error && <div className="skel" aria-busy="true">{[72, 58, 80, 64, 76, 52].map((w, i) => <i key={i} style={{ width: `${w}%`, height: 16 }} />)}</div>}
        {txs && txs.length === 0 && (q || category || account || review
          ? <p className="sub">No transactions match. Try a different search or date range.</p>
          : <p className="sub">Nothing here for this month yet. Add a purchase or a deposit with the + button, or connect your bank in <a href="#connections" onClick={jump(GO.bank)}>Settings, "SimpleFIN Sync"</a>.</p>)}
        {txs?.length === 500 && <p className="sub">Showing the latest 500. Narrow the search to see older ones.</p>}
        {days.map((d) => (
          <div key={d.date}>
            <div className="day-head">{dayLong(d.date)}</div>
            {d.items.map((t) => (
              <div key={t.id}>
              <SwipeRow actions={swipeActions(t)}>
              <div className={`tx ${picked.has(t.id) ? 'picked' : ''} ${open === t.id ? 'open' : ''}`}>
                <input type="checkbox" checked={picked.has(t.id)} onChange={() => toggle(t.id)} aria-label={`Select ${t.merchant}`} />
                <button type="button" className="logo-btn" aria-label={`Change the icon for ${t.merchant}`} title="Change this icon" onClick={() => { if (isPhone()) return dispatchEvent(new CustomEvent('ledger-logo-edit', { detail: { key: t.merchant, label: String(t.merchant).trim() } })); setOpen(t.id); setTimeout(() => dispatchEvent(new CustomEvent('ledger-logo-open', { detail: t.id })), 0); }}><Logo name={t.merchant} fallback={t.icon} /></button>
                <span className="grow" onClick={(e) => { if (!(e.target as HTMLElement).closest('button, input, select, a')) { if (isPhone()) setSheet(t.id); else setOpen(open === t.id ? null : t.id); } }}>
                  <span className="tx-name">
                    {t.merchant}
                    {t.waiting ? <i className="pulse" role="img" aria-label="Waiting for the bank" /> : null}
                    {t.left_out ? <em className="left-out-tag">left out</em> : null}
                    {t.kind === 'aside' ? <em className="left-out-tag" title="This category is left out of the budget (Budgets page).">not counted</em> : null}
                    {!t.left_out && t.acct_out ? <em className="left-out-tag" title="This account is left out of the budget (Accounts page). Choose a category to count this one purchase.">account left out</em> : null}
                    {!t.waiting && t.settled_at && Date.now() - t.settled_at < 3 * 86400000 ? <i className="matched" role="img" aria-label="The bank's entry matched the one you added">✓</i> : null}
                  </span>
                  <small>
                    {t.account}{t.notes ? ` · ${t.notes}` : ''}
                    {t.receipt ? <> · <button className="link" onClick={() => setReceipt(t.split_of || t.id)}>Receipt</button></> : t.amount < 0 && !t.pending ? <> · <button className="link" onClick={() => addReceipt(t)}>Add a receipt</button></> : null}
                    {t.left_out
                      ? <> · <span className="bad">left out of your totals</span> · <button className="link" onClick={() => leaveOut(t, false)}>Put back</button></>
                      : !t.pending && !t.split_of && !t.parts && t.kind !== 'transfer' ? <> · <button className="link" onClick={() => leaveOut(t, true)} title="For a charge the bank posted twice, or one that shouldn't count">Leave out</button></> : null}
                    {t.pending ? ' · pending' : null}
                    {!t.waiting && t.settled_at && Date.now() - t.settled_at < 3 * 86400000 ? ' · matched to the purchase you entered' : null}
                    {t.waiting ? (
                      daysAgo(t.date) > WAITING_DAYS
                        ? <> · <span className="bad">not found at the bank after {WAITING_DAYS} days</span> · <button className="link" onClick={() => keep(t)}>Keep</button> · <button className="link" onClick={() => remove(t)}>Remove</button></>
                        : <> · waiting for the bank{!t.split_of && !t.parts && t.kind !== 'transfer' ? <> · <button className="link" onClick={() => { setEditing(t.id); setOpen(t.id); }}>Edit</button></> : null} · <button className="link" onClick={() => remove(t)}>Remove</button></>
                    ) : t.manual ? <> · added by you{!t.split_of && !t.parts && t.kind !== 'transfer' ? <> · <button className="link" onClick={() => { setEditing(t.id); setOpen(t.id); }}>Edit</button></> : null} · <button className="link" onClick={() => remove(t)}>Remove</button></> : null}
                    {t.split_of ? <> · part of a {cents(Math.abs(t.whole))} purchase · <button className="link" onClick={() => unsplit(t)}>Undo split</button></>
                      : t.parts > 0 ? <> · split: {cents(Math.abs(t.amount))} of a {cents(Math.abs(t.whole))} purchase · <button className="link" onClick={() => setSplitting(t.id)}>Split again</button> · <button className="link" onClick={() => unsplit(t)}>Undo split</button></>
                        : !t.pending && !t.waiting && t.kind !== 'transfer' && Math.abs(t.amount) >= 0.02 ? <> · <button className="link" onClick={() => { setSplitting(t.id); setOpen(t.id); }}>Split</button></> : null}
                    {/* Money back from a shop: file it under the category of the purchase it refunds, so it comes off that spending. */}
                    {t.cat_key === 'Deposit' && t.amount > 0 && !t.pending && !t.split_of && <> · not counted as income · <button className="link" onClick={() => asIncome(t)}>It's income</button></>}
                    {t.amount > 0 && t.kind !== 'expense' && (t.kind !== 'transfer' || t.cat_key === 'Deposit') && !t.pending && !t.split_of && <> · <button className="link" onClick={() => asRefund(t)}>It's a refund</button></>}
                    {t.amount < 0 && t.kind === 'expense' && (
                      t.deduct_pct > 0 ? (
                        <> · <span className="claimed">{t.deduct_kind === 'teaching' ? 'Teaching' : gig.name} deduction{' '}
                          <input
                            key={t.deduct_pct} type="number" min="1" max="100" defaultValue={t.deduct_pct} aria-label={`Share of ${t.merchant} to claim, in percent`}
                            onBlur={(e) => { const v = Number(e.target.value); if (v > 0 && v <= 100 && v !== t.deduct_pct) claim(t, v); else e.target.value = String(t.deduct_pct); }}
                            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                          />%</span> · <button className="link" onClick={() => claim(t, 0)}>Unclaim</button></>
                      ) : (gig.on || gig.teachers > 0) ? (
                        <> · Claim for {gig.on && <button className="link" onClick={() => claim(t, 100, 'vipkid')} aria-label={`Claim ${t.merchant} for ${gig.name}`}>{gig.name}</button>}{gig.on && gig.teachers > 0 && ' or '}{gig.teachers > 0 && <button className="link" onClick={() => claim(t, 100, 'teaching')} aria-label={`Claim ${t.merchant} for teaching`}>teaching</button>}</>
                      ) : null
                    )}
                    {' · '}<LogoPicker name={t.merchant} openOn={t.id} />
                  </small>
                </span>
                <span className="cat">
                  <select value={t.category_id} aria-label={`Category for ${t.merchant}`}
                    onChange={(e) => { if (e.target.value === 'new') { setCreating(t); setNewErr(''); } else changeOne(t, Number(e.target.value)); }}>
                    {cats?.filter((c) => !c.hidden || c.id === t.category_id).map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}{c.kind === 'aside' ? ' (not counted)' : ''}</option>)}
                    <option value="new">＋ New category…</option>
                  </select>
                </span>
                <TxAmount amount={t.amount} />
                <button type="button" className="more-btn" aria-label={`More for ${t.merchant}`} aria-haspopup="dialog" onClick={() => setSheet(t.id)}>⋯</button>
              </div>
              </SwipeRow>
              {editing === t.id && <EditForm t={t} onDone={() => { setEditing(null); reload(); setToast({ text: 'Saved.' }); }} onClose={() => setEditing(null)} />}
              {splitting === t.id && cats && <SplitForm t={t} cats={cats} onDone={() => { setSplitting(null); reload(); }} onClose={() => setSplitting(null)} />}
              </div>
            ))}
          </div>
        ))}
      </section>

      {picked.size > 0 && (
        <div className="bulk">
          <span>{picked.size} selected</span>
          <CategoryPicker cats={cats ?? []} value={bulkCat} onChange={setBulkCat} label="Category to move them to" blank="Choose a category" />
          <button onClick={applyBulk}>Recategorize</button>
          <button onClick={() => setPicked(new Set())}>Clear</button>
        </div>
      )}

      {sheetTx && (
        <Sheet title={`${sheetTx.merchant}  ${sheetTx.amount > 0 ? '+' : ''}${cents(Math.abs(sheetTx.amount))}`} sub={sheetSub(sheetTx)} items={sheetFor(sheetTx)} onClose={() => setSheet(null)}>
          {sheetTx.amount < 0 && sheetTx.kind === 'expense' && sheetTx.deduct_pct > 0 && (
            <label className="sheet-field">Share claimed for {sheetTx.deduct_kind === 'teaching' ? 'teaching' : gig.name}
              <span><input key={sheetTx.deduct_pct} type="number" min="1" max="100" inputMode="decimal" defaultValue={sheetTx.deduct_pct}
                onBlur={(e) => { const v = Number(e.target.value); if (v > 0 && v <= 100 && v !== sheetTx.deduct_pct) claim(sheetTx, v); else e.target.value = String(sheetTx.deduct_pct); }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />%</span>
            </label>
          )}
        </Sheet>
      )}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.actions?.map((a) => <button key={a.label} onClick={a.run}>{a.label}</button>)}
        </div>
      )}
    </div>
  );
}
