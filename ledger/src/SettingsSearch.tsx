// The box at the top of Settings (2026-11-26). Settings has grown to about twenty sections, and people
// look for a thing by their own word for it ("bank", "dark", "backup"), which is often not the section's
// title. So each place carries a few everyday words, typing shrinks the page to the places that match, and
// choosing one opens its section and rings it, the way "Show me" links do.
//
// Under the box, "You open most" keeps the sections this device opens most often one tap away, so the
// regulars need no search at all (localStorage `ledger-settings-used`, per device: a count per section).
// Nothing here is sent anywhere.
import { useEffect, useRef, useState } from 'react';
import { goTo, type Go } from './go';

type Place = { id: string; title: string; why: string; words: string; go: Go };
const fold = (id: string, inner?: string, at?: string): Go => ({ page: 'connections', fold: inner ? [id, inner] : id, at });

// `id` is the section's fold id where it has one; that is also what "You open most" counts.
const PLACES: Place[] = [
  { id: 'look', title: 'Appearance', why: 'Backdrops, holiday scenes and colourways', words: 'theme background wallpaper scene holiday christmas colour color look style skin', go: { page: 'connections', at: '[data-go="appearance"]' } },
  { id: 'look-colours', title: 'Light or dark, colours and typeface', why: 'In Appearance: light or dark, text colour, accent, font and display size', words: 'dark light mode night font typeface text size bigger larger smaller zoom accent', go: { page: 'connections', fold: 'look-colours' } },
  { id: 'look-photo', title: 'Your own photo', why: 'In Appearance: a picture of yours as the backdrop', words: 'photo picture image wallpaper background custom', go: { page: 'connections', fold: 'look-photo' } },
  { id: 'look-motion', title: 'Motion', why: 'In Appearance: moving scenes, characters and page fades', words: 'animation animations moving characters fireworks fade reduce still', go: { page: 'connections', fold: 'look-motion' } },
  { id: 'password', title: 'Password', why: 'Change your password, sign out, or give another adult a sign-in', words: 'login log in sign in signin sign out signout logout security people person spouse partner user users devices', go: { page: 'connections', at: '[data-go="password"]' } },
  { id: 'passkeys', title: 'Passkeys', why: 'Sign in with Face ID, Touch ID or your device PIN', words: 'face id touch id fingerprint biometric passkey passwordless', go: { page: 'connections', at: '[data-go="passkeys"]' } },
  { id: 'bank', title: 'SimpleFIN Sync', why: 'Connects your bank so purchases arrive by themselves', words: 'bank banks connect connection sync token simplefin automatic link plaid feed', go: fold('bank') },
  { id: 'accounts', title: 'Synced accounts', why: 'The accounts your bank sends, and what kind each is', words: 'bank account accounts type checking savings credit card loan mortgage kind', go: fold('accounts') },
  { id: 'currency', title: 'Currency', why: 'Pounds, euros, dollars: how amounts are written', words: 'money symbol pound euro dollar yen country international', go: fold('currency') },
  { id: 'import', title: 'Import a file', why: 'A file downloaded from your bank, or a statement to read', words: 'bank csv upload file statement pdf spreadsheet export apple card history', go: fold('import') },
  { id: 'paydays', title: 'Paydays', why: 'When each paycheck, benefits check or pension arrives', words: 'paycheck paycheque pay salary wage wages income payday job employer social security pension benefits retired', go: fold('paydays') },
  { id: 'gig', title: 'Side gig', why: 'Income with no tax taken out, and how it pays', words: 'side job freelance self-employed self employed tutoring contractor business 1099 gig jobs calendar', go: fold('gig') },
  { id: 'rules', title: 'What Ledger has learned', why: 'Rules for filing purchases and claiming them for tax', words: 'rule rules category categories automatic filing merchant shop forget remembered', go: fold('rules') },
  { id: 'export', title: 'Download your data', why: 'Every transaction as a spreadsheet file, and backups', words: 'backup back up export download csv spreadsheet excel copy save restore', go: fold('export') },
  { id: 'updates', title: 'Updates', why: 'Whether a newer version of Ledger is out, and how to update', words: 'update updating version upgrade new release docker latest how', go: fold('updates', undefined, '[data-go="how-to-update"]') },
  { id: 'erase', title: 'Delete everything', why: 'Wipe your copy of Ledger for good', words: 'delete erase wipe remove reset start over close account', go: fold('erase') },
  { id: 'family', title: 'Family requests', why: 'Requests from family for their own copy, and reports they send', words: 'family share sharing invite request approve copy copies feedback', go: fold('family') },
  { id: 'applepay', title: 'Apple Pay purchases', why: 'An iPhone reports each purchase as you pay', words: 'apple pay iphone shortcut tap wallet phone automatic', go: fold('applepay') },
  { id: 'taxes-on', title: 'Tax section', why: 'Switch the US tax estimate on or off', words: 'tax taxes irs off hide country outside united states', go: fold('taxes-on') },
  { id: 'allowance', title: 'Allowances', why: 'A notebook of what you hold for each child', words: 'kids children child allowance pocket money chores jars', go: fold('allowance') },
  { id: 'email', title: 'Summary email', why: 'A short summary sent on the days you choose', words: 'email mail gmail summary weekly daily send inbox recipients', go: fold('email') },
  { id: 'alerts', title: 'Alerts', why: 'Emails when checking runs low, a bill is due or a budget tips over', words: 'alert alerts notification notifications notify warn warning low balance reminder reminders pay stub statement', go: fold('alerts') },
  { id: 'ha-sensors', title: 'Home Assistant sensors', why: 'Let automations react to bills, a low balance or budgets', words: 'home assistant sensor sensors automation automations ha', go: fold('ha-sensors') },
  { id: 'ai', title: 'AI recap and logos', why: 'Your Anthropic key, what AI costs, and what has been sent', words: 'ai claude anthropic key api cfo recap logo logos model cost privacy private receipts', go: fold('ai') },
  { id: 'ai-names', title: 'Hide names from the AI', why: 'In AI recap and logos: your names, employers, accounts and banks are sent as plain labels', words: 'privacy private hide names anonymous scrub mask employer bank ai claude', go: fold('ai', 'ai-names') },
  { id: 'ai-private', title: 'Keep some categories away from Claude', why: 'In AI recap and logos: categories the AI never sees', words: 'privacy private hide secret ai claude categories', go: fold('ai', 'ai-private') },
  { id: 'vipkid', title: 'Class calendar', why: 'Reads your booked classes to work out pay', words: 'vipkid class classes calendar caldav booked', go: fold('vipkid') },
];
// Everyday words offered before anything is typed, so nobody has to guess what to type.
const STARTERS = ['Bank', 'Password', 'Colours', 'Paycheck', 'Email', 'Backup'];

