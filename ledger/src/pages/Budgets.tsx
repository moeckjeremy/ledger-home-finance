import { CatIcon, EmojiPick } from '../icons';
import { useEffect, useState } from 'react';
import { api, budgetStartDay, currentPeriod, forgetLoaded, money, monthLong, periodLong, useData } from '../lib';
import { BudgetMonth, budgetDayWords } from '../BudgetMonth';
import { Fold, Meter, Modal, More, Skeleton } from '../ui';
import { BudgetSuggest } from './Setup';
import { ZeroGuide } from './ZeroGuide';

function BudgetInput({ cat, onSaved, month, plan }: { cat: any; onSaved: () => void; month?: string; plan?: boolean }) {
  const typed = cat.base ?? cat.budget;   // the monthly amount as typed; cat.budget also counts what was carried over
  const [value, setValue] = useState(String(typed));
  const [err, setErr] = useState('');
  const save = async () => {
    const n = Number(value);
    if (value.trim() === '' || !Number.isFinite(n) || n < 0) return setErr('Enter 0 or more');
    setErr('');
    if (n === typed) return;
    try {
      // In the zero-based mode the box is what this category is given this month, not a standing amount.
      if (cat.zero && month) await api('/api/zero/assign', { method: 'PUT', body: { month, category_id: cat.id, amount: n } });
      // For a month that hasn't begun, the amount is kept for that month and this month is left alone.
      else if (plan && month) await api('/api/budget-plan', { method: 'PUT', body: { month, category_id: cat.id, amount: n } });
      else await api(`/api/categories/${cat.id}`, { method: 'PATCH', body: { budget: n } });
      onSaved();
    } catch (e: any) {
      setErr(e.message);
    }
  };
  return (
    <div>
      <input
        type="number" min="0" step="10" inputMode="decimal" value={value} aria-label={cat.zero ? `Assigned to ${cat.name} this month` : `Monthly budget for ${cat.name}`}
        onChange={(e) => { setValue(e.target.value); setErr(''); }}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {err && <small className="bad">{err}</small>}
    </div>
  );
}

function AddCategory({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ name: '', icon: '', budget: '' });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: any) => { setF({ ...f, [k]: e.target.value }); setErr(''); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return setErr('Enter a name for the category.');
    try {
      await api('/api/categories', { method: 'POST', body: f });
      setF({ name: '', icon: '', budget: '' });
      onDone();
    } catch (e: any) {
      setErr(e.message);
    }
  };
  return (
    <form className="card" onSubmit={submit} noValidate>
      <div className="card-head"><h2>Add a category</h2></div>
      <div className="add-grid">
        <label>Name<input type="text" value={f.name} onChange={set('name')} placeholder="Haircuts" /></label>
        <EmojiPick value={f.icon} onChange={(v) => { setF({ ...f, icon: v }); setErr(''); }} />
        <label>Monthly budget<input type="number" min="0" step="5" inputMode="decimal" value={f.budget} onChange={set('budget')} placeholder="40" /></label>
        <div style={{ alignSelf: 'end' }}><button type="submit" className="primary">Add category</button></div>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
    </form>
  );
}

/**
 * "Give every dollar a job" (server/zero.js): the money that has come in and not yet been handed to a
 * category, with quick ways to fill the month. Shown at the top of Budgets while the mode is on.
 */
