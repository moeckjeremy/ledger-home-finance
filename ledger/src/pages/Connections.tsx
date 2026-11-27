import { WeekTipSettings } from '../WeekTip';
import { GO, jump } from '../go';
import { SettingsSearch } from '../SettingsSearch';
import { CurrencySettings } from '../Currency';
import { BudgetMonth, budgetDayWords } from '../BudgetMonth';
import { currencyCode, budgetStartDay } from '../lib';
import { GigPay } from './GigPay';
import { UpdateSettings } from '../UpdateNotice';
import { useTaxes, setTaxes } from '../lib';
import { AllowanceSwitch } from './Allowance';
import { at } from '../base';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Fold, MoneyInput, NumField } from '../ui';
import { StatementReader } from './Statements';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { api, cents, forgetLoaded, money, useData, useGig } from '../lib';
import { choosePhoto, photoUrl, readPhotoMeta, removePhoto, savePhotoMeta, type PhotoMeta, framing } from '../photo';
import { ACCENTS, COLORWAYS, STANDARD_LOOK, FONTS, INKS, readLook, saveLook, type Look, SIZES, readSize, saveSize } from '../appearance';

const TYPES = [
  ['checking', 'Checking'], ['savings', 'Savings'], ['credit', 'Credit card'], ['investment', 'Investment or retirement'], ['hsa', 'Health savings account'], ['property', 'Home, vehicle or other property'],
  ['auto', 'Car loan'], ['mortgage', 'Mortgage'], ['loan', 'Other loan'], ['insurance', 'Insurance policy'],
];

const ago = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} hour${h === 1 ? '' : 's'} ago` : `${Math.round(h / 24)} day${Math.round(h / 24) === 1 ? '' : 's'} ago`;
};

export function PasswordForm({ mode, onDone, withCode = false }: { mode: 'setup' | 'login'; onDone: () => void; withCode?: boolean }) {
  // withCode: a new household's copy asks for its one-time setup code along with the first password.
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'setup' && password.length < 8) return setErr('Use at least 8 characters.');
    if (mode === 'setup' && password !== again) return setErr("The two passwords don't match.");
    if (withCode && !code.trim()) return setErr('Enter the setup code you were given.');
    if (!password) return setErr('Enter your password.');
    try {
      await api(`/api/auth/${mode}`, { method: 'POST', body: withCode ? { password, code } : { password } });
      // Signed in by typing the password: the app may offer this device a quicker way next time (SignInTip).
      if (mode === 'login') { try { if (!localStorage.getItem('ledger-signin-tip')) localStorage.setItem('ledger-signin-tip', 'due'); } catch { /* private window */ } }
      setPassword('');
      setAgain('');
      onDone();
    } catch (e: any) {
      setErr(e.message);
    }
  };
  return (
    <form onSubmit={submit} noValidate className="pw-form">
      {withCode && (
        <label className="field"><span>Setup code</span>
          <input type="text" value={code} autoFocus autoComplete="off" spellCheck={false} onChange={(e) => { setCode(e.target.value); setErr(''); }} />
        </label>
      )}
      {/* Ledger has no user name, and password managers file a password badly without one. This field gives
          them a fixed name to keep it under; it isn't shown and isn't sent. */}
      <input type="text" name="username" autoComplete="username" value="Ledger" readOnly tabIndex={-1} aria-hidden="true" className="pw-user" />
      <label className="field"><span>{mode === 'setup' ? 'New password' : 'Password'}</span>
        <input type="password" name="password" value={password} autoFocus placeholder={mode === 'setup' ? 'At least 8 characters' : ''} autoComplete={mode === 'setup' ? 'new-password' : 'current-password'} onChange={(e) => { setPassword(e.target.value); setErr(''); }} />
      </label>
      {mode === 'setup' && (
        <label className="field"><span>Type it again</span>
          <input type="password" value={again} autoComplete="new-password" onChange={(e) => { setAgain(e.target.value); setErr(''); }} />
        </label>
      )}
      <button type="submit" className="primary">{mode === 'setup' ? 'Set password' : 'Sign in'}</button>
      {err && <p className="error" role="alert">{err}</p>}
    </form>
  );
}

/** "Forgot your password?" on a family copy's sign-in screen: a reset code from whoever runs the copy, and a new password. */
export function ForgotPassword({ onDone, canEmail, first }: { onDone: () => void; canEmail?: boolean; first?: boolean }) {
  const [open, setOpen] = useState(false);
  const [asked, setAsked] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [err, setErr] = useState('');
  if (!open) return <p className="sub forgot"><button className="link" onClick={() => setOpen(true)}>{first ? "Can't get in? Set a password with a reset code" : 'Forgot your password?'}</button></p>;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return setErr('Enter the reset code.');
    if (password.length < 8) return setErr('Use at least 8 characters.');
    if (password !== again) return setErr("The two passwords don't match.");
    try { await api('/api/auth/reset', { method: 'POST', body: { code, password } }); onDone(); } catch (x: any) { setErr(x.message); }
  };
  const emailMe = async () => {
    setErr('');
    try { await api('/api/auth/forgot', { method: 'POST' }); setAsked(true); } catch (x: any) { setErr(x.message); }
  };
  return (
    <form onSubmit={submit} noValidate className="pw-form forgot">
      {canEmail ? (
        asked
          ? <p className="sub" role="status">A reset code is on its way to the email address your Ledger was set up with. It usually arrives within a couple of minutes; check your junk folder too. Enter it below with a new password.</p>
          : <>
              <p className="sub">Ledger will email a one-time reset code to the address your Ledger was set up with. Then enter it here with a new password.</p>
              <button type="button" className="primary" onClick={emailMe}>Email me a reset code</button>
            </>
      ) : <p className="sub">Ask the person who set up your Ledger for a reset code. They can send one from their own Ledger, and it arrives by email. It works once, for a day.</p>}
      <label className="field"><span>Reset code</span><input type="text" value={code} autoFocus autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXX-XXXX-XXXX" onChange={(e) => { setCode(e.target.value); setErr(''); }} /></label>
      <label className="field"><span>New password</span><input type="password" value={password} autoComplete="new-password" placeholder="At least 8 characters" onChange={(e) => { setPassword(e.target.value); setErr(''); }} /></label>
      <label className="field"><span>Type it again</span><input type="password" value={again} autoComplete="new-password" onChange={(e) => { setAgain(e.target.value); setErr(''); }} /></label>
      <button type="submit" className="primary">Set the new password</button>
      <button type="button" onClick={() => setOpen(false)}>Back to sign in</button>
      {err && <p className="error" role="alert">{err}</p>}
    </form>
  );
}

/** Change the password, and sign other devices out, from Settings. */
function PasswordTools() {
  const { data: d, reload } = useData('/api/auth/devices');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ current: '', password: '', again: '' });
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const change = async (e: React.FormEvent) => {
    e.preventDefault(); setNote('');
    if (f.password.length < 8) return setErr('Use at least 8 characters for the new one.');
    if (f.password !== f.again) return setErr("The two new passwords don't match.");
    try {
      const r = await api('/api/auth/password', { method: 'POST', body: { current: f.current, password: f.password } });
      setOpen(false); setF({ current: '', password: '', again: '' }); setErr('');
      setNote(`Password changed.${r.signedOut ? ` ${r.signedOut} other device${r.signedOut === 1 ? ' was' : 's were'} signed out.` : ''}`); reload();
    } catch (x: any) { setErr(x.message); }
  };
  return (
    <>
      {!open ? <button onClick={() => { setOpen(true); setNote(''); }}>Change password</button> : (
        <form onSubmit={change} noValidate className="pw-form">
          <input type="text" name="username" autoComplete="username" value="Ledger" readOnly tabIndex={-1} aria-hidden="true" className="pw-user" />
          <label className="field"><span>Current password</span><input type="password" value={f.current} autoFocus autoComplete="current-password" onChange={(e) => { setF({ ...f, current: e.target.value }); setErr(''); }} /></label>
          <label className="field"><span>New password</span><input type="password" value={f.password} autoComplete="new-password" placeholder="At least 8 characters" onChange={(e) => { setF({ ...f, password: e.target.value }); setErr(''); }} /></label>
          <label className="field"><span>Type it again</span><input type="password" value={f.again} autoComplete="new-password" onChange={(e) => { setF({ ...f, again: e.target.value }); setErr(''); }} /></label>
          <button type="submit" className="primary">Change it</button>
          <button type="button" onClick={() => { setOpen(false); setErr(''); }}>Cancel</button>
          {err && <p className="error" role="alert">{err}</p>}
          <small className="sub">Changing it signs out your other devices.</small>
        </form>
      )}
      {!open && d && d.others > 0 && <button onClick={async () => { const r = await api('/api/auth/signout-others', { method: 'POST' }); setNote(`${r.signedOut} other device${r.signedOut === 1 ? '' : 's'} signed out.`); reload(); }}>Sign out {d.others} other device{d.others === 1 ? '' : 's'}</button>}
      {note && <p className="good" role="status">{note}</p>}
    </>
  );
}

/**
 * Settings, Password, "People who can sign in": a password of their own for each adult in the household.
 * Everyone sees the same Ledger. The first sign-in adds and removes the others; each person changes their
 * own password with "Change password" above.
 */
function People() {
  const { data: d, reload } = useData('/api/auth/people');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', password: '' });
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  if (!d || !d.passwordSet) return null;
  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setNote('');
    if (!f.name.trim()) return setErr('Enter their name.');
    if (f.password.length < 8) return setErr('Use at least 8 characters for their password.');
    try {
      await api('/api/auth/people', { method: 'POST', body: f });
      setNote(`${f.name.trim()} can now sign in with that password, and can change it to one only they know from Settings, Change password.`);
      setF({ name: '', password: '' }); setOpen(false); setErr(''); reload();
    } catch (x: any) { setErr(x.message); }
  };
  const remove = async (p: any) => {
    if (!confirm(`Remove ${p.name}'s sign-in? Their devices are signed out straight away. Nothing in Ledger is deleted.`)) return;
    try { await api(`/api/auth/people/${p.id}`, { method: 'DELETE' }); setNote(`${p.name} can no longer sign in.`); reload(); } catch (x: any) { setNote(x.message); }
  };
  const devices = (n: number) => (n ? `${n} device${n === 1 ? '' : 's'} signed in` : 'not signed in anywhere');
  return (
    <div className="people">
      <div className="group-head"><span>People who can sign in</span><span className="num">{d.people.length + 1}</span></div>
      <div className="row"><span className="grow wrap">The first sign-in{d.you === 0 ? ' (you)' : ''}<small>{devices(d.firstDevices)} · adds and removes the others</small></span></div>
      {d.people.map((p: any) => (
        <div key={p.id} className="row">
          <span className="grow wrap">{p.name}{d.you === p.id ? ' (you)' : ''}<small>{devices(p.devices)}</small></span>
          {d.canManage && <button className="link" onClick={() => remove(p)}>Remove</button>}
        </div>
      ))}
      {d.canManage && (!open ? <button onClick={() => { setOpen(true); setNote(''); }} style={{ marginTop: 10 }}>Add a person</button> : (
        <form onSubmit={add} noValidate className="pw-form">
          <p className="sub">Give another adult in your household a password of their own. They see the same Ledger as you. Either of you can then change your own password without the other needing to know it, and you can take their sign-in away without changing yours.</p>
          <label className="field"><span>Their name</span><input type="text" value={f.name} autoFocus autoComplete="off" maxLength={40} onChange={(e) => { setF({ ...f, name: e.target.value }); setErr(''); }} /></label>
          <label className="field"><span>A password to start them off</span><input type="password" value={f.password} autoComplete="new-password" placeholder="At least 8 characters, different from yours" onChange={(e) => { setF({ ...f, password: e.target.value }); setErr(''); }} /></label>
          <button type="submit" className="primary">Add them</button>
          <button type="button" onClick={() => { setOpen(false); setErr(''); }}>Cancel</button>
          {err && <p className="error" role="alert">{err}</p>}
        </form>
      ))}
      {note && <p className="good" role="status">{note}</p>}
    </div>
  );
}

/** Settings, "What Ledger has learned": the filing and tax-claim rules made as the app is used, each with Remove. */
/** Settings, "Delete everything" on a family copy: wipes the household's own copy after the words are typed out. */
function EraseEverything({ hasPassword }: { hasPassword: boolean }) {
  const [open, setOpen] = useState(false);
  const [words, setWords] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [gone, setGone] = useState(false);
  const ready = words.trim().toLowerCase() === 'delete everything' && (!hasPassword || password !== '');
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true); setErr('');
    try {
      await api('/api/auth/erase', { method: 'POST', body: { confirm: words, password } });
      (window as any).ledgerBusyUntil = Date.now() + 3600000;      // no auto-reload while this message is up
      setGone(true);
    } catch (x: any) { setErr(x.message || 'Could not do that.'); setBusy(false); }
  };
  if (gone) return (
    <section className="card">
      <div className="card-head"><h2>Everything has been deleted</h2></div>
      <p className="sub first">Your copy of Ledger is empty. You can close this page. If you ever want to start again, open the same address and it will begin from the first step.</p>
    </section>
  );
  return (
    <section className="card">
      <div className="card-head"><h2>Delete everything</h2></div>
      <p className="sub first">Removes everything in your copy of Ledger for good: accounts, transactions, budgets, bills, goals, receipts, tax figures, the bank connection, and every password and sign-in. It can't be undone, and nobody can get it back for you. The person who runs the server is told only that your copy is now empty. Its nightly backups, which you can't reach from here, drop the last trace within about a month.</p>
      <p className="sub">Want a copy first? <a href={at('/api/export/transactions.csv')} download>Download your transactions</a>.</p>
      {!open ? <button onClick={() => setOpen(true)}>Delete everything…</button> : (
        <form onSubmit={go} noValidate className="erase-form">
          <label><span>Type <b>delete everything</b> to go ahead</span><input type="text" value={words} autoFocus autoComplete="off" autoCapitalize="none" onChange={(e) => { setWords(e.target.value); setErr(''); }} /></label>
          {hasPassword && <label>Your Ledger password<input type="password" value={password} autoComplete="current-password" onChange={(e) => { setPassword(e.target.value); setErr(''); }} /></label>}
          <div className="add-actions">
            <button type="submit" className="danger" disabled={!ready || busy}>{busy ? 'Deleting…' : 'Delete everything for good'}</button>
            <button type="button" onClick={() => { setOpen(false); setWords(''); setPassword(''); setErr(''); }}>Cancel</button>
          </div>
          {err && <p className="error" role="alert">{err}</p>}
        </form>
      )}
    </section>
  );
}

