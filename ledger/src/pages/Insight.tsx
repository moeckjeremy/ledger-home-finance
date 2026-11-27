import { CatIcon } from '../icons';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cents, compact, dayShort, money, monthLong, periodLong, monthShort, useData } from '../lib';
import { Logo, TxAmount, reducedMotion } from '../ui';

// The detail behind each dashboard tile, opened by clicking the tile.
export const INSIGHTS = ['networth', 'spent', 'income', 'saved'] as const;
export type InsightView = (typeof INSIGHTS)[number];

const GROUPS = [
  { title: 'Cash', types: ['checking', 'savings'] },
  { title: 'Investments', types: ['investment'] },
  { title: 'Home and property', types: ['property'] },
  { title: 'Health savings', types: ['hsa'] },
  { title: 'Credit cards', types: ['credit'] },
  { title: 'Loans', types: ['auto', 'loan', 'mortgage'] },
];

const change = (n: number) => `${n >= 0 ? '+' : '-'}${money(Math.abs(n))}`;

function Share({ part, whole, over }: { part: number; whole: number; over?: boolean }) {
  const pct = whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0;
  return <div className="track thin" aria-hidden="true"><div className={over ? 'fill over' : 'fill'} style={{ width: `${pct}%` }} /></div>;
}

function NetWorth({ d }: { d: any }) {
  const assets = d.accounts.filter((a: any) => a.balance > 0).reduce((s: number, a: any) => s + a.balance, 0);
  const debts = d.accounts.filter((a: any) => a.balance < 0).reduce((s: number, a: any) => s - a.balance, 0);
  const known = GROUPS.flatMap((g) => g.types);
  const groups = [...GROUPS, { title: 'Other', types: [...new Set<string>(d.accounts.map((a: any) => a.type))].filter((t) => !known.includes(t)) }];
  return (
    <>
      <section className="card">
        <div className="pace-head">
          <div>
            <div className="label">Net worth today</div>
            <div className="hero">{money(d.netWorth)}</div>
            <div className="sub">What you own, {money(assets)}, less what you owe, {money(debts)}</div>
          </div>
        </div>
        <p className="fine">Balances are as of the last bank sync. The Apple Card and anything else not on the bank feed only change when you update them.</p>
      </section>
      {groups.map((g) => {
        const rows = d.accounts.filter((a: any) => g.types.includes(a.type));
        if (!rows.length) return null;
        const total = rows.reduce((s: number, a: any) => s + a.balance, 0);
        return (
          <section className="card" key={g.title}>
            <div className="card-head"><h2>{g.title}</h2><b className="num">{money(total)}</b></div>
            {rows.map((a: any) => {
              const moved = a.first == null ? null : a.balance - a.first;
              return (
                <div className="row" key={a.id}>
                  <Logo edit as={`account ${a.id}`} also={[a.name, `${a.name} payment`]} name={`${a.institution || ''} ${a.name}`} fallback="🏦" />
                  <span className="grow">{a.name}
                    <small>{a.institution || 'Added by you'}{moved != null && Math.abs(moved) >= 0.01 ? <> · <span className={moved >= 0 ? 'good' : 'bad'}>{change(moved)}</span> since {dayShort(a.since)}</> : ''}</small>
                  </span>
                  <span className="num">{cents(a.balance)}</span>
                </div>
              );
            })}
          </section>
        );
      })}
    </>
  );
}

