// The Recurring page's calendar view (2026-11-27): a month with each bill on its day and paydays marked,
// so a crowded week shows at a glance. Each day shows what goes out that day; choosing a day lists its
// bills underneath, which is how it stays usable at a phone's width. It reads only.
import { useState } from 'react';
import { cents, compact, money, monthLong, useData } from '../lib';
import { Logo } from '../ui';

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
  if (!c) return <p className="sub first">Laying out the month…</p>;
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
            {d.bills.length > 0 && <span className="bill-cal-names">{d.bills.slice(0, 2).map((b: any) => b.name).join(', ')}{d.bills.length > 2 ? ` +${d.bills.length - 2}` : ''}</span>}
          </button>
        ))}
      </div>
      <p className="sub bill-cal-key"><i className="bill-cal-pay" /> a payday{addForm ? <span> · choose a day to see it, or to add a bill on it</span> : null}</p>
      {chosen && (
        <div className="bill-cal-list">
          <h3>{long(chosen.date)}</h3>
          {chosen.pay.length > 0 && <p className="sub good">Payday: {chosen.pay.join(', ')}</p>}
          {chosen.bills.length === 0 && adding !== chosen.date && <p className="sub">Nothing is due this day.</p>}
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