function Rules() {
  const { data: r, reload } = useData('/api/rules');
  if (!r) return null;
  const forget = async (kind: 'filing' | 'claims', merchant: string) => { await api('/api/rules/forget', { method: 'POST', body: { kind, merchant } }); reload(); };
  const tidy = (m: string) => m.replace(/%/g, '').trim();
  const range = (x: any) => (x.min != null ? ` (${money(x.min)} or more)` : x.max != null ? ` (under ${money(x.max)})` : '');
  return (
    <section className="card">
      <div className="card-head"><h2>What Ledger has learned</h2></div>
      <p className="sub first">These rules were made as you used the app. Taking one off changes nothing already filed; it only stops applying to what comes next.</p>
      <div className="group-head"><span>Always filed in a category</span><span className="num">{r.filing.length}</span></div>
      {r.filing.length === 0 && <p className="sub">None yet. They are made when you change a purchase's category and choose "every purchase from this merchant".</p>}
      {r.filing.map((x: any) => <div key={x.merchant} className="row"><span className="grow wrap">{x.merchant}<small>goes in {x.icon} {x.category}</small></span><button className="link" onClick={() => forget('filing', x.merchant)}>Remove</button></div>)}
      <div className="group-head"><span>Always claimed for tax</span><span className="num">{r.claims.length}</span></div>
      {r.claims.length === 0 && <p className="sub">None yet. They are made when you claim a purchase and choose to do the same for that merchant every time.</p>}
      {r.claims.map((x: any) => <div key={x.merchant} className="row"><span className="grow wrap">{tidy(x.merchant)}<small>{Math.round(x.pct)}% claimed as {x.kind === 'teaching' ? 'a classroom expense' : 'a business expense'}</small></span><button className="link" onClick={() => forget('claims', x.merchant)}>Remove</button></div>)}
      {r.names.length > 0 && <>
        <div className="group-head"><span>Bills you renamed</span><span className="num">{r.names.length}</span></div>
        {r.names.map((x: any) => <div key={x.id} className="row"><span className="grow wrap">{x.name}<small>the bank calls it {x.bank}{range(x)}</small></span></div>)}
        <small className="sub">Change these with Rename on the Recurring page.</small>
      </>}
    </section>
  );
}

/** Settings, "Alerts": short emails between summaries when checking runs low, a bill is due tomorrow, or a budget tips over. */
function Alerts() {
  const { data: a, reload } = useData('/api/alerts');
  const { data: stubs, reload: reloadStubs } = useData<{ remindOn?: boolean }>('/api/paystub');
  const { data: stmts, reload: reloadStmts } = useData<{ on?: boolean }>('/api/statements/remind');
  const remindStmts = async (on: boolean) => { try { await api('/api/statements/remind', { method: 'PUT', body: { on } }); setErr(''); reloadStmts(); window.dispatchEvent(new Event('ledger-refresh')); } catch (e: any) { setErr(e.message); } };
  const [err, setErr] = useState('');
  if (!a) return null;
  const remind = async (on: boolean) => { try { await api('/api/paystub/remind', { method: 'PUT', body: { on } }); setErr(''); reloadStubs(); window.dispatchEvent(new Event('ledger-refresh')); } catch (e: any) { setErr(e.message); } };
  const put = async (body: object) => { try { await api('/api/alerts', { method: 'PUT', body }); setErr(''); reload(); } catch (e: any) { setErr(e.message); } };
  return (
    <section className="card">
      <div className="card-head"><h2>Alerts</h2>{a.on && <span className="good">On</span>}</div>
      <p className="sub first">A short email, once each, when checking is forecast to run low before payday, a bill comes out tomorrow, or a category goes over its budget. They go to the same addresses as the summary email, between 7 in the morning and 9 at night.</p>
      {!a.canSend && <p className="sub">Set up the summary email first: alerts are sent through it.</p>}
      <label className="row check"><span className="grow">Send alerts</span><input type="checkbox" checked={a.on} disabled={!a.canSend} onChange={(e) => put({ on: e.target.checked })} /></label>
      <div className="add-grid"><NumField label="Tell me when checking will drop below" value={a.low} step={50} hint="Dollars, before the next payday" onSave={(v) => put({ low: Number(v) })} /></div>
      {stubs && <>
        <label className="row check"><span className="grow">Remind us to add pay stubs</span><input type="checkbox" checked={stubs.remindOn !== false} onChange={(e) => remind(e.target.checked)} /></label>
        <p className="sub">A notice on the dashboard, and a line in the summary email about once a month, when someone with wages has no recent pay stub in for the tax estimate. Off here is off for everyone in the household, on every device.</p>
      </>}
      {stmts && <>
        <label className="row check"><span className="grow">Remind us to upload statements</span><input type="checkbox" checked={stmts.on !== false} onChange={(e) => remindStmts(e.target.checked)} /></label>
        <p className="sub">A notice on the dashboard, and a line in the summary email about once a month, a few days after a debt's statement should be out and hasn't been uploaded. Ledger learns each debt's usual day from the statements already uploaded, so a debt with fewer than three says nothing. Off here is off for everyone in the household, on every device.</p>
      </>}
      {a.now.length > 0 && <><div className="group-head"><span>True right now</span><span className="num">{a.now.length}</span></div>{a.now.map((t: string) => <p key={t} className="sub">{t}</p>)}</>}
      {(err || a.error) && <p className="error" role="alert">{err || a.error}</p>}
    </section>
  );
}

/** True when this browser, on this address, can use passkeys at all. */
export const passkeysPossible = () => typeof window !== 'undefined' && window.isSecureContext && typeof PublicKeyCredential !== 'undefined';

/** A name for this device's passkey when the person hasn't typed one. */
export const deviceName = () => { const u = navigator.userAgent; return /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android phone' : /Mac/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows computer' : 'This device'; };
/** Adds a passkey for this device to the signed-in household. Throws with a plain message if it can't. */
export async function addPasskey(name: string) {
  const { options, ticket } = await api('/api/passkeys/options', { method: 'POST', body: { origin: location.origin } });
  let response;
  try {
    response = await startRegistration({ optionsJSON: options });
  } catch (e: any) {
    if (e?.name === 'InvalidStateError') { try { localStorage.setItem('ledger-passkey-here', '1'); } catch { /* private window */ } }
    throw new Error(e?.name === 'InvalidStateError' ? 'This device already has a passkey for Ledger.' : e?.name === 'NotAllowedError' ? 'Adding the passkey was cancelled.' : "This device couldn't create a passkey.");
  }
  await api('/api/passkeys', { method: 'POST', body: { ticket, response, name } });
  try { localStorage.setItem('ledger-passkey-here', '1'); } catch { /* private window */ }
}

/** Signs in with a passkey: the device asks for your face, finger or PIN. */
export async function passkeySignIn() {
  const { options, ticket } = await api('/api/auth/passkey/options', { method: 'POST', body: { origin: location.origin } });
  let response;
  try {
    response = await startAuthentication({ optionsJSON: options });
  } catch (e: any) {
    throw new Error(e?.name === 'NotAllowedError' ? 'Sign-in was cancelled.' : "The passkey couldn't be used on this device.");
  }
  await api('/api/auth/passkey/verify', { method: 'POST', body: { ticket, response } });
  try { localStorage.setItem('ledger-passkey-here', '1'); } catch { /* private window */ }
}

function Passkeys() {
  const { data, reload } = useData<any>('/api/passkeys');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const possible = passkeysPossible();
  const add = async () => {
    setBusy(true); setErr(''); setMsg('');
    try {
      await addPasskey(name);
      setName('');
      setMsg('Passkey added. Next time, choose "Sign in with a passkey" on the sign-in screen.');
      reload();
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  };
  const remove = async (k: any) => {
    if (!confirm(`Remove the passkey "${k.name}"? That device will need the password to sign in.`)) return;
    await api(`/api/passkeys/${encodeURIComponent(k.id)}`, { method: 'DELETE' });
    reload();
  };
  const day = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return (
    <section className="card" data-go="passkeys">
      <div className="card-head"><h2>Passkeys</h2>{data?.passkeys.length > 0 && <span className="good">{data.passkeys.length} added</span>}</div>
      <p className="sub first">Sign in with Face ID, Touch ID or your device's PIN instead of typing the password. Your password keeps working as a backup.</p>
      {data?.passkeys.map((k: any) => (
        <div key={k.id} className="row">
          <span className="grow">{k.name}<small>Added {day(k.created_at)}{k.last_used ? ` · last used ${day(k.last_used)}` : ' · not used yet'}</small></span>
          <button onClick={() => remove(k)}>Remove</button>
        </div>
      ))}
      {possible ? (
        <div className="pw-form">
          <label className="field"><span>Name for this passkey</span>
            <input type="text" value={name} maxLength={60} placeholder="Sam's iPhone" onChange={(e) => setName(e.target.value)} />
          </label>
          <button className="primary" disabled={busy} onClick={add}>{busy ? 'Waiting for your device…' : 'Add a passkey'}</button>
          {err && <p className="error" role="alert">{err}</p>}
        </div>
      ) : (
        <p className="sub">
          Passkeys can't be added from this address. Browsers only allow them on a secure address that starts with https and uses a name, and this one is {location.origin}.
          {data?.origins.length > 0 && <> Open Ledger at <a href={data.origins[0]}>{data.origins[0]}</a> instead.</>}
        </p>
      )}
      {msg && <p className="good">{msg}</p>}
      <small>If you use iCloud Keychain, a passkey added on your iPhone also works with Touch ID on your Mac, so you only need to add one.</small>
    </section>
  );
}

function ImportFile({ sampleData, onDone }: { sampleData: boolean; onDone: () => void }) {
  const [reading, setReading] = useState(false);
  const { data: accounts, reload } = useData<any[]>('/api/import/accounts');
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [pv, setPv] = useState<any>(null);
  const [flip, setFlip] = useState(false);
  const [target, setTarget] = useState('new');
  const [name, setName] = useState('Apple Card');
  const [type, setType] = useState('credit');
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');

  const loadPreview = async (text: string, flipValue?: boolean) => {
    setErr('');
    try {
      const p = await api('/api/import/preview', { method: 'POST', body: { csv: text, flip: flipValue } });
      setPv(p);
      setFlip(p.flipped);
    } catch (e: any) {
      setPv(null);
      setErr(e.message);
    }
  };
  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setDone('');
    if (!file) return;
    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
    loadPreview(text);
  };
  const run = async () => {
    if (target === 'new' && !name.trim()) return setErr('Enter a name for the new account.');
    try {
      const body = target === 'new' ? { csv, flip, new_account: { name, type } } : { csv, flip, account_id: Number(target) };
      const r = await api('/api/import', { method: 'POST', body });
      const pend = (r.pendingAdded || 0) + (r.pendingKnown || 0);
      setDone(`${r.added} transaction${r.added === 1 ? '' : 's'} imported${r.skipped ? `, ${r.skipped} already there and skipped` : ''}.${pend ? ` ${pend} pending charge${pend === 1 ? '' : 's'} in the file: ${r.pendingAdded} added as waiting for the bank, ${r.pendingKnown} you had already entered.` : ''}`);
      setCsv('');
      setPv(null);
      setFileName('');
      reload();
      onDone();
    } catch (e: any) {
      setErr(e.message);
    }
  };

  return (
    <section className="card">
      <div className="card-head"><h2>Import a file</h2></div>
      <p className="sub first">
        For accounts the bank connection can't reach, such as Apple Card, and for your checking account's pending charges, which the connection doesn't list. Export the transactions as a CSV file and choose it here. Importing the same file twice won't create duplicates.
        {sampleData ? ' Your first import replaces the sample data.' : ''}
      </p>
      <label className="field file"><span>CSV file</span><input type="file" accept=".csv,text/csv" onChange={pick} /></label>
      <p className="sub">No CSV to be had? <button type="button" className="link" onClick={() => setReading(true)}>Read a PDF or photo of a statement</button> and Ledger lists its transactions for you to check.</p>
      {reading && <StatementReader forImport onClose={() => setReading(false)} onSaved={() => { reload(); onDone(); }} />}
      {pv && (
        <>
          <p className="sub"><b>{fileName}</b>: {pv.count} transactions from {pv.from} to {pv.to}, {cents(pv.spending)} of spending.{pv.pending ? ` Plus ${pv.pending} pending charge${pv.pending === 1 ? '' : 's'}, which will be kept as waiting for the bank.` : ''}</p>
          <table className="table">
            <thead><tr><th>Date</th><th>Description</th><th className="r">Amount</th></tr></thead>
            <tbody>
              {pv.sample.map((t: any, i: number) => (
                <tr key={i}><td>{t.date}</td><td>{t.merchant}</td><td className={`r num ${t.amount > 0 ? 'good' : ''}`}>{t.amount > 0 ? '+' : ''}{cents(Math.abs(t.amount))}</td></tr>
              ))}
            </tbody>
          </table>
          <label className="check">
            <input type="checkbox" checked={flip} onChange={(e) => loadPreview(csv, e.target.checked)} />
            Purchases are positive numbers in this file (green amounts above should be payments and refunds, not purchases)
          </label>
          <div className="add-grid" style={{ marginTop: 12 }}>
            <label>Import into
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="new">A new account</option>
                {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.institution})</option>)}
              </select>
            </label>
            {target === 'new' && (
              <>
                <label>Account name<input type="text" value={name} onChange={(e) => { setName(e.target.value); setErr(''); }} /></label>
                <label>Type
                  <select value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select>
                </label>
              </>
            )}
          </div>
          <div className="add-actions"><button className="primary" onClick={run}>Import {pv.count} transactions</button></div>
        </>
      )}
      {done && <p className="good" role="status">{done}</p>}
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  );
}

