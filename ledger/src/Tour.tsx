import { at } from './base';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * The guided tour (added 2026-11-19, the owner's idea: "a wizard that can walk them through each page").
 * The screen dims except for one thing at a time, with a small card beside it saying what it is for.
 * Next moves on, changing page by itself. It only points and explains: the screen underneath can't be
 * pressed while it is up, so nothing is changed by taking it.
 *
 * Every stop points at something each copy has whatever the household entered (the menu, the + button,
 * a page's own heading, the starter categories), and is worded for an empty copy. If the thing a stop
 * points at can't be found, the card is shown in the middle of the screen without a highlight, so the
 * tour never gets stuck. When a page or button changes, check its stop here (and About, as always).
 *
 * It starts by itself once, after a new household finishes the setup guide (`ledger-tour-due`, set in
 * App), and from "Take the tour" in About and Settings (the `ledger-tour` event). Kept per device.
 */
type Stop = {
  page?: string;          // the page to be on
  at?: string;            // what to light up (CSS selector; the first one visible is used)
  atPhone?: string;       // the same on a phone, where the side menu is the Menu button
  open?: 'add' | 'cfo';   // open the + menu, or the CFO's panel, while this stop shows
  noAiText?: string;      // said instead on a copy whose AI isn't switched on yet
  title: string;
  text: string;
  phoneText?: string;
  clip?: string;          // a short silent film of the thing being done, offered as "Watch it" in the card (files in public/tour)
};

const ALL_STOPS: Stop[] = [
  { title: 'A quick look around', text: "This takes about two minutes and shows where everything is. It only points things out: nothing you press during the tour changes anything. You can leave at any point, and take it again from About." },
  { at: '.sidebar', atPhone: '.pmenu-btn', title: 'The menu', text: 'Every page is one click away here. The tour visits each of them in turn.', phoneText: 'Menu opens every page, with Ask your CFO in the middle. The tour visits each of them in turn.' },
  { page: 'dashboard', at: '.strip, .page-title', title: 'Dashboard', text: "Your home page: what's left before payday, what's in checking, and how spending is going against your budgets. It fills in as your money comes in." },
  { page: 'dashboard', at: '.month', title: 'Choosing a month', text: 'Dashboard, Transactions and Budgets show one month at a time. Change the month here.' },
  { page: 'dashboard', at: '.fab-wrap', open: 'add', title: 'The + button', text: 'It is on every page, and it is how you add things: a purchase or a deposit typed in by hand, a transfer between your accounts, or a receipt read from a picture so Ledger fills it in for you. On a phone, "Read a receipt" opens the camera: photograph a receipt and in a few seconds Ledger has the shop, the date and the total, with the items sorted into your categories.',
    phoneText: 'It is on every page, and it is how you add things. "Read a receipt" opens your camera: photograph a receipt and in a few seconds Ledger has the shop, the date and the total, with the items sorted into your categories. You can also type in a purchase or a deposit, or record a transfer.', clip: 'receipt' },
  { page: 'transactions', at: '.search-toggle, input[type="search"], .page-title', title: 'Transactions', text: 'Everything that came in or went out, newest first. Choose a transaction\'s name to see its fine print, where you can change its category, add a note, split it across categories or leave it out. Search by name, note or amount here.' },
  { page: 'budgets', at: '.page-title', title: 'Budgets', text: 'Set what you mean to spend in each category. Each bar fills as the month goes on. The arrows put categories in your own order, "Organise" beside one renames it, groups it, merges it, hides it or leaves it out of the budget, and near the end of a month you can plan the next one from the top of this page.',
    phoneText: 'Set what you mean to spend in each category. Each bar fills as the month goes on. The "⋯" beside a category moves it up or down and opens "Organise", which renames it, groups it, merges it, hides it or leaves it out of the budget. Near the end of a month you can plan the next one from the top of this page.' },
  { page: 'budgets', at: '.main .logo-btn, .page-title', title: 'Changing icons and logos', text: "Any icon or logo in Ledger can be changed by choosing it. A category's icon opens a picker. A shop's or an account's logo can be looked up from its website, or replaced with a picture of your own." },
  { page: 'recurring', at: '[data-tour="add-bill"], .page-title', title: 'Recurring', text: 'Bills and subscriptions. Ledger finds the ones that repeat in your transactions, and "Add a bill" is for any it can\'t see. They feed the checking forecast on the dashboard. "Calendar" at the top lays the month out by day, and a bill can keep a link to the page where you pay it.' },
  { page: 'debt', at: '.page-title', title: 'Debt', text: 'Your cards and loans, what they cost in interest, and a plan for paying them down. It fills in once a card or loan is among your accounts. "Try a different plan" then sets two payoff orders side by side and shows what an extra payment would do.' },
  { page: 'accounts', at: '.add-account, .page-title', title: 'Accounts', text: 'Everything you own and owe, and your net worth over time. "Add an account by hand" adds an account, or a home or vehicle at a value you type, so net worth counts it. Accounts can be put in your own order or left out of the budget. Savings goals and "Check a statement" are here too.' },
  { page: 'reports', at: '.page-title', title: 'Reports', text: 'Where the money went. First one month as a single picture, with money in on the left and each kind of spending on the right, then the months side by side: by category and by shop.' },
  { page: 'taxes', at: '.page-title', title: 'Taxes', text: "A running estimate of this year's federal and state income tax, worked out from what you tell it about your household and pay. If you're paid wages, a ring of twelve months under \"Pay stubs\" shows which months' pay stubs are in, and you can choose a month to add one. It is an estimate to plan with, not tax advice." },
  { page: 'connections', at: '.page-title', title: 'Settings', text: 'How Ledger looks on this device, your password and who can sign in, the bank connection, paydays, emails and alerts. Each section opens when you choose its title, and the search box at the top finds a setting by an everyday word such as "bank" or "dark".' },
  { at: '.cfo-panel', atPhone: '.cfo-panel .cfo-ask, .cfo-panel', open: 'cfo', title: 'Ask your CFO',
    text: 'This panel opens from the round CFO seal under the menu. Type a question about your money in plain words, such as "How much did we spend on groceries last month?", and Claude answers from your own figures. You can ask how to do something in Ledger too. The paperclip takes a screenshot or file from your bank to catch Ledger up. It can suggest a change, but nothing changes until you confirm it.',
    phoneText: 'This opens from the middle of the Menu. Type a question about your money in plain words, such as "How much did we spend on groceries last month?", and Claude answers from your own figures. You can ask how to do something in Ledger too. The paperclip takes a screenshot or file from your bank to catch Ledger up. It can suggest a change, but nothing changes until you confirm it.',
    noAiText: 'This is where you ask a question about your money in plain words and Claude answers from your own figures. On this copy it runs on an Anthropic key of your own, and it is ready as soon as you add one: Settings, "AI recap and logos" walks you through it in four short steps. Until then this panel shows a reminder.' },
  { title: 'On your phone', clip: 'home', text: 'Ledger can sit on your phone\'s home screen and open like an app, full screen with its own icon. On an iPhone, open Ledger in Safari, tap the Share button (the square with an arrow), scroll down to "Add to Home Screen", then Add. On Android, open it in Chrome, tap the three dots and choose "Add to Home screen" or "Install app".' },
  { page: 'about', at: '[data-tour="tour-again"], .page-title', title: 'About', text: "The full guide to every feature, with a search box that needs no AI, a list of what's new, and a way to ask for something or report a problem. That's the tour. You can take it again from here whenever you like." },
];

type Box = { left: number; top: number; width: number; height: number };
const phone = () => innerWidth < 761;
const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Where an element is on the screen. The app is drawn enlarged on big screens (`zoom` on `.shell`), and
 *  browsers disagree on whether an element inside reports its size before or after that, so this asks. */
function boxOf(el: Element): Box {
  const r = el.getBoundingClientRect();
  let f = 1;
  const shell = el.closest('.shell') as HTMLElement | null;
  const zoom = shell ? parseFloat((getComputedStyle(shell) as any).zoom) || 1 : 1;
  if (shell && Math.abs(zoom - 1) > 0.01) {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;left:0;top:0;width:100px;height:1px;visibility:hidden;pointer-events:none';
    shell.appendChild(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    if (w > 0) f = (100 * zoom) / w;
  }
  return { left: r.left * f, top: r.top * f, width: r.width * f, height: r.height * f };
}

function find(stop: Stop): Element | null {
  const list = (phone() && stop.atPhone) || stop.at;
  if (!list) return null;
  for (const sel of list.split(',')) {
    for (const el of document.querySelectorAll(sel.trim())) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
  }
  return null;
}

// The CFO's panel is opened for its stop and put away after it. Nothing is asked, so it costs nothing.
let cfoShown = false;
const cfoPanel = (open: boolean) => {
  if (open === cfoShown) return;
  cfoShown = open;
  dispatchEvent(new Event(open ? 'ledger-cfo' : 'ledger-cfo-close'));
};
const addMenu = (open: boolean) => {
  if (!open) cfoPanel(false);
  const fab = document.querySelector('.fab') as HTMLElement | null;
  if (fab && (fab.getAttribute('aria-expanded') === 'true') !== open) fab.click();
};

export const takeTour = () => dispatchEvent(new Event('ledger-tour'));

export default function Tour() {
  const [n, setN] = useState<number | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [ready, setReady] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  // Whether this copy's AI is switched on, asked when the tour opens (the CFO stop is worded to match).
  const [ai, setAi] = useState(true);
  // Inside Home Assistant the stop about putting Ledger on a phone's home screen is left out: there it is
  // opened from the Home Assistant app.
  const [inHa, setInHa] = useState(false);
  useEffect(() => { fetch('/api/auth/status').then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.ingress) setInHa(true); }).catch(() => {}); }, []);
  // ...and the Taxes stop where the household has switched the tax section off.
  const [noTax, setNoTax] = useState(false);
  useEffect(() => { if (n === 0) fetch('/api/tax/on').then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setNoTax(!d.on); }).catch(() => {}); }, [n]);
  const STOPS = ALL_STOPS.filter((s) => !(inHa && s.clip === 'home') && !(noTax && s.page === 'taxes'));
  // The stop's short film, when it has one and "Watch it" was pressed. Put away on moving to another stop.
  const [clip, setClip] = useState(false);
  useEffect(() => { setClip(false); }, [n]);
  useEffect(() => { if (n === 0) fetch('/api/cfo').then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setAi(!!d.ready); }).catch(() => {}); }, [n]);
  const target = useRef<Element | null>(null);

  // Starting: on request, or once by itself after the setup guide.
  useEffect(() => {
    // The reminder is cleared when the tour really opens, not when it is noticed, so nothing is lost if
    // this part of the page is drawn twice in quick succession.
    const start = () => { try { localStorage.removeItem('ledger-tour-due'); } catch { /* private window */ } setReady(false); setBox(null); setN(0); };
    addEventListener('ledger-tour', start);
    let timer = 0;
    try { if (localStorage.getItem('ledger-tour-due') === '1') timer = window.setTimeout(start, 900); } catch { /* private window */ }
    return () => { removeEventListener('ledger-tour', start); clearTimeout(timer); };
  }, []);

  const leave = useCallback((home: boolean) => {
    addMenu(false);
    setN(null); setBox(null); setPos(null);
    try { localStorage.setItem('ledger-tour-seen', '1'); } catch { /* private window */ }
    if (home && location.hash.slice(1).split('/')[0] !== 'dashboard') location.hash = '#dashboard';
  }, []);
  const go = useCallback((to: number) => {
    addMenu(false);
    if (to >= STOPS.length) return leave(true);
    setReady(false);
    setN(Math.max(0, to));
  }, [leave]);

  const measure = useCallback(() => { setBox(target.current && target.current.isConnected ? boxOf(target.current) : null); }, []);

  // Arriving at a stop: go to its page, wait for what it points at to be drawn, bring it into view.
  useEffect(() => {
    if (n === null) return;
    const stop = STOPS[n];
    let stopped = false, tries = 0;
    const timers: number[] = [];
    if (stop.page && location.hash.slice(1).split('/')[0] !== stop.page) location.hash = `#${stop.page}`;
    const look = () => {
      if (stopped) return;
      if (stop.open === 'add') addMenu(true);
      if (stop.open === 'cfo') cfoPanel(true);
      const el = find(stop);
      // A page's heading is the fallback for most stops: give the thing itself a moment to appear first.
      const wants = (phone() && stop.atPhone) || stop.at;
      const settled = !wants || el && (tries >= 4 || !el.classList.contains('page-title') || !(stop.at || '').includes(','));
      if (!settled && tries++ < 12) { timers.push(window.setTimeout(look, 130)); return; }
      target.current = el;
      const show = () => { if (el && el.isConnected && !el.closest('.sidebar, .fab-wrap, .pmenu, .cfo-panel')) el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior }); measure(); };
      show(); setReady(true);
      // Pages fade in, fill in and menus unfold: look again once they have.
      timers.push(window.setTimeout(show, 350), window.setTimeout(measure, 800));
    };
    timers.push(window.setTimeout(look, stop.page || stop.open ? 160 : 0));
    return () => { stopped = true; timers.forEach(clearTimeout); };
  }, [n, measure]);

  useEffect(() => {
    if (n === null) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (document.querySelector('.tour-clip')) setClip(false); else leave(false); }
      else if (e.key === 'ArrowRight') go(n + 1);
      else if (e.key === 'ArrowLeft' && n > 0) go(n - 1);
    };
    addEventListener('keydown', key);
    addEventListener('resize', measure);
    addEventListener('scroll', measure, true);
    return () => { removeEventListener('keydown', key); removeEventListener('resize', measure); removeEventListener('scroll', measure, true); };
  }, [n, go, leave, measure]);

  // Where the card goes: beside what is lit, wherever there is room; in the middle when nothing is.
  useLayoutEffect(() => {
    const c = card.current;
    if (n === null || !ready || !c) return;
    const W = innerWidth, H = innerHeight, cw = c.offsetWidth, ch = c.offsetHeight, gap = 16, edge = 12;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
    let left = (W - cw) / 2, top = (H - ch) / 2;
    if (box) {
      const right = box.left + box.width, bottom = box.top + box.height;
      if (phone()) {
        top = box.top + box.height / 2 > H / 2 ? clamp(box.top - ch - gap, edge, H - ch - edge) : clamp(bottom + gap, edge, H - ch - edge);
      } else if (right + gap + cw <= W - edge && box.height > 200) { left = right + gap; top = clamp(box.top, edge, H - ch - edge); }
      else if (bottom + gap + ch <= H - edge) { top = bottom + gap; left = clamp(box.left, edge, W - cw - edge); }
      else if (box.top - gap - ch >= edge) { top = box.top - gap - ch; left = clamp(box.left + box.width - cw, edge, W - cw - edge); }
      else if (right + gap + cw <= W - edge) { left = right + gap; top = clamp(box.top, edge, H - ch - edge); }
      else if (box.left - gap - cw >= edge) { left = box.left - gap - cw; top = clamp(box.top, edge, H - ch - edge); }
    }
    setPos({ left: Math.round(left), top: Math.round(top) });
  }, [n, ready, box]);

  useEffect(() => { if (n !== null && ready) (card.current?.querySelector('.tour-next') as HTMLElement | null)?.focus({ preventScroll: true }); }, [n, ready]);

  if (n === null) return null;
  const stop = STOPS[n], last = n === STOPS.length - 1, pad = 7;
  const lit = box ? { left: box.left - pad, top: box.top - pad, width: box.width + pad * 2, height: box.height + pad * 2 } : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
  return createPortal(
    <div className={`tour-layer ${still() ? 'still' : ''}`} role="dialog" aria-modal="true" aria-label={`Tour: ${stop.title}`}>
      <div className="tour-block" />
      <div className={`tour-light ${box ? '' : 'none'}`} style={lit} />
      <div ref={card} className="tour-card" style={pos && ready ? { left: pos.left, top: pos.top, opacity: 1 } : { left: 0, top: 0, opacity: 0 }}>
        <div className="tour-count">{n === 0 ? 'Welcome' : `${n} of ${STOPS.length - 1}`}{stop.clip && <button type="button" className="tour-watch" onClick={() => setClip(true)}>▶ Watch it</button>}</div>
        <h2>{stop.title}</h2>
        <p>{(!ai && stop.noAiText) || (phone() && stop.phoneText) || stop.text}</p>
        <div className="tour-acts">
          <button className="link" onClick={() => leave(false)}>{n === 0 ? 'Not now' : 'Leave the tour'}</button>
          <span className="tour-gap" />
          {n > 0 && <button onClick={() => go(n - 1)}>Back</button>}
          <button className="primary tour-next" onClick={() => go(n + 1)}>{n === 0 ? 'Start' : last ? 'Done' : 'Next'}</button>
        </div>
      </div>
      {clip && stop.clip && (
        <div className="tour-clip" onClick={() => setClip(false)}>
          {/* Silent, so a phone will play it by itself; it loops until put away. Made on the demo copy, so the figures in it are made up. */}
          <video src={at(`/tour/${stop.clip}.mp4`)} poster={at(`/tour/${stop.clip}.jpg`)} autoPlay={!still()} controls={still()} muted loop playsInline aria-label={`A short film: ${stop.title}`} />
          <button type="button" className="tour-clip-close">Close</button>
        </div>
      )}
    </div>,
    document.body,
  );
}
