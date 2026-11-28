<p align="center"><img src="docs/readme/logo.svg" width="360" alt="Ledger"></p>

# Ledger

A household budget you run yourself. One small server, one SQLite file, no account with anyone:
your finances stay on a machine you own.

<p align="center">
  <a href="https://github.com/moeckjeremy/ledger-home-finance/releases/latest"><img src="https://img.shields.io/github/v/release/moeckjeremy/ledger-home-finance?label=release" alt="Latest release"></a>
  <img src="https://img.shields.io/badge/platforms-aarch64%20%7C%20amd64-555" alt="Runs on 64-bit ARM and PC">
  <img src="https://img.shields.io/badge/Home%20Assistant-App-18bcf2" alt="A Home Assistant app">
  <img src="https://img.shields.io/badge/Docker-ready--made%20image-2496ed" alt="A ready-made Docker image">
</p>

<p align="center"><a href="https://ledger-demo-ad6a24.fly.dev"><img src="docs/readme/try.svg" width="260" alt="Try the live demo"></a></p>
<p align="center"><sub>Nothing to install or sign up for. Every figure in the demo is made up, and whatever you change is wiped within the hour.<br>Bank sync, uploads and AI are switched off there; Ask your CFO shows example answers. It may take a couple of seconds to wake.</sub></p>

<p align="center"><a href="https://my.home-assistant.io/redirect/supervisor_addon/?addon=8b82984f_ledger&repository_url=https%3A%2F%2Fgithub.com%2Fmoeckjeremy%2Fledger-home-finance"><img src="https://my.home-assistant.io/badges/supervisor_addon.svg" alt="Show Ledger in my Home Assistant"></a></p>

<p align="center"><a href="#what-it-does">What it does</a> · <a href="#home-assistant-app">Home Assistant</a> · <a href="#docker-a-nas-a-home-server-or-your-own-computer">Docker</a> · <a href="#updating-a-docker-install">Updating</a> · <a href="#what-leaves-your-machine">What leaves your machine</a> · <a href="#license">License</a></p>