// GitHub's mark, drawn in the page's own ink so it reads in the light and dark looks alike (the shape is
// GitHub's own "mark-github" icon from its open-source Octicons set).
function GitHubMark() {
  return (
    <svg className="gh-mark" viewBox="0 0 16 16" width="24" height="24" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

// The public demo on Fly.io: how much it is used and roughly what the month will cost. Shown only on a copy
// that names a demo app (the publisher's). The cost is worked out from list prices, not read from a bill.
function DemoStats() {
  const { data: d, reload } = useData<any>('/api/fly');
  // Which count the bars show.
  const [show, setShow] = useState<'visits' | 'requests'>('visits');
  const [tok, setTok] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!d?.offered) return null;
  const send = async (path: string, method: string, body?: object) => {
    setBusy(true); setErr('');
    try { await api(path, { method, body }); setTok(''); forgetLoaded(); reload(); } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };
  const usd = (n: number) => `$${n.toFixed(2)}`;
  const m = d.month;
  const peak = Math.max(1, ...d.days.map((x: any) => x[show] || 0));
  const share = Math.min(100, Math.round((m.projected / d.allowance) * 100));
  return (
    <div className="demo-stats" data-go="demo-stats">
      <p className="sub first">The demo anyone can open, with made-up figures: <a href={d.address} target="_blank" rel="noreferrer">{d.address.replace('https://', '')}</a>. It sleeps when nobody is visiting and you pay only for the time it is awake.</p>
      {!d.connected ? (
        <>
          <p className="sub">To see its traffic and likely cost here, paste a read-only Fly.io token. It can read figures and change nothing. It is kept on this copy, never shown again, and used only to ask Fly about this one app.</p>
          <div className="token-form">
            <label className="field"><span>Read-only Fly.io token</span><input type="password" autoComplete="off" value={tok} onChange={(e) => setTok(e.target.value)} placeholder="FlyV1 …" /></label>
            <button className="primary" disabled={busy || tok.trim().length < 40} onClick={() => send('/api/fly/token', 'PUT', { token: tok })}>{busy ? 'Checking…' : 'Save'}</button>
          </div>
        </>
      ) : (
        <>
          <div className="row"><span className="grow wrap">Likely cost this month<small>From {m.awakeHours} hours awake and {m.mbOut} MB sent so far{m.daysKnown < m.dayOfMonth ? `, over the ${m.daysKnown} day${m.daysKnown === 1 ? '' : 's'} Ledger has figures for` : ''}. Worked out from Fly's list prices, not read from your bill.</small></span><b>{usd(m.projected)}</b></div>
          <div className="demo-meter"><i style={{ width: `${share}%` }} /></div>
          <p className="sub">{m.projected < d.allowance ? `That is ${share}% of the ${usd(d.allowance)} a month the Free plan covers once a card is on the account, so nothing would be charged.` : `That is over the ${usd(d.allowance)} a month the Free plan covers. Going over moves the account to pay-as-you-go, which bills the whole month.`} Even awake every minute of the month, one machine this size comes to about {usd(d.alwaysOn)}.</p>
          <div className="row"><span className="grow">So far this month</span><b>{usd(m.soFar)}</b></div>
          <div className="row"><span className="grow wrap">Requests this month<small>Every page, picture and figure a visitor's browser asks for counts as one, so one visit is a few dozen.</small></span><b>{m.requests.toLocaleString()}</b></div>
          <h3 className="setup-sub">The last 14 days</h3>
          <div className="repo-tiles">
            <div><b>{d.fortnight.visits.toLocaleString()}</b><small>visits</small></div>
            <div><b>{d.fortnight.requests.toLocaleString()}</b><small>requests</small></div>
            <div><b>{d.fortnight.awakeHours}</b><small>hours awake</small></div>
            <div><b>{usd(m.projected)}</b><small>likely this month</small></div>
          </div>
          <div className="seg demo-pick" role="group" aria-label="What the bars show">
            <button type="button" className={show === 'visits' ? 'on' : ''} onClick={() => setShow('visits')}>Visits</button>
            <button type="button" className={show === 'requests' ? 'on' : ''} onClick={() => setShow('requests')}>Requests</button>
          </div>
          <div className="repo-bars" role="img" aria-label={`${show === 'visits' ? 'Visits' : 'Requests'} by day`}>
            {d.days.map((x: any) => <span key={x.date} title={`${x.date}: ${x.visits} visits, ${x.requests} requests, ${Math.round(x.awakeMin)} minutes awake`}><em>{x[show] ? x[show].toLocaleString() : ''}</em><i style={{ height: `${Math.round((x[show] / peak) * 100)}%`, opacity: x[show] ? 1 : 0.25 }} /><small>{Number(x.date.slice(8))}</small></span>)}
          </div>
          <p className="sub">{show === 'visits'
            ? 'A visit is the demo being opened from an address that has not opened it in the last half hour. The demo keeps the count itself, as a bare number with nothing about who. Counting began on November 27, 2026.'
            : "A request is every page, picture and figure a visitor's browser asks for, so one visit is a few dozen. Fly counts these, and the figure runs a little low."} Each bar is that day against the busiest of the fourteen.</p>
          {d.since?.first ? <p className="sub">Since Ledger began keeping count on {d.since.first}: {(d.since.visits || 0).toLocaleString()} visits and {(d.since.requests || 0).toLocaleString()} requests.</p> : null}
          <p className="sub">Fly's own Billing page is the real figure: <a href="https://fly.io/dashboard/personal/billing" target="_blank" rel="noreferrer">open it</a>. {d.checkedAt ? `Last looked ${new Date(d.checkedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.` : ''}</p>
          {d.error && <p className="error">{d.error}</p>}
          <div className="add-actions"><button disabled={busy} onClick={() => send('/api/fly/refresh', 'POST')}>{busy ? 'Looking…' : 'Look now'}</button><button className="link" disabled={busy} onClick={() => send('/api/fly/token', 'DELETE')}>Remove the token</button></div>
        </>
      )}
      {err && <p className="error">{err}</p>}
    </div>
  );
}

// How the published project is doing on GitHub. Shown only on a copy that names a repository (the publisher's).
function RepoStats() {
  const { data: r, reload } = useData<any>('/api/repo');
  const [tok, setTok] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // When this device last looked, read once; the newest activity is then written down for next time.
  const [seenAt] = useState(() => { try { return localStorage.getItem('ledger-repo-seen') || ''; } catch { return ''; } });
  const newest = (r?.issues || []).reduce((a: string, i: any) => (i.updated > a ? i.updated : a), '');
  useEffect(() => { if (newest) { try { localStorage.setItem('ledger-repo-seen', newest); } catch { /* private window */ } } }, [newest]);
  if (!r?.offered) return null;
  const send = async (path: string, method: string, body?: object) => {
    setBusy(true); setErr('');
    try { await api(path, { method, body }); setTok(''); forgetLoaded(); reload(); } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };
  const days: any[] = (r.days || []).slice(-14);
  const top = Math.max(1, ...days.map((d) => d.clones));
  const issues: any[] = r.issues || [];
  // "New" is anything that has moved since this device last had the section open.
  const fresh = (i: any) => !!seenAt && i.updated > seenAt;
  const when = r.at ? new Date(r.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  return (
    <section className="card repo-stats">
      <div className="card-head"><h2>On GitHub</h2><span className="sub">{r.repo}</span></div>
      {r.error ? <p className="error" role="alert">{r.error}</p> : null}
      {r.facts ? (
        <div className="repo-tiles">
          <div><b>{r.facts.stars}</b><small>stars</small></div>
          <div><b>{r.facts.forks}</b><small>forks</small></div>
          <div><b>{r.facts.watchers}</b><small>watching</small></div>
          <div><b>{r.facts.issues}</b><small>open issues</small></div>
        </div>
      ) : null}
      <h3 className="setup-sub">What people have written</h3>
      {issues.length === 0 ? <p className="sub">Nothing yet. Bug reports, questions and suggestions that people post on GitHub will show here, newest first.</p> : (
        <div className="repo-issues">
          {issues.map((i) => (
            <a key={i.number} className="row" href={i.url || undefined} target="_blank" rel="noreferrer">
              <span className="grow wrap">{fresh(i) ? <em className="tag">new</em> : null}{i.title}
                <small>{i.pull ? 'Offered change' : 'Report or question'} #{i.number} · {i.open ? 'open' : 'closed'} · from {i.by || 'someone'} on {i.opened}{i.comments ? ` · ${i.comments} repl${i.comments === 1 ? 'y' : 'ies'}` : ''}{i.labels.length ? ` · ${i.labels.join(', ')}` : ''}</small></span>
              {i.url ? <span className="sub">Open ›</span> : null}
            </a>
          ))}
          <p className="sub">Tapping one opens it on GitHub, where you reply. GitHub also emails you about these at your GitHub address.</p>
        </div>
      )}
      {r.traffic ? (
        <>
          <h3 className="setup-sub">The last 14 days</h3>
          <div className="repo-tiles">
            <div><b>{r.traffic.clones}</b><small>downloads of the code</small></div>
            <div><b>{r.traffic.cloners}</b><small>different sources</small></div>
            <div><b>{r.traffic.views}</b><small>page views</small></div>
            <div><b>{r.traffic.viewers}</b><small>visitors</small></div>
          </div>
          {days.length > 0 && (
            <div className="repo-bars" role="img" aria-label="Downloads of the code by day">
              {days.map((d) => <span key={d.day} title={`${d.day}: ${d.clones} downloads from ${d.cloners}, ${d.views} views`}><i style={{ height: `${Math.round((d.clones / top) * 100)}%` }} /><small>{Number(d.day.slice(8))}</small></span>)}
            </div>
          )}
          {r.since?.first ? <p className="sub">Since Ledger began keeping count on {r.since.first}: {r.since.clones} downloads and {r.since.views} page views.</p> : null}
        </>
      ) : null}
      {r.trafficError ? <p className="error" role="alert">{r.trafficError}</p> : null}
      <p className="sub">Stars, forks and issues are public. A download is counted each time a machine fetches the code, which installing or updating the Home Assistant app does, so <b>your own installs are in the count</b>. "Different sources" is the nearer guess at how many people. GitHub runs about a day behind and never says who.</p>
      {!r.hasToken ? (
        <div className="key-guide">
          <small>Downloads and page views are only shown to the repository's owner, so GitHub wants a token for them. One that can only read is enough:</small>
          <ol>
            <li><b>Open GitHub's token page.</b> <a className="button" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">Make a fine-grained token</a></li>
            <li><b>Repository access:</b> "Only select repositories", and choose this one.</li>
            <li><b>Repository permissions:</b> set "Administration" to "Read-only". Leave everything else alone.</li>
            <li><b>Generate it, copy it, and paste it below.</b> It is kept on this copy and never shown again.</li>
          </ol>
          <form className="token-form" noValidate onSubmit={(e) => { e.preventDefault(); if (tok.trim()) send('/api/repo', 'PUT', { token: tok.trim() }); }}>
            <label className="field"><span>GitHub token</span><input type="password" value={tok} autoComplete="off" spellCheck={false} placeholder="Paste the token here" disabled={busy} onChange={(e) => { setTok(e.target.value); setErr(''); }} /></label>
            <button type="submit" className="primary" disabled={busy || !tok.trim()}>{busy ? 'Checking…' : 'Save'}</button>
          </form>
        </div>
      ) : null}
      {err && <p className="error" role="alert">{err}</p>}
      <div className="add-actions">
        <button disabled={busy} onClick={() => send('/api/repo/refresh', 'POST')}>{busy ? 'Checking…' : 'Check now'}</button>
        {r.hasToken ? <button className="link" disabled={busy} onClick={() => send('/api/repo', 'PUT', { token: '' })}>Forget the token</button> : null}
        {when ? <span className="sub">Last checked {when}</span> : null}
      </div>
    </section>
  );
}

// ---- Family requests (the host's copy only) ---------------------------------------------------
const when = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** After approving someone: what was done for them, and what to pass on if anything couldn't be sent. */
function HandOver({ h, onClose }: { h: any; onClose?: () => void }) {
  const sent = h.emailed;
  return (
    <div className="hand-over" role="status">
      <b>{h.name}'s copy is ready.</b>
      {sent
        ? <span>They've been emailed their link and setup code at {h.email}, and that address can now pass the email check. Nothing more to do. For your reference:</span>
        : h.allowed
          ? <span>{h.email} can now pass the email check, but the email to them couldn't be sent{h.problem ? ` (${h.problem})` : ''}. Send them these yourself, the address and the code separately if you can:</span>
          : h.allowed === false && h.problem
            ? <span>Their copy is set aside, but Cloudflare couldn't be updated ({h.problem}), so they can't get in yet. Try "Add an email" on their copy below.</span>
            : <span>Send them these yourself, the address and the code separately if you can:</span>}
      {h.ownAi && <span>Your AI is off for their copy. The email explains how to add their own Anthropic key.</span>}
      {h.addresses.map((a: string) => <code key={a}>{a}</code>)}
      <span>Setup code: <code>{h.code}</code></span>
      {onClose && <div><button onClick={onClose}>Done</button></div>}
    </div>
  );
}

/** One copy that has been given out: whose it is, its address, and the emails allowed to reach it. */
function FamilyCopy({ c, web, busy, act }: { c: any; web: boolean; busy: boolean; act: (fn: () => Promise<any>) => void }) {
  const [adding, setAdding] = useState(false);
  const [showing, setShowing] = useState(false);
  const [email, setEmail] = useState('');
  const change = (body: object) => act(() => api(`/api/family/copies/${c.name}/emails`, { method: 'POST', body }));
  const usd = (n: number) => '$' + Number(n || 0).toFixed(2);
  return (
    <div className="payday">
      <div className="row copy-row">
        <span className="grow wrap"><button className="link copy-name" title="How much this copy is used" onClick={() => setShowing(true)}>{c.to.name} <span aria-hidden="true">📈</span></button><small>{c.address} · approved {when(c.to.at)}</small></span>
        {showing && <CopyActivity name={c.name} label={c.to.name} onClose={() => setShowing(false)} />}
        <button className="link" onClick={() => act(async () => ({ handOver: await api(`/api/family/copies/${c.name}`) }))}>Show the setup code</button>
        <button className="link" disabled={busy} onClick={() => { if (confirm(`Send ${c.to.name} a code to set a new password? Only do this if they asked you themselves.`)) act(async () => { const r = await api(`/api/family/copies/${c.name}/reset`, { method: 'POST' }); alert(r.reset.emailed ? `A reset code was emailed to ${r.reset.email}. It works once, for ${r.reset.hours} hours.` : `The email couldn't be sent (${r.reset.problem}). Give ${r.reset.name} this reset code yourself: ${r.reset.code}`); return r; }); }}>Reset their password</button>
      </div>
      <div className="pay-calendar">
        {!c.ai ? <small>AI: couldn't reach this copy to check.</small> : (
          <small>
            AI: {c.ai.ownKey ? 'on their own Anthropic key, billed to them.' : c.ai.included ? `on your account. ${usd(c.ai.used)} of ${usd(c.ai.limit)} used this month.` : 'off. They can add their own key in their Settings.'}{' '}
            {c.ai.included
              ? <button className="link" disabled={busy} onClick={() => { if (confirm(`Switch your AI off for ${c.to.name}'s copy? Their AI features stop until they add an Anthropic key of their own. Tell them first.`)) act(() => api(`/api/family/copies/${c.name}/ai`, { method: 'POST', body: { included: false } })); }}>Switch my AI off for them</button>
              : <button className="link" disabled={busy} onClick={() => act(() => api(`/api/family/copies/${c.name}/ai`, { method: 'POST', body: { included: true } }))}>{c.ai.ownKey ? 'Offer my AI as a fallback' : 'Switch my AI on for them'}</button>}
          </small>
        )}
      </div>
      {web && (
        <div className="pay-calendar">
          <small>Emails that can reach it: {c.emails.length === 0 ? 'none yet' : c.emails.map((e: string) => (
            <span key={e}>{e} <button className="link" disabled={busy} onClick={() => { if (confirm(`Stop ${e} reaching ${c.to.name}'s copy? They should also change its password.`)) change({ email: e, remove: true }); }}>Remove</button> </span>
          ))}</small>
          {!adding ? <button className="link" onClick={() => setAdding(true)}>Add an email (a spouse, say)</button> : (
            <form className="token-form" onSubmit={(e) => { e.preventDefault(); change({ email }); setEmail(''); setAdding(false); }}>
              <label className="field grow"><span>Email to allow</span><input type="email" value={email} autoFocus onChange={(e) => setEmail(e.target.value)} /></label>
              <button type="submit" className="primary" disabled={busy || !email.includes('@')}>Allow</button>
              <button type="button" onClick={() => setAdding(false)}>Cancel</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * How much a family copy is used, in a small window opened from the household's name. It shows when
 * the copy is used and what it costs, never what is in it (see server/activity.js for the line).
 */
function CopyActivity({ name, label, onClose }: { name: string; label: string; onClose: () => void }) {
  const [a, setA] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    api(`/api/family/copies/${name}/activity`).then((d) => live && setA(d)).catch((e) => live && setErr(e.message));
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', key);
    return () => { live = false; removeEventListener('keydown', key); };
  }, [name]);
  const usd = (n: number) => '$' + Number(n || 0).toFixed(2);
  const date = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const ago = (t: number) => {
    const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(t).setHours(0, 0, 0, 0)) / 86400000);
    const at = new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return days <= 0 ? `today at ${at}` : days === 1 ? `yesterday at ${at}` : days < 14 ? `${days} days ago` : date(t);
  };
  const size = (b: number) => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);
  // The last thirty days, oldest first, each marked used or not.
  const strip = a ? Array.from({ length: 30 }, (_, i) => {
    const d = new Date(a.today + 'T12:00:00'); d.setDate(d.getDate() - (29 - i));
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { day, on: a.days.includes(day), label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) };
  }) : [];
  const state = !a ? '' : !a.passwordSet ? 'Not opened yet' : !a.lastUsed ? 'Set up, not used since' : a.days.length >= 12 ? 'Used most days' : a.days.length >= 4 ? 'Used now and then' : a.days.length >= 1 ? 'Used a little' : 'Not used in the last 30 days';
  return createPortal(
    <div className="logo-dialog-overlay" onClick={onClose}>
      <div className="logo-dialog card zoomed copy-activity" role="dialog" aria-modal="true" aria-label={`How much ${label}'s copy is used`} onClick={(e) => e.stopPropagation()}>
        <h2>{label}</h2>
        {err && <p className="error">{err}</p>}
        {!a && !err && <p className="sub">Asking their copy…</p>}
        {a && <>
          <p className="sub">{a.address} · approved {date(a.approvedAt)}</p>
          <div className="activity-lead"><b>{state}</b><span>{a.lastUsed ? `Last opened ${ago(a.lastUsed)}` : a.passwordSet ? 'No use recorded yet' : "They haven't used their setup code"}</span></div>
          <div className="activity-strip" role="img" aria-label={`Opened on ${a.days.length} of the last 30 days`}>
            {strip.map((d) => <i key={d.day} className={d.on ? 'on' : ''} title={`${d.label}: ${d.on ? 'opened' : 'not opened'}`} />)}
          </div>
          <small className="activity-caption">Opened on <b>{a.days.length}</b> of the last 30 days{a.daysEver > a.days.length ? `, ${a.daysEver} days in all` : ''}{a.firstUsed ? ` · first used ${date(a.firstUsed)}` : ''}</small>
          <dl className="activity-list">
            <div><dt>Setup guide</dt><dd>{!a.passwordSet ? 'Not started' : a.setupDone ? 'Finished' : 'Not finished'}</dd></div>
            <div><dt>Bank connection</dt><dd>{a.bank ? 'Connected' : 'None (figures entered by hand)'}</dd></div>
            <div><dt>Devices signed in</dt><dd>{a.devices}</dd></div>
            <div><dt>People who can reach it</dt><dd>{a.emails.length || 'none'}</dd></div>
            <div><dt>AI</dt><dd>{a.ai.ownKey ? 'Their own key, billed to them' : a.ai.included ? `Your account: ${usd(a.ai.used)} of ${usd(a.ai.limit)} this month` : 'Off'}</dd></div>
            <div><dt>Tax rules looked up</dt><dd>{a.ai.lookups ? `${a.ai.lookups} this month, about ${usd(a.ai.lookupCost)}` : 'none this month'}</dd></div>
            <div><dt>Space used</dt><dd>{size(a.bytes)}</dd></div>
            <div><dt>Version</dt><dd>{a.current ? 'Up to date' : 'Restarting on the newest'}</dd></div>
          </dl>
          {a.ai.included && !a.ai.ownKey && <div className="ai-meter" role="img" aria-label={`${usd(a.ai.used)} of ${usd(a.ai.limit)} used`}><i style={{ width: Math.min(100, (a.ai.used / a.ai.limit) * 100) + '%' }} /></div>}
          <p className="sub">This is when their copy is used and what it costs you. What's in it (balances, purchases, questions to the CFO) is never shown to you; About tells them so.</p>
        </>}
        <div className="dialog-actions"><button className="primary" onClick={onClose}>Done</button></div>
      </div>
    </div>,
    document.body,
  );
}

/** On a family copy with a password: whether the sign-in at the web address is enough by itself. */
function AccessChoice({ auth, onChanged }: { auth: any; onChanged: () => void }) {
  const [err, setErr] = useState('');
  const set = async (on: boolean) => {
    setErr('');
    try { await api('/api/auth/access', { method: 'PUT', body: { on } }); forgetLoaded(); onChanged(); } catch (e: any) { setErr(e.message); }
  };
  return (
    <label className="row check" style={{ marginTop: 12 }}>
      <span className="grow">Skip the password after signing in at the web address
        <small>{auth.access.login ? 'On: signing in with Google or the emailed code opens Ledger straight away.' : 'Off: after that sign-in, Ledger also asks for your password.'}{err ? ` ${err}` : ''}</small></span>
      <input type="checkbox" checked={!!auth.access.login} onChange={(e) => set(e.target.checked)} />
    </label>
  );
}

// One request waiting for an answer. Before approving, the host chooses whose AI the new copy runs on.
function WaitingRequest({ r, busy, none, act }: { r: any; busy: boolean; none: boolean; act: (fn: () => Promise<any>) => void }) {
  const [ai, setAi] = useState('mine');
  const approve = () => {
    const about = ai === 'own' ? ' Your AI will be off for their copy; the email tells them how to add their own.' : ' Their AI features will run on your account, up to the monthly limit.';
    if (confirm(`Approve ${r.name}? Their link and sign-in codes will go to ${r.email}, so only approve an address you recognise.${about}`)) act(() => api(`/api/family/requests/${r.id}/approve`, { method: 'POST', body: { ai } }));
  };
  return (
    <div className="row copy-row">
      <span className="grow wrap">{r.name}<small>{r.email}{r.relation ? ` · ${r.relation}` : ''}{r.note ? ` · "${r.note}"` : ''} · asked {when(r.at)}</small></span>
      <select value={ai} disabled={busy} aria-label={`AI for ${r.name}`} onChange={(e) => setAi(e.target.value)}>
        <option value="mine">AI on my account</option>
        <option value="own">They bring their own AI</option>
      </select>
      <button className="primary" disabled={busy || none} onClick={approve}>Approve</button>
      <button disabled={busy} onClick={() => act(() => api(`/api/family/requests/${r.id}/decline`, { method: 'POST' }))}>Decline</button>
    </div>
  );
}

// Requests from family for their own copy, the switch that opens the request page, and the copies kept waiting.
function FamilyRequests() {
  const { data: f, reload } = useData('/api/family');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [hand, setHand] = useState<any>(null);
  const [said, setSaid] = useState('');
  if (!f || !f.configured) return null;
  // The app is usually opened on a plain http address, where the browser's own clipboard isn't offered, so there is an older way too.
  const copy = async (text: string) => {
    try { if (navigator.clipboard && isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch { /* fall through */ }
    const t = document.createElement('textarea');
    t.value = text; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.append(t); t.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    t.remove();
    return ok;
  };
  // One press to invite: open the request page if it's closed, and put its link on the clipboard.
  // The copy comes first, while the browser still counts it as part of the click.
  const invite = async () => {
    const copied = await copy(f.requestPage);
    if (!f.open) await act(() => api('/api/family/open', { method: 'PUT', body: { open: true } }));
    setSaid(copied ? 'The request page is open and its link is copied. Paste it into a text or email to the person.' : 'The request page is open. Copy the link below and send it to the person.');
  };
  const act = async (fn: () => Promise<any>) => {
    setBusy(true); setErr('');
    try { const r = await fn(); if (r?.handOver) setHand(r.handOver); forgetLoaded(); reload(); } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };
  const waiting = f.requests.filter((r: any) => r.status === 'pending');
  const answered = f.requests.filter((r: any) => r.status !== 'pending').slice(0, 8);
  return (
    <section className="card">
      <div className="card-head"><h2>Family requests</h2>{f.open ? <span className="good">Open</span> : <span className="sub">Closed</span>}</div>
      <p className="sub first">Family ask for their own copy of Ledger on the request page. You approve or decline here. {f.web ? "Approving gives the person one of the copies kept waiting, lets their email through the check on its web address, and emails them their link and setup code." : "An approved person is given one of the copies kept waiting."} Their copy is theirs alone: you can't see into it from here.</p>
      {f.error && <p className="error" role="alert">{f.error}</p>}
      <div className="invite">
        <div className="invite-buttons">
          <button className="primary" disabled={busy} onClick={invite}>{f.open ? 'Copy the invite link' : 'Invite someone'}</button>
          {f.open && <button disabled={busy} onClick={async () => { await act(() => api('/api/family/open', { method: 'PUT', body: { open: false } })); setSaid('The request page is closed.'); }}>Close the request page</button>}
        </div>
        <input type="text" readOnly value={f.requestPage} aria-label="The request page's link" onFocus={(e) => e.target.select()} />
        <small>{said || (f.open ? 'The page is open: anyone with the link can send a request. Close it once the people you invited have asked.' : '"Invite someone" opens the request page and copies its link for you to send. The page is closed now and accepts nothing.')}</small>
      </div>
      <label className="row check">
        <span className="grow wrap">Request page open<small>{f.open ? 'People can send requests now. Close it once the people you invited have asked.' : 'Closed: the page says requests are closed and accepts nothing. Open it when you have invited someone.'} The page is {f.requestPage}</small></span>
        <input type="checkbox" checked={!!f.open} disabled={busy} onChange={(e) => act(() => api('/api/family/open', { method: 'PUT', body: { open: e.target.checked } }))} />
      </label>
      {hand && <HandOver h={hand} onClose={() => setHand(null)} />}
      <div className="group-head"><span>Waiting for your answer</span><span className="num">{waiting.length}</span></div>
      {waiting.length === 0 && <p className="sub">Nobody is waiting.</p>}
      {waiting.map((r: any) => <WaitingRequest key={r.id} r={r} busy={busy} none={f.free === 0} act={act} />)}
      <div className="group-head"><span>Copies</span><span className="num">{f.free} waiting</span></div>
      {f.copies.length === 0 && <p className="sub">No copies have been made yet.</p>}
      {f.free === 0 && f.copies.length > 0 && <p className="sub">Every copy has been given out. More need to be made on the NAS before another request can be approved.</p>}
      {f.copies.filter((c: any) => c.to).map((c: any) => <FamilyCopy key={c.name} c={c} web={f.web} busy={busy} act={act} />)}
      <div className="group-head"><span>Ideas and problems reported</span><span className="num">{f.reports.filter((r: any) => r.status === 'new').length} new</span></div>
      {f.reports.length === 0 && <p className="sub">Nothing has been sent from an About page yet.</p>}
      {f.reports.slice(0, 30).map((r: any) => (
        <div key={r.id} className="row" style={r.status === 'done' ? { opacity: 0.55 } : undefined}>
          <span className="grow wrap">{r.text}<small>{r.from} · {r.kind === 'problem' ? 'a problem' : r.kind === 'question' ? 'a question' : 'an idea'} · {when(r.at)}</small></span>
          <button className="link" disabled={busy} onClick={() => act(() => api(`/api/family/reports/${r.id}`, { method: 'POST', body: { done: r.status !== 'done' } }))}>{r.status === 'done' ? 'Reopen' : 'Done'}</button>
        </div>
      ))}
      {answered.length > 0 && <p className="sub">Recently answered: {answered.map((r: any) => `${r.name} (${r.status})`).join(', ')}.</p>}
      {!f.canEmail && <p className="sub">To be emailed when someone asks, set up the summary email below with your Gmail address; requests use the same sender.</p>}
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  );
}

// ---- Paydays ------------------------------------------------------------------------------------
const DAYS_OF_MONTH = [...Array.from({ length: 31 }, (_, i) => String(i + 1)), 'last'];
const dayName = (d: string) => (d === 'last' ? 'Last day' : d);
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const niceDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
type PayKind = 'job' | 'benefits' | 'pension' | 'other';
type PayForm = { kind: PayKind; name: string; match: string; how: 'twice' | 'once' | 'two-weeks' | 'weekly' | 'nth'; nth: string; day1: string; day2: string; weekday: string; anchor: string; amount_mode: string; amount: string };
const BLANK_PAY: PayForm = { kind: 'job', name: '', match: '', how: 'twice', nth: '2', day1: '15', day2: 'last', weekday: '5', anchor: '', amount_mode: 'last', amount: '' };
// The form's choices as the rule the server keeps, and back again.
const ruleOf = (f: PayForm) => (f.how === 'twice' ? `monthdays:${f.day1},${f.day2}` : f.how === 'once' ? `monthdays:${f.day1}` : f.how === 'weekly' ? `weekly:${f.weekday}` : f.how === 'nth' ? `nthweekday:${f.nth}:${f.weekday}` : `every:14:${f.anchor}`);
function formOf(p: any): PayForm {
  const [type, spec, anchor] = String(p.rule).split(':');
  const f: PayForm = { ...BLANK_PAY, kind: p.kind || 'job', name: p.name, match: p.match, amount_mode: p.amount_mode, amount: p.amount != null ? String(p.amount) : '' };
  if (type === 'weekly') return { ...f, how: 'weekly', weekday: spec };
  if (type === 'nthweekday') return { ...f, how: 'nth', nth: spec, weekday: anchor };
  if (type === 'every') return { ...f, how: 'two-weeks', anchor: anchor || '' };
  const days = spec.split(',');
  return days.length > 1 ? { ...f, how: 'twice', day1: days[0], day2: days[1] } : { ...f, how: 'once', day1: days[0] };
}

/** A file as a data URL, for sending a pay calendar to be read. */
const asDataUrl = (file: Blob) => new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error("That file couldn't be opened.")); r.readAsDataURL(file); });

