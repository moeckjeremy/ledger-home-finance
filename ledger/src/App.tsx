import { WeekTip } from './WeekTip';
import { OwedNotice } from './pages/GigPay';
import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTaxes, setTaxes, setCurrency, setBudgetDay, periodLong, periodShort } from './lib';
import { api, lastLoaded, monthLong, noteLoaded, useData, handoff, monthShort, busyFor, midSession } from './lib';
import { IconDialog, LogoDialog, UndoToast, reducedMotion } from './ui';
import { setFoundLogos, setLogoVersion } from './logos';
import Dashboard from './pages/Dashboard';
import Cfo, { CfoSeal } from './pages/Cfo';
import Insight, { INSIGHTS, type InsightView } from './pages/Insight';
import Transactions from './pages/Transactions';
import Budgets from './pages/Budgets';
import Recurring from './pages/Recurring';
import Accounts from './pages/Accounts';
import Reports from './pages/Reports';
import Debt from './pages/Debt';
import Taxes from './pages/Taxes';
import Connections, { ForgotPassword, PasswordForm, addPasskey, deviceName, passkeySignIn, passkeysPossible } from './pages/Connections';
import Setup from './pages/Setup';
import About from './pages/About';
import Tour from './Tour';
import { NewsNotice, allNewsSeen, useUnseenNews } from './News';
import { UpdateNotice } from './UpdateNotice';
import { GO, jump } from './go';

