import { GO, jump } from '../go';
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useEffect, useState } from 'react';
import { api, cents, compact, dayShort, daysUntil, money, periodLong, monthShort, signed, useData, useGig, lastLoaded, noteLoaded } from '../lib';
import { GoalsMini } from './Goals';
import { Logo, Meter, NumField, Roll, Skeleton, TxAmount, reducedMotion, isPhone } from '../ui';
import { celebrate, once } from '../celebrate';

function Tip({ active, payload, label, title }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tip">
      <div className="tip-title">{title ? title(label) : label}</div>
      {payload.filter((p: any) => p.value != null).map((p: any) => (
        <div key={p.dataKey} className="tip-row">
          <span><i style={{ background: p.color }} />{p.name}</span>
          <b>{money(p.value)}</b>
        </div>
      ))}
    </div>
  );
}

/** Progress toward the month's class goal, for a side gig paid by booked classes (VIPKid). */
function VipkidGoal() {
  const gig = useGig();
  return gig.classes ? <ClassGoal name={gig.name} /> : null;
}
function ClassGoal({ name }: { name: string }) {
  const { data: v, reload } = useData('/api/vipkid');
  if (!v) return null;
  const g = v.goal;
  if (!v.connected) {
    return (
      <section className="card">
        <div className="card-head"><h2>{name} class goal</h2></div>
        <p className="sub first">
          Your goal is {g.target} class units a month, worth about {money(g.payAtGoal)}. <a href="#connections" onClick={jump(GO.classCalendar)}>Connect your {name} calendar</a> to track progress here.
        </p>
      </section>
    );
  }
  const pct = Math.min(100, (g.booked / g.target) * 100), taughtPct = Math.min(100, (g.taught / g.target) * 100);
  return (
    <section className="card">
      <div className="card-head"><h2>{name} class goal</h2><span className="sub">{g.daysLeft} day{g.daysLeft === 1 ? '' : 's'} left</span></div>
      <div className="outlook-top">
        <div><div className="label">Taught and booked</div><div className="value">{g.booked} <span className="sub">of {g.target}</span></div></div>
        <div><div className="label">Earned if you hit it</div><div className="value">{money(g.payAtGoal)}</div></div>
      </div>
      <div className="track tall goal" role="img" aria-label={`${g.taught} classes taught and ${g.booked - g.taught} more booked, of a goal of ${g.target}`}>
        <div className="fill booked" style={{ width: `${pct}%` }} />
        <div className="fill" style={{ width: `${taughtPct}%` }} />
      </div>
      <p className="sub">
        {g.taught} taught, {g.booked - g.taught} more booked, worth {money(g.payBooked)} so far. A 50-minute class counts as two.{' '}
        {g.remaining > 0
          ? <>You need <b>{g.remaining} more</b>, about {g.perDay} a day for the rest of the month.</>
          : <b className="good">Goal reached.</b>}
      </p>
      <div className="add-grid">
        <NumField label="Monthly class goal" value={g.target} onSave={async (t) => { await api('/api/vipkid/goal', { method: 'POST', body: { target: t } }); reload(); }} />
        {(g.trackedFrom || g.taughtBefore > 0) && (
          <NumField
            label="Already taught this month" value={g.taughtBefore}
            hint={g.trackedFrom ? `Classes before ${dayShort(g.trackedFrom)}, which the calendar doesn't list` : 'Classes the calendar didn\'t list'}
            onSave={async (n) => { await api('/api/vipkid/goal', { method: 'POST', body: { taughtBefore: n } }); reload(); }}
          />
        )}
      </div>
    </section>
  );
}