// One paycheck's published pay calendar: upload a photo or PDF for Claude to read, or type the dates.
function PayCalendar({ p, onSaved }: { p: any; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const fileBox = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr(''); setNote(''); setBusy('Reading the calendar…');
    try {
      const r = await api('/api/paydays/read-calendar', { method: 'POST', body: { file: await asDataUrl(file) } });
      setText(r.dates.join('\n'));
      setNote(`${r.dates.length} pay dates read. Check them against the calendar, fix any that are wrong, then save.${r.unsure ? ` Claude's note: ${r.unsure}` : ''}`);
    } catch (e: any) { setErr(e.message); }
    setBusy('');
  };
  const save = async (dates: string[], year?: string) => {
    setErr('');
    try {
      await api(`/api/paydays/${p.id}/calendar`, { method: 'PUT', body: { dates, year } });
      setText(''); setNote(''); setOpen(false); onSaved();
    } catch (e: any) { setErr(e.message); }
  };
  return (
    <div className="pay-calendar">
      {p.calendars.map((c: any) => (
        <small key={c.year}>Pay calendar for {c.year} loaded ({c.dates} dates). <button className="link" onClick={() => save([], c.year)}>Remove</button> </small>
      ))}
      {!open ? <button className="link" onClick={() => setOpen(true)}>{p.calendars.length ? 'Add another year' : p.kind && p.kind !== 'job' ? 'Add a calendar of its payment dates' : "Add your employer's pay calendar"}</button> : (
        <div className="stack" style={{ gap: 8, marginTop: 8 }}>
          <small>A published calendar knows about bank holidays, so it is used in place of the pattern for the years it covers. Upload a PDF, photo or screenshot of it, or type the dates.</small>
          <div className="add-actions">
            <button type="button" className="primary" disabled={!!busy} onClick={() => fileBox.current?.click()}>Upload the calendar</button>
            <input ref={fileBox} type="file" accept="application/pdf,image/*" onChange={pick} hidden />
            <button onClick={() => { setOpen(false); setText(''); setNote(''); setErr(''); }}>Cancel</button>
          </div>
          {busy && <small role="status">{busy}</small>}
          {note && <small role="status">{note}</small>}
          <label>Pay dates, one on each line<textarea rows={6} value={text} placeholder={'2027-01-15\n2027-01-29'} onChange={(e) => setText(e.target.value)} /></label>
          <div><button className="primary" disabled={!text.trim()} onClick={() => save(text.split(/[\s,]+/).filter(Boolean))}>Save these dates</button></div>
        </div>
      )}
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}

// When each paycheck arrives and how much it is. The checking forecast on the dashboard is built from these.
const PAY_KIND_NAMES: Record<PayKind, string> = { job: 'A paycheck', benefits: 'Benefits', pension: 'A pension', other: 'Other income' };

export function Paydays() {
  const { data: list, reload } = useData<any[]>('/api/paydays');
  const taxesOn = useTaxes();
  // Inside the setup guide the side gig has its own step, and Settings is not on screen to jump to.
  const inGuide = typeof document !== 'undefined' && !!document.querySelector('.setup');
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [f, setF] = useState<PayForm>(BLANK_PAY);
  const [err, setErr] = useState('');
  if (!list) return null;
  const set = (k: keyof PayForm) => (e: any) => { setF({ ...f, [k]: e.target.value }); setErr(''); };
  const changed = () => { forgetLoaded(); reload(); };
  const start = (p?: any) => { setF(p ? formOf(p) : BLANK_PAY); setEditing(p ? p.id : 'new'); setErr(''); };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.how === 'two-weeks' && !f.anchor) return setErr('Choose the date of a recent or coming payday, so the app can count two weeks from it.');
    try {
      await api(editing === 'new' ? '/api/paydays' : `/api/paydays/${editing}`, { method: editing === 'new' ? 'POST' : 'PUT', body: { kind: f.kind, name: f.name, match: f.match, rule: ruleOf(f), amount_mode: f.amount_mode, amount: f.amount } });
      setEditing(null); changed();
    } catch (e: any) { setErr(e.message); }
  };
  const remove = async (p: any) => { if (!confirm(`Remove ${p.name} from your paydays?`)) return; await api(`/api/paydays/${p.id}`, { method: 'DELETE' }); changed(); };
  return (
    <section className="card">
      <div className="card-head"><h2>Paydays</h2></div>
      <p className="sub first">When each paycheck, benefits check or pension arrives and how much it is. The dashboard's forecast of what's left before payday is built from these.</p>
      {list.length === 0 && editing == null && <p className="sub">No paydays yet. Add one for each paycheck, benefits check or pension in the household.</p>}
      {list.map((p) => (
        <div key={p.id} className="payday">
          <div className="row">
            <span className="grow wrap">{p.name}
              <small>
                Paid {p.pattern}. {p.amount_mode === 'fixed' ? `${cents(p.amount)} each time.` : p.lastDeposit ? `${p.amount_mode === 'average' ? 'About the average of recent deposits' : 'Same as the last deposit'} (${cents(p.lastDeposit.amount)} on ${niceDate(p.lastDeposit.date)}).` : `No deposit containing "${p.match}" has been seen yet, so it isn't in the forecast.`}
                {p.next.length ? ` Next: ${p.next.map(niceDate).join(', ')}.` : ''}{p.gig ? ' This is your side gig.' : ''}{p.kind && p.kind !== 'job' ? ` ${PAY_KIND_NAMES[p.kind as PayKind]}: no pay stub is needed for it.` : ''}
              </small>
            </span>
            <button className="link" onClick={() => start(p)}>Change</button>
            <button className="link" onClick={() => remove(p)}>Remove</button>
          </div>
          <PayCalendar p={p} onSaved={changed} />
        </div>
      ))}
      {editing == null ? <div className="add-actions" style={{ marginTop: 12 }}><button className="primary" onClick={() => start()}>Add a payday</button></div> : (
        <form onSubmit={save} noValidate className="add-grid" style={{ marginTop: 14 }}>
          <label>What kind of income is it?
            <select value={f.kind} data-go="pay-kind" onChange={(e) => { const kind = e.target.value as PayKind; setF({ ...f, kind, how: kind === 'job' ? f.how : f.how === 'twice' ? 'once' : f.how }); setErr(''); }}>
              <option value="job">A paycheck from a job</option>
              <option value="benefits">Social Security or other benefits</option>
              <option value="pension">A pension</option>
              <option value="other">Other regular income</option>
            </select>
          </label>
          <label>{f.kind === 'job' ? 'Whose paycheck' : 'What to call it'}<input type="text" value={f.name} maxLength={60} placeholder={f.kind === 'job' ? 'Your paycheck (Acme)' : f.kind === 'pension' ? 'Pension' : f.kind === 'benefits' ? 'Social Security' : 'Rent from the upstairs flat'} onChange={set('name')} /></label>
          <label>A word from its deposit at the bank<input type="text" value={f.match} placeholder="acme" onChange={set('match')} /><small>Lets the app recognise the deposit when it lands. Leave blank if you have no bank connection.</small></label>
          <label>How often
            <select value={f.how} onChange={set('how')}>
              <option value="twice">Twice a month</option><option value="once">Once a month</option>
              <option value="two-weeks">Every two weeks</option><option value="weekly">Every week</option>
              <option value="nth">A set weekday each month (Social Security, pensions)</option>
            </select>
          </label>
          {(f.how === 'twice' || f.how === 'once') && <label>{f.how === 'twice' ? 'First payday of the month' : 'Day of the month'}<select value={f.day1} onChange={set('day1')}>{DAYS_OF_MONTH.map((d) => <option key={d} value={d}>{dayName(d)}</option>)}</select></label>}
          {f.how === 'twice' && <label>Second payday<select value={f.day2} onChange={set('day2')}>{DAYS_OF_MONTH.map((d) => <option key={d} value={d}>{dayName(d)}</option>)}</select></label>}
          {f.how === 'nth' && <label>Which one<select value={f.nth} onChange={set('nth')}><option value="1">First</option><option value="2">Second</option><option value="3">Third</option><option value="4">Fourth</option><option value="last">Last</option></select></label>}
          {(f.how === 'weekly' || f.how === 'nth') && <label>Day of the week<select value={f.weekday} onChange={set('weekday')}>{WEEKDAY_NAMES.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label>}
          {f.how === 'two-weeks' && <label>A recent or coming payday<input type="date" value={f.anchor} onChange={set('anchor')} /><small>The app counts every two weeks from this date.</small></label>}
          <label>Amount
            <select value={f.amount_mode} onChange={set('amount_mode')}>
              <option value="last">Same as the last deposit</option>
              <option value="average">Average of recent deposits (pay that varies)</option>
              <option value="fixed">A set amount I'll type</option>
            </select>
          </label>
          {f.amount_mode === 'fixed' && <label>{f.kind === 'job' ? 'Take-home pay each time' : 'What arrives each time'}<MoneyInput value={f.amount} placeholder="1,500.00" onChange={(v) => { setF({ ...f, amount: v }); setErr(''); }} /></label>}
          <div style={{ alignSelf: 'end' }} className="add-actions">
            <button type="submit" className="primary">{editing === 'new' ? (f.kind === 'job' ? 'Add paycheck' : 'Add it') : 'Save'}</button>
            <button type="button" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      )}
      {editing != null && f.kind !== 'job' && (
        <p className="sub pay-kind-note">Ledger counts this as income and shows it in your forecast. No pay stub is needed for it.{taxesOn && <> It is <b>not</b> counted in the tax estimate unless you enter the year's amount yourself, under <a href="#taxes" onClick={jump(GO.otherIncome)}>Taxes, "Retirement and other income"</a>. Whether it is taxable is a question for whoever prepares your taxes.</>}</p>
      )}
      {(f.how === 'twice' || f.how === 'once') && editing != null && <p className="sub">A payday that falls on a weekend is counted on the Friday before.</p>}
      {editing == null && <p className="sub">Paid for side jobs with no tax taken out? {inGuide ? 'That has its own step, next.' : <>Set that up under <a href="#connections" onClick={jump(GO.sideGig)}>Side gig</a>, so Ledger keeps it apart and shows what to set aside for tax.</>}</p>}
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  );
}

// A side gig: self-employment income with no tax taken out. Off unless the household has one.
/**
 * Under the first side gig: whose it is and any income that never reaches the bank, then the
 * household's other side gigs, each with its own name, deposit words, owner, cash income and costs.
 */
function MoreGigs({ gig }: { gig: ReturnType<typeof useGig> }) {
  const blank = { name: '', match: '', who: 'you', cash: '', costs: '' };
  const [f, setF] = useState<any>(blank);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [err, setErr] = useState('');
  const done = () => { forgetLoaded(); dispatchEvent(new Event('ledger-gig')); };
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); setErr(''); setEditing(null); setF(blank); done(); } catch (e: any) { setErr(e.message); } };
  const body = () => ({ name: f.name, match: f.match, who: f.who, cash: Number(f.cash) || 0, costs: Number(f.costs) || 0 });
  const form = (
    <form className="add-grid" noValidate onSubmit={(e) => { e.preventDefault(); run(() => api(editing === 'new' ? '/api/gigs' : `/api/gigs/${editing}`, { method: editing === 'new' ? 'POST' : 'PATCH', body: body() })); }}>
      <label>What you call it<input type="text" value={f.name} maxLength={40} placeholder="Lawn care" autoFocus onChange={(e) => { setF({ ...f, name: e.target.value }); setErr(''); }} /></label>
      <label>Words in its deposits<input type="text" value={f.match} placeholder="venmo, square" onChange={(e) => setF({ ...f, match: e.target.value })} /></label>
      {gig.two && <label>Whose it is<select value={f.who} onChange={(e) => setF({ ...f, who: e.target.value })}><option value="you">Yours</option><option value="spouse">Your spouse's</option></select></label>}
      <label>Income that never reaches the bank<MoneyInput value={String(f.cash)} onChange={(v) => setF({ ...f, cash: v })} placeholder="0" label="Cash income for the year" /><small>Cash and tips for the year, if any</small></label>
      <label>Its costs for the year<MoneyInput value={String(f.costs)} onChange={(v) => setF({ ...f, costs: v })} placeholder="0" label="Costs for the year" /><small>Supplies, mileage, fees</small></label>
      <div style={{ alignSelf: 'end' }} className="add-actions"><button type="submit" className="primary">{editing === 'new' ? 'Add' : 'Save'}</button><button type="button" onClick={() => { setEditing(null); setF(blank); setErr(''); }}>Cancel</button></div>
    </form>
  );
  return (
    <div>
      <div className="add-grid" style={{ marginTop: 10 }}>
        {gig.two && <label>Whose {gig.name} is<select value={gig.who} onChange={(e) => run(() => api('/api/gig/more', { method: 'PUT', body: { who: e.target.value } }))}><option value="you">Yours</option><option value="spouse">Your spouse's</option></select><small>Each person's side income is taxed on its own</small></label>}
        <NumField label={`${gig.name} income that never reaches the bank`} value={gig.cash ? String(gig.cash) : ''} allowBlank step={100} hint="Cash and tips for the year, if any" onSave={(v) => api('/api/gig/more', { method: 'PUT', body: { cash: v === '' ? 0 : Number(v) } }).then(done)} />
      </div>
      <div className="group-head"><span>Other side gigs</span><span className="num">{gig.extras.length}</span></div>
      {gig.extras.length === 0 && editing !== 'new' && <p className="sub">Only one so far. Add another if someone in the household has a second kind of side income to keep apart.</p>}
      {gig.extras.map((x) => (editing === x.id ? <div key={x.id}>{form}</div> : (
        <div key={x.id} className="row">
          <span className="grow wrap">{x.name}<small>{gig.two ? (x.who === 'spouse' ? "Your spouse's" : 'Yours') + ' · ' : ''}{x.match ? `deposits with: ${x.match}` : 'no deposit words yet'}{x.cash ? ` · ${money(x.cash)} in cash` : ''}{x.costs ? ` · ${money(x.costs)} of costs` : ''}</small></span>
          <button className="link" onClick={() => { setEditing(x.id); setF({ name: x.name, match: x.match, who: x.who, cash: x.cash ? String(x.cash) : '', costs: x.costs ? String(x.costs) : '' }); }}>Change</button>
          <button className="link" onClick={() => { if (confirm(`Remove ${x.name}? Its past deposits stay, filed as plain Income.`)) run(() => api(`/api/gigs/${x.id}`, { method: 'DELETE' })); }}>Remove</button>
        </div>
      )))}
      {editing === 'new' ? form : editing == null && <button onClick={() => setEditing('new')}>Add another side gig</button>}
      {err && <p className="error" role="alert">{err}</p>}
      {gig.extras.length > 0 && <small className="sub">Purchases you claim as business expenses on the Transactions page come off {gig.name}. Give the other gigs their costs as a yearly figure here.</small>}
    </div>
  );
}

