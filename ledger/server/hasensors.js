// Sensors for Home Assistant (2026-11-24, the owner: "set it up as sensor that can be turned on or off. So if
// people choose to use it with automations, they can, or can turn that feature off").
//
// Only where Ledger runs as a Home Assistant add-on. Every sensor is OFF until the household switches that
// one on in Settings, "Home Assistant sensors". A sensor that is on is written to Home Assistant every five
// minutes (and at once when something is switched), so automations and dashboards there can use it:
//
//   binary_sensor.ledger_bill_due_tomorrow    on when a bill comes out of checking tomorrow
//   binary_sensor.ledger_checking_low         on when checking is forecast below the chosen amount
//   binary_sensor.ledger_budget_over          on when a category is over its budget this month
//   sensor.ledger_days_to_payday              a number of days
//   sensor.ledger_left_before_payday          a dollar figure
//   sensor.ledger_budget_used                 a percentage
//
// The first three say yes or no and carry a count, never a name or an amount. The last two of the second
// three are figures, and the page says so: anything written to Home Assistant can be seen by everyone who
// uses that Home Assistant and is kept in its history. Switching one off writes "unavailable" over it once
// and then leaves it alone; Home Assistant forgets it at its next restart.
//
// This is the add-on's fourth permitted call to Home Assistant and the only one that writes anything
// (server/haai.js, haPublish): it can write these six entities and no others.
//
//   settings   ha_sensors (a JSON list of the ids switched on), alert_low (shared with the email alerts)
import { getSetting, setSetting, iso } from './db.js';
import { periodOf } from './period.js';
import { findAlerts } from './alerts.js';
import { outlook } from './cashflow.js';
import { haOffered, haPublish } from './haai.js';

const SENSORS = [
  { id: 'bill_due_tomorrow', entity: 'binary_sensor.ledger_bill_due_tomorrow', name: 'A bill is due tomorrow', hint: 'On the day before a bill comes out of checking. Says yes or no, and how many.', icon: 'mdi:calendar-alert' },
  { id: 'checking_low', entity: 'binary_sensor.ledger_checking_low', name: 'Checking is forecast to run low', hint: 'On when checking is forecast to fall below the amount below before the next payday. Says yes or no.', icon: 'mdi:bank-minus' },
  { id: 'budget_over', entity: 'binary_sensor.ledger_budget_over', name: 'A budget is over', hint: 'On when a category has gone over its budget this month. Says yes or no, and how many.', icon: 'mdi:chart-box-outline' },
  // unit and extra are what Home Assistant needs to graph a number and keep statistics for it.
  { id: 'days_to_payday', entity: 'sensor.ledger_days_to_payday', name: 'Days until payday', hint: 'A number of days.', icon: 'mdi:calendar-clock', unit: 'd', extra: { device_class: 'duration', state_class: 'measurement' } },
  { id: 'left_before_payday', entity: 'sensor.ledger_left_before_payday', name: 'Left before payday', hint: 'What checking is forecast to hold just before the next payday.', icon: 'mdi:cash', unit: 'USD', extra: { state_class: 'measurement' }, figure: true },
  { id: 'budget_used', entity: 'sensor.ledger_budget_used', name: 'Budget used this month', hint: 'Spending so far as a share of the month\'s budgets.', icon: 'mdi:percent', unit: '%', extra: { state_class: 'measurement' }, figure: true },
];
const BY_ID = new Map(SENSORS.map((s) => [s.id, s]));

const chosen = () => { try { const a = JSON.parse(getSetting('ha_sensors', '[]')); return Array.isArray(a) ? a.filter((x) => BY_ID.has(x)) : []; } catch { return []; } };
const low = () => Number(getSetting('alert_low', '100')) || 0;

let summary = null;   // handed over by server/index.js: the month's totals
const last = {};      // what was last written for each sensor, and whether it worked

