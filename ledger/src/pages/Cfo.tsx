// "Ask your CFO" (Claude Financial Officer): type a question about your money and
// Claude answers it from the app's own figures. It can look things up but can't
// change anything. The conversation lives on this page only: leaving the page or
// pressing "New conversation" starts afresh.
import { GO, jump } from '../go';
import { useEffect, useRef, useState } from 'react';
import { api, cents, dayShort, useAi, useData, useGig } from '../lib';
import { shrinkPicture } from '../ui';

// `actions`: changes the CFO proposed in this answer, each waiting for Confirm or Cancel; `result` once answered.
type Turn = { who: 'you' | 'cfo'; text: string; sources?: { url: string; title: string }[]; looked?: string[]; cost?: number; failed?: boolean; file?: File; actions?: { id: string; summary: string; result?: string; bad?: boolean }[] };

const IDEAS = [
  'How much do we have left before the next paycheck, and what comes out before then?',
  'Why did my forecast change?',
  'What have we spent on groceries and eating out this month?',
  'Which bills are due in the next two weeks?',
  // About the app itself: the CFO is given a map of Ledger (server/howto.js).
  'What can Ledger do that I might not have found yet?',
];
// One more for a household with a side gig.
const gigIdea = (name: string) => `How much have I set aside for ${name} taxes, and how much should it be?`;

/** The seal from the owner's sketch: CFO in the middle, "Claude Financial Officer" round the ring. */
export function CfoSeal({ size = 96 }: { size?: number }) {
  // "Claude Financial Officer" where the CFO is Claude; "Chief Financial Officer" where a household uses
  // another model through its Home Assistant (the owner, 2026-11-24).
  const { claude } = useAi();
  return (
    <svg className="cfo-seal" viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <defs><path id="cfo-arc" d="M 50 50 m -34 0 a 34 34 0 1 1 68 0 a 34 34 0 1 1 -68 0" /></defs>
      <circle className="outer" cx="50" cy="50" r="47" />
      <circle className="inner" cx="50" cy="50" r="25" />
      <text className="ring"><textPath href="#cfo-arc" startOffset="1%" textLength="212" lengthAdjust="spacing">{claude ? 'CLAUDE' : 'CHIEF'} · FINANCIAL · OFFICER ·</textPath></text>
      <text className="mid" x="50" y="50" textAnchor="middle" dominantBaseline="central">CFO</text>
    </svg>
  );
}

/** The CFO in person: an owl in blue glasses and a bow tie. It blinks now and then, and looks from side to side while working on an answer. */
export function CfoOwl({ size = 120, thinking = false }: { size?: number; thinking?: boolean }) {
  return (
    <svg className={`cfo-owl ${thinking ? 'thinking' : ''}`} viewBox="0 0 120 132" width={size} height={size * 1.1} aria-hidden="true">
      <ellipse cx="60" cy="126" rx="30" ry="4" fill="#000" opacity="0.18" />
      <path d="M44 118l-5 6M48 119v6M52 118l4 6M68 118l-4 6M72 119v6M76 118l5 6" stroke="#e0a13a" strokeWidth="3" strokeLinecap="round" fill="none" />
      <ellipse cx="60" cy="84" rx="36" ry="38" fill="#6b4a2f" />
      <ellipse className="wing l" cx="27" cy="86" rx="9" ry="24" fill="#5a3d26" />
      <ellipse className="wing r" cx="93" cy="86" rx="9" ry="24" fill="#5a3d26" />
      <ellipse cx="60" cy="92" rx="23" ry="26" fill="#ecd9b8" />
      <path d="M50 88q3 3 6 0M64 88q3 3 6 0M57 98q3 3 6 0M50 106q3 3 6 0M64 106q3 3 6 0" stroke="#c9ad82" strokeWidth="2" strokeLinecap="round" fill="none" />
      <g className="head">
        <path d="M33 30l-5-19 19 9zM87 30l5-19-19 9z" fill="#5a3d26" />
        <circle cx="60" cy="46" r="31" fill="#7a5536" />
        <circle cx="46" cy="47" r="13.5" fill="#f6ead2" /><circle cx="74" cy="47" r="13.5" fill="#f6ead2" />
        <g className="pupils"><circle cx="46" cy="48" r="5.6" fill="#1d1a17" /><circle cx="74" cy="48" r="5.6" fill="#1d1a17" /><circle cx="48" cy="46" r="1.8" fill="#fff" /><circle cx="76" cy="46" r="1.8" fill="#fff" /></g>
        <g className="lids" fill="#7a5536"><rect x="32" y="33" width="28" height="28" rx="14" /><rect x="60" y="33" width="28" height="28" rx="14" /></g>
        <circle cx="46" cy="47" r="15" fill="none" stroke="#4a93ea" strokeWidth="3" /><circle cx="74" cy="47" r="15" fill="none" stroke="#4a93ea" strokeWidth="3" />
        <path d="M31 45l-5-3M89 45l5-3" stroke="#4a93ea" strokeWidth="3" strokeLinecap="round" />
        <path d="M60 53l-5 8h10z" fill="#e0a13a" />
      </g>
      <path d="M60 79l-12-7v14zM60 79l12-7v14z" fill="#4a93ea" /><circle cx="60" cy="79" r="3.4" fill="#2f6fc4" />
    </svg>
  );
}