function Spent({ d }: { d: any }) {
  const diff = d.spent - d.spentLast;
  const prevName = monthLong(d.prevMonth).split(' ')[0];
  return (
    <>
      <section className="card">
        <div className="label">{d.isCurrent ? 'Spent so far this month' : `Spent in ${periodLong(d.month)}`}</div>
        <div className="hero">{money(d.spent)}</div>
        <div className="sub">
          {Math.round((d.spent / (d.budget || 1)) * 100)}% of the {money(d.budget)} budget ·{' '}
          <span className={diff <= 0 ? 'good' : 'bad'}>{money(Math.abs(diff))} {diff <= 0 ? 'less' : 'more'}</span> than {d.isCurrent ? `by this point in ${prevName}` : prevName} ({money(d.spentLast)})
        </div>
        <p className="fine">Counts purchases in spending categories, on any account, on the day they were charged. Card payments and transfers between your accounts are left out so nothing is counted twice.</p>
      </section>
      <section className="card">
        <div className="card-head"><h2>By category</h2><a href="#budgets">Budgets</a></div>
        {d.categories.map((c: any) => {
          const over = c.budget > 0 && c.spent > c.budget;
          const delta = c.spent - c.last;
          return (
            <div className="row" key={c.id}>
              <CatIcon icon={c.icon} edit={{ id: c.id, name: c.name }} />
              <span className="grow wrap">{c.name}
                <small>
                  {c.budget > 0 ? <span className={over ? 'bad' : ''}>{over ? `${money(c.spent - c.budget)} over` : `${money(c.budget - c.spent)} left`} of {money(c.budget)}</span> : 'No budget set'}
                  {Math.abs(delta) >= 1 ? <> · {money(Math.abs(delta))} {delta > 0 ? 'more' : 'less'} than {prevName}</> : null}
                </small>
                <Share part={c.spent} whole={c.budget || c.spent} over={over} />
              </span>
              <span className="num">{money(c.spent)}<small className="sub">{d.spent > 0 ? `${Math.round((c.spent / d.spent) * 100)}%` : ''}</small></span>
            </div>
          );
        })}
      </section>
      <div className="split two">
        <section className="card">
          <div className="card-head"><h2>Where it went most</h2></div>
          {d.merchants.map((m: any) => (
            <div className="row" key={m.merchant}>
              <Logo edit name={m.merchant} fallback={m.icon} />
              <span className="grow">{m.merchant}<small>{m.n} {m.n === 1 ? 'purchase' : 'purchases'}</small></span>
              <span className="num">{cents(m.total)}</span>
            </div>
          ))}
        </section>
        <section className="card">
          <div className="card-head"><h2>Largest purchases</h2><a href="#transactions">All transactions</a></div>
          {d.largest.map((t: any) => (
            <div className="row" key={t.id}>
              <Logo edit name={t.merchant} fallback={t.icon} />
              <span className="grow">{t.merchant}<small>{dayShort(t.date)} · {t.category}{t.pending ? ' · pending' : ''}{t.waiting ? ' · waiting for the bank' : ''}</small></span>
              <span className="num">{cents(-t.amount)}</span>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}

function Income({ d }: { d: any }) {
  const diff = d.income - d.incomeLast;
  const prevName = monthLong(d.prevMonth).split(' ')[0];
  return (
    <>
      <section className="card">
        <div className="label">{d.isCurrent ? 'Income so far this month' : `Income in ${periodLong(d.month)}`}</div>
        <div className="hero">{money(d.income)}</div>
        <div className="sub">
          <span className={diff >= 0 ? 'good' : 'bad'}>{money(Math.abs(diff))} {diff >= 0 ? 'more' : 'less'}</span> than {d.isCurrent ? `by this point in ${prevName}` : prevName} ({money(d.incomeLast)})
          {d.isCurrent ? <> · {prevName} finished at {money(d.incomeLastFull)}</> : null}
        </div>
        <p className="fine">These are deposits as they reached the bank, so paychecks are after tax and deductions. Transfers between your own accounts aren't income.</p>
      </section>
      <section className="card">
        <div className="card-head"><h2>By source</h2></div>
        {d.sources.length === 0 && <p className="sub first">No income yet this month.</p>}
        {d.sources.map((r: any) => (
          <div className="row" key={`${r.merchant}|${r.category}`}>
            <Logo edit name={r.merchant} fallback={r.icon} />
            <span className="grow wrap">{r.merchant}
              <small>{r.category} · {r.n} {r.n === 1 ? 'deposit' : 'deposits'}</small>
              <Share part={r.total} whole={d.income} />
            </span>
            <span className="num good">{cents(r.total)}<small className="sub">{d.income > 0 ? `${Math.round((r.total / d.income) * 100)}%` : ''}</small></span>
          </div>
        ))}
      </section>
      <section className="card">
        <div className="card-head"><h2>Each deposit</h2></div>
        {d.deposits.map((t: any) => (
          <div className="row" key={t.id}>
            <Logo edit name={t.merchant} fallback={t.icon} />
            <span className="grow">{t.merchant}<small>{dayShort(t.date)} · {t.category} · {t.account}</small></span>
            <TxAmount amount={t.amount} />
          </div>
        ))}
      </section>
    </>
  );
}

function Saved({ d }: { d: any }) {
  const saved = d.income - d.spent;
  const history = d.cashflow.map((m: any) => ({ month: m.month, saved: Math.round(m.income - m.spending) }));
  const over = d.categories.filter((c: any) => c.budget > 0 && c.spent > c.budget).sort((a: any, b: any) => (b.spent - b.budget) - (a.spent - a.budget));
  return (
    <>
      <section className="card">
        <div className="label">{saved >= 0 ? 'Saved' : 'Overspent'} {d.isCurrent ? 'so far this month' : `in ${periodLong(d.month)}`}</div>
        <div className={`hero ${saved >= 0 ? '' : 'bad'}`}>{money(Math.abs(saved))}</div>
        <div className="sub">{d.income > 0 ? `${Math.abs(Math.round((saved / d.income) * 100))}% of income ${saved >= 0 ? 'kept' : 'spent beyond what came in'}` : 'No income yet this month'}</div>
        {d.isCurrent && <p className="fine">This is income received so far less spending so far, so it swings with the calendar: it looks worse just before a payday and better just after one.</p>}
      </section>
      <section className="card">
        <div className="card-head"><h2>How it adds up</h2></div>
        <div className="row"><span className="grow">Income<small>Deposits received</small></span><a className="num good" href="#dashboard/income">+{cents(d.income)}</a></div>
        <div className="row"><span className="grow">Bills<small>Categories marked as fixed bills</small></span><span className="num">-{cents(d.fixedSpent)}</span></div>
        <div className="row"><span className="grow">Everything else<small>Groceries, eating out, shopping and the rest</small></span><a className="num" href="#dashboard/spent">-{cents(d.flexSpent)}</a></div>
        <div className="row total"><span className="grow">{saved >= 0 ? 'Saved' : 'Overspent'}</span><span className={`num ${saved >= 0 ? 'good' : 'bad'}`}>{cents(Math.abs(saved))}</span></div>
      </section>
      <section className="card">
        <div className="card-head"><h2>Month by month</h2></div>
        <div className="chart" style={{ height: 220 }}>
          <ResponsiveContainer>
            <BarChart data={history} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: 'var(--axis)' }} tick={{ fill: 'var(--ink3)', fontSize: 12 }} tickFormatter={monthShort} />
              <YAxis width={48} tickLine={false} axisLine={false} tick={{ fill: 'var(--ink3)', fontSize: 12 }} tickFormatter={compact} tickCount={5} />
              <Tooltip
                cursor={{ fill: 'var(--hover)' }}
                content={({ active, payload }: any) =>
                  active && payload?.length ? (
                    <div className="tip">
                      <div className="tip-title">{periodLong(payload[0].payload.month)}</div>
                      <div className="tip-row"><span>{payload[0].value >= 0 ? 'Saved' : 'Overspent'}</span><b>{money(Math.abs(payload[0].value))}</b></div>
                    </div>
                  ) : null
                }
              />
              <Bar dataKey="saved" radius={[4, 4, 0, 0]} isAnimationActive={!reducedMotion()} animationDuration={700}>
                {history.map((h: any) => <Cell key={h.month} fill={h.saved >= 0 ? 'var(--good)' : 'var(--bad)'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section className="card">
        <div className="card-head"><h2>Categories over budget</h2><a href="#budgets">Budgets</a></div>
        {over.length === 0 && <p className="sub first">Nothing is over its budget{d.isCurrent ? ' so far' : ''}.</p>}
        {over.map((c: any) => (
          <div className="row" key={c.id}>
            <CatIcon icon={c.icon} edit={{ id: c.id, name: c.name }} />
            <span className="grow">{c.name}<small>{money(c.spent)} of {money(c.budget)}</small></span>
            <span className="num bad">{money(c.spent - c.budget)} over</span>
          </div>
        ))}
      </section>
    </>
  );
}

export default function Insight({ month, view }: { month: string; view: InsightView }) {
  const { data: d, error } = useData(`/api/insight?month=${month}`);
  const saved = d ? d.income - d.spent >= 0 : true;
  const tabs: [InsightView, string][] = [['networth', 'Net worth'], ['spent', 'Spent'], ['income', 'Income'], ['saved', saved ? 'Saved' : 'Overspent']];
  return (
    <div className="stack">
      <nav className="crumbs" aria-label="Dashboard details">
        <a href="#dashboard">‹ Dashboard</a>
        <span className="seg">
          {tabs.map(([id, label]) => <a key={id} href={`#dashboard/${id}`} className={view === id ? 'on' : ''} aria-current={view === id ? 'page' : undefined}>{label}</a>)}
        </span>
      </nav>
      {error && <p className="error">{error}</p>}
      {d && view === 'networth' && <NetWorth d={d} />}
      {d && view === 'spent' && <Spent d={d} />}
      {d && view === 'income' && <Income d={d} />}
      {d && view === 'saved' && <Saved d={d} />}
    </div>
  );
}
