// Merchant logos. The app asks for a logo by website domain (netflix.com); this
// fetches it once, keeps it in the database, and serves it from there afterwards.
// Three sources, in order: Logo.dev, a logo database with proper company logos, when a key for it is
// saved (setting `logodev_key`, or LEDGER_LOGODEV_KEY for a family copy; a free account's
// publishable key, never printed); then Google's public icon service, then DuckDuckGo's; neither of those needs a key. Your browser never contacts the icon
// service itself, and only the domain name is ever sent, never a transaction.
import fs from 'node:fs';
import { db, getSetting, setSetting } from './db.js';

db.exec('CREATE TABLE IF NOT EXISTS logos (domain TEXT PRIMARY KEY, image BLOB, type TEXT, fetched INTEGER NOT NULL)');

const DAY = 86400000;
const inFlight = new Map();

const logoDevKey = () => getSetting('logodev_key') || process.env.LEDGER_LOGODEV_KEY || '';
// Where Logo.dev's pictures come from; LEDGER_LOGODEV_URL stands in for it in tests and is ignored in a container.
const LOGODEV = (!fs.existsSync('/.dockerenv') && process.env.LEDGER_LOGODEV_URL) || 'https://img.logo.dev';
// Pages add this to every logo's address, so browsers fetch the pictures again after the source changes.
export const logoVersion = () => getSetting('logo_v', '');
const bumpVersion = () => setSetting('logo_v', String(Date.now()).slice(-7));

/** A company's logo from Logo.dev, or null when it has none (fallback=404 stops it sending a placeholder). */
async function fromLogoDev(domain) {
  const key = logoDevKey();
  if (!key) return null;
  try {
    const res = await fetch(`${LOGODEV}/${encodeURIComponent(domain)}?token=${encodeURIComponent(key)}&size=128&format=png&fallback=404`, { signal: AbortSignal.timeout(8000) });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.startsWith('image/')) return null;
    const image = Buffer.from(await res.arrayBuffer());
    return image.length > 600 ? { image, type } : null;
  } catch { return null; }
}

/** Fetches every known site's logo again from Logo.dev, replacing what was kept. Pictures chosen by hand are left alone. */
export async function refreshFromLogoDev() {
  let better = 0, tried = 0;
  for (const { domain } of db.prepare("SELECT domain FROM logos WHERE domain NOT LIKE '%.upload'").all()) {
    tried++;
    const logo = await fromLogoDev(domain);
    if (logo) { saveLogo(domain, logo); better++; }
    // Logo.dev turns away bursts (it answered "too many requests" after about ninety in a row), so go gently.
    await new Promise((r) => setTimeout(r, 700));
  }
  return { tried, better };
}

export async function fetchLogo(domain) {
  const first = await fromLogoDev(domain);
  if (first) return first;
  const res = await fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`, { signal: AbortSignal.timeout(8000) });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.startsWith('image/')) return null;
  const image = Buffer.from(await res.arrayBuffer());
  // The service answers unknown sites with a tiny placeholder globe.
  if (image.length > 600) return { image, type };
  return fromDuckDuckGo(domain);
}

/** The last resort: DuckDuckGo's icon service. Its icons are small, but it knows some sites the others don't, and it says plainly (404) when it has nothing. */
async function fromDuckDuckGo(domain) {
  try {
    const res = await fetch(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`, { signal: AbortSignal.timeout(8000) });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.startsWith('image/')) return null;
    const image = Buffer.from(await res.arrayBuffer());
    return image.length > 300 ? { image, type } : null;
  } catch { return null; }
}

/** Remembers a fetched logo, or that there wasn't one. */
export function saveLogo(domain, logo) {
  db.prepare('INSERT INTO logos (domain, image, type, fetched) VALUES (?,?,?,?) ON CONFLICT(domain) DO UPDATE SET image = excluded.image, type = excluded.type, fetched = excluded.fetched')
    .run(domain, logo?.image ?? null, logo?.type ?? null, Date.now());
}