/** Claude's answer: paragraphs, "- " bullets and **bold**, nothing else. */
function Answer({ text }: { text: string }) {
  const bold = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**') && p.length > 4 ? <b key={i}>{p.slice(2, -2)}</b> : p));
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => { if (list.length) { const items = list; blocks.push(<ul key={blocks.length}>{items.map((l, i) => <li key={i}>{bold(l)}</li>)}</ul>); list = []; } };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (/^[-*•]\s+/.test(line)) { list.push(line.replace(/^[-*•]\s+/, '')); continue; }
    flush();
    if (line) blocks.push(<p key={blocks.length}>{bold(line.replace(/^#+\s*/, ''))}</p>);
  }
  flush();
  return <>{blocks}</>;
}

/**
 * A bank screenshot or export file handed to the CFO (2026-11-24, the owner: "give CFO a current copy of my
 * bank statement so it can catch my ledger up"). It is the same reader as "Upload a receipt" and "Import a
 * file", behind the CFO's door: a picture is read by Claude and its rows come back to tick; a CSV is read by
 * the app itself. Nothing is added until the button is pressed, and what is added on a connected account
 * waits for the bank's own entry, so nothing is doubled when the bank catches up.
 */
function FileCard({ file }: { file: File }) {
  const csv = /\.csv$/i.test(file.name) || /csv/.test(file.type);
  const { data: accounts } = useData<any[]>('/api/import/accounts');
  const { data: cats } = useData<any[]>('/api/categories');
  const [accountId, setAccountId] = useState('');
  const [step, setStep] = useState<'pick' | 'busy' | 'ready' | 'done'>('pick');
  const [rows, setRows] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [pv, setPv] = useState<any>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!accounts?.length || accountId) return;
    let last = '';
    try { last = localStorage.getItem('ledger-add-account') ?? ''; } catch { /* private window */ }
    setAccountId(String((accounts.find((a) => String(a.id) === last) ?? accounts.find((a) => a.type === 'checking') ?? accounts[0]).id));
  }, [accounts, accountId]);
  // A CSV costs nothing to look at, so it is opened straight away.
  useEffect(() => {
    if (!csv) return;
    file.text().then(async (t) => { setText(t); try { setPv(await api('/api/import/preview', { method: 'POST', body: { csv: t } })); } catch (e: any) { setErr(e.message); } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const accountName = accounts?.find((a) => String(a.id) === accountId)?.name ?? 'the account';
  const pickAccount = (
    <label className="cfo-file-account">From which account?
      <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>{(accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
    </label>
  );
  const read = async () => {
    setErr(''); setStep('busy');
    try {
      const image = await shrinkPicture(file).catch(() => { throw new Error("That file isn't a picture the app can read. Use a screenshot, a photo, or your bank's CSV export."); });
      const r = await api('/api/transactions/scan', { method: 'POST', body: { image, account_id: Number(accountId) } });
      if (!r.items.length) { setErr("Nothing that looks like a transaction was found in that picture."); setStep('pick'); return; }
      setRows(r.items.map((it: any, i: number) => ({ ...it, key: i, on: !it.already, category_id: String(it.category_id) })));
      setStep('ready');
    } catch (e: any) { setErr(e.message); setStep('pick'); }
  };
  const edit = (key: number, change: object) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...change } : r)));
  const chosen = rows.filter((r) => r.on);
  const add = async () => {
    setErr(''); setStep('busy');
    let added = 0, failed = 0;
    for (const r of chosen) {
      try { await api('/api/transactions', { method: 'POST', body: { date: r.date, merchant: r.merchant, amount: Number(r.amount), category_id: Number(r.category_id), account_id: Number(accountId), direction: r.direction, force: true } }); added++; } catch { failed++; }
    }
    try { localStorage.setItem('ledger-add-account', accountId); } catch { /* private window */ }
    setNote(`${added} added to ${accountName}${failed ? `, ${failed} could not be added` : ''}. They count from now, and when the bank's own entries arrive they take these over, so nothing is counted twice.`);
    setStep('done');
    dispatchEvent(new Event('ledger-refresh'));
  };
  const bring = async () => {
    setErr(''); setStep('busy');
    try {
      const r = await api('/api/import', { method: 'POST', body: { csv: text, flip: pv.flipped, account_id: Number(accountId) } });
      const pend = (r.pendingAdded || 0) + (r.pendingKnown || 0);
      setNote(`${r.added} transaction${r.added === 1 ? '' : 's'} added to ${accountName}${r.skipped ? `, ${r.skipped} already there and skipped` : ''}.${pend ? ` ${pend} pending charge${pend === 1 ? '' : 's'} in the file: ${r.pendingAdded} added as waiting for the bank, ${r.pendingKnown} already entered.` : ''}`);
      setStep('done');
      dispatchEvent(new Event('ledger-refresh'));
    } catch (e: any) { setErr(/FOREIGN KEY/.test(e.message) ? 'Ledger is still showing its sample data, so there is no account of yours to add these to yet. Bring this file in once from Settings, "Import a file", which makes the account; after that it works from here.' : e.message); setStep('pick'); }
  };

  if (step === 'done') return <p className="good" role="status">{note}</p>;
  if (step === 'busy') return <p className="sub cfo-file-busy"><CfoOwl size={40} thinking /> {rows.length || csv ? 'Adding them' : 'Reading it'}<span className="cfo-dots"><i /><i /><i /></span></p>;
  if (csv) {
    return (
      <div className="cfo-file">
        {pv ? <p><b>{file.name}</b> has {pv.count} transaction{pv.count === 1 ? '' : 's'} from {dayShort(pv.from)} to {dayShort(pv.to)}{pv.pending ? `, plus ${pv.pending} pending` : ''}. Anything Ledger already has is skipped, and pending rows are added as waiting for the bank.</p> : !err && <p className="sub">Opening {file.name}</p>}
        {pv && <>{pickAccount}<div className="add-actions"><button className="primary" disabled={!accountId} onClick={bring}>Add them to {accountName}</button></div></>}
        {err && <p className="error" role="alert">{err}</p>}
      </div>
    );
  }
  if (step === 'pick') {
    return (
      <div className="cfo-file">
        <p>I can read <b>{file.name || 'that picture'}</b> and list what is in it for you to check. Nothing is added until you say so. The picture is sent to Anthropic to be read, and isn't kept.</p>
        {pickAccount}
        <div className="add-actions"><button className="primary" disabled={!accountId} onClick={read}>Read it</button></div>
        {err && <p className="error" role="alert">{err}</p>}
      </div>
    );
  }
  const known = rows.filter((r) => r.already).length;
  return (
    <div className="cfo-file">
      <p>I found {rows.length} in the picture{known ? `; ${known} ${known === 1 ? 'is' : 'are'} already in Ledger and left unticked` : ''}. Tick what to add to <b>{accountName}</b>.</p>
      <div className="cfo-file-rows scan-rows">
        {rows.map((r) => (
          <label key={r.key} className={`cfo-file-row ${r.on ? '' : 'off'}`}>
            <input type="checkbox" checked={r.on} onChange={(e) => edit(r.key, { on: e.target.checked })} />
            <span className="grow">{r.merchant}<small>{dayShort(r.date)}{r.already ? ` · already ${r.already === 'bank' ? 'at the bank' : 'entered'}` : ''}</small></span>
            <span className="cfo-file-end">
              <b className={`num ${r.direction === 'in' ? 'good' : ''}`}>{r.direction === 'in' ? '+' : '-'}{cents(Number(r.amount))}</b>
              <select aria-label={`Category for ${r.merchant}`} value={r.category_id} onChange={(e) => edit(r.key, { category_id: e.target.value })}>
                {(cats ?? []).filter((c) => (r.direction === 'in' ? c.kind !== 'expense' || String(c.id) === r.category_id : c.kind === 'expense' || c.kind === 'aside') || String(c.id) === r.category_id).filter((c) => !c.hidden || String(c.id) === r.category_id).map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}{c.kind === 'aside' ? ' (not counted)' : ''}</option>)}
              </select>
            </span>
          </label>
        ))}
      </div>
      {rows.some((r) => r.lines?.length) && <p className="sub">This looks like a receipt. Added here it goes in as one purchase; "Upload a receipt" in the + menu can split it by item.</p>}
      <div className="add-actions"><button className="primary" disabled={!chosen.length} onClick={add}>Add {chosen.length} to Ledger</button></div>
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}

/**
 * The CFO on a public demo copy (server/democfo.js): no question can be typed, since the demo has no AI.
 * It offers example questions and shows an answer written ahead of time for each, and says so in plain
 * words, with what a key on your own copy adds.
 */
function DemoCfo() {
  const { data } = useData<any>('/api/cfo/demo');
  const [turns, setTurns] = useState<{ q: string; a: string }[]>([]);
  const [busy, setBusy] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (turns.length) end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [turns]);
  const show = async (id: string) => {
    if (busy) return;
    setBusy(id);
    try { const r = await api(`/api/cfo/demo/${id}`); setTurns((t) => [...t, { q: r.q, a: r.reply }]); }
    catch (e: any) { setTurns((t) => [...t, { q: data.questions.find((x: any) => x.id === id)?.q || '', a: e.message }]); }
    setBusy('');
  };
  if (!data) return null;
  const group = (kind: string) => data.questions.filter((x: any) => x.kind === kind);
  const asked = new Set(turns.map((t) => t.q));
  const buttons = (kind: string) => group(kind).map((x: any) => <button key={x.id} type="button" disabled={!!busy} className={asked.has(x.q) ? 'asked' : ''} onClick={() => show(x.id)}>{x.q}</button>);
  return (
    <div className="cfo cfo-demo">
      <section className="card cfo-intro">
        <CfoOwl size={turns.length ? 72 : 128} thinking={!!busy} />
        <h2>Ask about your money, or about Ledger</h2>
        <p className="sub">On your own copy you type any question and Claude answers from your figures. <b>This demo has no AI connected, so these are example questions with answers written ahead of time</b>, filled in with the demo household's made-up figures. Choose one to see what an answer looks like.</p>
      </section>
      {turns.length > 0 && (
        <div className="cfo-thread" aria-live="polite">
          {turns.map((t, i) => (
            <div key={i}>
              <div className="cfo-turn you"><p>{t.q}</p></div>
              <div className="cfo-turn cfo"><small className="cfo-example">An example answer, written ahead of time</small><Answer text={t.a} /></div>
            </div>
          ))}
          <div ref={end} />
        </div>
      )}
      <section className="card cfo-demo-pick" data-go="cfo-demo">
        <h3>About your money</h3>
        <div className="cfo-ideas">{buttons('money')}</div>
        <h3>About using Ledger</h3>
        <div className="cfo-ideas">{buttons('app')}</div>
      </section>
      <p className="cfo-foot">With an Anthropic API key added in Settings on your own copy, the CFO answers whatever you ask in your own words. It looks up your real transactions, bills and forecast as it goes, remembers the conversation, reads a bank screenshot to catch Ledger up, looks up tax rules on official sites, and can propose a change for you to confirm. A question usually costs about a cent or less.</p>
    </div>
  );
}

