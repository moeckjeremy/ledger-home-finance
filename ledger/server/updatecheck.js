// "A newer version is available", for someone running Ledger with plain Docker (asked for 2026-11-25: Home
// Assistant tells its users about updates itself; a plain Docker install had no way to know).
//
// Once a day the server reads two public files from the project's own repository on GitHub: the latest
// version number and the list of what changed. When that version is newer than the one running, the
// dashboard says so and shows the two lines that update it. It cannot update itself, and doesn't try.
//
// What leaves the machine: a plain request for two public files. Nothing about the household is sent, no
// key is used, and nothing is posted. GitHub does see the machine's internet address, as it did when
// Ledger was installed. It can be switched off (setting `update_check` = '0'; Settings, "Updates").
//
// Offered only where it makes sense. The ready-made image for plain Docker is built with two values baked
// in (addon/build.yml): LEDGER_RELEASE, the version, and LEDGER_REPO, the repository it was published
// from. Without both, nothing here runs: so not on a copy built from the code by hand, not inside Home
// Assistant (which has its own update button), and not on a copy someone else hosts (a setup code).
//
//   GET  /api/update          { offered, on, current, latest, newer, notes, checkedAt, image, page }
//   PUT  /api/update          { on }
//   POST /api/update/check    look now
import { getSetting, setSetting } from './db.js';

const VERSION = /^\d+(\.\d+){1,3}$/;
const current = VERSION.test(process.env.LEDGER_RELEASE || '') ? process.env.LEDGER_RELEASE : '';
const repo = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(process.env.LEDGER_REPO || '') ? process.env.LEDGER_REPO : '';
const offered = !!current && !!repo && process.env.LEDGER_INGRESS !== '1' && !process.env.LEDGER_SETUP_CODE && process.env.LEDGER_DEMO !== '1';

// A stand-in address for tests; ignored in the container, where only GitHub is ever asked.
const base = process.env.NODE_ENV !== 'production' && process.env.LEDGER_UPDATE_URL
  ? process.env.LEDGER_UPDATE_URL.replace(/\/$/, '')
  : `https://raw.githubusercontent.com/${repo}/main/ledger`;

const DAY = 24 * 3600 * 1000;
const isOn = () => getSetting('update_check') !== '0';

/** 1 when a is the newer version, -1 when b is, 0 when they are the same. */
export function compareVersions(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** The changelog's entries for versions newer than `since`, newest first. Other people's words: plain text, cut to length. */
export function notesSince(markdown, since) {
  const out = [];
  let entry = null;
  for (const raw of String(markdown).split(/\r?\n/)) {
    const head = raw.match(/^##\s+(\d+(?:\.\d+){1,3})\s*$/);
    if (head) { entry = compareVersions(head[1], since) > 0 ? { version: head[1], items: [] } : null; if (entry) out.push(entry); continue; }
    if (!entry) continue;
    const item = raw.match(/^\s*-\s+(.*)$/);
    if (item) entry.items.push(item[1].trim());
    else if (raw.trim() && entry.items.length) entry.items[entry.items.length - 1] += ' ' + raw.trim();
  }
  return out.filter((e) => e.items.length).slice(0, 8).map((e) => ({ version: e.version, items: e.items.slice(0, 8).map((t) => t.slice(0, 400)) }));
}

async function read(path) {
  const res = await fetch(`${base}/${path}`, { headers: { 'User-Agent': 'Ledger', Accept: 'text/plain' }, signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const text = await res.text();
  if (text.length > 400000) throw new Error('The answer was too large');
  return text;
}

let busy = null;
/** Ask GitHub once. Failures are quiet: the last good answer stays, and the next look is tomorrow. */
export function checkNow() {
  if (!offered) return Promise.resolve();
  if (busy) return busy;
  busy = (async () => {
    try {
      const config = await read('config.yaml');
      const latest = (config.match(/^version:\s*"?(\d+(?:\.\d+){1,3})"?\s*$/m) || [])[1];
      if (!latest) throw new Error('No version found');
      let notes = [];
      if (compareVersions(latest, current) > 0) {
        try { notes = notesSince(await read('CHANGELOG.md'), current); } catch { /* the version alone is enough */ }
      }
      setSetting('update_latest', latest);
      setSetting('update_notes', JSON.stringify(notes));
      setSetting('update_error', '');
    } catch (e) {
      setSetting('update_error', String(e?.message || e).slice(0, 120));
    }
    setSetting('update_checked', String(Date.now()));
  })().finally(() => { busy = null; });
  return busy;
}

function view() {
  if (!offered) return { offered: false };
  const latest = VERSION.test(getSetting('update_latest')) ? getSetting('update_latest') : '';
  const newer = isOn() && !!latest && compareVersions(latest, current) > 0;
  let notes = [];
  if (newer) { try { notes = JSON.parse(getSetting('update_notes') || '[]'); } catch { notes = []; } }
  return {
    offered: true, on: isOn(), current, latest: isOn() ? latest : '', newer, notes,
    checkedAt: Number(getSetting('update_checked')) || 0, failed: !!getSetting('update_error'),
    image: `ghcr.io/${repo.toLowerCase()}`, page: `https://github.com/${repo}`,
  };
}

export function installUpdateCheck(app) {
  app.get('/api/update', (_req, res) => res.json(view()));
  app.put('/api/update', async (req, res) => {
    if (!offered) return res.status(404).json({ error: "This copy doesn't check for updates." });
    const on = !!req.body?.on;
    setSetting('update_check', on ? '1' : '0');
    if (on) await checkNow();
    res.json(view());
  });
  app.post('/api/update/check', async (_req, res) => {
    if (!offered) return res.status(404).json({ error: "This copy doesn't check for updates." });
    if (!isOn()) return res.status(400).json({ error: 'Checking for updates is switched off.' });
    await checkNow();
    res.json(view());
  });
  if (!offered) return;
  const due = () => { if (isOn() && Date.now() - (Number(getSetting('update_checked')) || 0) >= DAY) checkNow(); };
  setTimeout(due, 90 * 1000).unref();
  setInterval(due, 3 * 3600 * 1000).unref();
}