export function SideGig() {
  const gig = useGig();
  const [name, setName] = useState<string | null>(null);
  const [match, setMatch] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  if (!gig.loaded) return null;
  const put = async (body: object, done: (r: any) => string) => {
    setErr(''); setNote('');
    try {
      const r = await api('/api/gig', { method: 'PUT', body });
      setNote(done(r)); setName(null); setMatch(null);
      forgetLoaded(); dispatchEvent(new Event('ledger-gig'));
    } catch (e: any) { setErr(e.message); }
  };
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const n = (name ?? (gig.on ? gig.name : '')).trim();
    if (!n) return setErr('Give it a name, such as Tutoring or DoorDash.');
    put({ on: true, name: n, match: match ?? gig.match }, (r) => `Saved.${r.moved ? ` ${r.moved} earlier deposit${r.moved === 1 ? '' : 's'} moved to ${n}.` : ''}`);
  };
  return (
    <section className="card">
      <div className="card-head"><h2>Side gig</h2>{gig.on && <span className="good">On</span>}</div>
      <p className="sub first">
        For income with no tax taken out: tutoring, deliveries, freelance work, selling things you make. Its pay gets its own category,
        the Taxes page works out the extra tax and how much of each payment to set aside, and you can claim purchases as its business expenses.
      </p>
      <form onSubmit={save} noValidate className="add-grid" style={{ marginTop: 12 }}>
        <label>What you call it<input type="text" value={name ?? (gig.on ? gig.name : '')} maxLength={40} placeholder="Tutoring" onChange={(e) => { setName(e.target.value); setErr(''); }} /></label>
        <label>Words in its deposits<input type="text" value={match ?? gig.match} placeholder="doordash, dd payment" onChange={(e) => { setMatch(e.target.value); setErr(''); }} />
          <small>How the bank words the payments, separated by commas. A deposit with any of these in its name is filed as this gig's pay.</small></label>
        <div style={{ alignSelf: 'end' }} className="add-actions">
          <button type="submit" className="primary">{gig.on ? 'Save' : 'Switch on'}</button>
          {gig.on && <button type="button" onClick={() => put({ on: false }, () => 'Switched off. Its past payments stay in their category.')}>Switch off</button>}
        </div>
      </form>
      {gig.on && (gig.classes || /vip\s?kid/i.test(gig.name)) && (
        <label className="row check">
          <span className="grow">Paid by booked classes (VIPKid)<small>Reads a class calendar to work out each week's pay and a monthly class goal</small></span>
          <input type="checkbox" checked={gig.classes} onChange={(e) => put({ on: true, classes: e.target.checked }, () => 'Saved.')} />
        </label>
      )}
      {err && <p className="error" role="alert">{err}</p>}
      {note && <p className="good" role="status">{note}</p>}
      {gig.on && <MoreGigs gig={gig} />}
      {gig.on && <GigPay />}
    </section>
  );
}

function VipkidCalendar() {
  const { data: v, reload } = useData('/api/vipkid');
  const [f, setF] = useState({ server: '', user: '', password: '' });
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  if (!v) return null;
  const set = (k: keyof typeof f) => (e: any) => { setF({ ...f, [k]: e.target.value }); setErr(''); };
  const run = async (label: string, url: string, body?: object) => {
    setBusy(label); setErr(''); setNote('');
    try {
      const r = await api(url, { method: 'POST', body });
      if (r.classes != null) setNote(`${r.classes} classes read from your calendar.`);
      setF({ server: '', user: '', password: '' });
    } catch (e: any) { setErr(e.message); }
    setBusy('');
    reload();
  };
  const connect = (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.user.trim() || !f.password) return setErr('Enter the account and password from the VIPKid sync guide.');
    run('Reading your classes…', '/api/vipkid/connect', { server: f.server.trim() || v.server, user: f.user, password: f.password });
  };
  const m = v.month;
  return (
    <section className="card">
      <div className="card-head"><h2>VIPKid class calendar</h2>{v.connected && <span className="good">Connected</span>}</div>
      <p className="sub first">
        Reads your booked classes from VIPKid, so each Friday's expected payment comes from the classes on your calendar and not an average.
        The details are in VIPKid under Booking Calendar Sync Setup Guide.
      </p>
      {v.connected ? (
        <>
          <p className="sub">
            {m.booked} class units this month so far ({m.taught} taught; a 50-minute class counts as two): {cents(m.base)} base plus {cents(m.incentive)} incentive, {cents(m.total)} in all.
            {m.nextTierAt ? ` The incentive rate steps up at class ${m.nextTierAt}.` : ''} Reaching $2,000 in a month takes about {v.classesFor2000} units.
          </p>
          <div className="add-actions">
            <button className="primary" disabled={!!busy} onClick={() => run('Reading your classes…', '/api/vipkid/sync')}>Sync classes now</button>
            <button disabled={!!busy} onClick={() => run('', '/api/vipkid/disconnect')}>Disconnect</button>
          </div>
        </>
      ) : (
        <form onSubmit={connect} noValidate className="add-grid" style={{ marginTop: 12 }}>
          <label>Server address<input type="text" value={f.server} onChange={set('server')} placeholder={v.server} autoComplete="off" /></label>
          <label>Account<input type="text" value={f.user} onChange={set('user')} autoComplete="off" /></label>
          <label>Password<input type="password" value={f.password} onChange={set('password')} autoComplete="off" /></label>
          <div style={{ alignSelf: 'end' }}><button type="submit" className="primary" disabled={!!busy}>Connect</button></div>
        </form>
      )}
      {busy && <p className="sub" role="status">{busy}</p>}
      {note && <p className="good" role="status">{note}</p>}
      {err && <p className="error" role="alert">{err}</p>}
      {!err && v.error && <p className="error">The last automatic sync failed: {v.error}</p>}
    </section>
  );
}

/**
 * The choice between Home Assistant's own AI and an Anthropic key, shown only where Ledger runs inside
 * Home Assistant. The first is the basics with whatever model the house already has; the second is everything.
 */
function AiRoute({ onChange }: { onChange: () => void }) {
  const { data: ha, reload } = useData<any>('/api/ai/ha');
  const [entity, setEntity] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!ha?.offered) return null;
  const chosen = entity ?? ha.entity ?? '';
  const put = async (body: object) => {
    setBusy(true); setErr('');
    try { await api('/api/ai/ha', { method: 'PUT', body }); forgetLoaded(); reload(); onChange(); dispatchEvent(new Event('ledger-refresh')); } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <div className="ai-route" data-go="ai-route">
      <h3>Which AI Ledger uses</h3>
      <div className="budget-ways" role="radiogroup" aria-label="Which AI Ledger uses">
        <div className={`budget-way ${ha.on ? 'on' : ''}`}>
          <b>The AI in your Home Assistant</b>
          <span>Whatever model you have already set up there: Claude, ChatGPT, Gemini, or one running on your own machine. No second key, and with a local model nothing leaves your house.</span>
          <small>The basics: the dashboard recap, category suggestions, and a CFO that answers from your month's figures.</small>
          {ha.entities.length === 0 ? <small className="bad">Your Home Assistant has no AI Task yet. Add an AI under its Settings, Devices &amp; services, then come back.</small> : (
            <span className="ai-route-pick">
              <select aria-label="Which AI Task" value={chosen} disabled={busy} onChange={(e) => setEntity(e.target.value)}>
                <option value="">Home Assistant's preferred AI</option>
                {ha.entities.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              {ha.on && chosen === (ha.entity ?? '') ? <button type="button" disabled={busy} onClick={() => put({ on: false })}>Stop using it</button>
                : <button type="button" className="primary" disabled={busy} onClick={() => put({ on: true, entity: chosen })}>{busy ? 'Checking it answers…' : 'Use this'}</button>}
            </span>
          )}
        </div>
        <div className={`budget-way ${ha.on ? '' : 'on'}`}>
          <b>An Anthropic key of your own</b>
          <span>Ledger talks to Claude directly. This is what the app was built around, and it works best this way.</span>
          <small>Everything: all of the above, plus reading receipts, statements and pay stubs, finding and drawing logos, and the full CFO, which looks things up in your data and on official tax sites and can suggest changes.</small>
          <small>{ha.on ? 'A key saved below is still used for those extras.' : 'Set it up below.'}</small>
        </div>
      </div>
      {ha.on && !ha.claude && <p className="sub">This AI isn't Claude as far as Ledger can tell, so the app calls it "your AI" and the CFO is your Chief Financial Officer. How well another model does here hasn't been tested: if the recap or the CFO reads oddly, that is the place to look.</p>}
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}

function AiRecap() {
  const { data: s, reload } = useData('/api/recap/settings');
  const { data: ai, reload: reloadAi } = useData<any>('/api/ai');
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [checking, setChecking] = useState(false);
  if (!s) return null;
  const save = async (body: object, done: string) => {
    setErr('');
    setNote('');
    setChecking(true);
    try { await api('/api/recap/settings', { method: 'POST', body }); setKey(''); setNote(done); reload(); reloadAi(); } catch (e: any) { setErr(e.message); }
    setChecking(false);
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return setErr('Paste your Anthropic API key.');
    save({ key, check: true }, 'Key checked and saved. The AI features are on.');
  };
  const own = !!ai?.ownKey;
  const inc = ai?.included;
  const usd = (n: number) => '$' + n.toFixed(2);
  const monthLabel = (ym: string) => new Date(ym + '-15T12:00:00').toLocaleDateString('en-US', { month: 'long' });
  const setIncluded = async (on: boolean) => { setErr(''); try { await api('/api/ai/included', { method: 'PUT', body: { on } }); setNote(on ? 'Included AI is on.' : 'Included AI is off.'); reload(); reloadAi(); } catch (e: any) { setErr(e.message); } };
  return (
    <section className="card">
      <div className="card-head"><h2>AI recap</h2>{(s.hasKey || s.viaHa) && <span className="good">On</span>}</div>
      <p className="sub first">
        With AI on, Claude writes the dashboard recap, reads screenshots of purchases and looks up merchant logos. Without it, the recap is an automatic summary and the other two are off.
        Ledger sends Anthropic only what each job needs: that day's totals and bills, the picture you chose, or a list of merchant names. No account numbers.
      </p>
      <AiRoute onChange={() => { reload(); reloadAi(); }} />

      {inc && (
        <div className="ai-choice">
          <div className="row">
            <span className="grow">Included AI<small>
              Provided with this copy of Ledger, up to {usd(inc.limit)} a month. {own ? 'Not in use while your own key is saved.' : inc.usedUp ? "This month's amount is used up; it starts again on the 1st." : inc.on ? usd(inc.used) + ' used so far this month.' : 'Switched off.'}
            </small></span>
            <button onClick={() => setIncluded(!inc.on)}>{inc.on ? 'Turn off' : 'Turn on'}</button>
          </div>
          {inc.on && !own && <div className="ai-meter" role="img" aria-label={usd(inc.used) + ' of ' + usd(inc.limit) + ' used'}><i style={{ width: Math.min(100, (inc.used / inc.limit) * 100) + '%' }} /></div>}
        </div>
      )}

      <div className="ai-choice" data-go="ai-key">
        <span className="label">{inc ? 'Or use your own Anthropic key' : 'Your Anthropic key'}</span>
        {ai?.bringOwn ? (
          <div className="key-guide">
            <small>The AI features on this copy run on a key of your own. You pay Anthropic directly, for what you use; for a household that is usually well under a dollar a month. It takes about five minutes, once.</small>
            <ol>
              <li><b>Make an account.</b> <a className="button" href="https://console.anthropic.com/" target="_blank" rel="noreferrer">Open Anthropic's site in a new tab</a> and sign up with your email. This is separate from a Claude subscription, if you have one.</li>
              <li><b>Add credit.</b> There, open <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noreferrer">Billing</a>, add a card and buy credit. $5 is the least you can buy and lasts a long time. Leave auto-reload off if you'd like it to simply stop when the credit runs out.</li>
              <li><b>Make a key.</b> Open <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">API keys</a>, choose "Create key", name it Ledger, and copy it. It starts with sk-ant- and is shown only once.</li>
              <li><b>Paste it below.</b> Ledger checks it with Anthropic before saving, and tells you if anything is missing.</li>
            </ol>
          </div>
        ) : (
          <small>{inc && !s.modelFixed ? 'No monthly limit and your choice of model. ' : inc ? 'No monthly limit. ' : ''}Anthropic bills API use to you, separately from a Claude subscription. <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">Get a key from Anthropic</a>, then paste it here.</small>
        )}
        {own ? (
          <div className="add-actions">
            <span className="good">Key saved</span>
            <button onClick={async () => { await api('/api/recap/key', { method: 'DELETE' }); setNote(inc?.on ? 'Key removed. The included AI takes over.' : 'Key removed. The recap is back to the automatic summary.'); reload(); reloadAi(); }}>Remove key</button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="token-form">
            <label className="field"><span>Anthropic API key</span>
              <input type="password" value={key} autoComplete="off" placeholder="sk-ant-…" onChange={(e) => { setKey(e.target.value); setErr(''); }} />
            </label>
            <button type="submit" className="primary" disabled={checking}>{checking ? 'Checking with Anthropic…' : 'Check and save'}</button>
          </form>
        )}
      </div>

      {(own || !inc) && !s.modelFixed && (
        <label className="field" style={{ maxWidth: 420, marginTop: 12 }}><span>Model</span>
          <select value={s.model} onChange={(e) => save({ model: e.target.value }, 'Model changed.')}>
            {s.models.map((m: any) => <option key={m.id} value={m.id}>{m.label}: {m.note}</option>)}
          </select>
        </label>
      )}

      {ai && (ai.usage.requests > 0 || ai.usage.last) && (
        <div className="ai-usage">
          <span className="label">AI use in {monthLabel(ai.usage.month)}: about {usd(ai.usage.cost)}</span>
          <small>
            {ai.usage.by.length ? ai.usage.by.map((b: any) => b.feature + ' ' + usd(b.cost) + ' (' + b.requests + ')').join(' · ') : 'Nothing yet this month.'}
            {ai.usage.last ? ' · ' + monthLabel(ai.usage.last.month) + ' came to ' + usd(ai.usage.last.cost) + '.' : ''}
            {' '}Worked out from Anthropic's list prices, so their bill may differ slightly.
          </small>
        </div>
      )}
      {ai && <AiSent />}
      {note && <p className="good" role="status">{note}</p>}
      {err && <p className="error" role="alert">{err}</p>}
      <LogoFetch />
      {s.hasKey && <LogoFinder />}
    </section>
  );
}

/** What each request to Claude carried, in plain words, and categories the household keeps away from it (server/ai.js). */
function AiSent() {
  const { data, reload } = useData<any>('/api/ai/sent');
  const { data: names, reload: reloadNames } = useData<any>('/api/ai/names');
  if (!data) return null;
  const hidden: number[] = data.private;
  const toggle = async (id: number) => {
    await api('/api/ai/private', { method: 'PUT', body: { ids: hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id] } });
    forgetLoaded(); reload();
  };
  const when = (at: number) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return (
    <div className="ai-sent">
      <Fold plain id="ai-sent" title="What has been sent to Claude" note={data.log.length ? `the last ${data.log.length}` : 'nothing yet'}>
        <p className="sub first">Each time an AI feature runs, Ledger notes here what the request carried. It is a description, not a copy: the content itself isn't kept. Only this copy of Ledger can see this list.</p>
        {data.log.length === 0 && <p className="sub">Nothing has been sent yet.</p>}
        {data.log.map((r: any, i: number) => (
          <div key={i} className="row"><span className="grow wrap">{r.feature}<small>{r.sent || 'Sent before Ledger began noting what a request carried.'}</small></span><small>{when(r.at)}</small></div>
        ))}
      </Fold>
      <Fold plain id="ai-private" title="Keep some categories away from Claude" note={hidden.length ? `${hidden.length} kept private` : 'none'}>
        <p className="sub first">Tick a category and its purchases, shops and bills are left out of what Claude is shown: the recap, Ask your CFO, logo searches and budget suggestions. Month totals still include them, so the sums stay right, and the category's name can still appear in a list of your categories. A receipt or statement you choose to upload is sent whole.</p>
        <div className="ai-private">
          {data.categories.map((c: any) => (
            <label key={c.id} className="hint-every"><input type="checkbox" checked={hidden.includes(c.id)} onChange={() => toggle(c.id)} /> {c.icon} {c.name}</label>
          ))}
        </div>
      </Fold>
      {names && (
        <Fold plain id="ai-names" title="Hide names from the AI" note={names.on ? 'on' : 'off'}>
          <p className="sub first">Switched on, the recap and Ask your CFO are sent plain labels in place of your household's names: the adults, employers, side gigs, accounts and banks. The answer has your own names put back before you read it, so nothing looks different to you. Amounts and dates still go, since the AI can't answer without them.</p>
          <label className="hint-every" data-go="ai-names"><input type="checkbox" checked={names.on} onChange={async (e) => { await api('/api/ai/names', { method: 'PUT', body: { on: e.target.checked } }); forgetLoaded(); reloadNames(); }} /> Hide names in what the recap and the CFO are sent</label>
          {names.swaps.length > 0 && (
            <>
              <p className="sub">{names.on ? 'What is being swapped:' : 'What would be swapped:'}</p>
              {names.swaps.slice(0, 40).map((s: any) => <div key={s.label} className="row"><span className="grow wrap">{s.names.join(', ')}</span><small>{s.label}</small></div>)}
            </>
          )}
          <p className="sub">Not covered: the names of shops and bills, categories and savings goals; a photo of a receipt, a statement or a pay stub, which is sent whole; and a name spelled differently from how it is saved in Ledger. It is a word swap, not a guarantee.</p>
        </Fold>
      )}
    </div>
  );
}

