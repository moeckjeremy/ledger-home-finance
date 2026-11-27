// "When your budget month starts" (server/period.js): the day of the month a household's budget resets.
// The 1st unless changed. Shown at the foot of the Budgets page and in Settings, "Budget month".
import { useState } from 'react';
import { api, forgetLoaded, periodLong, setBudgetDay, useData } from './lib';

const ord = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
export const budgetDayWords = (d: number) => (d === 1 ? 'the 1st, with the calendar' : `the ${ord(d)} of each month`);

export function BudgetMonth() {
  const { data } = useData<{ day: number; month: string }>('/api/budget-month');
  const [day, setDay] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!data) return null;
  const chosen = day ?? data.day;
  const save = async () => {
    setBusy(true); setErr('');
    try {
      await api('/api/budget-month', { method: 'PUT', body: { day: chosen } });
      setBudgetDay(chosen);
      forgetLoaded();
      // Every month on screen was cut at the old day: the page is drawn again from scratch.
      location.reload();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <section className="card" data-go="budget-month">
      <p className="sub first">Budgets usually run with the calendar, from the 1st. If your money works around another day, such as payday on the 20th, choose it here and your budget month runs from that day to the day before it in the next month.</p>
      <label className="field" style={{ maxWidth: 320 }}><span>My budget month starts on</span>
        <select value={chosen} disabled={busy} onChange={(e) => setDay(Number(e.target.value))}>
          {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d === 1 ? 'The 1st (the calendar month)' : `The ${ord(d)}`}</option>)}
        </select>
      </label>
      <p className="sub">{data.day === 1 ? 'It follows the calendar now.' : <>It starts on the {ord(data.day)} now: this month is <b>{periodLong(data.month)}</b>.</>} The day stops at the 28th so that every month has one.</p>
      {chosen !== data.day && (
        <>
          <p className="sub"><b>What changes:</b> budgets, what's spent and left, the pace line, carry-over, planning the next month, reports by month, the recap, the summary email and budget alerts all follow the new day. A month is named for the month it starts in{chosen === 1 ? '' : `, so "November" would run from November ${chosen} to December ${chosen - 1}`}. <b>What doesn't:</b> taxes, the bills calendar, the checking forecast and net worth stay on real dates.</p>
          <p className="sub">Earlier months are cut again at the new day, so their totals will shift a little, and categories that carry over start carrying again from this month. Nothing is deleted, and you can change it back.</p>
          <div className="add-actions"><button className="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : chosen === 1 ? 'Go back to the calendar month' : `Start my budget month on the ${ord(chosen)}`}</button><button disabled={busy} onClick={() => setDay(null)}>Never mind</button></div>
        </>
      )}
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  );
}
