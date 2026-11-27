// "Feature of the week": the small card under Ask your CFO in the side menu (server/highlights.js picks
// what it says). A computer only: the side menu doesn't exist on a phone, and the card isn't even asked
// for there, so a week's feature is never used up on a screen that can't show it.
import { useState } from 'react';
import { api, useData } from './lib';
import { goTo } from './go';
import { Modal } from './ui';

/** The card, where there is room for it: a window too short to show it doesn't ask for one either. */
export function WeekTip() {
  const room = typeof matchMedia !== 'function' || !matchMedia('(max-height: 850px), (max-width: 760px)').matches;
  return room ? <WeekTipCard /> : null;
}

function WeekTipCard() {
  const { data, reload } = useData<any>('/api/highlight');
  // The feature whose pop-up is open. Kept here because opening it puts the card away for the week, and
  // the pop-up has to outlast the card.
  const [open, setOpen] = useState<any>(null);
  const tip = data?.tip;
  const tell = (path: string, id: string) => api(path, { method: 'POST', body: { id } }).catch(() => { /* it is asked again next time */ }).then(reload);
  const more = () => { setOpen(tip); tell('/api/highlight/seen', tip.id); };
  return (
    <>
      {tip && !open && (
        <aside className="week-tip" aria-label="Feature of the week" data-go="week-tip">
          <small className="week-tip-kicker">Feature of the week</small>
          <b>{tip.title}</b>
          <div className="week-tip-acts"><button type="button" onClick={more}>Tell me more</button></div>
        </aside>
      )}
      {open && <TipPopup tip={open} onClose={() => { setOpen(null); reload(); }} note={'Either way this is put away until Monday, when a different feature is suggested. "Ignore" also means this one is never suggested again.'} />}
    </>
  );
}

/** The pop-up for one feature: its description, "Show me" and "Ignore". Used by the card and by Settings. */
function TipPopup({ tip, onClose, note }: { tip: any; onClose: () => void; note: string }) {
  const ignore = () => { api('/api/highlight/ignore', { method: 'POST', body: { id: tip.id } }).catch(() => { /* asked again another time */ }); onClose(); };
  return (
    <Modal title={tip.title} onClose={onClose}>
      <p className="week-tip-kicker">Feature of the week</p>
      <p className="week-tip-text">{tip.text}</p>
      <div className="add-actions">
        <button type="button" className="primary" onClick={() => { onClose(); goTo(tip.go); }}>Show me</button>
        <button type="button" title="Don't suggest this one again" onClick={ignore}>Ignore</button>
      </div>
      <p className="sub">{note}</p>
    </Modal>
  );
}

/** Settings: the whole thing on or off, a way to bring back the ones that were ignored, and another one now. */
export function WeekTipSettings() {
  const { data, reload } = useData<any>('/api/highlight');
  const [note, setNote] = useState('');
  const [tip, setTip] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  const put = async (body: object, said: string) => { await api('/api/highlight', { method: 'PUT', body }); setNote(said); reload(); };
  const another = async () => {
    setBusy(true); setNote('');
    try { const r = await api('/api/highlight/another', { method: 'POST' }); if (r.tip) setTip(r.tip); else setNote("There's nothing else to suggest right now: you've set up, or ignored, everything Ledger would point you to."); }
    catch (e: any) { setNote(e.message); }
    setBusy(false); reload();
  };
  return (
    <div data-go="week-tip-switch">
      <p className="sub first">Each Monday, the side menu on a computer names one thing in Ledger you could use and haven't set up yet, under "Ask your CFO". "Tell me more" opens a short description with "Show me" and "Ignore". Once you've opened it, it is put away until the next Monday, and "Ignore" stops that suggestion for good. It only suggests what applies to your household, and it isn't shown on a phone.</p>
      <label className="hint-every"><input type="checkbox" checked={data.on} onChange={(e) => put({ on: e.target.checked }, e.target.checked ? 'On.' : 'Off. Nothing will be suggested.')} /> Suggest a feature each week</label>
      <div className="add-actions">
        <button type="button" className="primary" disabled={busy} data-go="week-tip-another" onClick={another}>Show me another feature of the week</button>
        <button type="button" onClick={() => put({ forget: true }, 'The ones you ignored can be suggested again.')}>Suggest the ones I ignored again</button>
      </div>
      <p className="sub">"Show me another" works any day, and on a phone too: it picks the next thing that applies to you and opens it here.</p>
      {note && <p className="sub good" role="status">{note}</p>}
      {tip && <TipPopup tip={tip} onClose={() => setTip(null)} note={'Press the button again for a different one. "Ignore" means this one is never suggested again.'} />}
    </div>
  );
}