/** Claude looks up logos for merchants the built-in list doesn't know. */
/** Whether Ledger may ask the icon services for shops' logos at all. On unless switched off. */
// Sensors Ledger can write to Home Assistant for automations. Each is off until switched on here.
function HaSensors() {
  const { data: v, reload } = useData<any>('/api/ha/sensors');
  const [err, setErr] = useState('');
  const [low, setLow] = useState<string | null>(null);
  if (!v?.offered) return null;
  const put = async (body: object) => { setErr(''); try { await api('/api/ha/sensors', { method: 'PUT', body }); forgetLoaded(); reload(); } catch (e: any) { setErr(e.message); } };
  const says = (s: any) => (s.state === null ? 'Not written yet' : s.state === 'on' ? 'Yes' : s.state === 'off' ? 'No' : s.state === 'unknown' ? (s.needs ? `Nothing yet: it needs ${s.needs}` : 'Nothing to go on yet') : String(s.state));
  const row = (s: any) => (
    <label className="row check" key={s.id}><span className="grow wrap">{s.name}{s.figure ? <em className="tag">shows a figure to every Home Assistant user</em> : null}
      <small>{s.hint} <code>{s.entity}</code>{s.on ? <> · now: <b>{says(s)}</b></> : null}{s.error ? <span className="bad"> · {s.error}</span> : null}</small></span>
      <input type="checkbox" checked={s.on} onChange={(e) => put({ id: s.id, on: e.target.checked })} /></label>
  );
  const anyOn = v.sensors.some((s: any) => s.on);
  return (
    <section className="card ha-sensors">
      <div className="card-head"><h2>Home Assistant sensors</h2>{anyOn && <span className="good">On</span>}</div>
      <p className="sub first">For automations and dashboards in Home Assistant: a phone notification the day before a bill, a light that turns amber when checking runs low, a line on a wall display. Everything here is <b>off until you switch it on</b>, one sensor at a time, and Ledger writes nothing to Home Assistant otherwise.</p>
      <p className="sub">Worth knowing first: whatever you switch on can be seen by everyone who uses your Home Assistant, can be put on its dashboards, and is kept in its history. The first three only say yes or no. The ones marked "shows a figure" put a number from your finances there.</p>
      <p className="sub"><b>"Everyone" means every Home Assistant login, not only administrators:</b> ordinary users, guest logins and wall displays can all read these, even though only administrators can open Ledger itself.</p>
      <h3 className="setup-sub">Yes or no</h3>
      {v.sensors.filter((s: any) => !s.figure && s.entity.startsWith('binary_')).map(row)}
      <label className="field ha-low"><span>"Running low" means checking forecast below</span>
        <input type="text" inputMode="decimal" value={low ?? String(v.low)} onChange={(e) => setLow(e.target.value)} onBlur={() => { if (low !== null && low !== String(v.low)) put({ low }); setLow(null); }} />
        <small>Shared with the email alerts.</small></label>
      <h3 className="setup-sub">Numbers</h3>
      {v.sensors.filter((s: any) => !s.entity.startsWith('binary_')).map(row)}
      {err && <p className="error" role="alert">{err}</p>}
      <p className="sub">Ledger refreshes them every five minutes. In Home Assistant they appear under Developer tools, States, and can be used in any automation as a trigger or condition. Switch one off and it reads "unavailable" until Home Assistant next restarts, then it is gone.</p>
    </section>
  );
}

export function LogoFetch() {
  const { data: s, reload } = useData<any>('/api/settings');
  if (!s) return null;
  const on = s.logos_off !== '1';
  return (
    <div className="logo-fetch">
      <label className="row check"><span className="grow wrap">Fetch shops' logos from the internet<small>To show a logo, Ledger asks an icon service (Google's, then DuckDuckGo's) for the icon of that shop's website, once per shop. That tells the service which shops' sites were looked up, and nothing else. Off, shops show as a letter; logos already fetched stay.</small></span>
        <input type="checkbox" checked={on} onChange={async (e) => { await api('/api/settings', { method: 'PUT', body: { logos_off: e.target.checked ? '0' : '1' } }); forgetLoaded(); reload(); }} /></label>
    </div>
  );
}