export default function Cfo() {
  const gig = useGig();
  const ai = useAi();
  const { data: state } = useData<any>('/api/cfo');
  const { data: auth } = useData<any>('/api/auth/status');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [id, setId] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [turns, busy]);
  // A question drafted somewhere else in the app (a purchase someone isn't sure counts for tax) is put in the
  // box for them to read and send. It is never sent by itself: every question costs a little.
  useEffect(() => {
    const take = () => { try { const d = sessionStorage.getItem('ledger-cfo-draft'); if (d) { sessionStorage.removeItem('ledger-cfo-draft'); setQ(d); } } catch { /* private window */ } };
    take();
    addEventListener('ledger-cfo-ask', take);
    return () => removeEventListener('ledger-cfo-ask', take);
  }, []);

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    setQ('');
    setTurns((t) => [...t, { who: 'you', text }]);
    setBusy(true);
    try {
      const r = await api('/api/cfo/ask', { method: 'POST', body: { id, question: text } });
      setId(r.id);
      setTurns((t) => [...t, { who: 'cfo', text: r.reply, looked: r.looked, sources: r.sources, cost: r.cost, actions: r.actions }]);
    } catch (e: any) {
      setTurns((t) => [...t, { who: 'cfo', text: e.message, failed: true }]);
    } finally {
      setBusy(false);
    }
  };
  // Confirm or cancel a proposed change. Either way the buttons give way to what happened.
  const act = async (turn: number, action: string, confirm: boolean) => {
    const mark = (result: string, bad = false) => setTurns((ts) => ts.map((t, i) => (i === turn ? { ...t, actions: t.actions?.map((a) => (a.id === action ? { ...a, result, bad } : a)) } : t)));
    try {
      const r = await api('/api/cfo/act', { method: 'POST', body: { id, action, confirm } });
      mark(r.note);
      if (r.done) dispatchEvent(new Event('ledger-refresh'));
    } catch (e: any) { mark(e.message, true); }
  };
  const total = turns.reduce((a, t) => a + (t.cost || 0), 0);
  // A bank screenshot or export file: shown as a card in the conversation, which does the reading and adding.
  const attach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setTurns((t) => [...t, { who: 'you', text: `📎 ${file.name || 'A picture'}` }, { who: 'cfo', text: '', file }]);
  };
  const fileBox = <input id="cfo-file" className="camera-box" type="file" accept="image/*,.csv,text/csv" tabIndex={-1} aria-hidden="true" onChange={attach} />;

  if (auth?.demo) return <DemoCfo />;
  if (state && !state.ready) {
    return (
      <section className="card cfo-intro">
        <CfoOwl size={128} />
        <p className="sub">{state.limitNote || <>The CFO is Claude, so it needs AI switched on. Add an Anthropic key under <a href="#connections" onClick={jump(GO.ai)}>Settings, "AI recap and logos"</a>.</>}</p>
      </section>
    );
  }
  return (
    <div className="cfo">
      {turns.length === 0 ? (
        <section className="card cfo-intro">
          <CfoOwl size={128} />
          <h2>Ask about your money, or about Ledger</h2>
          {ai.plain ? <p className="sub">Your {ai.claude ? 'Claude' : 'Chief'} Financial Officer answers from this month's totals, your accounts, bills, debts and savings goals, using the AI set up in your Home Assistant. It also knows its way round Ledger, so you can ask how or where to do something. That is the basic CFO: it can't dig through single transactions, look up tax rules, read a screenshot or suggest changes. Those need an Anthropic key of your own, under <a href="#connections" onClick={jump(GO.ai)}>Settings, "AI recap and logos"</a>. It explains your figures; it doesn't give financial or tax advice.</p> : <p className="sub">Your Claude Financial Officer looks through your accounts, bills, budgets and taxes to answer. It also knows its way round Ledger: ask how to do something, where a setting is, or whether Ledger can do a thing, and it names the page and the button. It can look things up, read a bank screenshot or export file you hand it with the paperclip, and suggest a few changes (filing a transaction, a new category, a budget, a bill's name) that only happen when you tap Confirm. It is an AI and explains your figures; it doesn't give tax or investment advice.</p>}
          <div className="cfo-ideas">
            {[...(ai.plain ? IDEAS.filter((q) => !/forecast change/.test(q)) : IDEAS), ...(gig.on && !ai.plain ? [gigIdea(gig.name)] : [])].map((s) => <button key={s} type="button" onClick={() => ask(s)}>{s}</button>)}
            {!ai.plain && <label htmlFor="cfo-file" className="cfo-idea-file" role="button" tabIndex={0}>📎 Catch Ledger up with my bank: here's a screenshot or file</label>}
          </div>
        </section>
      ) : (
        <div className="cfo-thread" aria-live="polite">
          <div className="cfo-top"><button type="button" disabled={busy} onClick={() => { setTurns([]); setId(''); }}>↺ New conversation</button></div>
          {turns.map((t, i) => (
            <div key={i} className={`cfo-turn ${t.who} ${t.failed ? 'failed' : ''}`}>
              {t.who === 'you' ? <p>{t.text}</p> : t.file ? <FileCard file={t.file} /> : <Answer text={t.text} />}
              {t.actions?.map((a) => (
                <div key={a.id} className="cfo-action">
                  <span>{a.summary}</span>
                  {a.result ? <small className={a.bad ? 'bad' : 'good'} role="status">{a.result}</small> : (
                    <span className="cfo-action-buttons"><button className="primary" onClick={() => act(i, a.id, true)}>Confirm</button><button onClick={() => act(i, a.id, false)}>Cancel</button></span>
                  )}
                </div>
              ))}
              {t.who === 'cfo' && t.sources?.length ? (
                <div className="cfo-sources"><small>From the official page{t.sources.length > 1 ? 's' : ''}. Check there before relying on it:</small>
                  {t.sources.map((s) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.title}</a>)}
                </div>
              ) : null}
              {t.who === 'cfo' && !t.failed && (t.looked?.length || t.cost) ? (
                <small>{t.looked?.length ? `Looked at ${t.looked.join(', ')}` : ''}{t.looked?.length && t.cost ? ' · ' : ''}{t.cost ? `about $${t.cost.toFixed(2)}` : ''}</small>
              ) : null}
            </div>
          ))}
          {busy && <div className="cfo-turn cfo thinking"><CfoOwl size={46} thinking /><span>Looking through your accounts</span><span className="cfo-dots"><i /><i /><i /></span></div>}
          <div ref={end} />
        </div>
      )}
      <form className="cfo-ask" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        {fileBox}
        {!ai.plain && <label htmlFor="cfo-file" className="cfo-attach" role="button" tabIndex={0} title="Give your CFO a bank screenshot or file" aria-label="Give your CFO a bank screenshot or file">📎</label>}
        <textarea value={q} rows={1} placeholder="Ask your CFO a question" aria-label="Your question" disabled={busy}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(q); } }} />
        <button type="submit" className="primary" disabled={busy || !q.trim()}>Ask</button>
      </form>
      <p className="cfo-foot">
        Your question and the figures needed to answer it are sent to {ai.plain ? 'the AI set up in your Home Assistant' : 'Anthropic'}. Answers are an explanation of your own numbers, not financial or tax advice.
        {turns.length > 0 && <> {total > 0 ? `This conversation: about $${total.toFixed(2)}. ` : ''}The CFO remembers this conversation for two hours, or until you start a new one.</>}
      </p>
    </div>
  );
}
