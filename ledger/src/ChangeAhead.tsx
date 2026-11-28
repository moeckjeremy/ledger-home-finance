// "Its amount is changing": a bill or a paycheck told that its amount changes from a day ahead
// (server/changes.js). Until that day nothing changes; from it on the forecast and the bills calendar use
// the new amount. The waiting changes are listed with Remove, and the form opens when the row asks for it.
import { useState } from 'react';
import { api, cents, dayShort } from './lib';
import { MoneyInput } from './ui';

export type Ahead = { id: number; from: string; amount: number };

const tomorrow = () => { const d = new Date(Date.now() + 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const year = (date: string) => (date.slice(0, 4) === String(new Date().getFullYear()) ? '' : `, ${date.slice(0, 4)}`);

export function ChangeAhead({ kind, name, id, changes, open, onClose, onChanged }: { kind: 'bill' | 'pay'; name?: string; id?: number; changes?: Ahead[]; open: boolean; onClose: () => void; onChanged: () => void }) {
  const [amount, setAmount] = useState('');
  const [from, setFrom] = useState('');
  const [err, setErr] = useState('');
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    try { await api('/api/changes', { method: 'POST', body: { kind, name, id, from, amount: Number(amount) } }); setAmount(''); setFrom(''); onClose(); onChanged(); }
    catch (e: any) { setErr(e.message); }
  };
  const remove = async (c: Ahead) => { try { await api(`/api/changes/${c.id}`, { method: 'DELETE' }); onChanged(); } catch { /* it stays listed */ } };
  return (
    <>
      {(changes || []).map((c) => (
        <small key={c.id} className="change-ahead">{kind === 'pay' ? 'Each one becomes' : 'Changes to'} <b>{cents(c.amount)}</b> from {dayShort(c.from)}{year(c.from)} · <button type="button" className="link" onClick={() => remove(c)}>Remove</button></small>
      ))}
      {open && (
        <form className="bill-rename change-form" onSubmit={save} noValidate>
          <label>{kind === 'pay' ? 'New amount each time' : 'New amount'}<MoneyInput value={amount} placeholder="0.00" onChange={(v) => { setAmount(v); setErr(''); }} /></label>
          <label>Starting on<input type="date" value={from} min={tomorrow()} onChange={(e) => { setFrom(e.target.value); setErr(''); }} /></label>
          <button type="submit" className="primary" disabled={!amount || !from}>Save</button>
          <button type="button" onClick={() => { setErr(''); onClose(); }}>Cancel</button>
        </form>
      )}
      {open && err && <small className="bad" role="alert">{err}</small>}
      {open && <small>{kind === 'pay' ? 'For a raise or a change you know is coming. Until that day nothing changes; from it on, the forecast and the bills calendar count each one at the new amount.' : 'For a price rise or a new rate you know is coming. Until that day nothing changes; from it on, the forecast and the bills calendar use the new amount.'}</small>}
    </>
  );
}