const PAGES = [
  { id: 'dashboard', label: 'Dashboard', short: 'Dashboard', icon: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z' },
  { id: 'transactions', label: 'Transactions', short: 'Transactions', icon: 'M4 6h16M4 12h16M4 18h10' },
  { id: 'budgets', label: 'Budgets', short: 'Budgets', icon: 'M12 3v9l7 4M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9z' },
  { id: 'recurring', label: 'Recurring', short: 'Recurring', icon: 'M4 12a8 8 0 0 1 14-5l2-2v6h-6l2-2a5 5 0 1 0 1 6' },
  { id: 'debt', label: 'Debt', short: 'Debt', icon: 'M4 18l6-6 4 4 6-8M20 8v5M20 8h-5' },
  { id: 'accounts', label: 'Accounts', short: 'Accounts', icon: 'M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18' },
  { id: 'reports', label: 'Reports', short: 'Reports', icon: 'M5 20V10M12 20V4M19 20v-7' },
  { id: 'taxes', label: 'Taxes', short: 'Taxes', icon: 'M7 3h10a1 1 0 0 1 1 1v17l-3-2-3 2-3-2-3 2V4a1 1 0 0 1 1-1zM9 8h6M9 12h6' },
  { id: 'connections', label: 'Settings', short: 'Settings', icon: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19.4 13.5a7.6 7.6 0 0 0 0-3l1.9-1.5-1.9-3.3-2.3.9a7.5 7.5 0 0 0-2.6-1.5L14.1 2.7h-4.2l-.4 2.4a7.5 7.5 0 0 0-2.6 1.5l-2.3-.9-1.9 3.3 1.9 1.5a7.6 7.6 0 0 0 0 3l-1.9 1.5 1.9 3.3 2.3-.9a7.5 7.5 0 0 0 2.6 1.5l.4 2.4h4.2l.4-2.4a7.5 7.5 0 0 0 2.6-1.5l2.3.9 1.9-3.3Z' },
  { id: 'about', label: 'About', short: 'About', icon: '' },
  { id: 'cfo', label: 'Ask your CFO', short: 'CFO', icon: '' },
] as const;
type PageId = (typeof PAGES)[number]['id'];

const fromHash = (): PageId => {
  const id = location.hash.slice(1).split('/')[0];
  return (PAGES.find((p) => p.id === id)?.id ?? 'dashboard') as PageId;
};

function Icon({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/**
 * The menu icons, drawn in separate parts so each can move: on the computer when
 * the pointer is over a menu item, on the phone when its tab is chosen. The
 * shapes match the single-path versions in PAGES; the motion is in styles.css
 * under "Menu icons that move".
 */
function NavIcon({ id }: { id: PageId }) {
  const parts: Record<PageId, React.ReactNode> = {
    // A house that hops, then its lights come on.
    dashboard: <g className="home">
      <path className="lit" d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
      <path className="door" d="M9 15h6v6H9z" />
      <path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
    </g>,
    // The CFO's seal, in outline.
    cfo: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /></>,
    // An "i" in a circle.
    about: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.6v.2" /></>,
    // Three lines, written top to bottom.
    transactions: <><path className="l1" d="M4 6h16" /><path className="l2" d="M4 12h16" /><path className="l3" d="M4 18h10" /></>,
    // A dial whose hand sweeps round.
    budgets: <><path d="M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9z" /><path className="hand" d="M12 3v9l7 4" /></>,
    // A circling arrow that turns clockwise.
    recurring: <path className="turn" d="M4 12a8 8 0 0 1 14-5l2-2v6h-6l2-2a5 5 0 1 0 1 6" />,
    // A rising line drawn left to right, then its arrowhead.
    debt: <><path className="line" pathLength={1} d="M4 18l6-6 4 4 6-8" /><path className="head" d="M20 8v5M20 8h-5" /></>,
    // A bank: the floor, then each column goes up, then the roof comes down.
    accounts: <>
      <path className="floor" d="M3 20h18" />
      <path className="c1" d="M5 10v8" /><path className="c2" d="M9.5 10v8" /><path className="c3" d="M14.5 10v8" /><path className="c4" d="M19 10v8" />
      <path className="roof" d="M3 10l9-6 9 6" />
    </>,
    // Three bars: the middle one grows first, then the left, then the right.
    reports: <><path className="b1" d="M5 20V10" /><path className="b2" d="M12 20V4" /><path className="b3" d="M19 20v-7" /></>,
    // A receipt that prints downward, its lines written one after the other.
    taxes: <><path className="slip" d="M7 3h10a1 1 0 0 1 1 1v17l-3-2-3 2-3-2-3 2V4a1 1 0 0 1 1-1z" /><path className="w1" d="M9 8h6" /><path className="w2" d="M9 12h6" /></>,
    // A gear that turns.
    connections: <path className="turn" d={PAGES[8].icon} />,
  };
  return (
    <svg className={`ico ico-${id}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {parts[id]}
    </svg>
  );
}

/**
 * The phone's menu (2026-11-18, the owner's idea: the row of eight tabs along the bottom looked busy).
 * One "Menu" button at the bottom left; pressing it lifts a round glass dial with Ask your CFO in the middle and every page, Settings
 * and About in a ring around it (the ring was his idea too, once he had seen it as a grid). Choosing one, or touching anywhere else, puts the sheet away. Shown only
 * at phone width; the computer keeps its side menu.
 */
/** What the Taxes address shows when the household has switched the tax section off. */
function TaxesOff() {
  return (
    <div className="stack">
      <section className="card">
        <div className="card-head"><h2>The tax section is switched off</h2></div>
        <p className="sub first">Ledger's tax estimate covers United States federal and state income tax only, and this household has switched it off. Everything else in Ledger works as usual.</p>
        <div className="add-actions"><button onClick={() => setTaxes(true)}>Switch the tax section on</button></div>
      </section>
    </div>
  );
}

function PhoneMenu({ tabs, page }: { tabs: { id: PageId; short: string }[]; page: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    addEventListener('hashchange', close); addEventListener('keydown', key);
    return () => { removeEventListener('hashchange', close); removeEventListener('keydown', key); };
  }, [open]);
  const here = tabs.find((t) => t.id === page);
  const unseen = useUnseenNews().length;
  return (
    <div className="pmenu" data-news={unseen > 0 ? '' : undefined}>
      {open && <div className="pmenu-shade" onClick={() => setOpen(false)} />}
      {open && (
        <nav className="pmenu-sheet" aria-label="Pages">
          {/* Ask your CFO in the middle, with the pages, Settings and About in a ring around it. */}
          {[...tabs.map((p) => ({ id: p.id, name: p.short })), { id: 'connections' as PageId, name: 'Settings' }, { id: 'about' as PageId, name: 'About' }].map((p, i, all) => (
            <a key={p.id} href={`#${p.id}`} className={page === p.id ? 'on' : ''} aria-current={page === p.id ? 'page' : undefined} style={{ '--a': `${(360 / all.length) * i}deg`, '--n': i } as React.CSSProperties} onClick={() => setOpen(false)}>
              <NavIcon id={p.id} /><span>{p.name}</span>
              {p.id === 'about' && unseen > 0 && <i className="news-dot" role="img" aria-label="Something new" />}
            </a>
          ))}
          <a href="#cfo" className="pmenu-mid" aria-label="Ask your CFO, your Claude Financial Officer" onClick={(e) => { e.preventDefault(); setOpen(false); dispatchEvent(new Event('ledger-cfo')); }}><span className="pmenu-ask">Ask your</span><CfoSeal size={92} /></a>
        </nav>
      )}
      <button className={`pmenu-btn ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? 'Close the menu' : `Menu. You are on ${here?.short || page}`}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">{open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}</svg>
        <span>{open ? 'Close' : 'Menu'}</span>
      </button>
    </div>
  );
}

/** The round "+" button, on every page: add one purchase or read several from a screenshot. */
function AddButton({ onTransactions }: { onTransactions: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!(e.target as HTMLElement).closest?.('.fab-wrap')) setOpen(false); };
    addEventListener('pointerdown', close);
    addEventListener('hashchange', close);
    return () => { removeEventListener('pointerdown', close); removeEventListener('hashchange', close); };
  }, [open]);
  const go = (what: 'add' | 'deposit' | 'scan' | 'transfer') => (e: React.MouseEvent) => {
    e.preventDefault();
    setOpen(false);
    // Already on the page: ask it to open the form. Otherwise go there, and it opens on arrival.
    if (onTransactions) dispatchEvent(new CustomEvent('ledger-add', { detail: what }));
    else location.hash = `#transactions/${what}`;
    scrollTo({ top: 0, behavior: 'smooth' });
  };
  // "Read a receipt" (first called "Take a photo"; the owner renamed both the same day, and "Read a screenshot" became "Upload a receipt", for a picture already on the device) opens the phone's camera at once (it has to happen inside the tap itself, so the
  // file box lives here, not on the page it leads to). The picture is handed to the reader on the
  // Transactions page, which starts reading it straight away. Offered on touch screens only: a
  // computer has no camera to open this way.
  const camera = useRef<HTMLInputElement>(null);
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const snapped = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    busyFor(60_000);
    if (!file) return;
    handoff.photo = file;
    setOpen(false);
    if (onTransactions) dispatchEvent(new CustomEvent('ledger-add', { detail: 'scan' }));
    else location.hash = '#transactions/scan';
    setTimeout(() => dispatchEvent(new Event('ledger-photo')), 60);
    scrollTo({ top: 0, behavior: 'smooth' });
  };
  return (
    <div className="fab-wrap">
      {/* Always in the page (so the picture has somewhere to arrive even if the menu has closed), and invisible rather than removed, which a phone needs before it will open the camera for it. */}
      <input ref={camera} id="ledger-camera" className="camera-box" type="file" accept="image/*" capture="environment" tabIndex={-1} aria-hidden="true" onChange={snapped} />
      {open && (
        <div className="fab-menu">
          {/* A real label around the file box: the phone opens the camera from the tap itself, with no script in between (a scripted click on a hidden box didn't open it on the owner's iPhone). */}
          {touch && <label className="fab-photo" htmlFor="ledger-camera" onClick={() => busyFor(180_000)}>Read a receipt</label>}
          <a href="#transactions/scan" onClick={go('scan')}>Upload a receipt</a>
          <a href="#transactions/add" onClick={go('add')}>Add a purchase</a>
          <a href="#transactions/deposit" onClick={go('deposit')}>Add a deposit</a>
          <a href="#transactions/transfer" onClick={go('transfer')}>Record a transfer</a>
        </div>
      )}
      <button className={`fab ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? 'Close' : 'Add a transaction'}><span>+</span></button>
    </div>
  );
}

/**
 * The app's mark as a square: two rising bars and a tall "L", for the home-screen
 * icon and anywhere there's no room for the word.
 */
function Mark() {
  return (
    <svg className="mark" viewBox="0 0 96 96" role="img" aria-label="Ledger">
      <rect className="mark-tile" width="96" height="96" rx="22" />
      <rect className="bar" x="18" y="50" width="12" height="26" rx="6" />
      <rect className="bar" x="37" y="35" width="12" height="41" rx="6" />
      <path className="ell" d="M62 18V70H80" />
    </svg>
  );
}

/**
 * The logo, from the owner's sketch: two bars rise, the third is the upright of a
 * capital L, and the L's foot runs along the bottom as the line the rest of the
 * word sits on. `play` runs the build-up once (a bar, a taller bar, the L, then
 * the foot growing as e-d-g-e-r are written one at a time); `loop` repeats it
 * every ten seconds. Each stroke has pathLength 1 so it can be drawn on.
 */
function Logo({ play = false, loop = false, quick = false }: { play?: boolean; loop?: boolean; quick?: boolean }) {
  return (
    <svg className={`wordmark ${play ? 'play' : ''} ${loop ? 'loop' : ''} ${quick ? 'quick' : ''}`} viewBox="0 0 216 100" role="img" aria-label="Ledger">
      <rect className="bar s1" x="10" y="52" width="11" height="26" rx="5.5" />
      <rect className="bar s2" x="29" y="36" width="11" height="42" rx="5.5" />
      <path className="ell s3" pathLength={1} d="M53.5 72.5V14" />
      <path className="ell s4" pathLength={1} d="M53.5 72.5H206" />
      <path className="ink s5" pathLength={1} d="M66 52H86A10 10 0 1 0 83.1 59.1" />
      <path className="ink s6" pathLength={1} d="M113 52a10 10 0 1 0-20 0a10 10 0 1 0 20 0M113 24V62" />
      <path className="ink s7" pathLength={1} d="M143 52a10 10 0 1 0-20 0a10 10 0 1 0 20 0M143 42V80A10 10 0 0 1 125 88" />
      <path className="ink s8" pathLength={1} d="M152 52H172A10 10 0 1 0 169.100 59.100" />
      <path className="ink s9" pathLength={1} d="M181 42V62M181 52A10 10 0 0 1 197.500 44.500" />
    </svg>
  );
}

function Welcome({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const out = setTimeout(() => setLeaving(true), still ? 900 : 3600);
    const done = setTimeout(onDone, still ? 1100 : 4100);
    return () => { clearTimeout(out); clearTimeout(done); };
  }, [onDone]);
  return (
    <div className={`welcome ${leaving ? 'leaving' : ''}`} onClick={onDone} role="status" aria-label="Signed in">
      <Logo play />
      <div className="welcome-by">Powered by Claude</div>
    </div>
  );
}

/**
 * On a phone, the logo builds itself briefly each time Ledger is opened or refreshes itself, the way
 * other apps show theirs (The owner's request, 2026-11-19). A quicker run of the welcome's animation:
 * about a second and a half, a tap skips it, and it is a still logo under reduce-motion.
 */
function Opening({ onDone, onDrawn }: { onDone: () => void; onDrawn: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    let frame = 0, over = false;
    // Once the logo is drawn the app itself is started, and gets a moment to draw behind the logo before it fades.
    const drawn = () => {
      if (over) return;
      over = true; cancelAnimationFrame(frame);
      onDrawn();
      timers.push(setTimeout(() => setLeaving(true), 500), setTimeout(onDone, 800));
    };
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const parts = !still && box.current?.getAnimations ? box.current.getAnimations({ subtree: true }) : [];
    if (still) drawn();
    else if (!parts.length) timers.push(setTimeout(drawn, 1250));
    else {
      // The drawing is moved on by hand, one painted frame at a time and never more than a thirtieth of a
      // second per frame, instead of being left to the clock. Opened cold from the home screen, a phone
      // spends the first second bringing the app into view; left to the clock the drawing was over
      // before any of it could be seen (it "just appeared"). This way it only moves while frames are
      // really being painted, so it is always seen from the start.
      const LENGTH = 1200;
      let at = 0, last = 0;
      for (const p of parts) { p.pause(); p.currentTime = 0; }
      const step = (now: number) => {
        if (last) at += Math.min(now - last, 34);
        last = now;
        for (const p of parts) p.currentTime = Math.min(at, LENGTH);
        if (at >= LENGTH) drawn(); else frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
      // If frames never come (the app was opened and put straight in the background), carry on anyway.
      timers.push(setTimeout(() => { for (const p of parts) p.currentTime = LENGTH; drawn(); }, 4000));
    }
    return () => { over = true; cancelAnimationFrame(frame); timers.forEach(clearTimeout); };
  }, [onDone, onDrawn]);
  return <div ref={box} className={`welcome opening ${leaving ? 'leaving' : ''}`} onClick={onDone} aria-hidden="true"><Logo play quick /></div>;
}

// The opening logo sits beside the app, in a place of its own that never changes, so it plays once
// straight through. (Its first version was drawn from inside the sign-in check and was rebuilt the
// moment the answer arrived: on his phone the logo flashed, vanished and started again.)
export default function App() {
  // Phone only: the logo's brief build-up while the app opens. It covers the moment before anything has loaded.
  // Only for a real open. A reload in the middle of use (the phone dropping the page while the camera was
  // up, or an update arriving as you move between pages) goes straight back to the app: the owner saw the
  // logo play after photographing a receipt.
  const [opening, setOpening] = useState(() => typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches && !midSession());
  // The app waits for the drawing to finish. Started together, the phone was too busy building the
  // dashboard to draw the logo's frames: it showed the finished logo, or only a glimpse of it.
  const [started, setStarted] = useState(!opening);
  const start = useCallback(() => setStarted(true), []);
  const closeOpening = useCallback(() => { setStarted(true); setOpening(false); }, []);
  return <>{started && <Gate />}{opening && <Opening onDone={closeOpening} onDrawn={start} />}</>;
}

function Gate() {
  const { data: auth, reload: reloadAuth } = useData('/api/auth/status');
  if (auth) setLogoVersion((auth as any).logoV);
  if (auth) setBudgetDay((auth as any).budgetDay);   // which day a budget month starts, before any month is named
  if (auth) setCurrency((auth as any).currency);   // before the pages below draw a single amount
  // Plays once, right after signing in.
  const [welcome, setWelcome] = useState(false);
  const [pkBusy, setPkBusy] = useState(false);
  const [pkErr, setPkErr] = useState('');
  // The setup guide: shown to a new household until they finish it, and on request from Settings.
  const [guide, setGuide] = useState(false);
  useEffect(() => {
    const open = () => setGuide(true);
    addEventListener('ledger-signed-out', reloadAuth);
    addEventListener('ledger-setup', open);
    return () => { removeEventListener('ledger-signed-out', reloadAuth); removeEventListener('ledger-setup', open); };
  }, [reloadAuth]);

  if (!auth) return null;
  // A new household's copy: nothing opens until the first password is set with the setup code.
  if (auth.needsSetupCode) {
    return (
      <div className="signin">
        <div className="card">
          <div className="signin-brand"><Logo /></div>
          {auth.access?.email ? <FirstSignIn email={auth.access.email} onDone={reloadAuth} /> : (
            <>
              <p className="sub first">Welcome. This is your household's own copy of Ledger. Enter the setup code you were given and choose a password. You'll use the password to sign in from now on.</p>
              <PasswordForm mode="setup" withCode onDone={reloadAuth} />
            </>
          )}
        </div>
      </div>
    );
  }
  if (auth.signedIn && (!auth.setupDone || guide)) return <Setup first={!auth.setupDone} onDone={() => {
    // A household finishing setup for the first time is shown round the app once (see Tour.tsx).
    if (!auth.setupDone) { try { localStorage.setItem('ledger-tour-due', '1'); } catch { /* private window */ } allNewsSeen(); }
    setGuide(false); reloadAuth();
  }} />;
  // A copy that signs in with Cloudflare's check alone: the visitor has already passed it, so let them straight in.
  if (!auth.signedIn && auth.access?.login && auth.access.email) return <AccessSignIn hasPassword={auth.passwordSet} canReset={auth.canReset} canEmail={auth.canEmailReset} onDone={() => { setWelcome(true); reloadAuth(); }} />;
  if (!auth.signedIn && auth.access?.login && !auth.passwordSet) {
    return (
      <div className="signin"><div className="card">
        <div className="signin-brand"><Logo /></div>
        <p className="sub first">This copy of Ledger opens from its web address, after you sign in there with Google or a code sent to your email. Use the link from your welcome email.</p>
        {auth.canReset && <ForgotPassword first canEmail={auth.canEmailReset} onDone={() => { setWelcome(true); reloadAuth(); }} />}
      </div></div>
    );
  }
  if (!auth.signedIn) {
    return (
      <div className="signin">
        <div className="card">
          <div className="signin-brand"><Logo /></div>
          <p className="sub first">Enter your password to open your finances.</p>
          {passkeysPossible() && auth.passkeyOrigins?.includes(location.origin) && (
            <>
              <button
                className="primary passkey" disabled={pkBusy}
                onClick={async () => {
                  setPkBusy(true); setPkErr('');
                  try { await passkeySignIn(); setWelcome(true); reloadAuth(); } catch (e: any) { setPkErr(e.message); }
                  setPkBusy(false);
                }}
              >{pkBusy ? 'Waiting for your device…' : 'Sign in with a passkey'}</button>
              {pkErr && <p className="error" role="alert">{pkErr}</p>}
              <div className="or"><span>or use your password</span></div>
            </>
          )}
          <PasswordForm mode="login" onDone={() => { setWelcome(true); reloadAuth(); }} />
          {auth.canReset && <ForgotPassword canEmail={auth.canEmailReset} onDone={() => { setWelcome(true); reloadAuth(); }} />}
        </div>
      </div>
    );
  }
  return (
    <>
      <Shell onAuthChanged={reloadAuth} />
      {welcome && <Welcome onDone={() => setWelcome(false)} />}
    </>
  );
}

/**
 * A line at the top of the dashboard when a bank connection needs something from the household. It can be
 * put away for a week (per device), and comes back sooner if what it says changes.
 */
function BankAttention({ a }: { a?: { again: string[]; stale: string[]; failed: string } | null }) {
  const [, redraw] = useState(0);
  const [checking, setChecking] = useState(false);
  if (!a) return null;
  const key = JSON.stringify([a.again, a.stale, !!a.failed]);
  try { const h = JSON.parse(localStorage.getItem('ledger-bank-attention') || 'null'); if (h && h.key === key && h.until > Date.now()) return null; } catch { /* show it */ }
  const list = (names: string[]) => (names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`);
  return (
    <div className="bank-attention" role="status">
      <span className="grow">
        {a.again.length > 0 && <><b>{a.again.length === 1 ? 'A bank needs you to sign in again' : `${a.again.length} banks need you to sign in again`}:</b> {list(a.again)}. Until you do, at SimpleFIN, {a.again.length === 1 ? 'its' : 'their'} figures here stay as they were. </>}
        {a.failed && <><b>The last bank update didn't go through.</b> Ledger will keep trying. </>}
        {a.stale.length > 0 && !a.again.length && <><b>No new figures in five days</b> for {list(a.stale)}. </>}
      </span>
      {a.again.length > 0 && <a className="button-link" href="https://bridge.simplefin.org/" target="_blank" rel="noreferrer">Open SimpleFIN</a>}
      <button className="link" disabled={checking} onClick={async () => {
        // Asks the bank service again now, for someone who has just signed back in over there.
        setChecking(true);
        try { await api('/api/simplefin/sync', { method: 'POST' }); } catch { /* the notice will say if it failed */ }
        setChecking(false); dispatchEvent(new CustomEvent('ledger-refresh'));
      }}>{checking ? 'Checking…' : 'Check again'}</button>
      <a href="#connections" onClick={jump(GO.bank)}>Details</a>
      <button className="link" onClick={() => { try { localStorage.setItem('ledger-bank-attention', JSON.stringify({ key, until: Date.now() + 7 * 86400000 })); } catch { /* private window */ } redraw((n) => n + 1); }}>Hide for a week</button>
    </div>
  );
}

/**
 * A quicker way in next time, offered once to a device that has just signed in by typing the password
 * (The owner, 2026-11-23). On a family copy reached through Cloudflare's check, where the person has already
 * proved who they are with Google or an emailed code: let that be enough and stop asking for Ledger's own
 * password. Otherwise, where the address allows passkeys: sign in with Face ID, Touch ID or the device's PIN.
 * Yes does it; "Not now" puts the offer away on this device for good (both are still in Settings).
 * Kept on the device as localStorage `ledger-signin-tip`: 'due' after a password sign-in, 'done' once answered.
 */
function SignInTip() {
  const { data: auth, reload } = useData<any>('/api/auth/status');
  const [, redraw] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  let due = false, hasKey = false;
  try { due = localStorage.getItem('ledger-signin-tip') === 'due'; hasKey = localStorage.getItem('ledger-passkey-here') === '1'; } catch { /* private window */ }
  if (note) return <div className="bank-attention news-notice" role="status"><span className="grow">{note}</span><button type="button" className="link" onClick={() => setNote('')}>OK</button></div>;
  if (!auth || !due) return null;
  const skip = !!auth.access?.email && !auth.access.login && auth.passwordSet;
  const passkey = !skip && passkeysPossible() && !hasKey;
  const put = (v: string) => { try { localStorage.setItem('ledger-signin-tip', v); } catch { /* private window */ } redraw((n) => n + 1); };
  if (!skip && !passkey) return null;
  const yes = async () => {
    setBusy(true); setErr('');
    try {
      if (skip) { await api('/api/auth/access', { method: 'PUT', body: { on: true } }); reload(); setNote("Done. From now on, signing in at this web address is enough, and Ledger won't ask for its own password. You can change that in Settings, Password."); }
      else { await addPasskey(deviceName()); setNote('Done. Next time, choose "Sign in with a passkey" on the sign-in screen and this device will ask for your face, finger or PIN.'); }
      put('done');
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <div className="bank-attention news-notice" role="status">
      <span className="grow">
        {skip
          ? <><b>Skip the Ledger password next time?</b> You already signed in as {auth.access.email} to reach this page. Ledger can take that as enough and stop asking for its own password too.</>
          : <><b>Sign in without typing next time?</b> This device can use Face ID, Touch ID or its PIN for Ledger. Your password keeps working as a backup.</>}
        {err && <> <span className="bad">{err}</span></>}
      </span>
      <button type="button" className="primary" disabled={busy} onClick={yes}>{busy ? 'One moment…' : skip ? 'Yes, skip it' : 'Set it up'}</button>
      <button type="button" className="link" onClick={() => put('done')}>Not now</button>
    </div>
  );
}

/**
 * The dashboard's reminder to add a pay stub (The owner, 2026-11-19: "in case they forget"), in the same place
 * and shape as the bank notice. Who needs one is decided on the server (`stubReminder` in server/paystub.js).
 * "Add a pay stub" goes to the Taxes page with the form already open. Hidden per device for a month at a time;
 * it comes back sooner if what it says changes.
 */
/** Statements that should be out by now and haven't been uploaded (server/statementremind.js). One quiet line, like the pay stub one. */
function StatementReminder({ due }: { due?: { id: number; name: string; expected: string }[] | null }) {
  const [, redraw] = useState(0);
  if (!due || !due.length) return null;
  const key = due.map((d) => `${d.id}:${d.expected}`).join(',');
  try { const h = JSON.parse(localStorage.getItem('ledger-stmt-remind') || 'null'); if (h && h.key === key && h.until > Date.now()) return null; } catch { /* show it */ }
  const names = due.map((d) => d.name);
  const list = names.length <= 3 ? names.join(', ').replace(/, ([^,]*)$/, ' and $1') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
  const go = () => {
    try { sessionStorage.setItem('ledger-upload-debt', '1'); } catch { /* private window: the page still opens */ }
    if (location.hash === '#debt') dispatchEvent(new Event('ledger-upload-debt')); else location.hash = '#debt';
  };
  return (
    <div className="bank-attention" role="status">
      <span className="grow"><b>{due.length === 1 ? 'A new statement is' : 'New statements are'} likely out for {list}.</b> Uploading {due.length === 1 ? 'it' : 'them'} keeps your debt graphs exact.</span>
      <button className="button-link" onClick={go}>Upload debt</button>
      <button className="link" onClick={() => { try { localStorage.setItem('ledger-stmt-remind', JSON.stringify({ key, until: Date.now() + 30 * 86400000 })); } catch { /* private window */ } redraw((n) => n + 1); }}>Hide for a month</button>
    </div>
  );
}

type StubNeed = { people: { who: 'you' | 'spouse' | 'pay'; why: 'missing' | 'old' | 'yearend' | 'changed'; date: string; name?: string }[]; joint: boolean; name: string; spouseName?: string };
function StubReminder({ r }: { r?: StubNeed | null }) {
  const [, redraw] = useState(0);
  if (!r || !r.people.length) return null;
  const key = JSON.stringify(r.people.map((p) => [p.who, p.why, p.why === 'changed' ? p.date : '']));
  try { const h = JSON.parse(localStorage.getItem('ledger-stub-remind') || 'null'); if (h && h.key === key && h.until > Date.now()) return null; } catch { /* show it */ }
  const whose = (p: StubNeed['people'][number]) => (p.who === 'spouse' ? (r.spouseName ? `${r.spouseName}'s` : "your spouse's") : r.name ? `${r.name}'s` : 'your');
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const missing = r.people.filter((p) => p.why === 'missing'), old = r.people.filter((p) => p.why === 'old');
  const yearend = r.people.filter((p) => p.why === 'yearend'), changed = r.people.filter((p) => p.why === 'changed');
  const go = () => {
    // Open the Taxes page's household section (folded on a phone) and the stub form inside it.
    try {
      localStorage.setItem('ledger-folds', JSON.stringify({ ...JSON.parse(localStorage.getItem('ledger-folds') || '{}'), 'tax-stubs': true }));
      sessionStorage.setItem('ledger-stub-open', r.people[0].who === 'spouse' ? 'spouse' : 'you');
    } catch { /* private window: the page still opens */ }
    location.hash = '#taxes';
  };
  return (
    <div className="bank-attention" role="status">
      <span className="grow">
        {missing.length > 0 && <><b>{missing.length === 2 ? "Your pay stubs haven't been added yet" : `${cap(whose(missing[0]))} pay stub hasn't been added yet`}.</b> Until {missing.length === 2 ? 'they are' : 'it is'}, the tax estimate can't say what you'll owe or get back. </>}
        {old.length > 0 && <><b>{cap(old.map(whose).join(' and '))} pay stub is more than four months old.</b> A recent one keeps the tax estimate close. </>}
        {yearend.length > 0 && <><b>Add {yearend.map(whose).join(' and ')} last pay stub of the year.</b> It carries the year's final totals, which is as close as the estimate gets before you file. </>}
        {changed.length > 0 && <><b>{changed.map((p) => p.name).join(' and ')} {changed.length === 1 ? 'has' : 'have'} changed since the last pay stub was added.</b> A new stub brings the tax estimate up to date. </>}
      </span>
      <button className="button-link" onClick={go}>Add a pay stub</button>
      <button className="link" onClick={() => { try { localStorage.setItem('ledger-stub-remind', JSON.stringify({ key, until: Date.now() + 30 * 86400000 })); } catch { /* private window */ } redraw((n) => n + 1); }}>Hide for a month</button>
    </div>
  );
}

/**
 * The first screen of a new family copy when Cloudflare has already confirmed who the visitor is: they
 * choose how to sign in from now on. That check alone (nothing to remember), or a Ledger password as well.
 */
function FirstSignIn({ email, onDone }: { email: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [withPassword, setWithPassword] = useState(false);
  const claim = async () => {
    setBusy(true); setErr('');
    try { await api('/api/auth/access/claim', { method: 'POST' }); onDone(); } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  return (
    <>
      <p className="sub first">Welcome. This is your household's own copy of Ledger. You're signed in as <b>{email}</b>.</p>
      {!withPassword ? (
        <>
          <p className="sub">How would you like to open Ledger from now on?</p>
          <button className="primary passkey" disabled={busy} onClick={claim}>{busy ? 'Opening…' : 'Just this sign-in. No extra password'}</button>
          <small className="first-note">You'll get in the way you just did, with Google or a code sent to your email. Nothing more to remember.</small>
          {err && <p className="error" role="alert">{err}</p>}
          <div className="or"><span>or</span></div>
          <button disabled={busy} onClick={() => setWithPassword(true)}>Add a Ledger password as well</button>
          <small className="first-note">A second lock: after that sign-in, Ledger asks for a password of its own. You can add one later in Settings too.</small>
        </>
      ) : (
        <>
          <p className="sub">Enter the setup code from your welcome email and choose a password. Ledger will ask for the password after you sign in.</p>
          <PasswordForm mode="setup" withCode onDone={onDone} />
          <button className="link" onClick={() => setWithPassword(false)}>Back</button>
        </>
      )}
    </>
  );
}

/** Lets an already-confirmed visitor into a copy that signs in with Cloudflare's check alone. */
function AccessSignIn({ hasPassword, canReset, canEmail, onDone }: { hasPassword: boolean; canReset?: boolean; canEmail?: boolean; onDone: () => void }) {
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    api('/api/auth/access/login', { method: 'POST' }).then(() => live && onDone()).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, []);
  return (
    <div className="signin"><div className="card">
      <div className="signin-brand"><Logo /></div>
      {!err ? <p className="sub first">Opening your Ledger…</p> : (
        <>
          <p className="error" role="alert">{err}</p>
          {hasPassword && <PasswordForm mode="login" onDone={onDone} />}
          {canReset && <ForgotPassword first={!hasPassword} canEmail={canEmail} onDone={onDone} />}
        </>
      )}
    </div></div>
  );
}

/** One name per screen: a page, or one of the dashboard's detail views. */
const pageKey = (page: string, view: string) => `${page}/${INSIGHTS.includes(view as InsightView) ? view : ''}`;

/**
 * The line across the top of a public demo copy (server/demo.js): the figures are made up, what a visitor
 * changes is wiped, and what is switched off there. Shown on every page; there is nothing to dismiss.
 */
function DemoBanner() {
  const { data: auth } = useData<any>('/api/auth/status');
  const d = auth?.demo;
  if (!d) return null;
  return (
    <div className="bank-attention demo-banner" role="note">
      <span className="grow"><b>This is a demo.</b> Every figure here is made up.<span className="demo-more"> Click around and change anything you like: it is all wiped and started fresh within the hour. Bank sync, uploads and email are switched off here, and Ask your CFO shows example answers.</span></span>
      {d.repo && <a className="button" href={`https://github.com/${d.repo}`} target="_blank" rel="noreferrer">Get Ledger</a>}
      {(d.version || d.updated) && <small className="demo-build">{d.version ? `Running version ${d.version}.` : ''}{d.updated ? ` Updated ${new Date(`${d.updated}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}.` : ''}</small>}
    </div>
  );
}

function Shell({ onAuthChanged }: { onAuthChanged: () => void }) {
  const [page, setPage] = useState<PageId>(fromHash);
  // The part after a slash picks a view within a page, as in #transactions/review.
  const [view, setView] = useState(() => location.hash.split('/')[1] ?? '');
  const shown = useRef(pageKey(page, view));
  // A copy started with no time zone runs on world time until a browser says where it is (server/db.js).
  // Asked once per load; the server only takes the first answer.
  useEffect(() => {
    (async () => {
      try {
        const c = await (await fetch('/api/clock')).json();
        if (!c?.needs) return;
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (!zone) return;
        const r = await fetch('/api/clock', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ zone }) });
        if (r.ok && (await r.json()).changed) window.dispatchEvent(new Event('ledger-refresh'));
      } catch { /* the clock stays as it was */ }
    })();
  }, []);
  const { data: months, reload: reloadMonths } = useData<string[]>('/api/months');
  const { data: bank, reload: reloadBank } = useData('/api/simplefin');
  const { data: stubs } = useData<{ remind?: StubNeed }>('/api/paystub');
  const { data: stmts } = useData<{ due?: { id: number; name: string; expected: string }[] }>('/api/statements/remind');
  // Logos Claude has found for merchants; set before the pages draw so every row can use them.
  const { data: foundLogos, reload: reloadLogos } = useData<{ found: Record<string, string>; chosen: Record<string, string> }>('/api/logos/found');
  if (foundLogos) setFoundLogos(foundLogos);
  useEffect(() => {
    addEventListener('ledger-logos', reloadLogos);
    return () => removeEventListener('ledger-logos', reloadLogos);
  }, [reloadLogos]);
  const [month, setMonth] = useState('');
  const active = (month && months?.includes(month) ? month : months?.[0]) || '';

  // Shortly after the app opens, the data every page needs is fetched quietly, one request at a
  // time, and kept (see `useData`). The first visit to a page then draws complete straight away, as
  // revisits do, and doesn't show an empty page while it loads. (The owner noticed the difference on a
  // freshly opened family copy: "the screen goes temporarily black".)
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const urls = [
      `/api/summary?month=${active}`, `/api/transactions?month=${active}`, '/api/categories', '/api/accounts', '/api/checking', '/api/cashflow', '/api/goals',
      '/api/summary', '/api/recurrings/ignored', '/api/debts', '/api/reports', '/api/tax', '/api/paystub', '/api/gig',
    ];
    const timer = setTimeout(async () => {
      for (const url of urls) {
        if (stop) return;
        if (lastLoaded(url) !== undefined) continue;
        try { const d = await api(url); if (lastLoaded(url) === undefined) noteLoaded(url, d); } catch { /* the page will ask again itself */ }
      }
    }, 700);
    return () => { stop = true; clearTimeout(timer); };
  }, [active]);

  // "Ask your CFO" opens as a panel over whatever page you're on. A click anywhere outside it, the
  // Close button or Escape puts it away; the conversation is kept until the app is reloaded.
  const [cfo, setCfo] = useState(false);
  const [cfoEver, setCfoEver] = useState(false);
  useEffect(() => {
    const open = () => { setCfoEver(true); setCfo(true); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setCfo(false); };
    const shut = () => setCfo(false);            // the tour puts the panel away when it moves on
    addEventListener('ledger-cfo', open);
    addEventListener('ledger-cfo-close', shut);
    addEventListener('keydown', key);
    return () => { removeEventListener('ledger-cfo', open); removeEventListener('ledger-cfo-close', shut); removeEventListener('keydown', key); };
  }, []);

  useEffect(() => {
    const go = () => { setPage(fromHash()); setView(location.hash.split('/')[1] ?? ''); };
    const onHash = () => {
      // Moving to another page cross-fades: the old one fades out as the new one comes in.
      const next = pageKey(fromHash(), location.hash.split('/')[1] ?? '');
      const doc = document as Document & { startViewTransition?: (change: () => void) => { ready: Promise<unknown>; finished: Promise<unknown> } };
      const moving = next !== shown.current;
      shown.current = next;
      // (A fade cut short by the next tap is fine, so that isn't reported as an error.)
      // Phone only. On the computer the browser's cross-fade works from flat pictures of the screen, and a picture
      // can't hold the side menu's frosted glass, so the menu lost its frost for a moment on every click. There the
      // new page simply fades in (see `.page` in styles.css) and the menu is never touched.
      if (moving && innerWidth < 761 && doc.startViewTransition && !reducedMotion() && document.visibilityState === 'visible') {
        // A browser can drop a fade (the app went to the background, say) without
        // switching the page, so the switch is made anyway if it hasn't happened shortly.
        let switched = false;
        // The jump to the top happens with the switch, so the old page isn't seen scrolling away first.
        const change = () => { switched = true; go(); scrollTo(0, 0); };
        const fade = doc.startViewTransition(() => flushSync(change));
        fade.ready.catch(() => {});
        fade.finished.catch(() => {});
        setTimeout(() => { if (!switched) change(); }, 350);
      }
      else { go(); if (moving) scrollTo(0, 0); }
    };
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  const usesMonth = page === 'dashboard' || page === 'transactions' || page === 'budgets';
  const narrow = typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches;
  const title = PAGES.find((p) => p.id === page)!.label;
  const taxesOn = useTaxes();
  const tabs = PAGES.filter((p) => p.id !== 'connections' && p.id !== 'cfo' && p.id !== 'about' && (taxesOn || p.id !== 'taxes'));

  const news = useUnseenNews().length;
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Sections">
        <div className="brand with-logo"><Logo loop /></div>
        {PAGES.filter((p) => p.id !== 'cfo' && (taxesOn || p.id !== 'taxes')).map((p) => (
          <a key={p.id} href={`#${p.id}`} className={`nav ${page === p.id ? 'on' : ''}`} aria-current={page === p.id ? 'page' : undefined}>
            <NavIcon id={p.id} />
            {p.label}
            {p.id === 'about' && news > 0 && <span className="news-dot" role="img" aria-label="Something new" />}
          </a>
        ))}
        <a href="#cfo" className={`cfo-button ${cfo ? 'on' : ''}`} aria-expanded={cfo} aria-label="Ask your CFO, your Claude Financial Officer"
          onClick={(e) => { e.preventDefault(); if (cfo) setCfo(false); else dispatchEvent(new Event('ledger-cfo')); }}>
          <span>Ask your</span>
          <CfoSeal size={84} />
        </a>
        {!narrow && <WeekTip />}
        {bank?.sampleData && <div className="sample-note">{bank?.demo ? 'A demo with made-up figures.' : <>Sample data. <a href="#connections" onClick={jump(GO.bank)}>Connect your bank</a> to see your own.</>}</div>}
      </nav>

      <main className="main" data-page={page}>
        <DemoBanner />
        {page === 'dashboard' && <BankAttention a={bank?.attention} />}
        {page === 'dashboard' && <StubReminder r={stubs?.remind} />}
        {page === 'dashboard' && <StatementReminder due={stmts?.due} />}
        {page === 'dashboard' && <OwedNotice />}
        {page === 'dashboard' && <UpdateNotice />}
        {page === 'dashboard' && <SignInTip />}
        {page === 'dashboard' && <NewsNotice mark={<Logo />} />}
        <header className="topbar">
          {/* The page's own icon sits large and faint behind the start of the title, and the
              title's letters dissolve in from left to right each time the page changes. */}
          <h1 className="page-title" key={page} aria-label={title}>
            <span className="title-mark" aria-hidden="true"><NavIcon id={page} /></span>
            <span className="title-text" aria-hidden="true">
              {[...title].map((ch, i) => <span key={i} className="ch" style={{ '--i': i } as React.CSSProperties}>{ch}</span>)}
            </span>
          </h1>
          <div className="topbar-right">
            {usesMonth && months && months.length > 0 && (
              <select className="month" value={active} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
                {months.map((m) => (
                  // A phone has no room for "November 2026" beside a long page title, so the month is shortened there.
                  <option key={m} value={m}>{narrow ? periodShort(m) : periodLong(m)}</option>
                ))}
              </select>
            )}
            {page !== 'connections' && (
              <a href="#connections" className="gear" aria-label="Settings"><NavIcon id="connections" /></a>
            )}
          </div>
        </header>
        <div className="page" key={pageKey(page, view)}>
        {page === 'cfo' ? (
          <Cfo />
        ) : page === 'about' ? (
          <About />
        ) : page === 'connections' ? (
          <Connections onChanged={() => { reloadMonths(); reloadBank(); onAuthChanged(); }} />
        ) : active ? (
          <>
            {page === 'dashboard' && (INSIGHTS.includes(view as InsightView)
              ? <Insight month={active} view={view as InsightView} />
              : <Dashboard month={active} />)}
            {page === 'transactions' && <Transactions key={view === 'review' ? 'review' : 'all'} month={active} review={view === 'review'} start={view} />}
            {page === 'budgets' && <Budgets month={active} />}
            {page === 'recurring' && <Recurring />}
            {page === 'debt' && <Debt />}
            {page === 'taxes' && (taxesOn ? <Taxes /> : <TaxesOff />)}
            {page === 'accounts' && <Accounts />}
            {page === 'reports' && <Reports />}
          </>
        ) : months ? (
          <p className="sub">No transactions yet. <a href="#connections" onClick={jump(GO.bank)}>Connect your bank</a> or add one by hand.</p>
        ) : null}
        </div>
      </main>

      {active && <AddButton onTransactions={page === 'transactions'} />}

      <LogoDialog />
      <IconDialog />
      <UndoToast />
      <Tour />

      {cfoEver && (
        <div className={`cfo-overlay ${cfo ? 'open' : ''}`} onClick={() => setCfo(false)} aria-hidden={!cfo}>
          <aside className="cfo-panel" role="dialog" aria-label="Ask your CFO" onClick={(e) => e.stopPropagation()}>
            <div className="cfo-panel-head">
              <span>Ask your CFO</span>
              <button className="link" onClick={() => setCfo(false)}>Close</button>
            </div>
            <Cfo />
          </aside>
        </div>
      )}

      <PhoneMenu tabs={tabs} page={page} />
    </div>
  );
}