/** One bill or paycheck in the outlook. Its amount and its date can be changed when you know the real ones. */
function OutlookRow({ e, today, tone, onChanged }: { e: any; today: string; tone: (n: number) => string; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState('');
  const [d, setD] = useState('');
  const [err, setErr] = useState('');
  // The app's own date for the row is what a change is filed under, wherever the row has been moved to.
  const key = e.key || e.date;
  // The bank's feed can't say that a bill is already pending on checking; this tells the app so it isn't taken out twice.
  const markPending = async () => {
    try { await api('/api/cashflow/pending', { method: 'POST', body: { name: e.name, amount: Math.abs(e.amount) } }); setErr(''); onChanged(); } catch (x: any) { setErr(x.message); }
  };
  const save = async (amount: string | null) => {
    if (amount !== null && (amount.trim() === '' || !(Number(amount) >= 0))) return setErr('Enter an amount of 0 or more.');
    if (amount !== null && !d) return setErr('Choose a date.');
    try {
      // Reset puts both back. Saving sends the amount only when it differs from the app's own figure.
      const body: any = { kind: e.kind, name: e.name, date: key, to: amount === null ? null : d };
      if (amount === null) body.amount = null;
      else if (e.set || Number(amount) !== Math.abs(e.amount)) body.amount = Number(amount);
      await api('/api/cashflow/amount', { method: 'PUT', body });
      setEditing(false); setErr('');
      onChanged();
    } catch (x: any) {
      setErr(x.message);
    }
  };
  return (
    <div className={`row ${e.kind === 'pay' ? 'payrow' : ''}`}>
      <Logo edit name={e.name} fallback={e.icon} />
      <span className="grow wrap">
        {e.name}
        <small>
          {e.date === today ? 'Today' : dayShort(e.date)}
          {e.estimate ? ' · estimate' : ''}{e.set ? ` · set by you (the app had ${cents(e.usual)})` : ''}{e.usualDate ? ` · moved by you from ${dayShort(e.usualDate)}` : ''}{!e.set && e.note ? ` · ${e.note}` : ''}{e.aside ? ' · moved to tax savings, not counted' : ''}{e.onCard ? ' · charged to a card' : ''}{e.alreadyOut ? ' · pending at the bank, already taken out' : ''}{e.kind === 'card' ? ' · card payment' : ''}
          {!editing && <> · <button className="link" onClick={() => { setV(String(Math.abs(e.amount))); setD(e.date); setErr(''); setEditing(true); }} aria-label={`Change the amount or date for ${e.name}`}>Change</button></>}
          {!editing && e.kind === 'bill' && !e.onCard && !e.alreadyOut && e.date <= today && <> · <button className="link" onClick={markPending} aria-label={`${e.name} is pending at the bank`}>It's pending at the bank</button></>}
          {!editing && (e.set || e.usualDate) && <> · <button className="link" onClick={() => save(null)} aria-label={`Go back to the app's amount and date for ${e.name}`}>Reset</button></>}
        </small>
        {err && <small className="bad" role="alert">{err}</small>}
      </span>
      {editing ? (
        <form className="outlook-edit" onSubmit={(x) => { x.preventDefault(); save(v); }}>
          <input type="number" min="0" step="0.01" inputMode="decimal" value={v} autoFocus aria-label={`Amount for ${e.name}`}
            onChange={(x) => setV(x.target.value)} onFocus={(x) => x.target.select()} onKeyDown={(x) => x.key === 'Escape' && setEditing(false)} />
          <input type="date" value={d} min={today} aria-label={`Date for ${e.name}`} onChange={(x) => setD(x.target.value)} onKeyDown={(x) => x.key === 'Escape' && setEditing(false)} />
          <button type="submit" className="primary">Save</button>
          <button type="button" onClick={() => setEditing(false)}>Cancel</button>
        </form>
      ) : (
        <span style={{ textAlign: 'right' }}>
          <span className={`num ${e.amount > 0 ? 'good' : ''}`}>{e.amount > 0 ? '+' : ''}{cents(Math.abs(e.amount))}</span>
          <small className={e.onCard || e.alreadyOut || e.aside ? '' : tone(e.balance)}>{e.onCard || e.alreadyOut || e.aside ? 'no change' : `${e.balance < 0 ? '-' : ''}${cents(Math.abs(e.balance))}`}</small>
        </span>
      )}
    </div>
  );
}

// The dashboard's cards, for "Choose what shows here". The choice is kept on this device
// (localStorage `ledger-dash-hidden`, a list of the ids switched off), like the Appearance settings,
// so a phone and a computer can show different things.
const CARDS: [id: string, name: string, what: string][] = [
  ['glance', 'At a glance', 'Left before payday, in checking now, spent of budget'],
  ['recap', 'Recap', 'The short written summary'],
  ['totals', 'Month totals', 'Net worth, spent, income and saved'],
  ['pace', 'Spending pace', 'The chart of this month against your budget'],
  ['cashflow', 'Cash flow', 'Income and spending over the months'],
  ['recent', 'Recent', 'The latest transactions'],
  ['budgets', 'Budgets', 'The categories closest to their limit'],
  ['goals', 'Savings goals', 'Shown once you have a goal'],
  ['classes', 'Class goal', 'Only for a side gig paid by booked classes'],
  ['outlook', 'Bank balance outlook', 'Bills and paychecks coming up'],
];
/** What a phone shows before "Show more". */
const FIRST = ['glance', 'outlook', 'recent'];
function readHidden(): string[] {
  try { const v = JSON.parse(localStorage.getItem('ledger-dash-hidden') || '[]'); return Array.isArray(v) ? v.filter((x) => CARDS.some((c) => c[0] === x)) : []; } catch { return []; }
}
function readOrder(): string[] {
  try { const v = JSON.parse(localStorage.getItem('ledger-dash-order') || '[]'); return Array.isArray(v) ? v.filter((x) => CARDS.some((c) => c[0] === x)) : []; } catch { return []; }
}
/** The saved order, with any card it doesn't mention (one added since) after it in the usual place. */
const fullOrder = (order: string[]) => [...order, ...PHONE_ORDER.filter((id) => !order.includes(id))];
/** The order a phone shows the cards in when none has been chosen. */
const PHONE_ORDER = ['glance', 'outlook', 'recap', 'totals', 'pace', 'cashflow', 'recent', 'budgets', 'goals', 'classes'];
/** One card of the dashboard. With a place, it is wrapped so the phone's own order can be applied to it. */
function Slot({ at, children }: { at?: number; children: React.ReactNode }) {
  return at == null ? <>{children}</> : <div className="dash-slot" style={{ order: at }}>{children}</div>;
}
function DashChooser({ hidden, onChange, order, onOrder, phone }: { hidden: string[]; onChange: (h: string[]) => void; order: string[]; onOrder: (o: string[]) => void; phone: boolean }) {
  const [open, setOpen] = useState(false);
  const set = (id: string, on: boolean) => {
    const next = on ? hidden.filter((x) => x !== id) : [...hidden, id];
    try { localStorage.setItem('ledger-dash-hidden', JSON.stringify(next)); } catch { /* private window: lasts until reload */ }
    onChange(next);
  };
  const shift = (id: string, by: number) => {
    const next = fullOrder(order); const at = next.indexOf(id), to = at + by;
    if (to < 0 || to >= next.length) return;
    [next[at], next[to]] = [next[to], next[at]];
    try { localStorage.setItem('ledger-dash-order', JSON.stringify(next)); } catch { /* private window: lasts until reload */ }
    onOrder(next);
  };
  if (!open) return <p className="dash-choose"><button className="link" onClick={() => setOpen(true)}>Choose what shows here</button>{hidden.length > 0 && <small> · {hidden.length} hidden</small>}</p>;
  return (
    <section className="card dash-chooser">
      <div className="card-head"><h2>What shows on your dashboard</h2><button className="link" onClick={() => setOpen(false)}>Done</button></div>
      <p className="sub first">Switch off anything you don't use. This is remembered on this device only, so your phone and computer can differ.</p>
      {phone && <p className="sub">The arrows put the cards in your own order on this phone.</p>}
      {(phone ? fullOrder(order).map((id) => CARDS.find((c) => c[0] === id)!) : CARDS).map(([id, name, what], i, list) => (
        <div key={id} className="row check dash-pick">
          {phone && <span className="order-move"><button type="button" className="link" disabled={i === 0} aria-label={`Move ${name} up`} onClick={() => shift(id, -1)}>↑</button><button type="button" className="link" disabled={i === list.length - 1} aria-label={`Move ${name} down`} onClick={() => shift(id, 1)}>↓</button></span>}
          <label className="grow dash-pick-name"><span className="grow">{name}<small>{what}</small></span><input type="checkbox" checked={!hidden.includes(id)} onChange={(e) => set(id, e.target.checked)} /></label>
        </div>
      ))}
      {phone && order.length > 0 && <p><button className="link" onClick={() => { try { localStorage.removeItem('ledger-dash-order'); } catch { /* nothing kept */ } onOrder([]); }}>Back to the usual order</button></p>}
      {hidden.length > 0 && <p><button className="link" onClick={() => { try { localStorage.removeItem('ledger-dash-hidden'); } catch { /* nothing kept */ } onChange([]); }}>Show everything</button></p>}
    </section>
  );
}

/** What's in checking today, and where it's headed through the next paydays. */
const tone = (n: number) => (n < 0 ? 'bad' : n < 200 ? 'warn' : '');
const dollars = (n: number) => `${n < 0 ? '-' : ''}${cents(Math.abs(n))}`;

function Outlook({ o, reload }: { o: any; reload: () => void }) {
  const gig = useGig();
  const [all, setAll] = useState(false);
  if (!o) return <section className="card skel" id="outlook"><i className="big" style={{ width: '40%' }} /><i style={{ width: '80%' }} /><i style={{ width: '65%' }} /><i style={{ width: '72%' }} /></section>;
  const pay = o.nextPayday;
  // The next five, or everything up to payday if that's more.
  const beforePay = pay ? o.events.filter((e: any) => e.date < pay.date).length : 0;
  const shown = all ? o.events : o.events.slice(0, Math.max(5, beforePay + 1));
  return (
    <section className="card" id="outlook">
      <div className="card-head"><h2>Bank balance outlook</h2><a href="#recurring">All bills</a></div>
      <div className="outlook-top">
        {pay && (
          <div>
            <div className="label">Forecast before payday, {dayShort(pay.date)}</div>
            <div className={`value ${tone(o.beforePayday)}`}><Roll value={o.beforePayday} format={dollars} /></div>
          </div>
        )}
        <div className={pay ? 'now' : ''}>
          <div className="label">In checking now</div>
          <div className="value"><Roll value={o.balance} format={dollars} /></div>
          {bankRead(o) && <small>Last update: {bankRead(o)}<br /></small>}
          {nextRead(o) && <small>Next update: {nextRead(o)}<br /></small>}
          <small><a href="#transactions">See how this is worked out</a></small>
        </div>
      </div>
      {pay && (
        <p className="sub first">
          What should be left in checking once the bills below come out{o.estimatedIncomeBeforePayday > 0 ? `, counting about ${money(o.estimatedIncomeBeforePayday)} expected from ${gig.name}` : ''}.
          {o.taxHold?.active && <> {gig.name} pay isn't counted: you move it to {o.taxHold.account} until that holds {money(o.taxHold.target)} for taxes (now {money(o.taxHold.saved)}).</>}
          {o.typicalSpendPerDay > 0 && o.daysToPayday > 0 && (
            <> Your usual day-to-day spending of about {money(o.typicalSpendPerDay)} a day would leave roughly{' '}
              <b className={tone(o.afterTypicalSpending)}>{o.afterTypicalSpending < 0 ? '-' : ''}{money(Math.abs(o.afterTypicalSpending))}</b>.</>
          )}
        </p>
      )}
      {o.events.length === 0 && <p className="sub first">Nothing scheduled in the next three weeks.</p>}
      {shown.map((e: any) => (
        <OutlookRow key={`${e.kind}|${e.name}|${e.date}|${e.amount}`} e={e} today={o.today} tone={tone} onChanged={reload} />
      ))}
      {o.events.length > shown.length && <button className="show-all" onClick={() => setAll(true)}>Show all {o.events.length}</button>}
      {all && o.events.length > 5 && <button className="show-all" onClick={() => setAll(false)}>Show fewer</button>}
      <small style={{ marginTop: 8 }}>
        The small figure under each amount is the checking balance after it. If you know what a bill or paycheck will really be, or that it will come on a different day, choose Change on its row and the forecast follows; it applies to that one bill or payday, not later ones. The forecast starts from what's in checking now: the bank's posted balance less pending purchases and any you've entered or scanned.
      </small>
    </section>
  );
}

/** A short written summary of the month, refreshed once a day. */
function Recap({ month }: { month: string }) {
  // The recap last shown for this month appears at once, so the card doesn't grow after the page is up.
  const url = `/api/recap?month=${month}`;
  const [r, setR] = useState<any>(() => lastLoaded(url) ?? null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setR(lastLoaded(url) ?? null);
    api(url).then((d) => { noteLoaded(url, d); if (live) setR(d); }).catch(() => live && setR({ text: '', failed: true }));
    return () => { live = false; };
  }, [month]);
  const refresh = async () => {
    setBusy(true);
    try { const d = await api(`/api/recap/refresh?month=${month}`, { method: 'POST' }); noteLoaded(url, d); setR(d); } catch { /* keep the old one */ }
    setBusy(false);
  };
  if (r?.failed) return null;
  const blocks = (r?.text ?? '').split(/\n\s*\n/).filter(Boolean);
  return (
    <section className="card recap" aria-live="polite">
      <div className="card-head">
        <h2>Recap</h2>
        {r && <button className="link" onClick={refresh} disabled={busy}>{busy ? 'Writing…' : 'Refresh'}</button>}
      </div>
      {!r && <p className="sub first">Writing today's recap…</p>}
      {blocks.map((b: string, i: number) => {
        const lines = b.split('\n');
        return lines.every((l) => l.startsWith('- '))
          ? <ul key={i}>{lines.map((l, j) => <li key={j}>{l.slice(2)}</li>)}</ul>
          : <p key={i}>{b}</p>;
      })}
      {r?.review?.count > 0 && (
        <p><a href="#transactions/review">Review {r.review.count} transaction{r.review.count === 1 ? '' : 's'} that need{r.review.count === 1 ? 's' : ''} a category ({money(r.review.total)})</a></p>
      )}
      {r && (
        <small>
          {r.source === 'claude' ? 'Written by Claude' : r.source === 'ha' ? (r.by === 'Claude' ? 'Written by Claude, through Home Assistant' : "Written by your Home Assistant's AI") : 'Automatic summary'} · {new Date(r.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          {r.error ? <> · <span className="bad">{r.error}</span></> : null}
          {!r.hasKey ? <> · <a href="#connections" onClick={jump(GO.ai)}>Turn on AI</a> for a recap written by Claude</> : null}
        </small>
      )}
    </section>
  );
}

// A time said the way you'd say it: "today 8:51 PM", "yesterday 8:51 PM", "tomorrow 8:51 PM", or the date.
function dayTime(at: number) {
  const d = new Date(at), time = d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' });
  const days = Math.round((new Date(at).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000);
  return days === 0 ? `today ${time}` : days === -1 ? `yesterday ${time}` : days === 1 ? `tomorrow ${time}` : `${d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`;
}

// When the bank's own figures date from: the bank's time on its balance where the feed gives one,
// otherwise the last time the app read the feed.
function bankRead(o: { bankAsOf?: number | null; syncedAt?: number | null }) {
  const at = o.bankAsOf ?? o.syncedAt;
  return at ? dayTime(at) : '';
}

// When newer figures from the bank are expected. The feed goes back to the bank about once a day; the
// app works the time out from the updates it has seen, and reads hourly once that time has passed.
function nextRead(o: { bankNextAt?: number | null }) {
  if (!o.bankNextAt) return '';
  return o.bankNextAt < Date.now() ? 'due now, checking every hour' : `about ${dayTime(o.bankNextAt)}`;
}

export default function Dashboard({ month }: { month: string }) {
  const { data: s, error } = useData(`/api/summary?month=${month}`);
  const { data: o, reload: reloadOutlook } = useData('/api/cashflow');
  // A finished month that came in under budget gets a moment, once.
  const won = !!s && !s.isCurrent && s.budget > 0 && s.spent > 0 && s.spent <= s.budget;
  // Which cards this device has chosen to hide ("Choose what shows here", at the foot of the page).
  const [hidden, setHidden] = useState<string[]>(readHidden);
  // A phone starts with the three things looked at most (at a glance, the outlook, recent) and keeps the
  // rest behind "Show more", remembered on the device (localStorage `ledger-dash-more`).
  const phone = isPhone();
  const [more, setMore] = useState(() => { try { return localStorage.getItem('ledger-dash-more') === '1'; } catch { return false; } });
  const flipMore = () => { try { localStorage.setItem('ledger-dash-more', more ? '0' : '1'); } catch { /* private window */ } setMore(!more); if (more) scrollTo({ top: 0 }); };
  const brief = phone && !more;
  const show = (id: string) => !hidden.includes(id) && (!brief || FIRST.includes(id));
  // A phone can put the cards in its own order ("Choose what shows here"). A computer keeps its layout,
  // where cards sit side by side and the big-screen grid depends on their places.
  const [order, setOrder] = useState<string[]>(readOrder);
  const ordered = phone && order.length > 0;
  const place = (id: string) => (ordered ? fullOrder(order).indexOf(id) - 100 : undefined);
  const [cheer, setCheer] = useState('');
  useEffect(() => {
    setCheer('');
    if (won) once(`month-${month}`, () => { setCheer(month); celebrate(); });
  }, [won, month]);
  if (error) return <p className="error">{error}</p>;
  if (!s) return <Skeleton tiles={4} cards={3} rows={4} />;
  const animate = !reducedMotion();

  const diff = s.isCurrent ? s.paceToday - s.spent : s.budget - s.spent;
  const under = diff >= 0;
  const saved = s.income - s.spent;
  const today = s.daily[s.lastDay - 1];
  const ticks = [1, 8, 15, 22, s.days];
  const top = [...s.categories].filter((c: any) => !c.fixed && (c.budget > 0 || c.spent > 0)).sort((a: any, b: any) => b.spent / (b.budget || 1) - a.spent / (a.budget || 1)).slice(0, 5);

  return (
    <div className={`stack dash ${ordered ? 'own-order' : ''}`}>
      {cheer === month && <div className="cheer" role="status">🎉 {periodLong(month)} finished {money(s.budget - s.spent)} under budget.</div>}
      {show('glance') && s.isCurrent && o && (
        <Slot at={place('glance')}>
        <section className="strip" aria-label="At a glance">
          <a className="strip-tile" href="#dashboard" onClick={(e) => { e.preventDefault(); document.getElementById('outlook')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
            <div className="label">{o.nextPayday ? `Left before payday, ${dayShort(o.nextPayday.date)}` : 'Lowest in the next five weeks'}</div>
            <div className={`value ${tone(o.nextPayday ? o.beforePayday : o.lowest.balance)}`}><Roll value={o.nextPayday ? o.beforePayday : o.lowest.balance} format={dollars} intro /></div>
            <div className="sub">{o.nextPayday ? 'after the bills due before then' : o.lowest.date === o.today ? 'no bills ahead to bring it lower' : `on ${dayShort(o.lowest.date)}, after the bills due by then`}</div>
          </a>
          <a className="strip-tile" href="#transactions">
            <div className="label">In checking now</div>
            <div className="value"><Roll value={o.balance} format={dollars} intro /></div>
            <div className="sub">{o.pending > 0 ? `${cents(o.pending)} pending taken off` : 'nothing pending'}</div>
            {bankRead(o) && <div className="sub">Last update: {bankRead(o)}</div>}
            {nextRead(o) && <div className="sub">Next update: {nextRead(o)}</div>}
          </a>
          <a className="strip-tile" href="#dashboard/spent">
            <div className="label">Spent of {money(s.budget)}</div>
            <div className={`value ${s.spent > s.budget ? 'bad' : ''}`}><Roll value={s.spent} format={money} intro /></div>
            <div className="track"><div className={s.spent > s.budget ? 'fill over' : 'fill'} style={{ width: `${Math.min(100, (s.spent / (s.budget || 1)) * 100)}%` }} /></div>
          </a>
        </section>        </Slot>
      )}
      {show('recap') && <Slot at={place('recap')}><Recap month={month} /></Slot>}
      {show('totals') && <Slot at={place('totals')}><section className="tiles">
        <a className="tile" href="#dashboard/networth">
          <div className="label">Net worth</div>
          <div className="value"><Roll value={s.netWorth} format={money} /></div>
          <div className={s.netWorthChange >= 0 ? 'good' : 'bad'}>{signed(Math.round(s.netWorthChange)).replace('.00', '')} this month</div>
        </a>
        <a className="tile" href="#dashboard/spent">
          <div className="label">Spent</div>
          <div className="value"><Roll value={s.spent} format={money} /></div>
          <div className="sub">{Math.round((s.spent / (s.budget || 1)) * 100)}% of {money(s.budget)}</div>
        </a>
        <a className="tile" href="#dashboard/income">
          <div className="label">Income</div>
          <div className="value"><Roll value={s.income} format={money} /></div>
          <div className="sub">{periodLong(month)}</div>
        </a>
        <a className="tile" href="#dashboard/saved">
          <div className="label">{saved >= 0 ? 'Saved' : 'Overspent'}</div>
          <div className="value"><Roll value={Math.abs(saved)} format={money} /></div>
          <div className={saved >= 0 ? 'good' : 'bad'}>{s.income > 0 ? `${Math.round((saved / s.income) * 100)}% of income` : 'No income yet'}</div>
        </a>
      </section></Slot>}

      <div className={`split ${brief ? 'brief' : ''}`}>
      <div className="stack">
      {show('pace') && <Slot at={place('pace')}><section className="card">
        <div className="pace-head">
          <div>
            <div className="label">{s.isCurrent ? 'Spent so far this month' : `Spent in ${periodLong(month)}`}</div>
            <div className="hero"><Roll value={s.spent} format={money} /></div>
            <div className="sub">
              of {money(s.budget)} budget ·{' '}
              <span className={under ? 'good' : 'bad'}>
                {money(Math.abs(diff))} {under ? 'under' : 'over'} {s.isCurrent ? 'pace' : 'budget'}
              </span>
            </div>
          </div>
          <div className="legend">
            <span><i style={{ background: 'var(--accent)' }} />Spending</span>
            <span><i className="dash" />Budget pace</span>
          </div>
        </div>
        <div className="chart pace-chart">
          <div className="pace-fill">
          <ResponsiveContainer>
            <ComposedChart data={s.daily} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="paceFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.38} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="day" ticks={ticks} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} tick={{ fill: 'var(--ink3)', fontSize: 12 }} tickFormatter={(d) => (s.daily[d - 1]?.date ? dayShort(s.daily[d - 1].date) : `${monthShort(month)} ${d}`)} />
              <YAxis width={44} tickLine={false} axisLine={false} tick={{ fill: 'var(--ink3)', fontSize: 12 }} tickFormatter={compact} tickCount={4} />
              <Tooltip content={<Tip title={(d: number) => (s.daily[d - 1]?.date ? dayShort(s.daily[d - 1].date) : `${monthShort(month)} ${d}`)} />} cursor={{ stroke: 'var(--axis)' }} />
              <Line name="Budget pace" dataKey="pace" stroke="var(--ink3)" strokeWidth={2} strokeDasharray="5 5" dot={false} activeDot={false} isAnimationActive={animate} animationDuration={700} />
              <Area name="Spent" dataKey="spent" stroke="var(--accent)" strokeWidth={2.5} fill="url(#paceFill)" fillOpacity={1} dot={false} activeDot={{ r: 4, stroke: 'var(--panel)', strokeWidth: 2 }} isAnimationActive={animate} animationDuration={900} animationEasing="ease-out" />
              {s.isCurrent && today && <ReferenceDot x={today.day} y={today.spent} r={5} fill="var(--accent)" stroke="var(--panel)" strokeWidth={2} />}
            </ComposedChart>
          </ResponsiveContainer>
          </div>
        </div>
      </section></Slot>}

      <div className="cols">
        {show('cashflow') && <Slot at={place('cashflow')}><section className="card">
          <div className="card-head">
            <h2>Cash flow</h2>
            <div className="legend">
              <span><i style={{ background: 'var(--accent)' }} />Income</span>
              <span><i style={{ background: 'var(--series2)' }} />Spending</span>
            </div>
          </div>
          <div className="chart" style={{ height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={s.cashflow} margin={{ top: 10, right: 0, left: 0, bottom: 0 }} barGap={3}>
                <defs>
                  <linearGradient id="barIn" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity={1} /><stop offset="100%" stopColor="var(--accent)" stopOpacity={0.45} /></linearGradient>
                  <linearGradient id="barOut" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--series2)" stopOpacity={1} /><stop offset="100%" stopColor="var(--series2)" stopOpacity={0.45} /></linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: 'var(--axis)' }} tick={{ fill: 'var(--ink3)', fontSize: 12 }} tickFormatter={monthShort} />
                <YAxis width={44} tickLine={false} axisLine={false} tick={{ fill: 'var(--ink3)', fontSize: 12 }} tickFormatter={compact} tickCount={4} />
                <Tooltip content={<Tip title={periodLong} />} cursor={{ fill: 'var(--hover)' }} />
                <Bar name="Income" dataKey="income" fill="url(#barIn)" radius={[4, 4, 0, 0]} maxBarSize={16} isAnimationActive={animate} animationDuration={700} />
                <Bar name="Spending" dataKey="spending" fill="url(#barOut)" radius={[4, 4, 0, 0]} maxBarSize={16} isAnimationActive={animate} animationDuration={700} animationBegin={150} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section></Slot>}
        {show('recent') && <Slot at={place('recent')}><section className="card">
          <div className="card-head"><h2>Recent</h2><a href="#transactions">See all</a></div>
          {s.recent.length === 0 && <p className="sub">No transactions this month.</p>}
          {s.recent.map((t: any) => (
            <div key={t.id} className="row">
              <Logo edit name={t.merchant} fallback={t.icon} />
              <span className="grow">{t.merchant}<small>{dayShort(t.date)} · {t.category}</small></span>
              <TxAmount amount={t.amount} />
            </div>
          ))}
        </section></Slot>}
      </div>
      </div>

      <div className="cols">
        {show('budgets') && <Slot at={place('budgets')}><section className="card">
          <div className="card-head"><h2>Budgets</h2><a href="#budgets">See all</a></div>
          {top.map((c: any) => (
            <Meter key={c.id} id={c.id} icon={c.icon} name={c.name} spent={c.spent} budget={c.budget} />
          ))}
        </section></Slot>}
        {show('goals') && <Slot at={place('goals')}><GoalsMini /></Slot>}
        {show('classes') && <Slot at={place('classes')}><VipkidGoal /></Slot>}
        {show('outlook') && <Slot at={place('outlook')}><Outlook o={o} reload={reloadOutlook} /></Slot>}
      </div>
      </div>
      {phone && <p className="dash-more"><button onClick={flipMore}>{more ? 'Show less' : 'Show more'}</button>{!more && <small>The recap, month totals, charts, budgets and goals</small>}</p>}
      {!brief && <DashChooser hidden={hidden} onChange={setHidden} order={order} onOrder={setOrder} phone={phone} />}
    </div>
  );
}