// "Sharper logos" (2026-11-27, the owner: "offer a path to the more advanced logos that we use"). A household
// can paste its own free Logo.dev publishable key in Settings; with one, logos come from Logo.dev's
// database of proper company logos first, and from the free icon services only when it has none. The key is
// the household's own: it is checked against Logo.dev before it is kept, never sent back to a page and never
// written to a log, and the app ships with nobody's key. What Logo.dev is told is each shop's website name
// and that key, nothing about the household's money. Logo.dev's free plan asks for a credit, which the
// Settings section and About show while a key is in use.
const refresh = { running: false, tried: 0, better: 0, total: 0 };
async function refreshAll() {
  if (refresh.running) return;
  const rows = db.prepare("SELECT domain FROM logos WHERE domain NOT LIKE '%.upload'").all();
  Object.assign(refresh, { running: true, tried: 0, better: 0, total: rows.length });
  try {
    for (const { domain } of rows) {
      if (!getSetting('logodev_key')) break;   // the key was removed while this ran
      const logo = await fromLogoDev(domain);
      refresh.tried++;
      if (logo) { saveLogo(domain, logo); refresh.better++; }
      // Logo.dev turns away bursts, so go gently.
      await new Promise((r) => setTimeout(r, LOGODEV.startsWith('https://img.logo.dev') ? 700 : 5));
    }
  } finally { refresh.running = false; bumpVersion(); }
}

/** Asks Logo.dev for one well-known logo with a key: 'ok', 'refused' (not a working key) or 'unreachable'. */
async function tryKey(key) {
  try {
    const res = await fetch(`${LOGODEV}/apple.com?token=${encodeURIComponent(key)}&size=64&format=png&fallback=404`, { signal: AbortSignal.timeout(10000) });
    if (res.ok && (res.headers.get('content-type') || '').startsWith('image/')) return 'ok';
    return res.status === 429 || res.status >= 500 ? 'unreachable' : 'refused';
  } catch { return 'unreachable'; }
}

export function installLogos(app) {
  const view = () => ({ hasKey: !!getSetting('logodev_key'), fromHost: !getSetting('logodev_key') && !!process.env.LEDGER_LOGODEV_KEY, refresh: { ...refresh } });
  app.get('/api/logos/source', (_req, res) => res.json(view()));
  app.put('/api/logos/key', async (req, res) => {
    const key = String(req.body?.key || '').trim();
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) return res.status(400).json({ error: 'That doesn\u2019t look like a Logo.dev key. Copy the publishable key from your Logo.dev dashboard: it usually starts with pk_.' });
    const answer = await tryKey(key);
    if (answer === 'refused') return res.status(400).json({ error: 'Logo.dev didn\u2019t accept that key. Copy the publishable key again (not the secret one) and paste the whole of it.' });
    if (answer === 'unreachable') return res.status(502).json({ error: 'Logo.dev couldn\u2019t be reached just now, so the key wasn\u2019t checked or saved. Try again in a minute.' });
    setSetting('logodev_key', key);
    bumpVersion();
    refreshAll().catch(() => {});   // the logos already kept are replaced in the background, a few a second
    res.json(view());
  });
  app.delete('/api/logos/key', (_req, res) => {
    db.prepare("DELETE FROM settings WHERE key = 'logodev_key'").run();
    res.json(view());
  });

  app.get('/api/logo/:domain', async (req, res) => {
    const domain = String(req.params.domain).toLowerCase();
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain) || domain.length > 80) return res.status(400).end();
    let row = db.prepare('SELECT image, type, fetched FROM logos WHERE domain = ?').get(domain);
    // Fetching can be switched off (setting `logos_off`): logos already kept still show, and nothing new is
    // asked of the icon services, which would otherwise be told the websites of the shops a household uses.
    if (getSetting('logos_off') === '1' && !row?.image) return res.status(404).end();
    // Found logos are kept for good; a miss is retried after a month.
    if (!row || (!row.image && Date.now() - row.fetched > 30 * DAY)) {
      if (!inFlight.has(domain)) {
        inFlight.set(domain, fetchLogo(domain).catch(() => null).then((logo) => {
          db.prepare('INSERT INTO logos (domain, image, type, fetched) VALUES (?,?,?,?) ON CONFLICT(domain) DO UPDATE SET image = excluded.image, type = excluded.type, fetched = excluded.fetched')
            .run(domain, logo?.image ?? null, logo?.type ?? null, Date.now());
          inFlight.delete(domain);
        }));
      }
      await inFlight.get(domain);
      row = db.prepare('SELECT image, type FROM logos WHERE domain = ?').get(domain);
    }
    if (!row?.image) return res.status(404).end();
    res.setHeader('Content-Type', row.type);
    res.setHeader('Cache-Control', 'private, max-age=2592000');
    res.end(Buffer.from(row.image));
  });
}
