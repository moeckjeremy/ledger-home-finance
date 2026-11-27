import { at } from './base';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { applyLook, readLook } from './appearance';
import { busyFor } from './lib';

// The holiday backdrop is a standalone file (public/seasonal-backdrop.js) so it can be
// reused elsewhere. On its own it appears only around holidays, not for the plain seasons; the
// choice on the Connections page is remembered on this device.
const read = (k: string, d: string) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const script = document.createElement('script');
script.type = 'module';
script.src = at('/seasonal-backdrop.js');
document.head.append(script);
const backdrop = document.createElement('seasonal-backdrop');
backdrop.setAttribute('only', 'newyear valentines stpatricks easter july4 halloween thanksgiving christmas');
// How long the fade between pages takes, chosen in Connections, "Appearance".
document.documentElement.style.setProperty('--page-fade', `${Number(read('ledger-page-fade', '0.2')) || 0.2}s`);
// The holiday characters stand in the empty foot of the side menu. The phone has no side menu and
// shows none (The owner asked for them off there); it keeps the fireworks, which are behind the page.
backdrop.setAttribute('stage', '.sidebar');
backdrop.setAttribute('motion', read('ledger-backdrop-motion', 'on'));
const phone = matchMedia('(max-width: 760px)').matches;
backdrop.setAttribute('characters', read('ledger-backdrop-characters', 'on') === 'off' ? 'off' : phone ? 'fireworks' : 'on');
document.body.prepend(backdrop);
// The backdrop, colours and typeface chosen in Settings, "Appearance".
// A device that has never chosen starts with this copy's own default, which the server gives
// ('none', plain Onyx, on a family copy; the holiday scenes on the owner's). The very first visit
// doesn't know it yet, so it starts plain and the answer arrives a moment later.
const chosen = read('ledger-backdrop', ''), known = read('ledger-look-default', '');
applyLook(chosen || known ? readLook() : { ...readLook(), backdrop: 'none' });
if (!chosen) {
  fetch('/api/auth/status').then((r) => r.json()).then((s) => {
    if (!['none', 'auto'].includes(s?.look)) return;
    try { localStorage.setItem('ledger-look-default', s.look); } catch { /* private window */ }
    if (s.look !== known || !known) applyLook();
  }).catch(() => { if (!known) applyLook(); });
}

document.addEventListener('touchstart', () => {}, { passive: true });

// When the screen was last touched, and whether a file picker or the camera is up: both are read at
// the next page load (midSession in src/lib.ts) to tell a reload in the middle of use from Ledger
// being opened, so the phone's opening logo plays only for the second. Every file box in the app is
// covered here, whichever page it is on.
let touchedAt = 0;
addEventListener('pointerdown', () => {
  const now = Date.now();
  if (now - touchedAt < 2000) return;
  touchedAt = now;
  try { sessionStorage.setItem('ledger-touched-at', String(now)); } catch { /* private window */ }
}, { passive: true, capture: true });
const fileBox = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  if (!t?.closest) return false;
  if (t.matches('input[type="file"]')) return true;
  const label = t.closest('label') as HTMLLabelElement | null;
  return !!label?.control?.matches('input[type="file"]') || !!label?.querySelector('input[type="file"]');
};
document.addEventListener('click', (e) => { if (fileBox(e.target)) busyFor(180_000); }, true);
document.addEventListener('change', (e) => { if ((e.target as HTMLElement | null)?.matches?.('input[type="file"]')) busyFor(60_000); }, true);

// Updates arrive by themselves. The server gives each build a fingerprint (/version.json); an open
// copy asks for it every few minutes and whenever it comes back into view, and once it differs from
// the one this page was loaded with, the page reloads at a moment that won't interrupt: when it is
// in the background, when you come back to it, or when you next move to another page. Never while
// you're typing in a box or have a window open, and at most once a minute in case something goes wrong.
let loadedBuild = '', updateWaiting = false;
// (ledgerBusyUntil: set while the phone's camera is open for "Take a photo", so a reload can't throw the picture away.)
const midTask = () => Date.now() < ((window as any).ledgerBusyUntil || 0) || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || !!document.querySelector('.logo-dialog-overlay, .undo-toast, .about-overlay, .cfo-overlay.open, .setup, .tour-layer, .sheet-layer, .add-form, .value-how, .split-form, .statement-check, .outlook-edit, .holding-form, .add-account.open, .bill-rename, .logo-draw, .scan-rows, .other-review .add-actions');
const takeUpdate = () => {
  if (!updateWaiting || midTask()) return;
  try { const last = Number(sessionStorage.getItem('ledger-updated-at')) || 0; if (Date.now() - last < 60_000) return; sessionStorage.setItem('ledger-updated-at', String(Date.now())); } catch { /* private window: reload anyway */ }
  location.reload();
};
const checkBuild = async () => {
  try {
    const { build } = await (await fetch('/version.json', { cache: 'no-store' })).json();
    if (!build) return;
    if (!loadedBuild) loadedBuild = build; else if (build !== loadedBuild) updateWaiting = true;
  } catch { /* offline, or the server is restarting: try again later */ }
  if (document.hidden) takeUpdate();
};
checkBuild();
setInterval(checkBuild, 5 * 60_000);
document.addEventListener('visibilitychange', () => { if (document.hidden) takeUpdate(); else checkBuild().then(takeUpdate); });
addEventListener('hashchange', () => setTimeout(takeUpdate, 0));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// On a computer, cards catch the light: a soft sheen follows the pointer across whichever
// card it is over, and the dashboard's headline tiles lean a few degrees toward it. Touch
// screens and anyone who has asked their device for less motion are left alone.
if (matchMedia('(hover: hover) and (pointer: fine)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  let lit: HTMLElement | null = null;
  const clear = () => { if (lit) { lit.classList.remove('lit'); lit.style.removeProperty('--tx'); lit.style.removeProperty('--ty'); lit = null; } };
  addEventListener('pointermove', (e) => {
    const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('.strip-tile, .tile, .card, .fold');
    if (el !== lit) { clear(); lit = el ?? null; lit?.classList.add('lit'); }
    if (!lit) return;
    const r = lit.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    lit.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
    lit.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
    if (lit.matches('.strip-tile, .tile')) { lit.style.setProperty('--tx', `${((0.5 - y) * 5).toFixed(2)}deg`); lit.style.setProperty('--ty', `${((x - 0.5) * 6).toFixed(2)}deg`); }
  }, { passive: true });
  document.addEventListener('pointerleave', clear);
}
