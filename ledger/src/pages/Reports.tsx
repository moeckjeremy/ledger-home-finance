import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { compact, money, periodLong, monthShort, useData, useOwners } from '../lib';
import { useState } from 'react';
import { Logo, Skeleton, reducedMotion } from '../ui';
import { FlowCard } from './Flow';

const OTHER = { id: 0, name: 'Everything else', color: 'var(--ink3)', icon: '📦' };

export default function Reports() {
  const owners = useOwners();
  const [who, setWho] = useState('');
  const { data, error } = useData(`/api/reports${who ? `?who=${who}` : ''}`);
  const { data: cats } = useData<any[]>('/api/categories');
  if (error) return <p className="error">{error}</p>;
  if (!data || !cats) return <Skeleton tiles={4} cards={1} rows={8} />;

  const months: any[] = data.months.slice(-12);
  const totals: Record<number, number> = {};
  for (const m of months) for (const [id, v] of Object.entries(m.byCategory)) totals[+id] = (totals[+id] || 0) + (v as number);
  const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([id]) => cats.find((c) => c.id === +id)).filter(Boolean);
  // Six named series plus "everything else" keeps the stack readable.
  const series = [...ranked.slice(0, 6), OTHER];
  const topIds = new Set(ranked.slice(0, 6).map((c: any) => c.id));
  const rows = months.map((m) => {
    const row: any = { month: m.month, total: m.total, c0: 0 };
    for (const [id, v] of Object.entries(m.byCategory)) {
      if (topIds.has(+id)) row[`c${id}`] = v;
      else row.c0 = Math.round((row.c0 + (v as number)) * 100) / 100;
    }
    return row;
  });
  const full = months.slice(0, -1);
  const avg = full.reduce((a, m) => a + m.total, 0) / (full.length || 1);
  const high = [...full].sort((a, b) => b.total - a.total)[0];
  const low = [...full].sort((a, b) => a.total - b.total)[0];

  return (
    <div className="stack">
      {owners.marked && (
        <div className="owner-filter">
          <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Whose spending">
            <option value="">Everyone's spending</option>
            {owners.list.map((w) => <option key={w} value={w}>{owners.possessive(w)} accounts</option>)}
          </select>
        </div>
      )}
      <section className="tiles">
        <div className="tile"><div className="label">Average month</div><div className="value">{money(avg)}</div><div className="sub">last {full.length} full months</div></div>
        <div className="tile"><div className="label">Highest month</div><div className="value">{money(high?.total ?? 0)}</div><div className="sub">{high ? periodLong(high.month) : ''}</div></div>
        <div className="tile"><div className="label">Lowest month</div><div className="value">{money(low?.total ?? 0)}</div><div className="sub">{low ? periodLong(low.month) : ''}</div></div>
        <div className="tile"><div className="label">Past 12 months</div><div className="value">{money(months.reduce((a, m) => a + m.total, 0))}</div><div className="sub">total spending</div></div>
      </section>

      <FlowCard months={months.map((m) => m.month)} who={who} />

      <section className="card">
        <div className="card-head">
          <h2>Spending by category</h2>
          <div className="legend">
            {series.map((c: any) => <span key={c.id}><i style={{ background: c.color }} />{c.name}</span>)}
          </div>
        </div>
        <div className="chart" style={{ height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={rows} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: 'var(--axis)' }} tick={{ fill: 'var(--ink3)', fontSize: 12 }} tickFormatter={monthShort} />
              <YAxis width={44} tickLine={false} axisLine={false} tick={{ fill: 'var(--ink3)', fontSize: 12 }} tickFormatter={compact} tickCount={5} />
              <Tooltip
                cursor={{ fill: 'var(--hover)' }}
                content={({ active, payload, label }: any) =>
                  active && payload?.length ? (
                    <div className="tip">
                      <div className="tip-title">{periodLong(label)} · {money(payload[0].payload.total)}</div>
                      {[...payload].reverse().map((p: any) => (
                        <div key={p.dataKey} className="tip-row"><span><i style={{ background: p.color }} />{p.name}</span><b>{money(p.value)}</b></div>
                      ))}
                    </div>
                  ) : null
                }
              />
              {series.map((c: any) => (
                <Bar key={c.id} name={c.name} dataKey={`c${c.id}`} stackId="s" fill={c.color} stroke="var(--panel)" strokeWidth={1} maxBarSize={28} isAnimationActive={!reducedMotion()} animationDuration={700} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="cols">
        <section className="card">
          <div className="card-head"><h2>Category averages</h2></div>
          <table className="table">
            <thead><tr><th>Category</th><th className="r">Per month</th><th className="r">Budget</th></tr></thead>
            <tbody>
              {ranked.map((c: any) => {
                const a = totals[c.id] / months.length;
                return (
                  <tr key={c.id}>
                    <td>{c.icon} {c.name}</td>
                    <td className={`r num ${a > c.budget ? 'bad' : ''}`}>{money(a)}</td>
                    <td className="r num sub">{money(c.budget)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        <section className="card">
          <div className="card-head"><h2>Top merchants</h2><span className="sub">Past 3 months</span></div>
          <table className="table">
            <thead><tr><th>Merchant</th><th className="r">Visits</th><th className="r">Total</th></tr></thead>
            <tbody>
              {data.merchants.map((m: any) => (
                <tr key={m.merchant}><td><span className="with-logo"><Logo edit name={m.merchant} fallback={m.icon} />{m.merchant}</span></td><td className="r num sub">{m.count}</td><td className="r num">{money(m.total)}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