const there = (p: Place) => {
  const f = p.go.fold ? (Array.isArray(p.go.fold) ? p.go.fold[0] : p.go.fold) : '';
  // An inner section of Appearance or AI is there whenever its parent is.
  if (p.id.startsWith('look-')) return !!document.querySelector('[data-go="appearance"]');
  return !!document.querySelector(f ? `[data-fold="${f}"]` : p.go.at || 'x-none');
};
const readUsed = (): Record<string, number> => { try { const v = JSON.parse(localStorage.getItem('ledger-settings-used') || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
const norm = (s: string) => s.toLowerCase().replace(/colour/g, 'color').trim();

/** The text with the typed word marked where it appears. */
function Marked({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  return i < 0 ? <>{text}</> : <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

export function SettingsSearch() {
  const [q, setQ] = useState('');
  const [used, setUsed] = useState(readUsed);
  const [focused, setFocused] = useState(false);
  const [, redraw] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const bump = (id: string) => {
    const next = { ...readUsed() }; next[id] = (next[id] || 0) + 1;
    try { localStorage.setItem('ledger-settings-used', JSON.stringify(next)); } catch { /* private window: lasts until reload */ }
    setUsed(next);
  };
  // While something is typed, the rest of Settings steps aside (it stays loaded, so nothing typed there is lost).
  useEffect(() => { box.current?.parentElement?.classList.toggle('searching', !!q.trim()); }, [q]);
  useEffect(() => {
    const page = box.current?.parentElement;
    if (!page) return;
    // A section opened by hand counts toward "You open most". The count is taken as the click passes, while
    // the heading still says whether it was shut.
    const on = (e: Event) => {
      const head = (e.target as HTMLElement).closest?.('.fold-head');
      const id = head?.closest('[data-fold]')?.getAttribute('data-fold');
      if (head && id && head.getAttribute('aria-expanded') === 'false' && PLACES.some((p) => p.id === id)) bump(id);
    };
    page.addEventListener('click', on);
    // Which sections this copy has is only known once the page has drawn them.
    const t = setTimeout(() => redraw((n) => n + 1), 600);
    return () => { page.removeEventListener('click', on); clearTimeout(t); page.classList.remove('searching'); };
  }, []);

  const term = norm(q);
  const places = PLACES.filter(there);
  const hits = !term ? [] : places
    .map((p) => {
      const title = norm(p.title), why = norm(p.why), words = norm(p.words).split(' ');
      // "colours" should find "colour", "banks" should find "bank".
      const one = (t: string) => (title.startsWith(t) ? 4 : title.includes(t) ? 3 : words.some((w) => w.startsWith(t)) || norm(p.words).includes(t) ? 2 : why.includes(t) ? 1 : 0);
      const score = Math.max(one(term), term.length > 3 && term.endsWith('s') ? one(term.slice(0, -1)) : 0);
      return { p, score };
    })
    .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).map((x) => x.p);
  const most = places.filter((p) => (used[p.id] || 0) >= 2).sort((a, b) => used[b.id] - used[a.id]).slice(0, 4);
  const open = (p: Place) => { setQ(''); bump(p.id); setTimeout(() => goTo(p.go), 30); };

  return (
    <div className="settings-search" ref={box}>
      <label className="settings-search-box">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input type="search" value={q} placeholder="What do you want to change?" aria-label="Search settings" autoComplete="off" enterKeyHint="search"
          onChange={(e) => setQ(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setTimeout(() => setFocused(false), 200)}
          onKeyDown={(e) => { if (e.key === 'Escape') setQ(''); if (e.key === 'Enter' && hits[0]) { (e.target as HTMLInputElement).blur(); open(hits[0]); } }} />
        {q && <button type="button" className="link" aria-label="Clear the search" onClick={() => setQ('')}>Clear</button>}
      </label>
      {!term && most.length > 0 && (
        <div className="settings-chips"><small>You open most</small>
          {most.map((p) => <button key={p.id} type="button" className="chip" onClick={() => open(p)}>{p.title}</button>)}
          <button type="button" className="link settings-forget" onClick={() => { try { localStorage.removeItem('ledger-settings-used'); } catch { /* nothing kept */ } setUsed({}); }}>Forget these</button>
        </div>
      )}
      {!term && (focused || most.length === 0) && (
        <div className="settings-chips"><small>People often look for</small>
          {STARTERS.map((w) => <button key={w} type="button" className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => setQ(w.toLowerCase())}>{w}</button>)}
        </div>
      )}
      {term && (
        <div className="settings-hits" role="list">
          <small>{hits.length === 0 ? 'Nothing in Settings matches that.' : `${hits.length} place${hits.length === 1 ? '' : 's'}`}</small>
          {hits.map((p) => (
            <button key={p.id} type="button" role="listitem" className="settings-hit" onClick={() => open(p)}>
              <span className="grow"><b><Marked text={p.title} q={q.trim()} /></b><small><Marked text={p.why} q={q.trim()} /></small></span><span aria-hidden="true">›</span>
            </button>
          ))}
          {hits.length === 0 && <p className="sub">Try another word, or clear the box to see every section. Budgets, bills, debts and taxes are changed on their own pages, not here.</p>}
        </div>
      )}
    </div>
  );
}
