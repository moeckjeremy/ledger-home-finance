// About Ledger: what it does and how to use it, in plain words, with a form at the end for asking
// for something or reporting a problem (server/feedback.js). Opened from "About" in the side menu,
// the phone's "+" menu and the top of Settings.
//
// The page is a list of topic titles. Choosing one opens a glass pop-up (since 2026-11-18, at
// The owner's request, in place of text unfolding under the title) that shows the topic a page at a
// time, with Back and Next, and a small example drawn from the app above the words where one helps
// (src/pages/AboutArt.tsx). The text lives in PAGES below, one entry per page.
//
// When a feature changes, change its paragraph here too: this page is the only manual there is.
import { isValidElement, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ART } from './AboutArt';
import { JUST_ADDED, UPDATES } from '../updates';
import { allNewsSeen, goToNews } from '../News';
import { api, useData, useGig } from '../lib';

// Each topic: its title, and a line saying what's inside.
const SECTIONS: [id: string, title: string, inside: string][] = [
  ['what', 'What Ledger is', 'What it does, and what it can’t do'],
  ['around', 'Finding your way around', 'Each page in a line'],
  ['money-in', 'Getting your money in', 'Bank connection, adding by hand, receipts, files'],
  ['forecast', 'The checking forecast', 'How “left before payday” is worked out'],
  ['budgets', 'Budgets and categories', 'Setting, organising and planning budgets, splitting a purchase, icons'],
  ['bills', 'Bills', 'What the Recurring page tracks'],
  ['goals', 'Savings goals and debt', 'Saving toward something, and paying things off'],
  ['taxes', 'How the tax estimate works', 'What it counts, and what it leaves out'],
  ['cfo', 'Ask your CFO', 'Questions about your money in plain words'],
  ['phone', 'Putting Ledger on your phone', 'Add it to your home screen like an app'],
  ['settings', 'Settings worth knowing', 'Appearance, paydays, password and more'],
  ['privacy', 'Privacy and where your data lives', 'Who can see what, and what the AI is sent'],
  ['updates', 'What’s new', 'What has changed in Ledger, newest first'],
  ['ask', 'Ask for something or report a problem', 'Send an idea, a problem or a question'],
];

/** One topic's title, as a large button. Its letters rise in a small wave when the pointer comes onto it, and a rule draws under it. */
function Topic({ n, onOpen }: { n: number; onOpen: () => void }) {
  const [id, title, inside] = SECTIONS[n];
  return (
    <section className="about-topic" id={`about-${id}`}>
      <button className="about-title" aria-haspopup="dialog" onClick={onOpen}>
        <span className="about-num" aria-hidden="true">{String(n + 1).padStart(2, '0')}</span>
        <span className="about-words">
          <span className="about-name" aria-label={title}>
            {title.split(' ').map((word, w, all) => (
              <span key={w} className="word" aria-hidden="true">
                {[...word].map((ch, i) => <span key={i} className="ch" style={{ '--i': all.slice(0, w).join('').length + i } as React.CSSProperties}>{ch}</span>)}
                {w < all.length - 1 ? ' ' : ''}
              </span>
            ))}
          </span>
          <span className="about-inside">{inside}</span>
        </span>
        <span className="about-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg></span>
      </button>
    </section>
  );
}

/**
 * About, "What's new": a short "Just added" list (JUST_ADDED in src/updates.ts), and behind one button
 * the full history (UPDATES) as a single scrolling list, a day at a time, each day folded to its date
 * and count until tapped. Nobody has to page through every fix to see what is new.
 */
