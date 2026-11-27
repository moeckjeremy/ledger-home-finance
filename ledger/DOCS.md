# Ledger

A household budget that lives on your own machine: accounts, spending, bills, a checking forecast,
a debt payoff plan and a running estimate of federal and state income tax.

## Starting

1. Install the app and start it. It arrives ready-made, so this takes about a minute.
   Ledger runs on 64-bit machines only (a Raspberry Pi 4 or 5 or another 64-bit ARM board, or an ordinary
   64-bit PC). On a 32-bit system, such as an older Pi, Home Assistant does not list it in the store.
2. Open **Ledger** from the sidebar. A short setup guide asks about your household, accounts and paydays.
   You can skip it and come back to it from Settings.

Home Assistant signs you in, so Ledger asks for no password of its own in the sidebar. **Every Home
Assistant administrator can open Ledger; other users can't.** Home Assistant shows apps (it used to call them add-ons) to
administrators only, and hiding the panel from someone's sidebar is a preference they can undo, not a
lock. If someone you would not show your finances to is an administrator, make them a regular user first,
or don't install Ledger there.

## Getting your money in

- **By hand.** Add accounts and type purchases. Nothing leaves your machine.
- **Bank connection (optional).** Ledger reads balances and transactions through SimpleFIN Bridge, a
  separate paid service (about $15 a year, paid to them). Figures run about a day behind.
- **Files.** A CSV export from your bank, or a PDF or photo of a statement.

## AI features (optional)

Ledger works without any AI. If you want the extras, Settings, "AI recap and logos" offers two ways:

- **The AI in your Home Assistant.** If you have an AI set up under Home Assistant's Settings, Devices &
  services (Anthropic, OpenAI, Google, Ollama and others provide an "AI Task"), Ledger can use it: no second
  key, and with a model on your own machine nothing leaves the house. This gives the basics: the dashboard
  recap, category suggestions, and a CFO that answers from your month's figures. Only Claude has been tried
  with it; other models may read less well.
- **An Anthropic key of your own.** Ledger talks to Claude directly, which is what it was built around and
  works best. This gives everything: the basics, plus reading receipts, statements and pay stubs, finding
  and drawing logos, and the full CFO, which looks things up in your data and on official tax sites and can
  suggest changes. You pay Anthropic for what you use.

Either way Ledger sends only what each job needs, Settings lists what has been sent, and you can keep
chosen categories away from the AI. The app asks for permission to call Home Assistant for three things only, and
only if you choose them: that AI Task, reading one of your Home Assistant calendars for a side gig paid
by booked sessions (Settings, "Side gig"), and the optional sensors below. It lists your AI Tasks and
calendars, asks the AI Task, reads the calendar you picked, and writes its own sensors if you switch them
on. It changes nothing else in Home Assistant.

## Sensors for automations

Off until you switch them on, one at a time, in Ledger's Settings under "Home Assistant sensors":

| Sensor | Says |
|---|---|
| `binary_sensor.ledger_bill_due_tomorrow` | on the day before a bill comes out of checking (attribute `bills`: how many) |
| `binary_sensor.ledger_checking_low` | on when checking is forecast below the amount you set |
| `binary_sensor.ledger_budget_over` | on when a category is over budget this month (attribute `categories`) |
| `sensor.ledger_days_to_payday` | a number of days |
| `sensor.ledger_left_before_payday` | a dollar figure (unit USD) |
| `sensor.ledger_budget_used` | a percentage |

The first three say yes or no, with no names or amounts. The last two put a number from your finances
into Home Assistant. Anything switched on can be seen by **every Home Assistant login, not only
administrators**: ordinary users, guests and wall displays can read it in the interface, in history and
through Home Assistant's API, even though only administrators can open Ledger itself. Choose with that
in mind. Ledger refreshes them every five minutes. They are
plain states without a device, so they come back a few minutes after Home Assistant restarts, and a
sensor you switch off reads "unavailable" until the next restart.

An example automation:

```yaml
alias: Bill due tomorrow
triggers:
  - trigger: state
    entity_id: binary_sensor.ledger_bill_due_tomorrow
    to: "on"
actions:
  - action: notify.notify
    data:
      message: A bill comes out of checking tomorrow.
```

## If it ever stops

On the app's Info tab, switch on **Watchdog**. Home Assistant then starts Ledger again by itself if it
stops answering. It is off until you switch it on.

## Using it outside the sidebar

To add Ledger to a phone's home screen or post purchases to it from a Shortcut, give it a port under
the app's **Network** settings. Set a Ledger password first (Settings, Password): without one,
Ledger refuses everything that doesn't come through Home Assistant.

## Your data

One SQLite file in the app's `/data` folder. Removing the app removes it.

### Backing it up

Ledger is included in Home Assistant's own backups, so it is kept wherever those are kept. Under
**Settings → System → Backups** in Home Assistant:

- Switch on automatic backups.
- Keep a copy off this machine. Home Assistant Cloud, if you subscribe, stores an encrypted copy of
  your latest backup; a network drive works too.
- Leave encryption on and save the encryption key somewhere safe. A backup holds your figures and
  any keys you saved in Ledger, and an encrypted backup can't be opened without that key.

To bring Ledger back, restore the backup in Home Assistant. Ledger is stopped for the few seconds a
backup takes, so the copy is whole. "Download your data" in Ledger's Settings is only a spreadsheet
of transactions, not a full backup.

## The tax estimate

An estimate for the current tax year, not tax advice. Federal figures are worked out in detail.
Arkansas is worked out in detail; other states use a simpler table of rates, deductions and
exemptions and leave out local income taxes and each state's own credits. Check with a tax preparer
before relying on it.