/** What each sensor says right now. 'unknown' where Ledger has nothing to go on yet. */
function values() {
  let alerts = [], o = null, s = null;
  try { alerts = findAlerts(); } catch { /* nothing to report */ }
  try { o = outlook(); } catch { /* no accounts yet */ }
  try { s = summary ? summary(periodOf()) : null; } catch { /* no month yet */ }
  const has = !!(o && o.accounts.length);
  const due = alerts.filter((a) => a.key.startsWith('due:')).length;
  const over = alerts.filter((a) => a.key.startsWith('over:')).length;
  // `needs` says, for the page, why a sensor has nothing to report yet.
  const account = has ? '' : 'a checking account', payday = has ? (o.nextPayday ? '' : 'a payday') : 'a checking account';
  return {
    bill_due_tomorrow: { state: has ? (due ? 'on' : 'off') : 'unknown', attributes: { bills: due }, needs: account },
    checking_low: { state: has ? (alerts.some((a) => a.key.startsWith('low:')) ? 'on' : 'off') : 'unknown', attributes: {}, needs: account },
    budget_over: { state: over ? 'on' : 'off', attributes: { categories: over }, needs: '' },
    days_to_payday: { state: has && o.nextPayday ? o.daysToPayday : 'unknown', attributes: {}, needs: payday },
    left_before_payday: { state: has ? Math.round((o.nextPayday ? o.beforePayday : o.lowest.balance) * 100) / 100 : 'unknown', attributes: {}, needs: account },
    budget_used: { state: s && s.budget > 0 ? Math.round((s.spent / s.budget) * 100) : 'unknown', attributes: {}, needs: s && s.budget > 0 ? '' : 'a budget' },
  };
}

/** Writes every chosen sensor to Home Assistant. Never throws: a Home Assistant that is restarting is tried again in five minutes. */
export async function publishSensors() {
  if (!haOffered()) return;
  const on = chosen();
  if (!on.length) return;
  const now = values();
  for (const id of on) {
    const s = BY_ID.get(id), v = now[id];
    try {
      await haPublish(s.entity, String(v.state), { friendly_name: `Ledger: ${s.name}`, icon: s.icon, ...(s.unit && v.state !== 'unknown' ? { unit_of_measurement: s.unit, ...(s.extra || {}) } : {}), ...v.attributes });
      last[id] = { state: v.state, needs: v.state === 'unknown' ? v.needs : '', at: Date.now(), error: '' };
    } catch (e) { last[id] = { ...(last[id] || {}), error: String(e?.message || 'It could not be written.').slice(0, 200) }; }
  }
}

/** One sensor switched off: say so in Home Assistant once, so a stale "on" doesn't sit there. */
async function retire(id) {
  const s = BY_ID.get(id);
  delete last[id];
  try { await haPublish(s.entity, 'unavailable', { friendly_name: `Ledger: ${s.name}`, icon: s.icon }); } catch { /* it goes at Home Assistant's next restart anyway */ }
}

const view = () => {
  const on = new Set(chosen());
  return { offered: haOffered(), low: low(), sensors: SENSORS.map((s) => ({ id: s.id, entity: s.entity, name: s.name, hint: s.hint, figure: !!s.figure, on: on.has(s.id), state: on.has(s.id) ? last[s.id]?.state ?? null : null, needs: on.has(s.id) ? last[s.id]?.needs || '' : '', error: on.has(s.id) ? last[s.id]?.error || '' : '' })) };
};

export function installHaSensors(app, sources) {
  summary = sources?.summaryFor || null;
  app.get('/api/ha/sensors', (_req, res) => res.json(view()));
  app.put('/api/ha/sensors', async (req, res) => {
    if (!haOffered()) return res.status(400).json({ error: "This copy of Ledger isn't running inside Home Assistant, so it has no Home Assistant to tell." });
    const b = req.body || {};
    if (b.low !== undefined) {
      const n = Number(b.low);
      if (!Number.isFinite(n) || n < 0 || n > 1e7) return res.status(400).json({ error: 'Enter the amount as a number.' });
      setSetting('alert_low', String(Math.round(n * 100) / 100));
    }
    if (b.id !== undefined) {
      if (!BY_ID.has(b.id)) return res.status(400).json({ error: "Ledger has no sensor by that name." });
      const on = new Set(chosen()), was = on.has(b.id);
      if (b.on) on.add(b.id); else on.delete(b.id);
      setSetting('ha_sensors', JSON.stringify(SENSORS.map((s) => s.id).filter((id) => on.has(id))));
      // Only a sensor that was on is told to read "unavailable": writing that for one that never existed
      // would create it in Home Assistant (found by the NAS session's test, 2026-11-24).
      if (!b.on && was) await retire(b.id);
    }
    await publishSensors();
    res.json(view());
  });
  if (haOffered()) {
    // Not unref'd: these timers are part of what the server is for. LEDGER_HA_SENSORS_EVERY (ms) is for tests.
    const every = Math.max(1000, Number(process.env.LEDGER_HA_SENSORS_EVERY) || 5 * 60_000);
    setTimeout(() => publishSensors().catch(() => {}), Math.min(30_000, every));
    setInterval(() => publishSensors().catch(() => {}), every);
  }
}