function WhatsNew() {
  const [all, setAll] = useState(false);
  const total = UPDATES.reduce((n, [, items]) => n + items.length, 0);
  // Reading this page is what the dashboard's "New in Ledger" line asks for, so it stops asking.
  useEffect(() => { allNewsSeen(); }, []);
  return (
    <div className="whats-new">
      <p className="whats-new-head">Just added</p>
      <ul className="just-added">{JUST_ADDED.map(([title, text, more]) => <li key={title}><b>{title}</b><span>{text}{more?.go && <> <button type="button" className="link" onClick={() => goToNews(more.go!)}>Show me</button></>}</span></li>)}</ul>
      {!all ? <button className="whats-new-all" onClick={() => setAll(true)}>Everything that has changed ({total})</button> : (
        <div className="history">
          <p className="whats-new-head">Everything that has changed</p>
          {UPDATES.map(([date, items], i) => (
            <details key={date} open={i === 0}>
              <summary>{new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })}<small>{items.length} change{items.length === 1 ? '' : 's'}</small></summary>
              <ul>{items.map((x) => <li key={x}>{x}</li>)}</ul>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

/** The pop-up: one topic, a page at a time. Arrow keys turn the page, Escape or a click outside closes it. */
function Reader({ n, pages, start = 0, onClose, onTopic }: { n: number; pages: React.ReactNode[]; start?: number; onClose: () => void; onTopic: (n: number) => void }) {
  const [id, title] = SECTIONS[n];
  const [page, setPage] = useState(start);
  useEffect(() => setPage(start), [n, start]);
  const last = pages.length - 1;
  const go = (to: number) => setPage(Math.max(0, Math.min(last, to)));
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      // Typing in the form at the end shouldn't turn pages.
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return void (e.key === 'Escape' && onClose());
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setPage((p) => Math.min(last, p + 1));
      if (e.key === 'ArrowLeft') setPage((p) => Math.max(0, p - 1));
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [last, onClose]);
  const art = ART[id]?.[page];
  const next = n < SECTIONS.length - 1 ? SECTIONS[n + 1] : null;
  // Drawn straight under <body>: inside the page it would be pinned to the page's own glass panel, not the window.
  return createPortal(
    <div className="about-overlay" onClick={onClose}>
      <div className="about-pop" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="about-pop-head">
          <span className="about-num" aria-hidden="true">{String(n + 1).padStart(2, '0')}</span>
          <h2>{title}</h2>
          <button className="about-close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="about-page about-section" key={`${id}-${page}`}>
          {art && <figure className="about-art" aria-hidden="true">{art}<figcaption>An example, with made-up figures</figcaption></figure>}
          {pages[page]}
        </div>
        <footer className="about-pop-foot">
          <button onClick={() => go(page - 1)} disabled={page === 0}>Back</button>
          {pages.length > 1 && (
            <span className="about-dots" role="group" aria-label={`Page ${page + 1} of ${pages.length}`}>
              {pages.map((_, i) => <button key={i} className={i === page ? 'on' : ''} aria-label={`Page ${i + 1}`} aria-current={i === page} onClick={() => go(i)} />)}
            </span>
          )}
          {page < last
            ? <button className="primary" onClick={() => go(page + 1)}>Next</button>
            : next ? <button className="primary" onClick={() => onTopic(n + 1)} title={next[1]}>Next topic</button> : <button className="primary" onClick={onClose}>Done</button>}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/** The form at the foot of the page, and what this household has sent before. */
function Feedback() {
  const { data, reload } = useData('/api/feedback');
  const [kind, setKind] = useState('idea');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  if (!data) return null;
  const to = data.goesTo === 'host' ? 'the person who runs your copy of Ledger' : data.goesTo === 'you' ? 'your own list in Settings, Family requests' : 'this copy only';
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(''); setNote('');
    try {
      const r = await api('/api/feedback', { method: 'POST', body: { kind, text } });
      setText('');
      setNote(r.delivered ? 'Sent. Thank you.' : data.goesTo === 'nowhere' ? 'Saved.' : "Saved here, but it couldn't be passed on just now. Mention it to them directly as well.");
      reload();
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };
  const earlier = data.sent.length > 0 && (
    <>
      <div className="group-head"><span>{data.goesTo === 'github' ? 'Saved on this copy earlier' : "What you've sent"}</span></div>
      {data.goesTo === 'github' && <p className="sub">These were only ever saved here and reached nobody. If one still matters, report it on GitHub.</p>}
      {data.sent.map((f: any) => <div key={f.id} className="row"><span className="grow wrap">{f.text}<small>{f.kind === 'problem' ? 'A problem' : f.kind === 'question' ? 'A question' : 'An idea'} · {new Date(f.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{f.delivered || data.goesTo === 'github' ? '' : ' · not passed on yet'}</small></span></div>)}
    </>
  );
  // A copy you run yourself: there is no host to send to, so ideas and problems go to the project's page.
  if (data.goesTo === 'github' && /^https:\/\/github\.com\//.test(data.page || '')) return (
    <>
      <p className="sub first">If something doesn't work, is confusing, or is missing, the place to say so is Ledger's project page on GitHub, where the person who maintains it sees every report.</p>
      <div className="add-actions">
        <a className="button-link strong" href={`${data.page}/new`} target="_blank" rel="noreferrer">Report it on GitHub</a>
        <a className="link" href={data.page} target="_blank" rel="noreferrer">See what others have reported</a>
      </div>
      <ul className="sub github-notes">
        <li>You need a GitHub account, which is free.</li>
        <li><b>What you write there is public.</b> Leave out your figures, account numbers, passwords and anything else private. A screenshot shows your figures too: crop or cover them first.</li>
        <li>Say what you were doing and what you expected; for a problem, name the page you were on and the version (Settings, "Updates" shows it; inside Home Assistant, the app's Info tab).</li>
        <li>Nothing is sent from Ledger. The button only opens the page.</li>
      </ul>
      {earlier}
    </>
  );
  return (
    <>
      <p className="sub first">If something doesn't work, is confusing, or is missing, say so here. It goes to {to}. Say what you were doing and what you expected; for a problem, the page you were on helps.</p>
      <form onSubmit={send} noValidate className="about-form">
        <label className="field"><span>What is it?</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="idea">Something I'd like added or changed</option>
            <option value="problem">Something that isn't working</option>
            <option value="question">A question</option>
          </select>
        </label>
        <label className="field"><span>Tell us about it</span>
          <textarea rows={5} maxLength={2000} value={text} onChange={(e) => { setText(e.target.value); setErr(''); }} placeholder="On the Budgets page, I tried to…" />
        </label>
        <div><button type="submit" className="primary" disabled={busy || text.trim().length < 5}>{busy ? 'Sending…' : 'Send'}</button></div>
      </form>
      {err && <p className="error" role="alert">{err}</p>}
      {note && <p className="good" role="status">{note}</p>}
      <p className="sub">Please don't put passwords or account numbers in here.</p>
      {earlier}
    </>
  );
}

/** The words of a piece of the guide, read out of its markup (examples drawn from components have none). */
function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (isValidElement(node)) return textOf((node.props as { children?: React.ReactNode }).children);
  return '';
}

/**
 * Searching the guide (2026-11-26): for someone without AI, who can't ask the CFO "can I plan next month?"
 * and would otherwise have to guess which topic holds the answer. Every page of every topic is read into
 * plain text once; typing lists the pages that contain every word typed, with the sentence it was found in,
 * and choosing one opens the guide at that page. Nothing leaves the page.
 */
function GuideSearch({ pages, onOpen, q, setQ }: { pages: Record<string, React.ReactNode[]>; onOpen: (topic: number, page: number) => void; q: string; setQ: (v: string) => void }) {
  const index = useMemo(() => SECTIONS.flatMap(([id, title], n) => (pages[id] || []).map((pg, i, all) => ({ n, title, page: i, of: all.length, text: textOf(pg).replace(/\s+/g, ' ').trim() }))).filter((x) => x.text.length > 20), [pages]);
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  // "budgets" should find "budget".
  const forms = (w: string) => (w.length > 3 && w.endsWith('s') ? [w, w.slice(0, -1)] : [w]);
  const hits = !words.length ? [] : index.map((x) => {
    const low = x.text.toLowerCase(), head = x.title.toLowerCase();
    let at = -1, score = 0;
    for (const w of words) {
      const found = forms(w).map((f) => low.indexOf(f)).filter((i) => i >= 0);
      const inTitle = forms(w).some((f) => head.includes(f));
      if (!found.length && !inTitle) return null;
      if (found.length && at < 0) at = Math.min(...found);
      score += (inTitle ? 3 : 0) + Math.min(3, forms(w).reduce((a, f) => a + low.split(f).length - 1, 0));
    }
    const from = Math.max(0, low.lastIndexOf('. ', Math.max(0, at - 1)) + 2 > at - 110 ? low.lastIndexOf('. ', Math.max(0, at - 1)) + 2 : at - 60);
    const bit = x.text.slice(at < 0 ? 0 : from, (at < 0 ? 0 : from) + 170);
    return { ...x, score, bit: `${(at < 0 ? 0 : from) > 0 && !/^[A-Z“"]/.test(bit) ? '…' : ''}${bit}${x.text.length > from + 170 ? '…' : ''}` };
  }).filter(Boolean).sort((a, b) => b!.score - a!.score).slice(0, 8) as { n: number; title: string; page: number; of: number; bit: string }[];
  const mark = (t: string) => {
    const all = words.flatMap(forms).sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!all.length) return t;
    return t.split(new RegExp(`(${all.join('|')})`, 'gi')).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
  };
  return (
    <div className="settings-search guide-search">
      <label className="settings-search-box">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input type="search" value={q} data-go="guide-search" placeholder="Search the guide: plan next month, refund, backup…" aria-label="Search the guide" autoComplete="off" enterKeyHint="search"
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setQ(''); if (e.key === 'Enter' && hits[0]) onOpen(hits[0].n, hits[0].page); }} />
        {q && <button type="button" className="link" aria-label="Clear the search" onClick={() => setQ('')}>Clear</button>}
      </label>
      {words.length > 0 && (
        <div className="settings-hits" role="list">
          <small>{hits.length === 0 ? 'Nothing in the guide mentions that.' : hits.length === 8 ? 'The 8 closest places' : `${hits.length} place${hits.length === 1 ? '' : 's'} in the guide`}</small>
          {hits.map((h) => (
            <button key={`${h.n}-${h.page}`} type="button" role="listitem" className="settings-hit" onClick={() => onOpen(h.n, h.page)}>
              <span className="grow"><b>{h.title}</b>{h.of > 1 ? <em className="guide-page"> · page {h.page + 1} of {h.of}</em> : null}<small>{mark(h.bit)}</small></span><span aria-hidden="true">›</span>
            </button>
          ))}
          {hits.length === 0 && <p className="sub">Try a different word, or fewer words. If Ledger doesn't do what you're after, <button className="link" onClick={() => onOpen(SECTIONS.findIndex((x) => x[0] === 'ask'), 0)}>ask for it</button>.</p>}
        </div>
      )}
    </div>
  );
}

export default function About() {
  const gig = useGig();
  // A link such as #about/taxes opens straight to that topic.
  const [open, setOpen] = useState(() => SECTIONS.findIndex((s) => s[0] === (location.hash.split('/')[1] || '')));
  const [start, setStart] = useState(0);   // the page a topic opens on (a search result opens mid-topic)
  const [q, setQ] = useState('');
  // Each topic's text, a page at a time. The pop-up shows one page with Back and Next.
  const PAGES: Record<string, React.ReactNode[]> = {
    'what': [
      <>
        <p>Ledger keeps a household's money in one place. It shows what you have, what will come out of checking before your next payday, where your money goes each month against a budget, what you owe and how to pay it down, and roughly what you'll owe in tax.</p>
        <p>It is a private app, not a bank. <b>It can't move money, pay a bill or make a transfer.</b> It only reads what your bank reports and what you tell it. Its forecasts and tax figures are estimates to plan with, not promises.</p>
      </>,
    ],
    'around': [
      <>
        <ul><li><b>Dashboard.</b> The day-to-day view: what's left before payday, what's in checking, this month's spending against your budget, a short written recap, and the bills and paychecks coming up. "Choose what shows here", at the foot of the page, hides any card you don't use; that choice is kept on each device.</li><li><b>Transactions.</b> Every purchase, payment and deposit. Change a category, split a purchase across categories, search, and add things by hand.</li><li><b>Budgets.</b> A monthly amount for each kind of spending, and how much of each you've used. Categories can be put in your own order and groups, and next month can be planned before it starts.</li></ul>
      </>,
      <>
        <ul><li><b>Recurring.</b> The bills Ledger has noticed coming round, with when each is next due.</li><li><b>Debt.</b> Cards and loans, with a plan for which to pay off first and when you'd be clear.</li><li><b>Accounts.</b> Every account and its balance, your net worth over time, and your savings goals. An account can be left out of the budget.</li></ul>
      </>,
      <>
        <ul><li><b>Reports.</b> Where a month's money went, in one picture, and spending over the months.</li><li><b>Taxes.</b> An estimate of this year's United States federal and state income tax. Outside the United States it can be switched off in Settings, "Tax section".</li><li><b>Settings.</b> SimpleFIN Sync (the bank connection), paydays, currency, appearance, password and the rest, with a search box at the top.</li></ul>
      </>,
      <>
        <p>The round <b>+</b> button, on every page, adds a purchase or a deposit, reads a receipt or a bank screenshot, or records a transfer. The seal under the menu (the middle of the Menu on a phone) opens <b>Ask your CFO</b>. The box at the top of this guide searches all of it.</p>
        <p><b>Feature of the week.</b> On a computer, a small card under "Ask your CFO" names one thing in Ledger you could use and haven't set up yet, such as a savings goal or your paydays. It only suggests what applies to your household, with a new one each Monday. "Tell me more" opens a short description: "Show me" takes you straight there, and "Ignore" means that one is never suggested again. Once you've opened it, it is put away until the next Monday. Settings, "Feature of the week" switches the whole thing off, and has "Show me another feature of the week" if you'd like to be pointed at one right away, on a phone too.</p>
      </>,
    ],
    'money-in': [
      <>
        <p>There are four ways, and you can mix them.</p>
      </>,
      <>
        <ul><li><b>Connect your bank</b> (Settings, "SimpleFIN Sync", where the box for your SimpleFIN setup token is). This uses SimpleFIN Bridge, a separate service that costs $1.50 a month or $15 a year, paid to them. Your bank password is typed on their site and never reaches Ledger. <b>It runs about a day behind:</b> SimpleFIN visits each bank roughly once every 24 hours, so a purchase made this morning may not show until tomorrow. The dashboard says when the bank's figures were last updated and when the next update is expected. Banks sometimes ask you to sign in again at SimpleFIN; when one does, or an account's figures haven't moved in five days, a line at the top of the dashboard says so.</li><li><b>Add it yourself.</b> Press + and type the purchase. It counts toward your spending and your checking estimate straight away, marked "waiting for the bank". When the bank's own entry arrives, it takes over that line and keeps your category and note, so nothing is counted twice.</li><li><b>Read a receipt.</b> On a phone, press + and choose <b>Read a receipt</b>: the camera opens straight away, you photograph the receipt, and your CFO's owl reads it. It then says in a sentence where you shopped, what for, how much and on which account, with the details underneath for you to check and correct before anything is added. If the receipt covers more than one kind of spending (food, clothing and medicine in one trip), it sorts the items into your categories and suggests a split. Each tax on the receipt goes with the items it was charged on (alcohol and food are taxed differently from other things), as far as the receipt shows. Open "Review the items" to see every item and where it was filed, and move any of them to another category; the split follows. Or choose "Keep it as one purchase". If your bank has already listed that purchase, nothing is added twice: Ledger offers to split the one that's there. <b>Upload a receipt</b>, in the same menu, is for a picture you already have: an older photo of a receipt, or a screenshot of pending charges from your bank's app, which it reads row by row. Nothing is added until you've checked it. A receipt's picture is kept with its purchase: choose <b>Receipt</b> on that line to see it again.</li><li><b>Import a file</b> (Settings, Import a file). A CSV export from your bank, for accounts the connection can't reach. Importing the same months twice doesn't double anything. If your bank offers no CSV, <b>Read a PDF or photo of a statement</b> in the same place has Claude list the statement's transactions for you to check before any are added.</li></ul>
      </>,
      <>
        <p>Without a bank connection you can still keep accounts by hand: add them with today's balance in the setup guide or with "Add an account by hand" on the Accounts page, and add purchases as you make them.</p>
        <p><b>Accounts you keep yourself.</b> On the Accounts page, "Add an account by hand" makes one with today's balance. From then on its balance follows the purchases, deposits and transfers you enter on it. "Set balance" corrects it whenever it drifts from the real figure, and an account with nothing on it can be removed.</p>
        <p><b>Leaving something out.</b> If the bank posts a charge twice, or something shouldn't count as spending, choose "Leave out" in its fine print on the Transactions page. It stays in the list with a "left out" tag but no longer counts toward your spending, budgets or income, and "Put back" undoes it. Nothing is deleted.</p>
        <p><b>Fixing a mistake.</b> Anything you typed in has "Edit" in its fine print on the Transactions page, for its name, amount and date. What the bank reported can't be changed, only filed, split or noted. The search box also finds an amount.</p>
        <p><b>Money coming in.</b> The <b>+</b> button also has "Add a deposit", and the add form has a switch at the top: Money out or Money in. A deposit starts as "Other deposits", which counts as neither income nor spending: right for a gift, card rewards, money you moved, or anything you're unsure of. Pay goes under Income. A refund or a reimbursement goes under the category the spending was in, so it counts against that spending.</p>
        <p><b>What counts as income.</b> Only what you've told Ledger is pay: deposits that match your Paydays (Settings, Income) or your side gig, deposits your bank words as payroll, and anything you file under Income yourself. Every other deposit the bank reports goes to "Other deposits", where "It's income" or "It's a refund" in its fine print refiles it with one tap. Ledger never guesses that money is income. A deposit you add on a bank account waits for the bank's own entry, as a purchase does, and counts toward your checking estimate in the meantime.</p>
      </>,
    ],
    'forecast': [
      <>
        <p><b>In checking now</b> is the bank's posted balance with pending and waiting purchases already taken off, so it is closer to what you can really spend than the balance alone. Transactions shows how it was worked out.</p>
        <p><b>Left before payday</b> starts from that figure and takes off every bill due before your next paycheck. It is the number to watch. If you have no regular payday, the tile shows the lowest point checking will reach in the next five weeks instead.</p>
      </>,
      <>
        <p>The outlook card lists each bill and paycheck with the balance after it. If you know what a bill or paycheck will really be, or that it will come on a different day (a holiday, a bonus), choose <b>Change</b> on its row and set the amount or the date; it applies to that one bill or payday. A paycheck that arrives a few days early is recognised when it reaches the app, and a one-off bonus doesn't change what the app expects next time. If a bill is already pending at your bank, choose <b>It's pending at the bank</b> so it isn't taken off twice.</p>
      </>,
      <>
        <p>Paydays come from Settings, Paydays. A payday can be a paycheck from a job, Social Security or other benefits, a pension, or other regular income: all of them count as income, and only a job is ever asked for a pay stub. If the forecast looks wrong, that and the Recurring page are the first places to check.</p>
      </>,
    ],
    'budgets': [
      <>
        <p>Each purchase is filed in a category, and each category has a monthly budget. Ledger files most things itself from the merchant's name. When it gets one wrong, change the category on the Transactions page; you'll be offered "every purchase from this merchant", which also teaches it for next time.</p>
        <p><b>Give every dollar a job</b> (Budgets page, "Choose your budgeting method" at the foot). A second way to budget that you can switch on, and off again without losing anything. Instead of a set amount per category, the money comes first: pay that has arrived shows as "To be assigned", and you hand it out to categories until that reads zero. The box beside each category is what you give it this month; a category can only spend what it has been given, what it doesn't spend stays in it for later months, and overspending comes off it. When a category runs over, "Move it" covers it from one with room. "Fill empty ones with my usual amounts" gives a month a quick start. Months before you switched it on keep the budgets they had, and your set amounts come back if you switch it off. "How this works" on that page walks through it with an example.</p>
        <p><b>A budget month that starts on your day.</b> Budgets run with the calendar unless you say otherwise. If your money works around another day, such as payday on the 20th, open <b>When your budget month starts</b> at the foot of the Budgets page (or Settings, Budget month) and choose a day from the 1st to the 28th. Your budget month then runs from that day to the day before it in the next month, and is named for the month it starts in. Budgets, what's spent and left, carry-over, planning ahead, reports by month, the recap and the summary email all follow it. Taxes, the bills calendar, the checking forecast and net worth stay on real dates. Changing the day cuts earlier months again, so their totals shift a little; nothing is deleted.</p>
        <p><b>Carry over</b> (Budgets page). Switch it on for a category and whatever is left of its budget at the end of a month is added to the next month's, while anything overspent comes off it. It suits things you save up for or that come in lumps: clothing, gifts, car repairs. It starts with the month you switch it on, and the row shows what was carried.</p>
        <p><b>Leave an account out of the budget</b> (Accounts page). For personal "fun money" accounts, a child's account, or anything you want to see but not count. Its balance still shows and still counts in net worth, but what is spent from it no longer counts toward your budgets, totals or the checking forecast. To count the money you set aside for it, file the transfer from your main account under a category of its own, such as "Fun money". One purchase on a left-out account can still be counted by choosing a category for it by hand. Switch it back with "Count in the budget" and everything returns to where it was.</p>
        <p><b>Suggested budgets</b> (Budgets page) proposes an amount for each category from what you've really spent over the last few months, or from your take-home pay if it hasn't seen a full month yet. You see the suggestions and can change them before anything is saved.</p>
      </>,
      <>
        <p><b>Refunds.</b> When a shop pays you back, choose <b>It's a refund</b> under that line on Transactions. Ledger files it under the category of the purchase it refunds, so it comes off that spending and doesn't look like income.</p>
        <p><b>Splitting a purchase.</b> When one trip covers two things, such as groceries and clothes at the same store, choose <b>Split</b> under the purchase on Transactions, and say how much belongs in another category. "Undo split" puts it back.</p>
      </>,
      <>
        <p><b>Logos and icons.</b> Ledger shows a company's logo beside its purchases where it can find one. To set or change one, click the icon wherever you see it: beside a transaction, a bill, an account, a row in the dashboard's outlook or recent activity, or in a report. A category's icon changes the same way: click it on Budgets or the dashboard and pick another. You can take a logo from a website (type the company's address, such as kroger.com), choose a picture of your own, or pick <b>Ask Claude to draw one</b>: say what it should show, such as "a silver SUV" or "a pair of scissors", look at the preview, and keep it or ask for another. Drawn icons are simple, flat pictures, and it draws the thing itself, not a company's logo. Whatever you choose applies to every transaction with that name.</p>
      </>,
      <>
        <p>Make your own category wherever a category is chosen: every category menu ends with <b>New category…</b>, whether you're adding a purchase or a bill, reading a screenshot, splitting a purchase or moving several at once. The Budgets page has it too. To rename one, click its icon anywhere, or choose Organise beside it on the Budgets page; purchases keep being filed in it under the new name. <b>Planning next month.</b> "Plan next month's budget" at the top of the Budgets page opens the coming month before it starts. Amounts typed there begin on the 1st and stay until you change them, and this month is left alone. With "give every dollar a job" switched on, it is where you hand out next month's money ahead of time. To change the order, use the arrows beside a category on the Budgets page ("⋯" on a phone); every category menu follows it. <b>Organise</b>, beside each category, moves it between flexible spending and fixed bills or into a group of your own (Giving, Food, Kids, whatever suits you), merges it into another category so its history goes with it, hides one you no longer use without losing its past, or leaves a category out of the budget altogether: what is filed there (work expenses you are paid back for, say) counts in no budget, total or report, and the Budgets page shows what went out and what came back. Accounts and savings goals have the same arrows, and on a phone "Choose what shows here" at the foot of the dashboard puts its cards in your own order. Remove is in Organise too: anything filed in a removed category moves to Other and its history is lost, so to keep the history use Merge or Hide instead. Transfers between your own accounts and card payments are filed as Transfer and don't count as spending.</p>
      </>,
    ],
    'bills': [
      <>
        <p>The Recurring page lists bills Ledger has spotted repeating, and feeds them into the forecast. A bill whose amount changes with the seasons, like electricity, is estimated from past years where it has them.</p>
        <p><b>Worth knowing</b>, at the top of that page, lists any bill whose price went up since last time, and adds up your once-a-year bills into the amount to put aside each month so none of them is a scramble.</p>
        <p><b>Bills on their own rhythm.</b> A bill you add yourself can come round every month, once a year, or every week, 2 weeks, 4 weeks, 8 weeks, 2 months, 3 months or 6 months, counted from its next due date. The forecast takes it out each time it falls due, and the monthly total counts its average share.</p>
        <p><b>Undo.</b> Removing a bill, or a transaction you typed, shows "Undo" at the foot of the screen for a few seconds. It puts back everything that went with it: both sides of a transfer, the parts of a split, a receipt's picture.</p>
        <p>Use <b>Rename</b> to give a bill a name you'd recognise ("Water" in place of the utility company's wording). If a bill shown there isn't really a bill, you can hide it.</p>
        <p><b>A calendar of your bills.</b> At the top of the Recurring page, switch from List to Calendar to see a month with each bill on its day and a green dot on paydays. Choose a day to see what's due, or to add a bill on that day without leaving the calendar. The arrows look at other months.</p>
        <p><b>A pay link.</b> "Add a pay link" on a bill saves the web address of the page where you pay it, and "Pay it" then opens that page in a new tab, so you don't have to hunt for it each month. Ledger never pays anything itself and holds no card details: the paying happens on the company's own site.</p>
      </>,
    ],
    'goals': [
      <>
        <p><b>Investments</b> (Accounts page). Each investment account shows how its value has changed over a month, three months, this year and a year, with any money you paid in shown beside the change. Where your bank lists what is inside the account, the holdings appear by themselves with their value and, if the bank knows it, the gain against what you paid. For an account kept by hand, or one whose bank lists nothing, choose <b>Add a holding</b> and type them in. Prices are not looked up unless you switch that on at the foot of the Investments card. Switched on, Ledger asks Yahoo Finance for the price of each ticker symbol a few times a day (only the symbols are sent) and values a holding you typed with a share count at shares times that price; a holding your bank reports keeps the bank's value. Switched off, a typed value is as current as you keep it.</p>
        <p><b>Whose is what</b> (Accounts page). Each account can be marked as one adult's or as shared, from the small menu on its row, or the ⋯ on a phone. Once any is marked, the Accounts page shows what each person has, owes and has spent this month, and Transactions and Reports can be narrowed to one person's accounts or the shared ones. It is only a way of looking: budgets, the forecast and the tax estimate still cover the whole household, and everyone who signs in still sees everything.</p>
        <p><b>Check a statement</b> (Accounts page, on a checking, savings, card or health savings account). Type the statement's first and last day and the balance at each end. Ledger adds up what it has for those days and tells you whether it comes to the same. If it doesn't, it gives the difference and what could explain it: something entered twice, something missing, an entry dated just the other side of the line, or an amount typed the wrong way round. A check changes nothing by itself; you fix what it finds on the Transactions page and check again. The next check starts where the last one ended. It is most use on an account you keep by hand, where nothing else would catch a slip.</p>
        <p><b>Your home and other property.</b> Net worth counts your mortgage and car loans, so it should count what they paid for too. On the Accounts page, "Add an account by hand" has "A home, vehicle or other property": give it a name and type what it's worth. Update it whenever you like with "Set value". As you add it, and afterwards under "How its value is kept" on its row, you choose between two ways. <b>Type it in:</b> buttons open Zillow for a home or Kelley Blue Book for a vehicle in your own browser, you can save the page where you check it, and nothing is sent anywhere. <b>Look it up each month:</b> for a home in the United States, Ledger asks RentCast, a property data service, for an estimate once a month. That needs a free key you make at RentCast (the steps are shown there) and the home's address, which is sent to RentCast and kept in your Ledger. Typing a value yourself switches the monthly lookup off for that property. <b>Lower it each month:</b> for a car or truck. You type what it's worth today and give its model year and kind (car, SUV, pickup, hybrid or electric), and Ledger lowers the value a little each month, the way a vehicle loses value: fastest in its first year, about 8% a year at one and two years old, 10% from three to six and about 13.5% from seven, a little more for an SUV and a little less for a pickup. The figures began from published studies (the Bureau of Labor Statistics and iSeeCars) and were fitted to Kelley Blue Book values looked up by hand for about thirty popular models in November 2026, and one model can differ a lot from its kind, so you also say how well yours holds its value (well, about average, poorly), which takes about a quarter off or adds about half, or you can type a rate of your own instead. It is an estimate by a rule of thumb, not a Kelley Blue Book value, and nothing is sent anywhere. Check Kelley Blue Book once or twice a year, type the new figure, and the lowering carries on from there. <b>Mileage:</b> when you read a fuel receipt, your CFO asks what the odometer says ("Not now" skips it), and the same panel has a box for it. Once two readings are a couple of months apart, Ledger works out the miles a year and adjusts the rate: about a third of a point (half for a pickup or electric) for each 1,000 miles a year above or below a typical 12,000, unless you typed a rate of your own. For a vehicle kept at a typed value the readings don't change the value; the latest one is shown beside the Kelley Blue Book button, which asks for it. The readings stay in your copy. The model year and kind can be filled in from the VIN if you'd rather not type them (optional; see the privacy topic for what that sends).</p>
        <p><b>Months of expenses covered</b> (Accounts page). Once Ledger has a finished month of spending, a card shows how long your savings would last at your usual spending: your savings accounts, divided by the average of the last three finished months. An account set aside for taxes is left out. It is one figure, not a target.</p>
        <p><b>Savings goals</b> (Accounts page). Name what you're saving for, the amount, and a date if you have one. Link it to an account and what's in that account counts toward it automatically, or keep track yourself. With a date, it shows how much to put away each month. If two goals use one account, the first goal you made is filled first. A goal can also follow your tax bill: choose "What I'll owe in tax" and its amount comes from the Taxes page and moves with it, so you can see how much of your tax money is put away.</p>
        <p><b>Allowances</b> (switch it on in Settings; it then sits on the Accounts page). A notebook of what you hold for each child. Give a child a weekly allowance and Ledger adds it on its day; "Add money" is for chores and gifts, and "Record spending" for what they spend. If you like, each allowance is shared between spend, save and give, and a child can have something they are saving for. It is only a record: the money stays wherever you keep it, and no balance or total elsewhere in Ledger counts it. Nothing about it is sent to Claude.</p>
        <p><b>Trying a different plan.</b> On the Debt page, "Try a different plan" sets two payoff orders side by side: smallest balance first, which the page follows, and highest rate first. Each shows the month you'd be clear and the interest from here. Two boxes let you try another monthly extra or a one-time amount and see what each would do. It changes nothing, and it doesn't say which order is better: that is yours to choose.</p>
        <p><b>Graphs, extra payments and loan forgiveness.</b> On the Debt page, "Show graph" on a debt draws its balance heading to zero and how each year's payments split between principal and interest; "Your debts over time" stacks them all. A debt's graph has "Upload past statements": earlier statements fill in its past with the lender's own figures. Once a debt has three statements uploaded, Ledger knows roughly when the next one is due and reminds you on the dashboard a few days after, if it hasn't been uploaded; Settings, Alerts has the switch. Under a debt's graph, "What stands out" lists a few plain facts from its statements, such as how far it has moved in six months, the interest so far this year and whether it is rising, and how often a card was paid in full. They are worked out by Ledger itself, not written by AI, and "Ask your CFO about this debt" puts a question in the CFO's box if you want it talked through. "Extra you add every month" is for extra principal you pay automatically, and the row says what it saves. A federal student loan has one more line: if you work for a public school, a government or a nonprofit, the loan may be forgivable after 120 qualifying payments. Ledger does not decide whether you qualify. It points you to studentaid.gov for your count, lets you type that count to track progress, and has a switch that keeps the payoff plan from sending spare money to a loan you expect to be forgiven.</p>
        <p><b>Uploading statements.</b> "Upload debt" on the Debt page takes one statement or several at once, as PDFs or photos. Claude reads each one's closing balance, payment, interest, minimum and rate (and says so if a promotional rate is about to end), and you choose which account each belongs to. Then you decide what to keep: a point on that debt's graph, its rate and payment from the newest statement, and, only if you tick it, the transactions listed. The files are sent to Claude to be read and are not kept.</p>
        <p><b>Paying in parts.</b> Each debt shows what has gone toward it so far this month, however many payments that came in, against its usual payment: how much is still to go, or how much you are ahead. On a card, <b>Record a payment</b> opens a short form for a payment you have just made, of any amount: it leaves your checking forecast at once and counts toward the month, and the bank's own entry takes its place when it arrives. A mortgage is left out, because its payment includes escrow.</p>
        <p><b>Debt.</b> Enter each card's interest rate and minimum payment on the Debt page. Ledger then shows the order to pay them off, what you can put toward debt each month beyond the minimums, and when you'd be clear. A card you clear every month isn't really a debt: tick "I pay this card in full every month" on its row and it leaves the payoff order and the debt-free date.</p>
      </>,
    ],
    'taxes': [
      <>
        <p><b>Your state comes first.</b> Ledger assumes no state. The first time you open Taxes it shows a map of the United States: tap your state (or choose it from the list) and the estimate appears. You can change it later under "Your household". If you live outside the United States, the tax section has nothing useful to say: switch it off on that first screen or in Settings, "Tax section", and it leaves the menu.</p>
        <p>The Taxes page estimates this year's <b>federal and state</b> income tax. Your state is the one you chose on the map, and can be changed under "Your household". Arkansas, where Ledger began, is worked out in detail. Every other state uses a simpler table of its rates, standard deduction and personal exemptions, so treat that figure as rough; states with no income tax show federal only. It is an estimate for planning, not tax advice and not a tax return.</p>
      </>,
      <>
        <p><b>What it works from:</b> how you file (married filing jointly or separately, single, or head of household), each person's pay for the year and pre-tax deductions such as retirement and health premiums, and any deductions you list. Under <b>More about your household</b> on that page you can add whatever else applies, and each one changes the estimate: your ages, each child's or dependent's birth year, other jobs held this year, Social Security, pensions and retirement withdrawals, unemployment pay, interest and investment income, rental profit, student loan interest, child care, college tuition, mortgage interest, property taxes, giving, medical bills, and insurance bought on the Marketplace. Leave blank anything that doesn't apply.</p>
      </>,
      <>
        <p><b>Credits it works out for you:</b> the child tax credit ($2,200 under 17) and the $500 credit for older children and other dependents, the earned income credit for lower incomes, the child care credit, the college credit, and the larger deductions from age 65. "How the federal figure adds up" under the estimate lists each one.</p>
        <p><b>Changed jobs this year, or have two?</b> Add the last pay stub from each job, one after the other, choosing "Another job this year" for the second. Ledger keeps one stub per job and adds them together. Without stubs, put the main job's pay for this calendar year in the salary box and each other job under "Other jobs this year".</p>
      </>,
      <>
        <p><b>How a side gig pays.</b> In Settings, Side gig, each gig has "how it pays", which tells the forecast what to expect. <b>It varies</b>: the average of recent deposits. <b>About the same each time</b>: you say roughly what a week or a month brings in. <b>By booked sessions</b>: Ledger reads your booking calendar and works out pay at your rate, by the hour or per session, paid on the day, weekly or monthly; good for tutoring, lessons and anything by appointment. <b>By the job</b>: you type each job in with what you expect and when; good for a handyman, a contractor or freelance projects.</p>
        <p>Three things keep that forecast honest. Past your last booked session, and in any week with no job typed in, Ledger uses an estimate (your rough figure, or the average of recent deposits) and labels it as one, so the forecast doesn't show you earning nothing. A job whose pay day has gone by moves to <b>Owed to you</b> and stays there until you say it was paid, is still coming, or is written off; the dashboard mentions it. And when a deposit close to a job's amount arrives, Ledger ticks that job off only if it is the one job it could be; otherwise it asks you which. The calendar is read, never changed, and Ledger keeps the times of events, not who they are with.</p>
        <p><b>More than one side gig.</b> In Settings, Side gig, "Add another side gig" keeps a second or third kind of side income apart, each with its own name and deposits, and says whose it is. Income that never reaches the bank (cash, tips) can be typed in as a yearly figure for each.</p>
        <p><b>Paying during the year.</b> If nobody withholds tax from your income, the IRS expects it in four payments (April 15, June 15, September 15 and January 15). "Paying it" on the Taxes page shows about how much each should be.</p>
      </>,
      <>
        <p><b>Not sure whether something counts?</b> Each row of "Purchases that might count" has "Not sure". Say what the purchase was for, then choose. "Ask your CFO" puts a question in the CFO's box about how that rule works. "Ask your tax preparer" sets the purchase aside under "Questions for your tax preparer"; and opens an email to them straight away, written by Ledger and covering everything you've set aside, for you to read and add to (exactly what was bought, say). Their email address is asked for once. Send it from Ledger (it goes from your own email, the one set up for the summary email, so their reply comes to you, and it can carry the receipts) or open it in your own email app. Nothing is sent until you press Send. When the answer comes, press Yes or No on each one.</p>
        <p><b>Documents for your tax preparer (off unless you turn it on).</b> Under "Tax pack", Ledger can keep your tax forms and year-end statements, such as a W-2, a Form 1098 or a lender's statement, and print them with the tax pack so the hand-over is one printout. These papers carry Social Security and account numbers, so it stays off until you switch it on. Switched on, they are kept in your Ledger's own database and its backups on the server your Ledger runs on; they are never sent to Claude or anyone else and never emailed, and they appear only in the version you download "with the documents". Switching it off removes them.</p>
        <p><b>Receipts for what you claim.</b> Any purchase can have a picture of its receipt kept with it: "Add a receipt" on the purchase in Transactions, on a row of "Purchases that might count", or in the tax pack's list of claimed purchases that have none. The tax pack shows how many of your claimed purchases have one, and "Download it with the receipts" prints each receipt on a page of its own after the summary. Your preparer usually only needs the totals; the receipts are your proof if the tax office ever asks. The emailed tax pack leaves the pictures out, because they would make it too large to send.</p>
        <p><b>Questions for your tax preparer.</b> Under "Tax pack" you can write any question or note you want to remember for them. Each is printed near the front of the tax pack PDF until you remove it, together with any purchases you set aside with "Ask your tax preparer" and haven't had an answer on.</p>
        <p><b>The tax pack.</b> At the foot of the Taxes page, one PDF gathers what a tax preparer would ask for: your household, wages, side income, every purchase you claimed, other deductions, tax already paid and Ledger's estimate. Download it, or email it to yourself or your preparer. In January, after the year ends, Ledger emails you a copy by itself.</p>
        <p><b>Purchases that might count.</b> On the Taxes page, Ledger lists this year's purchases whose shop name suggests a tax break: classroom supplies if there's a teacher in the house, gear and software if there's a side gig, child care if there are children, and giving, medical bills and property tax for everyone. It goes by the name alone and can't see what was bought, so each is only a maybe. Say Yes or No, and tick the box to give the same answer for every purchase from that shop. A yes on a classroom or side-gig purchase claims it; a yes on the others adds to a total, and "Use" puts that total into the estimate. Nothing changes until you answer, and a tax preparer is the one to ask whether something really counts.</p>
        <p><b>Finding your way round the Taxes page.</b> The top shows where you stand in four figures: the year's tax, what has been paid in so far out of your paychecks (with the date of the newest pay stub it is counted from), what is left for you to pay, and the next payment due with its date. "Where you stand" beside them draws the year's tax as one bar: paid in, still coming out of this year's remaining paychecks, and left to pay. Under it, "Needs your attention" lists only what is waiting on you (a pay stub that's due, purchases to say yes or no to, a question for your tax preparer), and each line takes you to it. Everything else is folded under three headings, each row showing a one-line summary until you open it: what the estimate is built from, ways to lower it, and what you need at tax time. Ledger remembers which rows you leave open on each device.</p>
        <p><b>Making a payment.</b> Ledger can't pay tax for you, but "Pay the IRS (Direct Pay)" and "Pay Arkansas (ATAP)", beside the next payment and under "Paying it", open the government's own sites and say what to choose there. Afterwards, type what you paid under "estimated payments made" so it counts.</p>
        <p><b>Where the figures come from.</b> "Where do I find these figures?" on the Taxes page opens a list of every figure it asks for with the form and the line or box to read: pay stubs and W-2s for pay and tax withheld, last year's Form 1040 (or the Form 8879 you signed) for last year's total tax, Forms 1098, 1098-E and 1098-T for mortgage interest, student loan interest and tuition, and so on.</p>
        <p><b>Fill in from a pay stub.</b> Under "Pay stubs". Upload a recent stub as a PDF, photo or screenshot. Ledger reads this check's and the year-to-date figures, shows them for you to correct, and works out the full year. The section opens with a ring of twelve months, with a band for each adult: blue where a pay stub covers the month, amber when this month's is due, red when a month has gone by with nothing entered, and faint when it isn't time yet. Choose a month to see who is in and to upload or type a stub for it, or to mark it "No pay this month". One stub covers every month back to when the job began, so the newest stub from each job is enough. Once every earner has a stub in, it can tell you whether you're likely to owe or get a refund. If someone with wages has no stub in for the year, theirs is more than four months old, a regular paycheck has changed in amount since it was added, or it's the end of the year and their last stub isn't in, the dashboard shows a reminder with a button that takes you straight to the form (give each adult's first name in "Your household" and it says whose it means), and the summary email mentions it about once a month. If you'd rather not be reminded, switch off "Remind us to add pay stubs" in Settings, Alerts; that turns it off for the whole household.</p>
      </>,
      <>
        {gig.on ? <p><b>{gig.name}, your side income.</b> Nobody takes tax out of it, so the page shows the extra tax it adds, including self-employment tax, and what share of each payment to set aside. Purchases you claim as its business expenses lower that tax. If you name a savings account for tax money, the page compares what's in it with what you owe so far.</p> : <p><b>Side income.</b> If someone earns money with no tax taken out (tutoring, deliveries, freelance work), switch on a side gig in Settings. The page then shows the extra tax it adds, including self-employment tax, and what share of each payment to set aside.</p>}
      </>,
      <>
        <p><b>Claiming purchases.</b> On Transactions, a purchase can be claimed as a business expense for a side gig, or as a classroom expense if a K-12 teacher lives in the household. Claimed purchases add up on the Taxes page by themselves.</p>
      </>,
      <>
        <p><b>What it leaves out.</b> For states other than Arkansas: city, county and school district income taxes, the state's own credits and subtractions, how it treats pensions and retirement withdrawals (counted in full; Social Security is not counted), deductions that shrink as income rises, and a head of household's own brackets. For everyone: a business with employees or stock; selling a home; early-withdrawal penalties; and the less common credits. For Arkansas it doesn't use the state's low-income tables, its child care credit or its small credit for incomes under about $27,600, so a low Arkansas figure may really be lower still. Child support received isn't taxed and isn't counted. If something large in your year isn't on the page, treat the figure as a starting point and ask whoever prepares your return.</p>
      </>,
    ],
    'cfo': [
      <>
        <p>The seal under the menu opens a panel where you can ask about your money in plain words: "How much is left before payday?", "What did we spend on eating out last month?", "Which bills are due in the next two weeks?". It looks the answer up in your own figures. You can ask it about Ledger itself too: "Can I plan next month's budget?", "How do I leave a card out of my budget?", "What can Ledger do that I haven't found?". It answers with the page and the button.</p>
        <p>It can also suggest a few changes when you ask: moving a shop's purchases or one single transaction to another category, making a new category, setting a budget, or renaming a bill. So "file that reimbursement check under a new Classroom category" works. Each suggestion appears with Confirm and Cancel, and nothing changes until you tap Confirm. It can't move money, and it sees nothing outside this app. Closing the panel leaves you on the page you were on, and the conversation is kept while the app stays open.</p>
        <p><b>Catching up with your bank.</b> The bank connection can run a day behind. To catch Ledger up sooner, press the paperclip beside the question box (or the last example on the CFO's opening screen) and choose a screenshot of your bank's recent or pending activity, or the bank's CSV export. A screenshot is read by Claude and its rows come back to tick, each with a category you can change; a CSV is read by Ledger itself and anything already there is skipped. Nothing is added until you press the button. On a connected account what is added waits for the bank, and the bank's own entry takes it over when it arrives, so nothing is counted twice.</p>
      </>,
      <>
        <p><b>What it won't do.</b> The CFO is Claude, an AI, and nobody checks its answers before you read them. So it explains your figures and how rules work in general, but it won't tell you whether to claim or deduct something on your own taxes, or which investments to buy or sell. Those are questions for whoever prepares your taxes or a licensed adviser.</p>
        <p><b>Looking a rule up.</b> When you ask how a tax or Social Security rule works, the CFO can search and read the official sites (the IRS, Arkansas's revenue office and Social Security, and nowhere else) and tell you what the page says, with a link under the answer. Only your question's subject is searched for; nothing about your household is sent to those sites. Open the link before relying on a figure: pages are sometimes for an earlier year.</p>
        <p>It will still give you every figure that helps you ask them, and the tax pack at the foot of the Taxes page gathers what a preparer would want.</p>
      </>,
    ],
    'phone': [
      <>
        <p>Ledger works in a phone's browser, and you can put it on your home screen so it opens like an app, full screen with its own icon.</p>
        <ul><li><b>iPhone or iPad.</b> Open Ledger in <b>Safari</b>, tap the Share button (the square with an arrow), scroll down and choose <b>Add to Home Screen</b>, then Add.</li><li><b>Android.</b> Open Ledger in <b>Chrome</b>, tap the three dots at the top right, and choose <b>Add to Home screen</b> or <b>Install app</b>.</li></ul>
        <p><b>Updates arrive by themselves.</b> When Ledger is improved, an open copy refreshes itself at a quiet moment, on the computer and on the phone; there is nothing to install.</p>
        <p>You'll sign in once on the phone; it then stays signed in for about three months. On the phone, the <b>Menu</b> button at the bottom left opens every page, Settings, About and Ask your CFO; the + button beside it adds things. Pages are pared down on a phone: tap a transaction, or the <b>⋯</b> on a bill, account or budget, for a list of everything you can do with it; the Dashboard starts with your balance outlook and recent activity, with the rest behind <b>Show more</b>; and Taxes shows the estimate first, with each other section opening from its title.</p>
      </>,
    ],
    'settings': [
      <>
        <ul><li><b>Finding a setting.</b> The box at the top of Settings takes your own word for a thing ("bank", "dark", "backup") and shows where it is changed. Under it, the sections you open most on this device stay one tap away; "Forget these" clears that list, which never leaves your device.</li><li><b>Appearance.</b> The backdrop (holiday scenes that change through the year, a plain colourway, your own colours, or a photo of your own), light or dark, and <b>Display size</b> if everything looks too small or too large on your screen. These are remembered on each device separately. A photo you choose stays on that device and is never sent to Ledger's server; Ledger picks light or dark text and an accent colour to suit it, and you can dim or blur it.</li><li><b>Paydays.</b> When each paycheck arrives and how much it is. You can upload your employer's pay calendar and Ledger will read the dates.</li><li><b>Side gig.</b> Income with no tax taken out.</li></ul>
      </>,
      <>
        <ul><li><b>Signing in.</b> If your copy has a web address, you first confirm who you are there with Google or a code sent to your email. You chose at the start whether that is enough by itself or whether Ledger also asks for a password of its own; Settings, Password changes that either way ("Skip the password after signing in at the web address", or add a password if you have none).</li><li><b>Password.</b> Change it here; changing it signs out your other devices, and you can sign other devices out without changing it. <b>A sign-in for each person:</b> under "People who can sign in" the first person can give another adult a password of their own. Everyone sees the same Ledger; each can change their own password without knowing the other's, and one person's sign-in can be taken away without touching anyone else's. If your copy opens with the sign-in at its web address and has no Ledger password, adding one gives you a spare key. If you forget your password, or that sign-in ever can't be confirmed, choose "Forgot your password?" (or "Can't get in?") on the sign-in screen, then "Email me a reset code": a one-time code arrives at the email address your Ledger was set up with, usually within a couple of minutes, and you choose a new password. On a secure web address you can also add Face ID, Touch ID or a fingerprint under Passkeys.</li>
          <li><b>Currency.</b> The money your household uses: US dollars unless you choose another. It changes how every amount is written, and nothing is converted.</li>
          <li><b>Summary email.</b> A short summary of totals on the days and hour you choose, to whichever addresses you list. It's sent from a Gmail account of yours with an app password, which Google makes for Ledger alone; Settings, Summary email has the five steps and buttons that open the right Google pages. Alerts are sent the same way, so set this up first.</li>
          <li><b>Alerts.</b> A short email when checking is forecast to run low before payday, a bill comes out tomorrow, or a category goes over budget.</li>
          <li><b>What Ledger has learned.</b> The rules it has picked up for filing purchases and claiming them for tax, each with Remove.</li>
          <li><b>Updating Ledger.</b> How you update depends on where your copy runs. <b>Installed with Docker on your own computer:</b> the dashboard says when a newer version is out, and Settings, "Updates" shows the version you are running and the two lines to paste, at any time; your data is kept. <b>Inside Home Assistant:</b> updates appear with your other app updates under Home Assistant's Settings, Apps (called Add-ons on older versions). <b>A copy someone else runs for you:</b> they update it, and an open page refreshes itself. About, "What's new" lists what each update changed.</li>
          <li><b>Download your data.</b> Every transaction as a spreadsheet file. It is a record, not a full backup: inside Home Assistant, Ledger is included in Home Assistant's own backups, and Settings says how to keep those somewhere safe.</li><li><b>Delete everything.</b> On a copy someone set up for you, this wipes all of it for good, without asking anyone: accounts, transactions, budgets, receipts, the bank connection and every sign-in. You type the words "delete everything" (and your password, if you have one) so it can't happen by a slip. The person who runs the server is told only that your copy is now empty; its nightly backups drop the last trace within about a month. Download your transactions first if you want to keep them.</li><li><b>The setup guide.</b> "Open the setup guide" walks through your household, accounts, paydays and budgets again, step by step. "Take the tour" (here and at the top of About) shows you round the app: it lights up one thing at a time, the menu, the + button, each page, and says what it is for. It takes about two minutes, changes nothing, and runs once by itself when a new household finishes setting up.</li></ul>
      </>,
    ],
    'privacy': [
      <>
        <p><b>Your copy is yours.</b> Each household has its own copy of Ledger with its own sign-in and its own data, kept apart from every other household's. It lives on the home server of the person who set it up for you, who looks after it and its backups. It is not on a company's servers.</p>
        <p><b>What the person who hosts it can see.</b> When your copy was last opened and on which days, whether setup was finished, whether a bank is connected, how many devices are signed in, what its AI has cost, and how many times the CFO looked up a tax rule. Ledger never shows them what is in it: not your balances, purchases, budgets or what you ask the CFO. As with any service, whoever runs the server could in principle open its files, so use a copy only if you trust them with that.</p>
        <p><b>Your bank password never reaches Ledger.</b> The bank connection is read-only and goes through SimpleFIN.</p>
      </>,
      <>
        <p><b>Home Assistant sensors</b> (only where Ledger runs inside Home Assistant, and off unless you switch them on in Settings): each sensor you choose is written to your own Home Assistant so automations there can use it. Three say only yes or no, one is a number of days, and two are figures from your finances. Everyone who uses that Home Assistant can see them, and it keeps their history.</p>
        <p><b>The AI features</b> (the written recap, Ask your CFO, reading screenshots, statements, pay stubs and pay calendars, suggesting categories from shop names, budget and tax suggestions, finding merchant logos and drawing icons) send what they need to Claude, made by Anthropic, to get an answer: for example your month's figures for the recap, or the picture you chose to upload. Pictures and files you upload are read and not kept. If you'd rather not use them, they can be switched off in Settings, and the rest of the app works without them. If you run Ledger inside Home Assistant you can choose the AI already set up there instead (Settings, "AI recap and logos"): the recap, category suggestions and a basic CFO then go to that AI, whichever it is, and nothing goes to Anthropic unless you also save a key for the extras.</p>
        <p><b>Seeing what was sent.</b> Settings, "AI recap and logos" has <b>What has been sent to Claude</b>: a plain line for each request ("12 shop names", "a pay stub you uploaded") with the time. It is a description, not a copy, and only your copy of Ledger can see it. Beside it, <b>Keep some categories away from Claude</b> lets you tick categories whose purchases, shops and bills are then left out of the recap, Ask your CFO, logo searches and budget suggestions. Month totals still include them. A receipt or statement you choose to upload is sent whole.</p>
        <p><b>Hiding names.</b> In the same place, <b>Hide names from the AI</b> swaps your household's names for plain labels in what the recap and Ask your CFO are sent: the adults, employers, side gigs, accounts and banks become "Adult 1", "Employer 1", "Checking account 2", "Bank 1". Your own names are put back in the answer before you read it. Amounts and dates still go, and so do the names of shops and bills. It is off until you switch it on, and it shows you the list of what it swaps.</p>
        <p><b>Who pays for the AI.</b> On most copies the person who set Ledger up for you includes it, up to a small amount each month. If yours doesn't, or you'd like no monthly limit, you can add your own Anthropic key: Settings, "AI recap and logos" lists the steps, and Ledger checks the key before saving it. You then pay Anthropic directly for what you use, usually well under a dollar a month for a household.</p>
        <p><b>A home's value</b>, if you set it to be looked up each month, sends that home's address and your own RentCast key to RentCast once a month. A property kept by hand sends nothing, and Ledger never asks for its address.</p>
        <p><b>A vehicle's VIN</b>, only if you press "Fill these in from the VIN" when setting up a vehicle: the VIN you type goes to the U.S. government's vehicle safety agency (NHTSA), whose free decoder returns the year, make, model and type. Ledger doesn't keep the VIN.</p>
        <p><b>Investment prices</b>, if you switch them on, are asked of Yahoo Finance by ticker symbol only: never your share counts or values.</p>
        <p><b>Company logos</b> are fetched by the company's web address only, never with anything about your purchases. <a href="https://logo.dev" target="_blank" rel="noreferrer">Logos provided by Logo.dev</a>.</p>
        <p><b>Checking for a newer version.</b> If you run Ledger yourself with Docker, it looks at its public project page on GitHub once a day for a newer version, and tells you on the dashboard when there is one. Nothing about your household is sent. Settings, "Updates" switches it off. A copy hosted for you, or one inside Home Assistant, doesn't do this: those are updated another way.</p>
      </>,
      <>
        <p>The AI features have a monthly allowance. If it runs out they pause until the 1st of the next month; nothing else is affected.</p>
      </>,
    ],
    // What's new is one page: the few things just added, then the whole history behind a button.
    'updates': [<WhatsNew />],
    'ask': [
      <>
        <Feedback />
      </>,
    ],
  };
  return (
    <div className="about">
      <p className="about-lead">Everything about Ledger, a topic at a time. Choose one to read it, or search the guide for what you're after. <button className="link" data-tour="tour-again" onClick={() => dispatchEvent(new Event('ledger-tour'))}>Take the tour</button> to be shown round the app instead.</p>
      <GuideSearch pages={PAGES} q={q} setQ={setQ} onOpen={(n, page) => { setStart(page); setOpen(n); }} />
      {!q.trim() && SECTIONS.map((_, n) => <Topic key={n} n={n} onOpen={() => { setStart(0); setOpen(n); }} />)}
      {open >= 0 && <Reader n={open} pages={PAGES[SECTIONS[open][0]]} start={start} onClose={() => setOpen(-1)} onTopic={(n) => { setStart(0); setOpen(n); }} />}
    </div>
  );
}
