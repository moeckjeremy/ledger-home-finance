// The Recurring page's calendar view (2026-11-27): a month with each bill on its day and paydays marked,
// so a crowded week shows at a glance. Each day shows what goes out that day; choosing a day lists its
// bills underneath, which is how it stays usable at a phone's width. It reads only.
import { useState } from 'react';
import { cents, compact, dayShort, money, monthLong, useData } from '../lib';
import { Logo, MoneyInput } from '../ui';

// A short balance for a day's box, with the minus sign ahead of the currency sign.
const short = (n: number) => (n < 0 ? '-' : '') + compact(Math.abs(n));
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const shift = (month: string, by: number) => { const [y, m] = month.split('-').map(Number); const d = new Date(y, m - 1 + by, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

// `addForm` draws the page's own "Add a bill" form for a chosen day, so a bill can be added right here.
export function BillCalendar({ addForm }: { addForm?: (date: string, close: () => void, done: () => void) => React.ReactNode }) {
  const [month, setMonth] = useState(thisMonth());
  const { data: c, reload } = useData<any>(`/api/bills/calendar?month=${month}`);
  const [picked, setPicked] = useState('');
  // The day a bill is being added on, if any.
  const [adding, setAdding] = useState('');
  // The projected checking balance (server/billcalendar.js). Two things can be laid over it, on this device
  // only and never saved: a usual day's spending for each day ahead, and a purchase being tried out.
  const [spend, setSpend] = useState(() => { try { return localStorage.getItem('ledger-cal-spend') === '1'; } catch { return false; } });
  const [testing, setTesting] = useState(false);
  const [buy, setBuy] = useState({ amount: '', date: '' });
  if (!c) return <p className="sub first">Laying out the month…</p>;
  const p = c.proj;
  const buyAmount = testing ? Math.max(0, Number(buy.amount) || 0) : 0;
  const buyDate = buy.date || p?.from || '';
  const dayNo = (date: string) => Math.round((new Date(`${date}T12:00:00`).getTime() - new Date(`${p.from}T12:00:00`).getTime()) / 86400000);
  // A day's balance with whatever is laid over it.
  const shown = (date: string, balance: number, withBuy = true) => balance - (spend ? p.perDay * dayNo(date) : 0) - (withBuy && buyAmount > 0 && date >= buyDate ? buyAmount : 0);
  const lowestOf = (withBuy: boolean) => (p?.series || []).reduce((low: any, s: any) => { const b = shown(s.date, s.balance, withBuy); return !low || b < low.balance ? { date: s.date, balance: b } : low; }, null);
  const low = p ? lowestOf(true) : null, lowPlain = p ? lowestOf(false) : null;
  const tone = (b: number) => (b < 0 ? ' neg' : b < p.low ? ' low' : '');
  // The day shown underneath: the one chosen, else today if it is in this month, else the first day with a bill.
  const chosen = c.days.find((d: any) => d.date === picked) || c.days.find((d: any) => d.date === c.today) || c.days.find((d: any) => d.bills.length) || c.days[0];
  const long = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  return (
    <div className="bill-cal" data-go="bill-calendar">
      <div className="bill-cal-head">
        <button type="button" aria-label="The month before" onClick={() => { setMonth(shift(month, -1)); setPicked(''); }}>‹</button>
        <b>{monthLong(month)}</b>
        <button type="button" aria-label="The month after" onClick={() => { setMonth(shift(month, 1)); setPicked(''); }}>›</button>
        {month !== thisMonth() && <button type="button" className="link" onClick={() => { setMonth(thisMonth()); setPicked(''); }}>This month</button>}
        <span className="grow" />
        <small>{c.count} bill{c.count === 1 ? '' : 's'}, {money(c.total)}</small>
      </div>
      <div className="bill-cal-grid" role="grid" aria-label={`Bills in ${monthLong(month)}`}>
        {DAYS.map((d) => <span key={d} className="bill-cal-dow" role="columnheader">{d}</span>)}
        {Array.from({ length: c.startsOn }, (_, i) => <span key={`b${i}`} className="bill-cal-blank" />)}
        {c.days.map((d: any) => (
          <button key={d.date} type="button" role="gridcell"
            className={`bill-cal-day${d.date === c.today ? ' today' : ''}${d.date === chosen?.date ? ' on' : ''}${d.bills.length ? ' has' : ''}${d.date < c.today ? ' past' : ''}`}
            aria-label={`${long(d.date)}: ${d.bills.length ? `${d.bills.length} bill${d.bills.length === 1 ? '' : 's'}, ${cents(d.total)}` : 'no bills'}${d.pay.length ? `, payday (${d.pay.join(', ')})` : ''}`}
            onClick={() => { setPicked(d.date); if (adding && adding !== d.date) setAdding(''); }}>
            <span className="bill-cal-num">{Number(d.date.slice(8))}{d.pay.length > 0 && <i className="bill-cal-pay" title={`Payday: ${d.pay.join(', ')}`} />}</span>
            {d.bills.length > 0 && <span className="bill-cal-amt">{d.total >= 1000 ? compact(d.total) : money(d.total)}</span>}
            {p && d.balance != null && <span className={`bill-cal-bal${tone(shown(d.date, d.balance))}${low?.date === d.date ? ' lowest' : ''}`} title="Projected checking at the end of this day">{short(shown(d.date, d.balance))}</span>}
            {d.bills.length > 0 && <span className="bill-cal-names">{d.bills.slice(0, 2).map((b: any) => b.name).join(', ')}{d.bills.length > 2 ? ` +${d.bills.length - 2}` : ''}</span>}
          </button>
        ))}
      </div>
      <p className="sub bill-cal-key"><i className="bill-cal-pay" /> a payday{addForm ? <span> · choose a day to see it, or to add a bill on it</span> : null}</p>
      {p && low && (
        <div className="bill-cal-proj" data-go="cal-balance">
          <p className="sub"><b className="bill-cal-bal-key">$</b> The small figure on each day ahead is your <b>projected checking balance</b> at the end of that day, from the bills, card payments and paychecks Ledger knows about. Lowest through {dayShort(p.until)}: <b className={tone(low.balance).trim()}>{money(low.balance)}</b> on {dayShort(low.date)}{low.balance < 0 ? ', which is below zero' : low.balance < p.low ? `, which is under your ${money(p.low)} low-balance line` : ''}.{!spend && ' Everyday spending such as groceries is not in it.'}</p>
          {p.perDay > 0 && <label className="check"><input type="checkbox" checked={spend} onChange={(e) => { setSpend(e.target.checked); try { localStorage.setItem('ledger-cal-spend', e.target.checked ? '1' : '0'); } catch { /* private window */ } }} /> Also take off my usual everyday spending, about {money(p.perDay)} a day</label>}
          {!testing
            ? <div className="add-actions"><button type="button" data-go="cal-test" onClick={() => { setTesting(true); setBuy({ amount: '', date: chosen && chosen.date >= p.from && chosen.date <= p.until ? chosen.date : p.from }); }}>Test a purchase</button></div>
            : (
              <div className="bill-cal-test">
                <b>Test a purchase</b>
                <div className="add-grid">
                  <label className="field"><span>How much</span><MoneyInput value={buy.amount} placeholder="0.00" onChange={(v) => setBuy({ ...buy, amount: v })} /></label>
                  <label className="field"><span>On what day</span><input type="date" value={buyDate} min={p.from} max={p.until} onChange={(e) => setBuy({ ...buy, date: e.target.value && e.target.value >= p.from && e.target.value <= p.until ? e.target.value : buyDate })} /></label>
                </div>
                {buyAmount > 0 && lowPlain && (
                  <p className="sub" role="status">Paid from checking on {dayShort(buyDate)}, {money(buyAmount)} would leave your lowest day at <b className={tone(low.balance).trim()}>{money(low.balance)}</b> on {dayShort(low.date)} (it is {money(lowPlain.balance)} on {dayShort(lowPlain.date)} without it). {low.balance < 0 ? 'That takes checking below zero.' : low.balance < p.low ? `That stays above zero but under your ${money(p.low)} low-balance line.` : `That stays above your ${money(p.low)} low-balance line.`} The calendar above shows it with the purchase.</p>
                )}
                <small>Nothing is saved or added: this only shows what the days ahead would look like. It runs through {dayShort(p.until)}.</small>
                <div className="add-actions"><button type="button" onClick={() => { setTesting(false); setBuy({ amount: '', date: '' }); }}>Done testing</button></div>
              </div>
            )}
        </div>
      )}
      {chosen && (
        <div className="bill-cal-list">
          <h3>{long(chosen.date)}</h3>
          {p && chosen.balance != null && <p className="sub">Projected checking at the end of this day: <b className={tone(shown(chosen.date, chosen.balance)).trim()}>{money(shown(chosen.date, chosen.balance))}</b></p>}
          {(chosen.extra || []).map((e: any, i: number) => (
            <div key={`x${i}`} className="row">
              <Logo name={e.name} fallback={e.kind === 'pay' ? '💵' : '💳'} />
              <span className="grow">{e.name}<small>{e.kind === 'pay' ? (e.aside ? 'Pay kept for taxes, so not counted' : 'Money in') : 'Card payment from checking'}</small></span>
              <span className={`num${e.amount > 0 ? ' good' : ''}`}>{e.estimate ? '~' : ''}{e.amount > 0 ? '+' : ''}{cents(e.amount)}</span>
            </div>
          ))}
          {chosen.pay.length > 0 && <p className="sub good">Payday: {chosen.pay.join(', ')}</p>}
          {chosen.bills.length === 0 && !(chosen.extra || []).length && adding !== chosen.date && <p className="sub">Nothing is due this day.</p>}
          {chosen.bills.map((b: any, i: number) => (
            <div key={i} className="row">
              <Logo name={b.name} fallback={b.icon || '🔁'} />
              <span className="grow">{b.name}{b.pay_url && <small><a className="link" href={b.pay_url} target="_blank" rel="noopener noreferrer">Pay it ↗</a></small>}</span>
              <span className="num">{b.estimate ? '~' : ''}{cents(b.amount)}</span>
            </div>
          ))}
          {addForm && (adding === chosen.date
            ? addForm(chosen.date, () => setAdding(''), () => { setAdding(''); reload(); })
            : <div className="add-actions"><button type="button" data-go="bill-cal-add" onClick={() => setAdding(chosen.date)}>Add a bill on this day</button></div>)}
        </div>
      )}
    </div>
  );
}