function ZeroBar({ z, month, onChanged }: { z: any; month: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [guide, setGuide] = useState(() => { try { return !z.before && !localStorage.getItem('ledger-zero-guide'); } catch { return false; } });
  const closeGuide = () => { try { localStorage.setItem('ledger-zero-guide', '1'); } catch { /* private window */ } setGuide(false); };
  if (z.before) return <section className="card"><p className="sub" style={{ margin: 0 }}>This month is from before you began giving every dollar a job ({z.from}), so it shows the budgets you had then.</p></section>;
  const fill = async (how: string) => { setBusy(true); try { const r = await api('/api/zero/fill', { method: 'POST', body: { month, how } }); setNote(r.filled ? `${r.filled} categor${r.filled === 1 ? 'y' : 'ies'} filled in. Change any amount on the right.` : 'Every category already has an amount this month.'); onChanged(); } catch (e: any) { setNote(e.message); } setBusy(false); };
  const left = z.toAssign;
  return (
    <section className={`card zero-bar ${left < -0.005 ? 'over' : left > 0.005 ? 'some' : 'done'}`}>
      <div className="zero-top">
        <div><div className="label">{left < -0.005 ? 'Assigned more than you have' : 'To be assigned'}</div><div className="value">{money(Math.abs(left))}</div></div>
        <p className="sub">{left > 0.005 ? 'Money that has come in and has no job yet. Hand it out below until this reads zero.' : left < -0.005 ? 'The categories below have been given more than has come in. Lower some until this reads zero.' : 'Every dollar has a job.'} Income this month so far: {money(z.income)}; given out this month: {money(z.assignedMonth)}.</p>
      </div>
      <div className="add-actions">
        <button disabled={busy} onClick={() => fill('usual')}>Fill empty ones with my usual amounts</button>
        <button className="link" onClick={() => setGuide(true)}>How this works</button>
        {z.hasLast && <button disabled={busy} onClick={() => fill('last')}>Fill empty ones like last month</button>}
      </div>
      {note && <p className="sub" role="status">{note}</p>}
      {guide && <ZeroGuide onClose={closeGuide} />}
    </section>
  );
}

/** The switch between the two ways of budgeting, at the foot of the page. Each household chooses; nothing is lost either way. */
function ZeroSwitch({ z, onChanged }: { z: any; onChanged: () => void }) {
  const [start, setStart] = useState(z.start ? String(z.start) : '');
  const [err, setErr] = useState('');
  const [guide, setGuide] = useState(false);
  const put = async (body: object) => { try { await api('/api/zero', { method: 'PUT', body }); setErr(''); forgetLoaded(); onChanged(); dispatchEvent(new CustomEvent('ledger-refresh')); } catch (e: any) { setErr(e.message); } };
  const reset = async () => { if (!confirm('Start over from this month? The amounts you have assigned so far are forgotten. Your ordinary budgets are not touched.')) return; try { await api('/api/zero/reset', { method: 'POST' }); forgetLoaded(); onChanged(); dispatchEvent(new CustomEvent('ledger-refresh')); } catch (e: any) { setErr(e.message); } };
  return (
    <Fold id="budget-zero" title="Choose your budgeting method" note={z.on ? 'Every dollar gets a job' : 'A set amount for each category'}>
      <p className="sub first">Ledger can budget in two ways. <b>A set amount for each category</b> is the usual one: each category has a monthly figure and Ledger shows how you are doing against it. <b>Give every dollar a job</b> starts from the money instead: as pay arrives it waits to be assigned, and you hand it out to categories until none is left. A category can only spend what it has been given, and what it doesn't spend stays in it for later. <button className="link" onClick={() => setGuide(true)}>See how it works</button></p>
      {guide && <ZeroGuide onClose={() => setGuide(false)} />}
      <label className="row check" data-go="zero-switch"><span className="grow">Give every dollar a job</span><input type="checkbox" checked={z.on} onChange={(e) => put({ on: e.target.checked })} /></label>
      {z.on ? <>
        <div className="add-grid">
          <label className="field"><span>Money you already had when you began</span>
            <input type="number" min="0" step="50" inputMode="decimal" value={start} placeholder="0" onChange={(e) => setStart(e.target.value)} onBlur={() => put({ start: Number(start || 0) })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
            <small>Optional. For example what was in checking that day. It is added to what you can assign. Began {z.from}.</small></label>
        </div>
        <p className="sub">Switching this off puts your set amounts back exactly as they were. What you assigned is kept in case you switch it on again. <button className="link" onClick={reset}>Start over from this month</button></p>
      </> : <p className="sub">Switching it on changes this page only for {`this month onward`}; earlier months keep the budgets they had. Your set amounts are kept and come back if you switch it off.</p>}
      {err && <p className="error" role="alert">{err}</p>}
    </Fold>
  );
}

const PROTECTED = ['Other', 'Income', 'Transfer'];

/**
 * "Organise" for one category: which list it sits in (flexible, fixed, or a group of the household's own),
 * merging it into another, or hiding it. One window, so a row keeps a short line of links.
 */
function Organise({ cat, own, cats, onClose, onDone, onRemove }: { cat: any; own: any[]; cats: any[]; onClose: () => void; onDone: (note: string) => void; onRemove: () => void }) {
  const inOwn = cat.group_id && own.some((g) => g.id === cat.group_id);
  const [list, setList] = useState(inOwn ? String(cat.group_id) : cat.fixed ? 'fixed' : 'flex');
  const [fixed, setFixed] = useState(!!cat.fixed);
  const [name, setName] = useState('');
  const others = cats.filter((c) => c.id !== cat.id && !c.hidden);
  const [into, setInto] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const keep = !PROTECTED.includes(cat.name);
  const run = async (what: () => Promise<string>) => {
    setBusy(true); setErr('');
    try { onDone(await what()); } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  const place = () => run(async () => {
    let to = list;
    if (list === 'new') {
      if (!name.trim()) throw new Error('Give the new group a name.');
      to = String((await api('/api/category-groups', { method: 'POST', body: { name } })).id);
    }
    await api(`/api/categories/${cat.id}/place`, { method: 'POST', body: { list: to, fixed } });
    return `${cat.name} moved.`;
  });
  const merge = () => run(async () => {
    if (!into) throw new Error('Choose the category to merge it into.');
    const target = others.find((c) => String(c.id) === into);
    if (!confirm(`Merge "${cat.name}" into "${target?.name}"? Everything filed in ${cat.name} moves there and ${cat.name} is removed. This can't be undone.`)) throw new Error('');
    const r = await api(`/api/categories/${cat.id}/merge`, { method: 'POST', body: { into: Number(into) } });
    return `${cat.name} merged into ${r.to}: ${r.moved} transaction${r.moved === 1 ? '' : 's'} moved.`;
  });
  const aside = () => run(async () => {
    await api(`/api/categories/${cat.id}/aside`, { method: 'POST', body: { on: true } });
    return `${cat.name} no longer counts in your budget. It is listed under "Not counted in the budget" on this page.`;
  });
  const hide = () => run(async () => {
    await api(`/api/categories/${cat.id}/hide`, { method: 'POST', body: { on: true } });
    return `${cat.name} is hidden. It is listed at the foot of this page if you want it back.`;
  });
  const grouped = list !== 'flex' && list !== 'fixed';
  return (
    <Modal title={`Organise ${cat.name}`} onClose={onClose}>
      <div className="organise">
        {keep && <>
          <h3>Its name and icon</h3>
          <div className="add-actions"><button onClick={() => { onClose(); dispatchEvent(new CustomEvent('ledger-icon-edit', { detail: { id: cat.id, name: cat.name, icon: cat.icon } })); }}>Rename or change the icon</button></div>
        </>}
        <h3>Where it sits</h3>
        <div className="add-grid">
          <label>List
            <select value={list} data-go="cat-list" onChange={(e) => { setList(e.target.value); setErr(''); }}>
              <option value="flex">Flexible spending</option>
              <option value="fixed">Fixed bills</option>
              {own.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              <option value="new">＋ A new group of your own…</option>
            </select>
          </label>
          {list === 'new' && <label>Name of the group<input type="text" value={name} maxLength={40} placeholder="Giving" autoFocus onChange={(e) => { setName(e.target.value); setErr(''); }} /></label>}
        </div>
        {grouped && <label className="row check"><span className="grow">It is a fixed bill<small>About the same every month, such as rent or insurance. Ledger leaves fixed bills out when it judges your day-to-day pace.</small></span><input type="checkbox" checked={fixed} onChange={(e) => setFixed(e.target.checked)} /></label>}
        <div className="add-actions"><button className="primary" disabled={busy} onClick={place}>Save</button></div>
        {keep && <>
          <h3>Merge it into another category</h3>
          <p className="sub">Everything filed in {cat.name}, its bills and the shops Ledger has learned to file there all move to the category you choose, and {cat.name} is removed. The other category keeps its own budget.</p>
          <div className="add-actions">
            <select value={into} aria-label={`Category to merge ${cat.name} into`} onChange={(e) => { setInto(e.target.value); setErr(''); }}>
              <option value="">Choose a category</option>
              {others.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
            <button disabled={busy || !into} onClick={merge}>Merge</button>
          </div>
          <h3>Leave it out of the budget</h3>
          <p className="sub">For spending that isn't really yours, such as work expenses you are paid back for. What you file in {cat.name} then counts in no budget, total or report, and its budget goes to 0. File the money that comes back there too and this page shows both sides. You can still choose it in every category menu.</p>
          <div className="add-actions"><button disabled={busy} data-go="cat-aside" onClick={aside}>Don't count {cat.name}</button></div>
          <h3>Hide it</h3>
          <p className="sub">For a category you no longer use. It leaves this page and every category menu, and its budget goes to 0. Nothing filed in it changes, and its past stays in your totals and reports.</p>
          <div className="add-actions"><button disabled={busy} onClick={hide}>Hide {cat.name}</button></div>
          <h3>Remove it</h3>
          <p className="sub">Removing throws its history away: everything filed in {cat.name} is moved to Other and can't be told apart afterwards. <b>To keep the history, use Merge or Hide above.</b> Remove suits a category made by mistake or never used.</p>
          <div className="add-actions"><button className="danger" disabled={busy} onClick={() => { onClose(); onRemove(); }}>Remove {cat.name}</button></div>
        </>}
        {err && <p className="error">{err}</p>}
      </div>
    </Modal>
  );
}

const thisMonth = () => currentPeriod();   // the budget month running today (the calendar month unless the start day was moved)
const monthAfter = (m: string) => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; };
const nameOf = (m: string) => monthLong(m).split(' ')[0];

export default function Budgets({ month: chosen }: { month: string }) {
  // "Plan next month" looks one month ahead on this page only; the rest of the app stays on the month chosen.
  const [ahead, setAhead] = useState(false);
  const now = thisMonth(), coming = monthAfter(now);
  useEffect(() => { if (chosen !== now) setAhead(false); }, [chosen, now]);
  const planning = ahead && chosen === now;
  const month = planning ? coming : chosen;
  const { data: s, error, reload: reloadSummary } = useData(`/api/summary?month=${month}`);
  const { data: z, reload: reloadZero } = useData<any>(`/api/zero?month=${month}`);
  const { data: own, reload: reloadGroups } = useData<any[]>('/api/category-groups');
  const reload = () => { reloadSummary(); reloadZero(); reloadGroups(); };
  const [organising, setOrganising] = useState<any>(null);
  // (Before the early returns below: hooks must run in the same order on every draw.)
  const [note, setNote] = useState('');
  if (error) return <p className="error">{error}</p>;
  if (!s) return <Skeleton tiles={0} cards={2} rows={6} />;
  const suggest = <section className="card"><div className="card-head"><h2>Suggested budgets</h2></div><p className="sub first">Ledger can suggest an amount for each category from what you've really spent over the last few months, or from your take-home pay if it hasn't seen a full month yet. You check them before anything changes.</p><BudgetSuggest onApplied={reload} /></section>;
  // Removing a category moves whatever was filed in it to Other, so nothing is lost.
  const removeCategory = async (c: any) => {
    if (!confirm(`Remove "${c.name}"? Everything filed in it moves to Other and its history is lost. (Merge or Hide would keep it.) This can't be undone.`)) return;
    try {
      const r = await api(`/api/categories/${c.id}`, { method: 'DELETE' });
      setNote(`${c.name} removed.${r.moved ? ` ${r.moved} transaction${r.moved === 1 ? '' : 's'} moved to ${r.to}.` : ''}`);
      forgetLoaded(); reload();
    } catch (e: any) { setNote(e.message); }
  };
  // What's left at the end of a month moves into the next one (and overspending comes off it).
  const carry = async (c: any) => {
    try {
      await api(`/api/categories/${c.id}`, { method: 'PATCH', body: { rollover: !c.rollover } });
      setNote(c.rollover ? `${c.name} no longer carries over. Its budget is the same every month again.` : `${c.name} now carries over: whatever is left at the end of this month is added to next month's, and anything overspent comes off it.`);
      forgetLoaded(); reload();
    } catch (e: any) { setNote(e.message); }
  };
  // One place up or down within its own list. The order is the household's, and every menu follows it.
  const move = async (c: any, dir: 'up' | 'down') => {
    try { await api(`/api/categories/${c.id}/move`, { method: 'POST', body: { dir } }); setNote(''); forgetLoaded(); reload(); dispatchEvent(new Event('ledger-refresh')); }
    catch (e: any) { setNote(e.message); }
  };
  // A hidden category is left off the page unless something was spent in it this month.
  const myGroups = own ?? [];
  const inOwn = (c: any) => c.group_id && myGroups.some((g) => g.id === c.group_id);
  const visible = s.categories.filter((c: any) => !c.hidden || c.spent > 0.005);
  const tucked = s.categories.filter((c: any) => c.hidden);
  const groups = ([
    ...myGroups.map((g) => ({ id: g.id, title: g.name, items: visible.filter((c: any) => c.group_id === g.id) })),
    { title: 'Flexible spending', items: visible.filter((c: any) => !inOwn(c) && !c.fixed) },
    { title: 'Fixed bills', items: visible.filter((c: any) => !inOwn(c) && c.fixed) },
  ] as { id?: number; title: string; items: any[] }[]).filter((g) => g.id || g.items.length);
  const changed = () => { forgetLoaded(); reload(); dispatchEvent(new Event('ledger-refresh')); };
  const countAgain = async (c: any) => { try { await api(`/api/categories/${c.id}/aside`, { method: 'POST', body: { on: false } }); setNote(`${c.name} counts in your budget again. Give it a budget if it needs one.`); changed(); } catch (e: any) { setNote(e.message); } };
  const unhide = async (c: any) => { try { await api(`/api/categories/${c.id}/hide`, { method: 'POST', body: { on: false } }); setNote(`${c.name} is back.`); changed(); } catch (e: any) { setNote(e.message); } };
  const newGroup = async () => {
    const name = prompt('Name of the new group (for example Giving, Food or Kids):');
    if (!name?.trim()) return;
    try { await api('/api/category-groups', { method: 'POST', body: { name } }); setNote(`${name.trim()} added. Use Organise beside a category to put it there.`); changed(); } catch (e: any) { setNote(e.message); }
  };
  const renameGroup = async (g: any) => {
    const name = prompt('Name of the group:', g.title);
    if (!name?.trim() || name.trim() === g.title) return;
    try { await api(`/api/category-groups/${g.id}`, { method: 'PATCH', body: { name } }); changed(); } catch (e: any) { setNote(e.message); }
  };
  const moveGroup = async (g: any, dir: 'up' | 'down') => { try { await api(`/api/category-groups/${g.id}/move`, { method: 'POST', body: { dir } }); changed(); } catch (e: any) { setNote(e.message); } };
  const removeGroup = async (g: any) => {
    if (!confirm(`Remove the group "${g.title}"? Only the heading goes: its categories move back under Flexible spending or Fixed bills.`)) return;
    try { await api(`/api/category-groups/${g.id}`, { method: 'DELETE' }); changed(); } catch (e: any) { setNote(e.message); }
  };
  const left = s.budget - s.spent;
  const zeroNow = !!z?.on && !z.before;
  // Covering an overspent category by moving what the page suggests (zero-based mode only).
  const cover = async (c: any) => {
    try {
      for (const f of c.from) {
        const giver = s.categories.find((x: any) => x.name === f.name);
        if (giver) await api('/api/zero/move', { method: 'POST', body: { month, from: giver.id, to: c.id, amount: Math.round(f.amount * 100) / 100 } });
      }
      setNote(`${c.name} covered.`); forgetLoaded(); reload();
    } catch (e: any) { setNote(e.message); }
  };

  // For each category that's over, suggest covering it from flexible
  // categories expected to finish the month with the most left over.
  const elapsed = s.isCurrent ? s.lastDay / s.days : 1;
  const pool = s.categories
    .filter((c: any) => !c.fixed && c.budget > c.spent)
    .map((c: any) => ({ name: c.name, icon: c.icon, left: c.budget - c.spent, spare: Math.max(0, c.budget - c.spent / elapsed) }))
    .sort((a: any, b: any) => b.spare - a.spare);
  const suggestions = s.categories
    .filter((c: any) => c.spent > c.budget + 0.5)
    .sort((a: any, b: any) => b.spent - b.budget - (a.spent - a.budget))
    .map((c: any) => {
      let need = c.spent - c.budget;
      const from: { name: string; amount: number; left: number }[] = [];
      for (const p of pool) {
        if (need < 0.5) break;
        const take = Math.min(need, p.left);
        if (take < 0.5) continue;
        from.push({ name: p.name, amount: take, left: p.left });
        p.left -= take;
        p.spare = Math.max(0, p.spare - take);
        need -= take;
      }
      return { ...c, over: c.spent - c.budget, from, uncovered: need };
    });

  return (
    <div className="stack">
      {note && <p className="sub" role="status">{note}</p>}
      {planning ? (
        <section className="card plan-ahead" data-go="plan-ahead-on">
          <div className="card-head"><h2>Planning {periodLong(coming)}</h2><button className="link" onClick={() => setAhead(false)}>Back to {nameOf(now)}</button></div>
          {zeroNow
            ? <p className="sub first">You are handing out money for {nameOf(coming)}. "To be assigned" is what you have left today, so anything beyond it is waiting on {nameOf(coming)}'s income. {nameOf(now)}'s amounts are not changed.</p>
            : <p className="sub first">Amounts you type here start on {nameOf(coming)} {budgetStartDay()} and stay until you change them. {nameOf(now)}'s budget is not touched. A category you leave alone keeps the amount it has now.</p>}
          {!zeroNow && s.categories.some((c: any) => c.planned) && <p style={{ margin: 0 }}><button className="link" onClick={async () => { try { await api(`/api/budget-plan?month=${coming}`, { method: 'DELETE' }); forgetLoaded(); reload(); } catch (e: any) { setNote(e.message); } }}>Start {nameOf(coming)} over from {nameOf(now)}'s amounts</button></p>}
        </section>
      ) : chosen === now ? (
        <p className="plan-ahead-offer"><button data-go="plan-ahead" onClick={() => setAhead(true)}>Plan {nameOf(coming)}'s budget</button><small>Work on next month before it starts, without changing this one.</small></p>
      ) : null}
      {z?.on && <ZeroBar z={z} month={month} onChanged={reload} />}
      <section className="tiles">
        <div className="tile"><div className="label">Budget</div><div className="value">{money(s.budget)}</div><div className="sub">{zeroNow ? 'in your categories this month' : s.categories.some((c: any) => c.rollover && Math.abs(c.carry) >= 0.005) ? 'this month, with what was carried over' : 'per month'}</div></div>
        <div className="tile"><div className="label">Spent</div><div className="value">{money(s.spent)}</div><div className="sub">{Math.round((s.spent / (s.budget || 1)) * 100)}% used</div></div>
        <div className="tile"><div className="label">{left >= 0 ? 'Left' : 'Over'}</div><div className="value">{money(Math.abs(left))}</div><div className={left >= 0 ? 'good' : 'bad'}>{left >= 0 ? 'still available' : 'past your budget'}</div></div>
        <div className="tile"><div className="label">Income</div><div className="value">{money(s.income)}</div><div className="sub">{zeroNow ? `${money(z.toAssign)} still to assign` : `${money(s.income - s.budget)} unbudgeted`}</div></div>
      </section>
      {suggestions.length > 0 && (
        <section className="card">
          <div className="card-head"><h2>Over budget</h2></div>
          {suggestions.map((c: any) => (
            <div key={c.id} className="row">
              <CatIcon icon={c.icon} edit={{ id: c.id, name: c.name }} />
              <span className="grow wrap">
                {c.name} is <b className="bad">{money(c.over)} over</b>.{' '}
                {c.from.length > 0 && (
                  <>Cover it by moving {c.from.map((f: any, i: number) => (
                    <span key={f.name}>{i > 0 ? (i === c.from.length - 1 ? ' and ' : ', ') : ''}<b>{money(f.amount)} from {f.name}</b> ({money(f.left)} unspent)</span>
                  ))}.</>
                )}
                {c.uncovered >= 0.5 && <> {c.from.length ? 'The remaining' : 'Nothing else has room, so the'} {money(c.uncovered)} comes out of your excess money this month.</>}
              </span>
              {zeroNow && c.from.length > 0 && <button onClick={() => cover(c)}>Move it</button>}
            </div>
          ))}
          <small>Suggestions favor categories on track to finish the month with the most left.</small>
        </section>
      )}
      <section className="card">
        {zeroNow ? <p className="sub" style={{ margin: 0 }}>The box on the right is what each category is given <b>this month</b>. It saves when you leave the field. Each bar shows what the category has to spend: this month's amount plus whatever it had left from before.</p> : <p className="sub" style={{ margin: 0 }}>Change a monthly amount on the right. It saves when you leave the field. <b>Carry over</b> moves whatever is left at the end of a month into the next one, which suits things you save up for, such as clothing, gifts or car repairs.</p>}
        <p className="sub" style={{ margin: '6px 0 0' }}>{'The arrows (or "⋯" on a phone) move a category up or down. '}<b>Organise</b>{' does the rest: rename, regroup, merge, hide, leave out of the budget, or remove. '}<button className="link" data-go="cat-group" onClick={newGroup}>Make a group of your own</button></p>
        {groups.map((g, gi) => (
          <div key={g.id ? `g${g.id}` : g.title}>
            <div className="group-head">
              <span>{g.title}{g.id ? <span className="group-acts">
                <span className="wide-only"><button className="link" disabled={gi === 0} aria-label={`Move the group ${g.title} up`} onClick={() => moveGroup(g, 'up')}>↑</button><button className="link" disabled={gi >= myGroups.length - 1} aria-label={`Move the group ${g.title} down`} onClick={() => moveGroup(g, 'down')}>↓</button><button className="link" onClick={() => renameGroup(g)}>Rename</button><button className="link" onClick={() => removeGroup(g)}>Remove</button></span>
                <More name={g.title} sub="A group of your own" items={() => [
                  gi > 0 && { label: 'Move up', run: () => moveGroup(g, 'up') },
                  gi < myGroups.length - 1 && { label: 'Move down', run: () => moveGroup(g, 'down') },
                  { label: 'Rename', run: () => renameGroup(g) },
                  { label: 'Remove the group', danger: true, hint: 'Its categories go back under Flexible or Fixed', run: () => removeGroup(g) },
                ]} />
              </span> : null}</span>
              <span className="num">{money(g.items.reduce((a: number, c: any) => a + c.spent, 0))} / {money(g.items.reduce((a: number, c: any) => a + c.budget, 0))}</span>
            </div>
            {g.id && !g.items.length ? <p className="sub group-empty">Nothing here yet. Use Organise beside a category to put it in this group.</p> : null}
            {g.items.map((c: any, i: number) => (
              <div key={c.id} className="budget-row">
                <div>
                  <Meter id={c.id} icon={c.icon} name={c.name} spent={c.spent} budget={c.budget} />
                  {c.hidden ? <small className="carry-note">Hidden, but something was spent in it this month. <button className="link" onClick={() => unhide(c)}>Show it again</button></small> : null}
                  {c.zero && Math.abs(c.carry) >= 0.005 && <small className="carry-note">{c.carry > 0 ? <>{money(c.base)} this month, plus <b className="good">{money(c.carry)}</b> left from before</> : <>{money(c.base)} this month, less <b className="bad">{money(-c.carry)}</b> overspent before</>}</small>}
                  {c.rollover && <small className="carry-note">{Math.abs(c.carry) < 0.005 ? "Carries over: what's left this month moves to next month." : c.carry > 0 ? <>{money(c.base)} a month, plus <b className="good">{money(c.carry)}</b> carried over</> : <>{money(c.base)} a month, less <b className="bad">{money(-c.carry)}</b> overspent before</>}</small>}
                </div>
                <BudgetInput key={`${c.id}-${month}-${c.base ?? c.budget}`} cat={c} month={month} plan={planning} onSaved={() => { forgetLoaded(); reload(); }} />
                <More name={c.name} sub={`${money(c.spent)} spent of ${money(c.budget)}`} items={() => [
                  !c.zero && { label: c.rollover ? 'Stop carrying over' : 'Carry over', hint: c.rollover ? 'The same budget every month again' : "What's left moves into next month", run: () => carry(c) },
                  i > 0 && { label: 'Move up', hint: 'One place higher in this list and in every category menu', run: () => move(c, 'up') },
                  i < g.items.length - 1 && { label: 'Move down', hint: 'One place lower', run: () => move(c, 'down') },
                  { label: 'Organise', hint: 'Rename it, change its group, merge, hide or remove it', run: () => setOrganising(c) },
                ]} />
                <div className="budget-acts wide-only">
                <span className="budget-move" data-go="cat-move">
                  <button className="link budget-remove" disabled={i === 0} aria-label={`Move ${c.name} up`} title="Move up" onClick={() => move(c, 'up')}>↑</button>
                  <button className="link budget-remove" disabled={i === g.items.length - 1} aria-label={`Move ${c.name} down`} title="Move down" onClick={() => move(c, 'down')}>↓</button>
                </span>
                {!c.zero && <button className="link budget-remove" aria-pressed={!!c.rollover} aria-label={`${c.rollover ? 'Stop carrying over' : 'Carry over'} what is left of ${c.name}`} onClick={() => carry(c)}>{c.rollover ? 'Stop carrying over' : 'Carry over'}</button>}
                <button className="link budget-remove" data-go="cat-organise" aria-label={`Organise the category ${c.name}`} title="Rename it, change its list or group, merge, hide or remove it" onClick={() => setOrganising(c)}>Organise</button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </section>
      {!zeroNow && !planning && suggest}
      <AddCategory onDone={reload} />
      {s.aside?.length > 0 && (
        <section className="card" data-go="cat-aside-list">
          <div className="card-head"><h2>Not counted in the budget</h2></div>
          <p className="sub first">Categories you have left out, such as expenses you are paid back for. Nothing filed here is in your budget, totals or reports.</p>
          {s.aside.map((c: any) => (
            <div key={c.id} className="row copy-row">
              <CatIcon icon={c.icon} />
              <span className="grow wrap" style={{ flexBasis: 170 }}>{c.name}<small>{c.out > 0 || c.back > 0 ? <>{money(c.out)} out this month{c.back > 0 ? <>, {money(c.back)} back{c.out - c.back > 0.005 ? <>, {money(c.out - c.back)} still to come</> : null}</> : null}</> : 'Nothing this month'}</small></span>
              <button className="link" onClick={() => dispatchEvent(new CustomEvent('ledger-icon-edit', { detail: { id: c.id, name: c.name, icon: c.icon } }))}>Rename</button>
              <button className="link" onClick={() => countAgain(c)}>Count it again</button>
            </div>
          ))}
        </section>
      )}
      {tucked.length > 0 && (
        <Fold id="budget-hidden" title="Hidden categories" note={`${tucked.length}`}>
          <p className="sub first">Categories you have hidden. Their past spending is still in your totals and reports.</p>
          {tucked.map((c: any) => (
            <div key={c.id} className="row"><CatIcon icon={c.icon} /><span className="grow">{c.name}</span><button className="link" onClick={() => unhide(c)}>Show again</button></div>
          ))}
        </Fold>
      )}
      {organising && <Organise cat={organising} own={myGroups} cats={s.categories} onClose={() => setOrganising(null)} onDone={(n) => { setOrganising(null); if (n) setNote(n); changed(); }} onRemove={() => removeCategory(organising)} />}
      {z && !planning && <ZeroSwitch z={z} onChanged={reload} />}
      {!planning && <Fold id="budget-startday" title="When your budget month starts" note={budgetDayWords(budgetStartDay())}><BudgetMonth /></Fold>}
    </div>
  );
}