![Ledger's dashboard: what is left before payday, what is in checking, and spending against budget](docs/readme/dashboard.jpg)

<table>
  <tr>
    <td width="50%"><img src="docs/readme/budgets.jpg" alt="The Budgets page, with suggestions for covering a category that has gone over"></td>
    <td width="50%"><img src="docs/readme/debt.jpg" alt="The Debt page, with a payoff plan and a debt-free date"></td>
  </tr>
  <tr>
    <td align="center"><sub>Budgets, with a way to cover what has gone over</sub></td>
    <td align="center"><sub>A payoff plan for what you owe</sub></td>
  </tr>
  <tr>
    <td><img src="docs/readme/christmas.jpg" alt="The dashboard with the Christmas scene behind it"></td>
    <td><img src="docs/readme/light.jpg" alt="The dashboard in its light look"></td>
  </tr>
  <tr>
    <td align="center"><sub>Holiday scenes, if you want them</sub></td>
    <td align="center"><sub>Light or dark</sub></td>
  </tr>
</table>

<p align="center"><img src="docs/readme/phone.jpg" width="250" alt="Ledger on a phone"><br><sub>On a phone, added to the home screen</sub></p>

Every figure in these pictures is made up: it is the sample household a new copy starts with.

Ledger began as one family's replacement for a paid budgeting app and grew from there. It is a
personal project, shared as it is. It is not a product, and nobody is on call for it.

## What it does

- **Dashboard**: what is left before payday, what is in checking now, spending against budget.
- **Transactions**: from a bank connection, typed by hand, read from a receipt or statement, or
  imported from a file. Split a purchase across categories; leave one out; undo a removal.
- **Budgets**: a set amount for each category, or "give every dollar a job" (zero-based). Unspent
  money can carry over.
- **Recurring bills**: found in your transactions or added by hand on any rhythm, with a forecast of
  your checking balance through the next two paydays.
- **Debt**: a payoff plan, graphs of each debt heading to zero, standing extra payments, and what
  you have paid toward each this month.
- **Taxes**: a running estimate of federal income tax, self-employment tax and state income tax for
  the year, with pay stubs month by month, purchases that might be deductible, and a pack to hand to
  a tax preparer. **An estimate, not tax advice.**
- **Savings goals, investments** (balances, and prices if you switch them on), **statement checks**.
- **Ask your CFO** and other optional AI features, run on your own Anthropic API key, or, inside Home Assistant, on the AI you already have set up there (the basics; Claude by key does the most).
- Works on a phone and can be added to its home screen.

## Running it

### Docker (a NAS, a home server, or your own computer)

Ledger is published ready-made, for ordinary PCs and Macs (amd64) and for ARM machines such as a
Raspberry Pi or an Apple-silicon Mac (arm64). Nothing needs building. With
[Docker](https://www.docker.com/products/docker-desktop/) installed, one line starts it:

```bash
docker run -d --name ledger --restart unless-stopped -p 4317:4317 -v ledger-data:/data ghcr.io/moeckjeremy/ledger-home-finance:latest
```

Then open `http://localhost:4317` on that machine, or `http://<its address>:4317` from another device
on your network. A new copy starts with sample data so you can look around; your first bank
connection or import replaces it. Your data is kept in the Docker volume `ledger-data`.

New to Docker? [A two-page printable guide](docs/Ledger-on-your-computer.pdf) walks through installing it
on a Windows PC or a Mac with pictures, and reaching Ledger from your phone.

On your own computer Ledger only works while the computer is on and awake: bank syncs, the summary
email and alerts wait until it is.

### Updating a Docker install

Ledger looks at this page once a day and says on its dashboard when a newer version is out (nothing about
you is sent, and Settings, "Updates" switches it off). Settings, "Updates" also shows the version you are
running and these same steps at any time. To update, run these two lines one after the other. Your data is
kept: it lives in the `ledger-data` volume, not in the container.

```bash
docker rm -f ledger
```

```bash
docker run -d --pull always --name ledger --restart unless-stopped -p 4317:4317 -v ledger-data:/data ghcr.io/moeckjeremy/ledger-home-finance:latest
```

The first removes the old version and the second fetches the new one and starts it. Your data stays in the
volume. (They are two separate lines on purpose: the terminal in Docker Desktop on Windows does not accept
`&&`.) If you prefer Compose,
[`ledger/compose.yaml`](ledger/compose.yaml) does the same
(`docker compose up -d`; add `TZ=Your/Zone` to a `.env` file there for your time zone).
Without a time zone, Ledger takes
its own from the first browser that opens it; to fix one yourself, add `-e TZ=Your/Zone` before the
image's name.

Set a password in Settings before the port is reachable by anyone you would not show your finances
to. Ledger has no TLS of its own: put it behind a reverse proxy, a VPN such as Tailscale, or a
tunnel with its own sign-in if you want to reach it from outside your home.

### Home Assistant app

[![Show Ledger in my Home Assistant](https://my.home-assistant.io/badges/supervisor_addon.svg)](https://my.home-assistant.io/redirect/supervisor_addon/?addon=8b82984f_ledger&repository_url=https%3A%2F%2Fgithub.com%2Fmoeckjeremy%2Fledger-home-finance)

Press the button: it opens Ledger's own page in your Home Assistant, offering to add this repository
first if you haven't already. Press Install there, start it, and open it from the sidebar. Or do it by
hand: in Home Assistant go to Settings, Apps, Install app, and type **Ledger** in the search bar. If it
isn't listed, add this repository first (the ⋮ menu there, Repositories, paste this page's address) and
search again. It arrives ready-made for 64-bit machines (ARM and
PC); a 32-bit Home Assistant, such as one on an older Raspberry Pi, will not list it. See [the app's notes](ledger/DOCS.md).

The app asks for permission to call Home Assistant's API. Home Assistant offers no narrower permission
than that, so here is exactly what Ledger does with it: nothing at all unless you choose "The AI in your
Home Assistant" in Ledger's Settings, or one of your Home Assistant calendars for a side gig paid by booked
sessions, or switch on one of its optional sensors. Then it makes four calls and no others. Three only
read or ask: it lists your AI Tasks and calendars for a menu, it asks the AI Task you chose
(`ai_task.generate_data`), and it reads the events of the calendar you chose. The fourth writes, and only
Ledger's own sensors (`binary_sensor.ledger_...` and `sensor.ledger_...`, six in all, each off until you
switch it on in Ledger's Settings) so your automations can react to a bill due tomorrow or a low balance.
It cannot write anything else. The code is in `ledger/server/haai.js`.

### From source

To build the image yourself: `docker build -f ledger/Dockerfile.docker -t ledger ledger`. Or without Docker:

```bash
npm ci
npm run build
NODE_ENV=production LEDGER_DATA_DIR=./data PORT=4317 node server/index.js
```

Node 24 or newer (it uses Node's built-in SQLite).

## Settings you can pass in the environment

| Variable | What it does |
|---|---|
| `LEDGER_DATA_DIR` | Folder for the database. `/data` in the container. |
| `PORT`, `HOST` | Where to listen. 4317 and all addresses in the container. |
| `TZ` | Your time zone, so "today" and paydays are right. If it is not set, Ledger uses the time zone of the first browser that opens it. |
| `LEDGER_FRESH=1` | Start empty with the setup guide, in place of sample data. |
| `LEDGER_INGRESS=1` | Home Assistant app mode: trust requests from the Supervisor, allow framing. |
| `LEDGER_SETUP_CODE` | For a copy you host for another household: a one-time code they use to claim it. |
| `LEDGER_AI_KEY`, `LEDGER_AI_MONTHLY_LIMIT`, `LEDGER_AI_MODEL` | An Anthropic key the host pays for on such a copy, with a monthly ceiling. |

## What leaves your machine

Nothing, unless you switch it on:

- **Bank connection**: Ledger asks SimpleFIN Bridge (a separate paid service you sign up for) for
  your balances and transactions. Your bank password never reaches Ledger.
- **AI features**: what each one sends to Anthropic is described in the app (About, and Settings,
  "What has been sent to Claude"). Off until you add a key.
- **A booking calendar**, if you connect one for a side gig paid by the session: Ledger fetches that calendar's iCal address every few hours. Nothing is sent to it.
- **Logos**: to show a shop's logo, Ledger asks an icon service (Google's, then DuckDuckGo's) for the icon of that shop's website, once per shop. This happens with or without an AI key, and can be switched off in Settings, "AI recap and logos"; shops then show as a letter. If you paste a free [Logo.dev](https://logo.dev) key of your own under "Sharper logos" there, Ledger asks Logo.dev first, sending the same website name and your key, and shows proper company logos. The app ships with no key.
- **Investment prices**: ticker symbols only, off until switched on.
- **Summary email and alerts**: through a mail account you set up.

## The tax estimate

For tax year 2026. Federal figures follow IRS Rev. Proc. 2025-32. Arkansas is worked out in detail
from the state's own worksheet. Every other state uses one table of rates, standard deductions and
personal exemptions (the Tax Foundation's compilation as of January 1, 2026) and leaves out local
income taxes, each state's own credits, and more: see `server/states.js` for the list. The constants
need updating each January. Do not file from it.

## Notes for anyone reading the code

React, TypeScript and Vite in `src/`; one Express process in `server/` with Node's `node:sqlite`,
no ORM. Tables are created and migrated at start-up by the module that owns them. Amounts are
negative for money out. Some internal names (`vipkid`, `ar…`) are older than the features they now
serve.

Ledger was written with Claude, Anthropic's AI model, and uses the Claude API for its optional AI
features. It is not made, endorsed or supported by Anthropic.

## License

MIT. See `LICENSE`. Free to use, change and share; it comes with no warranty.