function LogoFinder() {
  const { data: f, reload } = useData('/api/logos/finder');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  if (!f) return null;
  const run = async () => {
    setBusy(true); setErr(''); setNote('');
    try {
      const r = (await api('/api/logos/finder/run', { method: 'POST' })).ran;
      setNote(r.checked ? `Checked ${r.checked} merchant${r.checked === 1 ? '' : 's'} and found ${r.found} logo${r.found === 1 ? '' : 's'}.${r.more ? ' There are more to check; press again or leave it to run by itself.' : ''} Reload the page to see them.` : 'Every merchant has already been checked.');
      reload();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="logo-finder">
      <label className="check">
        <input type="checkbox" checked={f.on} onChange={async (e) => { await api('/api/logos/finder', { method: 'PUT', body: { on: e.target.checked } }); reload(); }} />
        Find logos for merchants that don't have one
      </label>
      <p className="sub">
        Every few hours Claude is sent the names of merchants it hasn't seen (names only, no amounts or dates, and never payments to people) and asked which company each is. Each name is checked once.
        {` ${f.found} found so far${f.waiting ? `, ${f.waiting}${f.waiting >= 160 ? ' or more' : ''} waiting to be checked` : ''}.`}
      </p>
      <div className="add-actions"><button disabled={busy} onClick={run}>{busy ? 'Looking…' : 'Find logos now'}</button></div>
      {f.error && !err && <p className="error" role="alert">The last automatic check didn't work. {f.error}</p>}
      {note && <p className="good" role="status">{note}</p>}
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}

/** The summary email: who it's sent from, who gets it, and a look at this week's. */
function WeeklyEmail() {
  const { data: m, reload } = useData('/api/mail');
  const [user, setUser] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [adding, setAdding] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  if (!m) return null;
  const run = async (work: () => Promise<string>) => {
    setErr(''); setNote(''); setBusy(true);
    try { setNote(await work()); reload(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api('/api/mail', { method: 'PUT', body: { user: user ?? m.user, ...(password.trim() ? { password } : {}) } });
      const first = !m.hasPassword && !!password.trim();
      setPassword(''); setUser(null);
      return first ? 'Saved. Add who it goes to, then press "Send a test to me" to check it works.' : 'Saved.';
    });
  };
  // Each address is saved as soon as it's added or removed.
  const addAddress = (e: React.FormEvent) => {
    e.preventDefault();
    const a = adding.trim();
    if (!a) return setErr('Type an email address to add.');
    if (m.to.some((x: string) => x.toLowerCase() === a.toLowerCase())) return setErr(`${a} is already on the list.`);
    run(async () => { await api('/api/mail', { method: 'PUT', body: { to: [...m.to, a] } }); setAdding(''); return `${a} added.`; });
  };
  const removeAddress = (a: string) => run(async () => {
    const s = await api('/api/mail', { method: 'PUT', body: { to: m.to.filter((x: string) => x !== a) } });
    return `${a} removed.${m.on && !s.on ? ' Nobody is left on the list, so the summary email is turned off.' : ''}`;
  });
  const when = (ms: number) => new Date(ms).toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return (
    <section className="card">
      <div className="card-head"><h2>Summary email</h2>{m.on && <span className="good">On</span>}</div>
      <p className="sub first">
        A short summary on the days you choose: what's left before the next paycheck, the bills due first, the next paychecks, the last seven days' spending and any budgets running over.
        Totals only, no account numbers. It's sent from a Gmail account of yours, using an app password: 16 letters Google makes for Ledger alone. It isn't your normal Gmail password, and you can cancel it at Google whenever you like.
      </p>
      {!m.hasPassword && (
        <div className="key-guide mail-guide">
          <small>Setting it up takes about five minutes, once. Any Gmail account will do; the summary can still go to other addresses.</small>
          <ol>
            <li><b>Turn on 2-Step Verification,</b> if it isn't on already. Google only makes app passwords for accounts that have it. <a className="button" href="https://myaccount.google.com/signinoptions/twosv" target="_blank" rel="noreferrer">Open 2-Step Verification in a new tab</a></li>
            <li><b>Make the app password.</b> <a className="button" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">Open Google's app passwords page</a> Sign in if asked, type a name such as Ledger, and press Create.</li>
            <li><b>Copy the 16 letters</b> Google shows. It shows them only once; the spaces don't matter.</li>
            <li><b>Paste them below</b> with the Gmail address they belong to, and press Save.</li>
            <li><b>Add who it goes to,</b> then press "Send a test to me" to see it arrive.</li>
          </ol>
          <small>If Google says app passwords aren't available for your account, 2-Step Verification is off, or the account is run by a school or employer that has switched them off. A personal Gmail account works.</small>
        </div>
      )}
      <form onSubmit={save} noValidate className="token-form">
        <label className="field"><span>Gmail address it's sent from</span>
          <input type="email" value={user ?? m.user} autoComplete="off" placeholder="Your Gmail address" onChange={(e) => setUser(e.target.value)} />
        </label>
        <label className="field"><span>App password{m.hasPassword ? ' (saved; type to replace)' : ''}</span>
          <input type="password" value={password} autoComplete="new-password" placeholder={m.hasPassword ? '••••••••••••••••' : '16 letters from Google'} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button type="submit" className="primary" disabled={busy}>Save</button>
      </form>
      <div className="mail-to">
        <span className="label">Send it to</span>
        {m.to.length === 0 && <p className="sub">Nobody yet. Add an address below.</p>}
        <ul>
          {m.to.map((a: string) => (
            <li key={a}>
              <span>{a}</span>
              <button type="button" disabled={busy} onClick={() => removeAddress(a)} aria-label={`Remove ${a}`}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={addAddress} noValidate>
          <input type="email" value={adding} autoComplete="off" placeholder="Add an email address" aria-label="Email address to add" onChange={(e) => { setAdding(e.target.value); setErr(''); }} />
          <button type="submit" disabled={busy}>Add</button>
        </form>
      </div>
      <div className="mail-when">
        <span className="label">Send it on</span>
        <div className="days" role="group" aria-label="Days to send">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => {
            const on = m.days.includes(i);
            return (
              <button key={d} type="button" className={on ? 'on' : ''} aria-pressed={on} disabled={busy}
                onClick={() => run(async () => { await api('/api/mail', { method: 'PUT', body: { days: on ? m.days.filter((x: number) => x !== i) : [...m.days, i] } }); return ''; })}>{d}</button>
            );
          })}
        </div>
        <label className="field"><span>At</span>
          <select value={m.hour} disabled={busy} onChange={(e) => run(async () => { await api('/api/mail', { method: 'PUT', body: { hour: Number(e.target.value) } }); return ''; })}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h % 12 || 12}:00 {h < 12 ? 'AM' : 'PM'}</option>)}
          </select>
        </label>
        <div className="quick">
          <button className="link" disabled={busy} onClick={() => run(async () => { await api('/api/mail', { method: 'PUT', body: { days: [1, 2, 3, 4, 5] } }); return ''; })}>Weekdays</button>
          <button className="link" disabled={busy} onClick={() => run(async () => { await api('/api/mail', { method: 'PUT', body: { days: [0, 1, 2, 3, 4, 5, 6] } }); return ''; })}>Every day</button>
          <button className="link" disabled={busy} onClick={() => run(async () => { await api('/api/mail', { method: 'PUT', body: { days: [0] } }); return ''; })}>Sundays only</button>
        </div>
      </div>
      <p className="sub">Sends {m.schedule}.</p>
      <div className="add-actions mail-acts">
        <button disabled={busy} onClick={() => run(async () => { setPreview(await api('/api/mail/preview')); return ''; })}>Show today's email</button>
        {m.hasPassword && m.user && <button disabled={busy} onClick={() => run(async () => `Test sent to ${(await api('/api/mail/test', { method: 'POST' })).sentTo}. Tests go only to that address.`)}>Send a test to me</button>}
        {m.on
          ? <button disabled={busy} onClick={() => run(async () => { await api('/api/mail', { method: 'PUT', body: { on: false } }); return 'Summary email turned off.'; })}>Turn off</button>
          : <button disabled={busy} onClick={() => run(async () => { await api('/api/mail', { method: 'PUT', body: { on: true } }); return 'Summary email turned on.'; })}>Turn on</button>}
        {m.hasPassword && <button disabled={busy} onClick={() => run(async () => { await api('/api/mail/password', { method: 'DELETE' }); return 'App password removed and the summary email turned off.'; })}>Remove app password</button>}
      </div>
      {m.on && m.nextSend && <p className="sub">Next one: {when(m.nextSend)}, to {m.to.join(' and ')}.{m.lastSent ? ` Last sent ${when(m.lastSent)}.` : ''}</p>}
      {m.lastError && <p className="error" role="alert">The last email didn't go out. {m.lastError}</p>}
      {note && <p className="good" role="status">{note}</p>}
      {err && <p className="error" role="alert">{err}</p>}
      {preview && (
        <div className="mail-preview">
          <div className="sub"><b>Subject:</b> {preview.subject} · <button className="link" onClick={() => setPreview(null)}>Hide</button></div>
          <iframe title="Today's email" sandbox="allow-same-origin" srcDoc={preview.html} onLoad={(e) => { const f = e.currentTarget; const h = f.contentDocument?.documentElement.scrollHeight; if (h) f.style.height = `${h}px`; }} />
        </div>
      )}
    </section>
  );
}

const SCENES: [string, string][] = [
  ['auto', 'Automatic: holidays only'], ['auto-seasons', 'Automatic: holidays and seasons'],
  ['thanksgiving', 'Thanksgiving'], ['christmas', 'Christmas'], ['autumn', 'Autumn'], ['winter', 'Winter'], ['spring', 'Spring'], ['summer', 'Summer'],
  ['halloween', 'Halloween'], ['newyear', "New Year's"], ['valentines', "Valentine's Day"], ['stpatricks', "St. Patrick's Day"], ['easter', 'Easter'], ['july4', 'Fourth of July'],
];
const blend = (colors: string[], angle = 135) => (colors.length === 1 ? colors[0] : `linear-gradient(${angle}deg, ${colors.join(', ')})`);

/** A row of colour dots with "Automatic" first and a colour picker last. */
function ColorChoice({ value, choices, auto, onChange, label }: { value: string; choices: string[]; auto: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="dots" role="group" aria-label={label}>
      <button type="button" className={`dot auto ${value === '' ? 'on' : ''}`} aria-pressed={value === ''} onClick={() => onChange('')}>{auto}</button>
      {choices.map((c) => (
        <button key={c} type="button" className={`dot ${value.toLowerCase() === c ? 'on' : ''}`} style={{ background: c }} aria-pressed={value.toLowerCase() === c} aria-label={`${label}: ${c}`} onClick={() => onChange(c)} />
      ))}
      <label className="pick-color">
        <input type="color" value={value || choices[0]} aria-label={`${label}: choose any colour`} onChange={(e) => onChange(e.target.value)} />
        Any colour
      </label>
    </div>
  );
}

// How the app looks on this device: backdrop, colours and typeface. Remembered on this device only.
function Appearance() {
  const el = document.querySelector('seasonal-backdrop');
  const [look, setLook] = useState<Look>(readLook);
  const [size, setSize] = useState(readSize);
  const [motion, setMotion] = useState(el?.getAttribute('motion') !== 'off');
  const [cast, setCast] = useState(el?.getAttribute('characters') !== 'off');
  const phone = typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches;
  const [fade, setFade] = useState(() => { try { return localStorage.getItem('ledger-page-fade') || '0.2'; } catch { return '0.2'; } });
  const keep = (key: string, value: string, attr: string) => {
    el?.setAttribute(attr, value);
    try { localStorage.setItem(key, value); } catch { /* private window: applies until reload */ }
  };
  const change = (c: Partial<Look>) => setLook(saveLook(c));
  // Whether the page is showing dark right now, to preview the colourways as they'll appear.
  // Redraw when the device itself switches between light and dark, so the choices shown keep up.
  const [, deviceFlipped] = useState(0);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-color-scheme: dark)'), on = () => deviceFlipped((n) => n + 1);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  const darkNow = look.scheme === 'dark' || (look.scheme === 'auto' && typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches);
  const isScene = SCENES.some(([id]) => id === look.backdrop);
  const custom = look.backdrop === 'custom';
  // A photo of your own as the backdrop. The picture stays on this device (src/photo.ts).
  const [pic, setPic] = useState<PhotoMeta | null>(readPhotoMeta);
  const [picUrl, setPicUrl] = useState('');
  const [picBusy, setPicBusy] = useState(false);
  const [picErr, setPicErr] = useState('');
  useEffect(() => { let on = true; photoUrl().then((u) => { if (on) setPicUrl(u); }); return () => { on = false; }; }, [pic]);
  const photoOn = look.backdrop === 'photo' && !!pic;
  const pickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPicBusy(true); setPicErr('');
    try { setPic(await choosePhoto(file)); change({ backdrop: 'photo' }); }
    catch (x: any) { setPicErr(x?.message || 'That picture could not be kept on this device.'); }
    setPicBusy(false);
  };
  const tunePhoto = (c: Partial<PhotoMeta>) => { if (!pic) return; const next = { ...pic, ...c }; savePhotoMeta(next); setPic(next); change({}); };
  const dropPhoto = async () => { await removePhoto(); setPic(null); setPicUrl(''); if (look.backdrop === 'photo') change({ backdrop: 'none' }); };
  const setColor = (i: number, v: string) => change({ backdrop: 'custom', colors: look.colors.map((c, j) => (j === i ? v : c)) });
  const changed = JSON.stringify(look) !== JSON.stringify(STANDARD_LOOK);
  // What each folded part is set to, shown beside its title.
  const lookNote = [
    custom ? '' : look.scheme === 'auto' && photoOn ? 'Suits your photo' : look.scheme === 'auto' ? 'Automatic' : look.scheme === 'light' ? 'Light' : 'Dark',
    look.accent || look.ink ? 'your colours' : '',
    `${FONTS.find((f) => f.id === look.font)?.label} typeface`,
  ].filter(Boolean).join(', ');
  const motionNote = [`${fade}-second fade`, `${phone ? 'fireworks' : 'characters'} ${cast ? 'on' : 'off'}`, `snow ${motion ? 'on' : 'off'}`].join(', ');
  return (
    <section className="card" data-go="appearance">
      <div className="card-head"><h2>Appearance</h2>{changed && <button className="link" onClick={() => change(STANDARD_LOOK)}>Back to the standard look</button>}</div>
      <p className="sub first">Saved on this device only.</p>

      <div className="look-row">
        <span className="label">Holiday and season scenes</span>
        <select value={isScene ? look.backdrop : ''} aria-label="Holiday and season scenes" onChange={(e) => e.target.value && change({ backdrop: e.target.value })}>
          {!isScene && <option value="">Not in use</option>}
          {SCENES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </div>

      <div className="look-row">
        <span className="label">Still colourways</span>
        <div className="swatches">
          {/* The app's plain look, with solid panels and no glass. */}
          {/* Both are always offered (it was one swatch named by the device's light or dark setting, so a
              phone in light mode never saw "Onyx": a family member, 2026-11-19). Choosing one sets light or dark too. */}
          <button type="button" className={`swatch ${look.backdrop === 'none' && darkNow ? 'on' : ''}`} aria-pressed={look.backdrop === 'none' && darkNow} onClick={() => change({ backdrop: 'none', scheme: 'dark' })}>
            <i style={{ background: 'linear-gradient(135deg, #0e0f13, #1c1e26)' }} />Onyx
          </button>
          <button type="button" className={`swatch ${look.backdrop === 'none' && !darkNow ? 'on' : ''}`} aria-pressed={look.backdrop === 'none' && !darkNow} onClick={() => change({ backdrop: 'none', scheme: 'light' })}>
            <i style={{ background: 'linear-gradient(135deg, #f5f4f0, #ffffff)', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.18)' }} />Ivory
          </button>
          {COLORWAYS.map((w) => (
            <button key={w.id} type="button" className={`swatch ${look.backdrop === w.id ? 'on' : ''}`} aria-pressed={look.backdrop === w.id} onClick={() => change({ backdrop: w.id })}>
              <i style={{ background: blend(darkNow ? w.dark : w.light) }} />{w.label}
            </button>
          ))}
        </div>
      </div>

      <Fold plain id="look-custom" title="Your own colours" note={custom ? 'In use' : 'Not in use'}>
      <div className="look-row">
        <small>One colour for a solid backdrop, or up to four blended together. Light or dark text is chosen to suit them.</small>
        <div className="swatches">
          <button type="button" className={`swatch ${custom ? 'on' : ''}`} aria-pressed={custom} onClick={() => change({ backdrop: 'custom' })}>
            <i style={{ background: blend(look.colors, look.angle) }} />Custom
          </button>
        </div>
        {custom && (
          <>
            <div className="custom-colors">
              {look.colors.map((c, i) => (
                <span className="stop" key={i}>
                  <input type="color" value={c} aria-label={`Colour ${i + 1}`} onChange={(e) => setColor(i, e.target.value)} />
                  {look.colors.length > 1 && <button type="button" className="link" aria-label={`Remove colour ${i + 1}`} onClick={() => change({ colors: look.colors.filter((_, j) => j !== i) })}>Remove</button>}
                </span>
              ))}
              {look.colors.length < 4 && <button type="button" onClick={() => change({ colors: [...look.colors, look.colors.at(-1) as string] })}>Add a colour</button>}
              {look.colors.length > 1 && (
                <select value={look.angle} aria-label="Direction of the blend" onChange={(e) => change({ angle: Number(e.target.value) })}>
                  <option value="160">Corner to corner</option>
                  <option value="180">Top to bottom</option>
                  <option value="90">Left to right</option>
                  <option value="45">Bottom left to top right</option>
                </select>
              )}
            </div>
            <div className="custom-preview" style={{ background: blend(look.colors, look.angle) }} aria-hidden="true" />
          </>
        )}
      </div>
      </Fold>

      <Fold plain id="look-photo" title="Your own photo" note={photoOn ? 'In use' : pic ? 'Not in use' : 'None chosen'}>
      <div className="look-row look-photo">
        <small>Use a picture of your own as the backdrop. It is kept on this device only and is never sent to Ledger's server, so each phone or computer chooses its own. Ledger picks light or dark text, tints the cards and takes an accent colour from the picture to suit it.</small>
        <div className="add-actions">
          <label className={`button primary ${picBusy ? 'busy' : ''}`}>{picBusy ? 'Preparing…' : pic ? 'Choose a different photo' : 'Choose a photo'}<input type="file" accept="image/*" disabled={picBusy} onChange={pickPhoto} hidden /></label>
          {pic && !photoOn && <button type="button" onClick={() => change({ backdrop: 'photo' })}>Use it again</button>}
          {pic && <button type="button" onClick={dropPhoto}>Remove the photo</button>}
        </div>
        {picErr && <p className="error" role="alert">{picErr}</p>}
        {pic && (
          <>
            {picUrl && !photoOn && <div className="photo-preview" style={{ backgroundImage: `url("${picUrl}")` }} aria-hidden="true" />}
            {picUrl && photoOn && <PhotoFrame url={picUrl} pic={pic} onChange={tunePhoto} />}
            {photoOn && (
              <div className="photo-tune">
                <label>Dim the photo<input type="range" min="0" max="80" step="5" value={pic.dim} onChange={(e) => tunePhoto({ dim: Number(e.target.value) })} /><span>{pic.dim}%</span></label>
                <label>Zoom in<input type="range" min="1" max="3" step="0.05" value={framing(pic).zoom} onChange={(e) => tunePhoto({ zoom: Number(e.target.value) })} /><span>{framing(pic).zoom === 1 ? 'Fit' : `${framing(pic).zoom.toFixed(1)}x`}</span></label>
                <label>Blur it<input type="range" min="0" max="24" step="2" value={pic.blur} onChange={(e) => tunePhoto({ blur: Number(e.target.value) })} /><span>{pic.blur === 0 ? 'Sharp' : `${pic.blur}`}</span></label>
                <small>More dimming makes words that sit straight on the picture easier to read. Light or dark text follows the picture unless you choose one below.</small>
              </div>
            )}
          </>
        )}
      </div>
      </Fold>

      <Fold plain id="look-colours" title="Light or dark, colours and typeface" note={lookNote}>
      {!custom && (
        <div className="look-row">
          <span className="label">Light or dark</span>
          <small>Automatic follows this device's own setting.</small>
          <div className="dots" role="group" aria-label="Light or dark">
            {(['auto', 'light', 'dark'] as const).map((v) => (
              <button key={v} type="button" className={`dot auto ${look.scheme === v ? 'on' : ''}`} aria-pressed={look.scheme === v} onClick={() => change({ scheme: v })}>{v === 'auto' ? 'Automatic' : v === 'light' ? 'Light' : 'Dark'}</button>
            ))}
          </div>
        </div>
      )}

      <div className="look-row">
        <span className="label">Accent colour</span>
        <small>Used for buttons, links, highlights and chart lines. Automatic follows the backdrop.</small>
        <ColorChoice label="Accent colour" value={look.accent} choices={ACCENTS} auto="Automatic" onChange={(v) => change({ accent: v })} />
      </div>

      <div className="look-row">
        <span className="label">Text colour</span>
        <small>Automatic is near-white on dark and near-black on light. Smaller print uses a softer shade of the same colour.</small>
        <ColorChoice label="Text colour" value={look.ink} choices={INKS} auto="Automatic" onChange={(v) => change({ ink: v })} />
      </div>

      <div className="look-row">
        <span className="label">Display size</span>
        <select value={size} aria-label="Display size" onChange={(e) => { setSize(e.target.value); saveSize(e.target.value); }}>
          {SIZES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <span className="label">Typeface</span>
        <select value={look.font} aria-label="Typeface" onChange={(e) => change({ font: e.target.value })}>
          {FONTS.map((f) => <option key={f.id} value={f.id} style={{ fontFamily: f.stack || undefined }}>{f.label}</option>)}
        </select>
      </div>
      </Fold>

      <Fold plain id="look-motion" title="Motion" note={motionNote}>
      <div className="row">
        <span className="grow">Fade between pages<small>How long one page takes to fade into the next. Try each, then tap around the menu.</small></span>
        <select value={fade} aria-label="Fade between pages" onChange={(e) => {
          setFade(e.target.value);
          document.documentElement.style.setProperty('--page-fade', `${e.target.value}s`);
          try { localStorage.setItem('ledger-page-fade', e.target.value); } catch { /* private window: applies until reload */ }
        }}>
          <option value="0.2">Quick (0.2 seconds)</option>
          <option value="0.35">Smooth (0.35 seconds)</option>
          <option value="0.5">Slow (0.5 seconds)</option>
          <option value="0.8">Very slow (0.8 seconds)</option>
        </select>
      </div>
      <label className="row check">
        <span className="grow">{phone ? 'Holiday fireworks' : 'Holiday characters and fireworks'}<small>{phone ? 'Behind the page on New Year\'s and the Fourth of July. The characters appear on the computer only' : 'The turkey, Santa, the ghost and friends stand at the foot of the side menu; fireworks stay behind the page'}</small></span>
        <input type="checkbox" checked={cast} onChange={(e) => { setCast(e.target.checked); try { localStorage.setItem('ledger-backdrop-characters', e.target.checked ? 'on' : 'off'); } catch { /* private window */ } el?.setAttribute('characters', !e.target.checked ? 'off' : phone ? 'fireworks' : 'on'); }} />
      </label>
      <label className="row check">
        <span className="grow">Falling leaves and snow<small>Turn off to keep a holiday scene still</small></span>
        <input type="checkbox" checked={motion} onChange={(e) => { setMotion(e.target.checked); keep('ledger-backdrop-motion', e.target.checked ? 'on' : 'off', 'motion'); }} />
      </label>
      </Fold>
    </section>
  );
}

/** Phones that send their Apple Pay purchases here, and how to set one up. */
function ApplePay() {
  const { data, reload } = useData<any>('/api/taps');
  const [name, setName] = useState('');
  const [account, setAccount] = useState('');
  const [made, setMade] = useState<{ key: string; name: string } | null>(null);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState('');
  if (!data) return null;
  const address = `${location.origin}/api/tap`;
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      const r = await api('/api/taps', { method: 'POST', body: { name, account_id: Number(account || data.accounts[0]?.id) } });
      setMade({ key: r.key, name: name.trim() }); setName(''); reload();
    } catch (x: any) { setErr(x.message); }
  };
  const copy = async (what: string, text: string) => { try { await navigator.clipboard.writeText(text); setCopied(what); } catch { setCopied(''); } };
  const when = (ms: number) => new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return (
    <section className="card">
      <div className="card-head"><h2>Apple Pay purchases</h2></div>
      <p className="sub first">
        An iPhone can tell Ledger about a purchase the moment you pay with a card in Wallet, which is the only way to see Apple Card spending as it happens.
        Each phone gets its own key. A key can add a purchase and nothing else: it can't read your data or sign in.
      </p>
      {data.keys.length > 0 && (
        <div>
          {data.keys.map((k: any) => (
            <div className="row" key={k.id}>
              <span className="grow wrap">{k.name}<small>Purchases go to {k.account ?? 'an account that no longer exists'} unless the card says otherwise · {k.last_used ? `last used ${when(k.last_used)}, ${k.uses} so far` : 'not used yet'}</small></span>
              <button onClick={async () => { await api(`/api/taps/${k.id}`, { method: 'DELETE' }); if (made?.name === k.name) setMade(null); reload(); }}>Remove</button>
            </div>
          ))}
        </div>
      )}
      {data.keys.length > 0 && (
        <div className="tap-recent">
          <div className="group-head"><span>What your phones have sent lately</span></div>
          {(data.recent ?? []).length === 0 && <p className="sub">Nothing has arrived since this list began on November 18, 2026.</p>}
          {(data.recent ?? []).map((r: any, i: number) => (
            <div className="row" key={i}>
              <span className="grow wrap">{r.merchant || (r.outcome === 'wrong key' ? 'A report with a key Ledger doesn\'t know' : 'A report with nothing in it')}
                <small>{when(r.at)} · {r.outcome === 'recorded' ? `added to ${r.detail}` : r.outcome === 'already recorded' ? 'already recorded, so not added twice' : r.detail || r.outcome}{r.phone ? ` · ${r.phone}` : ''}</small></span>
              {r.amount != null && <span className="num">{cents(Number(r.amount))}</span>}
            </div>
          ))}
          <p className="sub">If a purchase isn't listed here, the phone's report never reached Ledger: the automation didn't run for that payment, the phone couldn't reach your home server at that moment, or Ledger was restarting for an update (last restart {when(data.startedAt)}). Add it with the + button; the bank's entry will still replace it.</p>
        </div>
      )}
      <form onSubmit={add} noValidate className="token-form">
        <label className="field"><span>Name for the phone</span>
          <input type="text" value={name} placeholder="Sam's iPhone" onChange={(e) => { setName(e.target.value); setErr(''); }} />
        </label>
        <label className="field"><span>Its purchases usually go on</span>
          <select value={account || String(data.accounts[0]?.id ?? '')} onChange={(e) => setAccount(e.target.value)}>
            {data.accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <button type="submit" className="primary">Add a phone</button>
      </form>
      {err && <p className="error" role="alert">{err}</p>}
      {made && (
        <div className="tap-steps">
          <p><b>Key for {made.name}.</b> It's shown this once, so finish these steps on that phone now. If you lose it, remove the phone above and add it again.</p>
          <div className="tap-copy"><code>{made.key}</code><button type="button" onClick={() => copy('key', made.key)}>{copied === 'key' ? 'Copied' : 'Copy key'}</button></div>
          <div className="tap-copy"><code>{address}</code><button type="button" onClick={() => copy('address', address)}>{copied === 'address' ? 'Copied' : 'Copy address'}</button></div>
          <ol>
            <li>On the iPhone, open <b>Shortcuts</b>, tap <b>Automation</b> at the bottom, then <b>+</b>.</li>
            <li>Choose <b>Transaction</b>. Tick the cards to report (Apple Card, and your debit card if you like), leave every category ticked, choose <b>Run Immediately</b> and tap <b>Next</b>.</li>
            <li>Tap <b>New Blank Automation</b>, then search for and add the action <b>Get Contents of URL</b>. Be careful: there is a similar one called "Get Component of URL", which is the wrong one. The right one has a green icon and offers a Method setting.</li>
            <li>In the URL box, paste the address above. Tap the arrow to show more, and set <b>Method</b> to <b>POST</b> and <b>Request Body</b> to <b>JSON</b>.</li>
            <li>Add four text fields to the body:
              <ul>
                <li><code>key</code>: paste the key above</li>
                <li><code>merchant</code>: tap the box, choose <b>Transaction</b> (on some phones it's called Shortcut Input), then <b>Merchant</b></li>
                <li><code>amount</code>: <b>Transaction</b>, then <b>Amount</b></li>
                <li><code>card</code>: <b>Transaction</b>, then <b>Card or Pass</b></li>
              </ul>
            </li>
            <li>Tap <b>Done</b>. The next time that phone pays with one of those cards, the purchase appears in Transactions.</li>
          </ol>
          <p className="sub">The phone has to be able to reach this address when it pays: on your home Wi-Fi, or anywhere with Tailscale on. A purchase made out of reach isn't sent, and is picked up later from the card's monthly export.</p>
        </div>
      )}
    </section>
  );
}

export default function Connections({ onChanged }: { onChanged: () => void }) {
  const { data: s, error, reload } = useData('/api/simplefin');
  const { data: auth, reload: reloadAuth } = useData('/api/auth/status');
  const taxesOn = useTaxes();
  const gig = useGig();
  const { data: family } = useData('/api/family');
  const { data: repoStats } = useData<any>('/api/repo');
  const { data: flyStats } = useData<any>('/api/fly');
  const { data: update } = useData<any>('/api/update');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  if (error) return <p className="error">{error}</p>;
  if (!s || !auth) return null;

  const refresh = () => { reload(); reloadAuth(); onChanged(); };
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setErr('');
    try { await fn(); } catch (e: any) { setErr(e.message); }
    setBusy('');
    refresh();
  };
  const connect = (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return setErr('Paste your SimpleFIN setup token.');
    run('Connecting and reading your accounts…', async () => { await api('/api/simplefin/connect', { method: 'POST', body: { token } }); setToken(''); });
  };
  // Signing out. On a copy that opens with the web address's sign-in alone, leaving Ledger isn't enough: the
  // Google or email check is still passed, so Ledger would let the device straight back in. So that check is
  // signed out of too, at Cloudflare's own sign-out address for this site.
  const signOut = async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* signed out already */ }
    forgetLoaded();
    if (auth?.access?.login && auth.access.email) { location.href = '/cdn-cgi/access/logout'; return; }
    refresh();
  };
  // Nothing protects this copy yet: no Ledger password and no sign-in at the web address either.
  const needsPassword = !s.passwordSet && !s.locked && s.networkOpen;
  const r = s.lastResult;

  return (
    <div className="stack narrow">
      <SettingsSearch />
      {/* How the app looks is a different kind of setting from the connections below, so it sits at the top beside the password. */}
      <h3 className="group-title">This device</h3>
      <div className="split two top-pair">
      <div className="stack">
      <section className="card" data-go="password">
        <div className="card-head"><h2>Password</h2>{s.passwordSet && <span className="good">On</span>}</div>
        {s.passwordSet ? (
          <>
            <p className="sub first">Ledger asks for your password on each new device or browser, then keeps that device signed in for as long as you keep using it (it signs out after 90 days without a visit).</p>
            <div className="add-actions" style={{ flexWrap: 'wrap' }}>
              <button onClick={signOut}>Sign out on this device</button>
              <PasswordTools />
            </div>
            {auth.access && <AccessChoice auth={auth} onChanged={refresh} />}
            <People />
          </>
        ) : auth.access?.login ? (
          <>
            <p className="sub first">You open this copy with the sign-in at its web address (Google, or a code sent to your email). There is no Ledger password.</p>
            <div className="add-actions" style={{ flexWrap: 'wrap' }}>
              <button onClick={signOut}>Sign out on this device</button>
              <button className="link" onClick={() => run('', async () => { const r = await api('/api/auth/signout-others', { method: 'POST' }); alert(r.signedOut ? `Signed out ${r.signedOut} other device${r.signedOut === 1 ? '' : 's'}.` : 'No other devices were signed in.'); })}>Sign out my other devices</button>
            </div>
            <small>Signing out here also signs this device out of the Google or email check, so the next visit asks for it again.</small>
            <p className="sub" style={{ marginTop: 14 }}>Add a Ledger password as a spare key. It is your way back in if the sign-in at the web address ever can't be confirmed, and it lets you give each adult a sign-in of their own:</p>
            <PasswordForm mode="setup" onDone={refresh} />
          </>
        ) : auth.ingress ? (
          <>
            <p className="sub first">Home Assistant signs you in, so Ledger needs no password of its own here. Add one only if you also want to open Ledger outside Home Assistant, at its own address: that address stays closed until a password is set.</p>
            <PasswordForm mode="setup" onDone={refresh} />
          </>
        ) : auth.thisMac ? (
          <>
            <p className="sub first">
              {s.networkOpen
                ? "Other devices on your Wi-Fi can open Ledger right now. Set a password before connecting your bank, so only you can see it."
                : 'Only this computer can open Ledger right now. A password is needed before you open it to your phone.'}
            </p>
            <PasswordForm mode="setup" onDone={refresh} />
            <small>There's no reset: if you forget it, the password has to be cleared on the computer that runs Ledger. Choose something you'll remember or save it in your password manager.</small>
          </>
        ) : (
          <p className="sub first">{auth.demo ? 'Passwords are switched off in the demo, so nobody can lock it. On your own copy this is where you set one, add a sign-in for each person, and add Face ID or a fingerprint.' : 'No password is set yet. Open Ledger on the computer that runs it, or on a device on the same home network, to create one.'}</p>
        )}
      </section>
      {s.passwordSet && <Passkeys />}
      </div>
      <Appearance />
      </div>

      <h3 className="group-title">Banks and accounts</h3>
      <Fold id="bank" title={<span className="sf-title"><img src={at('/logos/simplefin.png')} alt="" />SimpleFIN Sync</span>} note={s.connected ? 'Your banks are connected' : 'For your banks. Paste your setup token here'} startOpen={!s.connected}>
      <section className="card">
        <div className="card-head"><h2 className="sf-title"><img src={at('/logos/simplefin.png')} alt="" />SimpleFIN Sync</h2>{s.connected && <span className="good">Connected</span>}</div>
        {!s.connected ? (
          <>
            <p className="sub first">
              Ledger reads your banks through SimpleFIN Bridge, a separate service that costs $1.50 a month or $15 a year, paid to them. Your bank passwords are entered on their site and never reach Ledger.
              It is optional: without it you can still add purchases yourself or import files from your bank.
              {s.sampleData ? ' Your first sync replaces the sample data with your real accounts; your categories, budgets, and tax settings stay.' : ''}
            </p>
            <div className="key-guide">
              <ol>
                <li><b>Open SimpleFIN and make an account.</b> <a className="button" href="https://bridge.simplefin.org/" target="_blank" rel="noreferrer">Open SimpleFIN in a new tab</a></li>
                <li><b>Connect your banks there.</b> You sign in to each bank on SimpleFIN's site, not here.</li>
                <li><b>Still in SimpleFIN, make a setup token</b> for a new app, and copy it. It is one long line of letters and numbers, and it works once.</li>
                <li><b>Come back here and paste it into the box below</b>, marked "SimpleFIN setup token", then press Connect.</li>
              </ol>
            </div>
            <p className="sub">
              <b>Good to know before you sign up:</b> SimpleFIN visits each bank about once a day, so balances and new purchases can be up to 24 hours behind your bank's own app.
              Ledger shows when the bank's figures were last updated, and anything you add yourself counts straight away.
            </p>
            {needsPassword ? (
              <p className="advice">Set a password in the box above first. The box for your SimpleFIN setup token appears here once you have.</p>
            ) : (
              <form onSubmit={connect} noValidate className="token-form" data-go="bank-token">
                <label className="field"><span>SimpleFIN setup token</span>
                  <input type="text" value={token} autoComplete="off" spellCheck={false} placeholder="Paste the long token from SimpleFIN here" disabled={!!busy} onChange={(e) => { setToken(e.target.value); setErr(''); }} />
                </label>
                <button type="submit" className="primary" disabled={!!busy}>Connect</button>
              </form>
            )}
          </>
        ) : (
          <>
            <p className="sub first">
              {r ? `Last synced ${ago(r.at)}: ${r.added} new transaction${r.added === 1 ? '' : 's'} across ${r.accounts} account${r.accounts === 1 ? '' : 's'}.` : 'Not synced yet.'}{' '}
              Ledger syncs by itself about twice a day while it's running.
            </p>
            <div className="add-actions">
              <button className="primary" disabled={!!busy} onClick={() => run('Syncing…', () => api('/api/simplefin/sync', { method: 'POST' }))}>Sync now</button>
              <button disabled={!!busy} onClick={() => confirm('Disconnect SimpleFIN? Your accounts and transactions stay, but they stop updating.') && run('', () => api('/api/simplefin/disconnect', { method: 'POST' }))}>Disconnect</button>
            </div>
          </>
        )}
        {busy && <p className="sub" role="status">{busy}</p>}
        {err && <p className="error" role="alert">{err}</p>}
        {!err && s.lastError && <p className="error">The last automatic sync failed: {s.lastError}</p>}
        {r?.messages?.length > 0 && (
          <div className="advice">
            <p><b>Messages from SimpleFIN</b></p>
            {r.messages.map((m: string) => <p key={m}>{m}</p>)}
          </div>
        )}
      </section>
      </Fold>
      {s.accounts.length > 0 && (
        <Fold id="accounts" title="Synced accounts" note={`${s.accounts.length} account${s.accounts.length === 1 ? '' : 's'}: set each one's type`}>
        <section className="card">
          <div className="card-head"><h2>Synced accounts</h2></div>
          <p className="sub first">Check each account's type. It decides where the account appears and whether it counts as debt.</p>
          {s.accounts.map((a: any) => (
            <div key={a.id} className="row">
              <span className="grow">{a.name}<small>{a.institution}</small></span>
              <select value={a.type} aria-label={`Type of ${a.name}`} onChange={(e) => run('', () => api(`/api/accounts/${a.id}/type`, { method: 'PATCH', body: { type: e.target.value } }))}>
                {TYPES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
              <span className="num acct-bal">{cents(a.balance)}</span>
            </div>
          ))}
        </section>
        </Fold>
      )}
      {needsPassword ? null : <Fold id="currency" title="Currency" note={`Amounts are written in ${currencyCode()}`}><CurrencySettings /></Fold>}
      {needsPassword ? null : <Fold id="budget-month" title="Budget month" note={`Starts on ${budgetDayWords(budgetStartDay())}`}><BudgetMonth /></Fold>}
      {needsPassword ? null : <Fold id="import" title="Import a file" note="For accounts the bank connection can't reach, such as Apple Card"><ImportFile sampleData={s.sampleData} onDone={refresh} /></Fold>}

      {needsPassword ? null : <p className="sub"><button className="link" onClick={() => dispatchEvent(new Event('ledger-tour'))}>Take the tour</button> to be shown round the app. <button className="link" onClick={() => dispatchEvent(new Event('ledger-setup'))}>Open the setup guide</button> to go through your household, accounts, paydays and budgets step by step. <a href="#about">About Ledger</a> explains how everything works, and is where to ask for something or report a problem.</p>}

      {needsPassword ? null : <h3 className="group-title">Income</h3>}
      {needsPassword ? null : <Fold id="rules" title="What Ledger has learned" note="Rules for filing purchases and claiming them for tax"><Rules /></Fold>}
      {needsPassword ? null : <Fold id="export" title="Download your data" note={auth.ingress ? 'Every transaction as a spreadsheet file, and how Ledger is backed up' : 'Every transaction as a spreadsheet file'}>
        <section className="card">
          <div className="card-head"><h2>Download your data</h2></div>
          <p className="sub first">Every transaction in Ledger as a spreadsheet file (CSV) that opens in Excel, Numbers or Google Sheets: date, account, description, amount, category, note and any tax claim. For your own records, or to hand to whoever prepares your taxes.</p>
          <a className="button-link" href={at('/api/export/transactions.csv')} download>Download transactions</a>
          {auth.ingress ? (
            <div className="backup-note">
              <h3>Backing up everything</h3>
              <p className="sub">That file is only your transactions. The whole of Ledger (accounts, budgets, settings, receipts) is included in <b>Home Assistant's own backups</b>, so it is kept wherever those are kept. Three things worth doing in Home Assistant, under Settings, System, Backups:</p>
              <ol className="sub">
                <li><b>Switch on automatic backups</b>, so a recent copy always exists.</li>
                <li><b>Keep a copy off this machine.</b> If you subscribe to Home Assistant Cloud, it stores an encrypted copy of your latest backup for you. A network drive works too. A backup that lives only on this machine is lost with it.</li>
                <li><b>Leave encryption on, and save the encryption key</b> Home Assistant shows you somewhere safe. A backup holds your figures and any keys you saved in Ledger, and without that key an encrypted backup can't be opened again.</li>
              </ol>
              <p className="sub">To bring Ledger back, restore the backup in Home Assistant. Ledger pauses for the few seconds a backup takes, so the copy is whole.</p>
            </div>
          ) : !auth.canErase ? (
            <p className="sub">That file is only your transactions. Everything else lives in Ledger's data folder on the machine that runs it: copy that folder somewhere else now and then, and you have a full backup.</p>
          ) : null}
        </section>
      </Fold>}
      {needsPassword || !update?.offered ? null : <Fold id="updates" title="Updates" note={!update.on ? 'Checking is switched off' : update.newer ? `Ledger ${update.latest} is available` : `Running Ledger ${update.current}`}><UpdateSettings /></Fold>}
      {needsPassword || !auth.canErase ? null : <Fold id="erase" title="Delete everything" note="Wipe your copy of Ledger for good"><EraseEverything hasPassword={!!auth.passwordSet} /></Fold>}
      {needsPassword ? null : <Fold id="paydays" title="Paydays" note="When each paycheck arrives and how much it is"><Paydays /></Fold>}
      {needsPassword ? null : <Fold id="gig" title="Side gig" note={gig.on ? `${gig.name}: income with no tax taken out` : 'Income with no tax taken out, such as tutoring or deliveries'}><SideGig /></Fold>}

      {needsPassword || !(family?.configured || repoStats?.offered || flyStats?.offered) ? null : <h3 className="group-title">Sharing</h3>}
      {needsPassword || !family?.configured ? null : <Fold id="family" title="Family requests" note={family.open ? 'The request page is open' : 'Requests from family for their own copy'}><FamilyRequests /></Fold>}
      {needsPassword || !repoStats?.offered ? null : <Fold id="repo" title={<span className="sf-title"><GitHubMark />On GitHub</span>} note={repoStats.facts ? `${repoStats.facts.stars} stars, ${(repoStats.issues || []).filter((i: any) => i.open).length} open reports${repoStats.traffic ? `, ${repoStats.traffic.clones} downloads in 14 days` : ''}` : 'How the published copy is doing'}><RepoStats /></Fold>}
      {needsPassword || !flyStats?.offered ? null : <Fold id="demo-stats" title={<span className="sf-title"><img src={at('/logos/flyio.png')} alt="" />The public demo</span>} note={flyStats.connected ? `about $${flyStats.month.projected.toFixed(2)} this month, ${flyStats.month.requests.toLocaleString()} requests` : 'Its traffic and likely cost'}><DemoStats /></Fold>}

      {needsPassword ? null : <h3 className="group-title">Extras</h3>}
      {/* Not on a family copy: a phone's report can't pass the Cloudflare sign-in in front of its address. */}
      {needsPassword || auth.canErase || auth.ingress ? null : <Fold id="applepay" title="Apple Pay purchases" note="An iPhone reports each purchase as you pay, including Apple Card"><ApplePay /></Fold>}
      {needsPassword ? null : <Fold id="taxes-on" title="Tax section" note={taxesOn ? 'On: an estimate of US federal and state income tax' : 'Switched off'}>
        <section className="card">
          <div className="card-head"><h2>Tax section</h2>{taxesOn && <span className="good">On</span>}</div>
          <p className="sub first">The Taxes page estimates United States federal and state income tax. If you live somewhere else it has nothing useful to say: switch it off and it leaves the menu, and Ledger stops holding money back for tax in the forecast, asking for pay stubs and sending the January tax pack. Nothing you entered is lost, and you can switch it back on here.</p>
          <label className="row check"><span className="grow">Use the tax section</span><input type="checkbox" checked={taxesOn} onChange={(e) => setTaxes(e.target.checked)} /></label>
        </section>
      </Fold>}
      {needsPassword ? null : <Fold id="allowance" title="Allowances" note="A notebook of what you hold for each child"><AllowanceSwitch /></Fold>}
      {needsPassword ? null : <Fold id="email" title="Summary email" note="A short summary sent on the days you choose"><WeeklyEmail /></Fold>}
      {needsPassword ? null : <Fold id="alerts" title="Alerts" note="Emails when checking runs low, a bill is due or a budget tips over, and the pay stub reminder"><Alerts /></Fold>}
      {needsPassword ? null : <Fold id="tips" title="Feature of the week" note="One suggestion a week in the side menu, on a computer"><WeekTipSettings /></Fold>}
      {needsPassword || !auth.ingress ? null : <Fold id="ha-sensors" title="Home Assistant sensors" note="Optional: let automations react to bills, a low balance or budgets"><HaSensors /></Fold>}
      {needsPassword ? null : <Fold id="ai" title="AI recap and logos" note="Claude writes the recap, reads screenshots and finds logos"><AiRecap /></Fold>}
      {needsPassword || !gig.classes ? null : <Fold id="vipkid" title={`${gig.name} class calendar`} note="Reads your classes to work out each Friday's pay"><VipkidCalendar /></Fold>}
    </div>
  );
}

/**
 * Framing your own photo (The owner, 2026-11-23: "the ability to crop or align"). A small window the shape of
 * this device's screen shows the picture as it will sit behind the app; dragging it moves the picture, the
 * arrow keys nudge it, and the Zoom slider beside it crops in. Nothing is cut from the stored picture: only
 * the point kept in view and the zoom are remembered, on this device, so it can always be changed back.
 */
function PhotoFrame({ url, pic, onChange }: { url: string; pic: PhotoMeta; onChange: (c: Partial<PhotoMeta>) => void }) {
  const f = framing(pic);
  const box = useRef<HTMLDivElement>(null);
  const from = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const [drag, setDrag] = useState(false);
  const tall = typeof innerWidth === 'number' && innerHeight > innerWidth;
  const down = (e: React.PointerEvent) => { from.current = { px: e.clientX, py: e.clientY, x: f.x, y: f.y }; setDrag(true); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); };
  const move = (e: React.PointerEvent) => {
    const s0 = from.current, el = box.current;
    if (!s0 || !el) return;
    // Dragging the picture right brings its left side into view, so the point in view moves the other way.
    const r = el.getBoundingClientRect(), by = 100 / f.zoom;
    onChange({ x: Math.max(0, Math.min(100, Math.round(s0.x - ((e.clientX - s0.px) / r.width) * by))), y: Math.max(0, Math.min(100, Math.round(s0.y - ((e.clientY - s0.py) / r.height) * by))) });
  };
  const up = () => { from.current = null; setDrag(false); };
  const key = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2, d = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, number[]>)[e.key];
    if (!d) return;
    e.preventDefault();
    onChange({ x: Math.max(0, Math.min(100, f.x + d[0])), y: Math.max(0, Math.min(100, f.y + d[1])) });
  };
  const moved = f.x !== 50 || f.y !== 50 || f.zoom !== 1;
  return (
    <>
      <div ref={box} className={`photo-frame ${tall ? 'tall' : ''} ${drag ? 'drag' : ''}`} style={{ aspectRatio: `${innerWidth} / ${innerHeight}`, ['--fx' as any]: `${f.x}%`, ['--fy' as any]: `${f.y}%`, ['--fz' as any]: f.zoom }}
        role="img" tabIndex={0} aria-label="Your photo as it sits behind the app. Drag it, or use the arrow keys, to move it."
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}>
        <i style={{ backgroundImage: `url("${url}")` }} />
      </div>
      <small>This window is the shape of this screen. Drag the picture to move it into place, and zoom in below to crop closer.{moved && <> <button type="button" className="link" onClick={() => onChange({ x: 50, y: 50, zoom: 1 })}>Centre it again</button></>}</small>
    </>
  );
}
