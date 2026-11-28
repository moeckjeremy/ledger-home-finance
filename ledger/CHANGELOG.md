# Changelog

## 0.1.38

- Your balance on every day ahead. On the Recurring page's calendar, each coming day shows your
  projected checking balance at the end of that day, worked out from the bills, card payments and
  paychecks Ledger knows about, with the lowest day pointed out. A tick box takes your usual everyday
  spending off as well.
- Test a purchase. Under the calendar, type an amount and a day to see what it would do to the days
  ahead and whether checking would run low. Nothing is saved.
- Amounts that change on a day. When you know the rent goes up in March or a raise starts in January,
  "Its amount is changing" on a bill (Recurring) or a payday (Settings, Paydays) takes the new amount
  and the day it starts. Nothing changes before that day; from it on, the forecast and the bills
  calendar use the new figure.
- Adding a vehicle is one step. Choosing "Lower it a little each month" in "Add an account by hand" now
  asks its model year, kind, how well the model holds its value and (optionally) the odometer right
  there, and "Add it" sets everything up. Before, a second panel opened afterwards and asked how its
  value is kept all over again. A year in the name, such as "2020 RAV4", fills in the model year.

## 0.1.37

- Sharper logos, if you want them. Without a key, a shop's logo is the small icon from its website.
  Settings, "AI recap and logos", "Sharper logos" now takes a free Logo.dev key of your own, and with
  one Ledger shows proper company logos instead. It walks you through getting the key and checks it
  before keeping it. What it sends is each shop's website name and your key, to Logo.dev; nothing about
  your purchases. Nothing changes unless you add a key.

## 0.1.36

- Home Assistant now calls add-ons apps, and Ledger's pages and notes say so too. Nothing about
  installing or updating has changed.
- A budget month that starts on a day you choose. If your money works around payday on the 20th, say,
  set that at the foot of the Budgets page ("When your budget month starts") or in Settings, "Budget
  month". Budgets, what is spent and left, the pace line, carry-over, planning the next month, reports
  by month, the recap, the summary email and budget alerts follow it; taxes, bill dates, the checking
  forecast and net worth stay on real dates. It is the 1st unless you change it.
- Your home, vehicles and other property in your net worth. On the Accounts page, "Add an account
  by hand" has "A home, vehicle or other property": type what it is worth and update it when you like.
  As you add it, and later under "How its value is kept", you choose between two ways. Type it in: a button opens Zillow in your
  own browser, and nothing is sent anywhere. Or, for a home in the United States, look it up each
  month: Ledger asks RentCast for an estimate once a month, using a free key you make there yourself.
  That sends the home's address to RentCast and keeps it in your Ledger; it is off unless you set it
  up, and typing a value yourself switches it off again.
- A vehicle's value can lower itself each month. Type what the car is worth today and Ledger lowers
  it a little each month so it isn't frozen until you next update it. It is an estimate, not a Kelley
  Blue Book value; a button opens Kelley Blue Book for checking it, and typing a new figure restarts
  the lowering from there. Nothing is sent anywhere.
- The setup guide can add a vehicle whose value lowers itself: tick "It's a vehicle" beside its
  name and value.
- The rate a vehicle's value is lowered at is now worked out from its model year, its kind (car, SUV,
  pickup, hybrid or electric) and, once there are odometer readings, its real mileage, using averages
  from the Bureau of Labor Statistics and iSeeCars. A particular model can differ a lot from its kind,
  so a rate of your own still works. It remains an estimate, not a Kelley Blue Book value.
  You also say how well the model holds its value (well, about average, poorly), which matters more
  than its kind.
  The figures were fitted to used-vehicle values looked up by hand for about thirty popular models:
  about 8% a year at one and two years old, 10% from three to six and 13.5% after, a quarter less
  for a model that holds its value well and half more for one that does not.
  "Where does this figure come from?" shows the sum for your vehicle, the studies behind it and how
  to compare it with Kelley Blue Book.
- A vehicle's model year and kind can be filled in from its VIN, if you choose. That sends the VIN,
  and nothing else, to the U.S. vehicle safety agency's free decoder; Ledger does not keep it.
- Mileage from the pump. After a fuel receipt is read, your CFO asks what the odometer says (it can
  be skipped), and a vehicle's "How its value is kept" panel has a box for it too. Once two readings
  are a couple of months apart, Ledger works out the miles a year and uses that for how fast the
  vehicle's value is lowered, unless you set a rate of your own. Readings stay in your copy.
- Where the money went, on the Reports page: one month as a single picture. Money in on the left,
  each kind of spending and what was left over on the right, each band as thick as its amount.
- A calendar view of bills on the Recurring page, with each bill on its day and paydays marked.
  Choose a day to see what is due, or to add a bill on that day right there.
- Feature of the week. On a computer, a small card under "Ask your CFO" in the side menu names one
  thing you could use and haven't set up yet: only what applies to your household, a new one each
  Monday. "Tell me more" opens a short description with "Show me" and "Ignore". Once opened it is put
  away until the next Monday, and "Ignore" stops that suggestion for good. It isn't shown on a phone.
  Settings, "Feature of the week" switches it off, and "Show me another feature of the week" there
  points you at one straight away, on any device.
- "Add an account by hand" is at the top of the account list on the Accounts page, not the foot.
- The logo's fade at the end of its loop is one solid shape, in the app and on the project's page.
- The setup guide's accounts step can add a home or vehicle, and the guided tour mentions the new
  calendar, pay links, payoff comparison, property and the money-flow picture.

## 0.1.35

- Try a different plan, on the Debt page. Smallest balance first (the order the page follows) and
  highest rate first are shown side by side, each with the month you'd be clear and the interest from
  here. Two boxes try another monthly extra or a one-time amount. It changes nothing and doesn't say
  which order is better.
- Months of expenses covered, on the Accounts page: your savings divided by your usual monthly
  spending (the average of the last three finished months). An account set aside for taxes is left out.
- Hide names from the AI (Settings, "AI recap and logos"). Off until switched on. The recap and Ask
  your CFO are then sent plain labels in place of the household's names, employers, side gigs, accounts
  and banks, and the real names are put back in the answer. Amounts, dates, shops and bills still go.
- Demo mode, for showing Ledger publicly with made-up figures: a copy started with `LEDGER_DEMO=1`
  needs no sign-in, refuses anything that brings in real data, sets a password, sends email or calls
  an AI, and wipes whatever visitors change within the hour. Ask your CFO there shows example
  questions with answers written ahead of time, and says so. Does nothing unless that is set.
- A live demo with made-up figures is linked from the project's page on GitHub.
- Reading a receipt shows your CFO's owl reading it, then a sentence saying where you shopped, what
  for, how much and on which account, above the details you can correct. Nothing is added until you
  press Add, as before.
- A pay link on a bill (Recurring page): save the address of the company's own payment page and
  "Pay it" opens it in a new tab. Ledger never pays anything; it only saves you finding the page.

## 0.1.34

- Security: the library Ledger sends email with (nodemailer) is updated from 7.0.13 to 10.6.1, which
  closes a list of published advisories. Ledger only sends email to addresses the household typed in
  Settings or on the Taxes page, so the risk was small, but there is no reason to stay on the old one.
- Every address an email is sent to is now checked once more just before sending, and anything that is
  not one plain address is refused.

## 0.1.33

- Categories in your own order. On the Budgets page the arrows beside a category (or "⋯" on a phone)
  move it up or down within its list, and every category menu in the app follows the same order.
  Nothing filed in a category changes.
- Organise, beside each category: move it between flexible spending and fixed bills, put it in a group
  of your own (Giving, Food, Kids…), merge it into another category so its history goes with it, or
  hide one you no longer use without losing its past.
- Plan next month before it starts. "Plan next month's budget" at the top of the Budgets page opens the
  coming month; amounts typed there begin on the 1st and this month is left alone. Works with both ways
  of budgeting.
- A category can be left out of the budget (Organise, "Leave it out of the budget"): for work expenses
  you are paid back for, and the like. What is filed there counts in no budget, total or report, and
  the Budgets page shows what went out and what came back.
- Accounts and savings goals can be moved up and down. Goals that share an account are filled from the
  top, so their order decides which is filled first.
- On a phone, the dashboard's cards can be put in your own order ("Choose what shows here").
- Updating is easier to find: Settings, "Updates" shows the steps at any time (Docker installs), the
  About guide explains updating for each kind of install, and the project page has its own heading for it.
- Ask your CFO how to do something in Ledger ("can I plan next month's budget?") and it names the page
  and the button. It is given a short map of the app with each question, on both AI routes.
- The About guide can be searched. Type what you are after and it lists the pages that cover it, with
  the sentence it was found in. It works without any AI.
- Settings has a search box at the top. Type your own word for something ("bank", "dark", "backup")
  and it lists where that is changed; choosing one opens it. The sections a device opens most often
  are kept one tap away under the box. That count stays on the device.

## 0.1.32

- Paydays for people who are retired or on benefits. When you add a payday you now say what it is: a
  paycheck from a job, Social Security or other benefits, a pension, or other regular income. Only a
  job is ever asked for a pay stub. For the others Ledger says plainly that the money counts as income
  but is not in the tax estimate unless you enter it yourself, with a link to where that is done.
- Paydays now points to Side gig for pay with no tax taken out.

## 0.1.31

- Fixed for plain Docker: a new copy could never set its password. Settings said to open Ledger "on the
  Mac that runs it", and with no password most of Settings stayed hidden, including the bank connection,
  the AI key and Updates. A browser on the computer that runs Docker, or on the same home network, can
  now set the first password. Nothing changes inside Home Assistant or on a copy that already has one.

## 0.1.30

- Currency: Settings, "Currency" (and the setup guide's first step) lets a household choose the money it
  uses, from 22 currencies. Every amount is then written with that symbol, in the app, in the summary
  email and alerts, and in what the AI features are told. It changes how amounts are written only:
  nothing is converted, and a household has one currency. US dollars stay the default.
- Fixed for plain Docker on Windows: the two lines that update Ledger no longer use `&&`, which the
  terminal in Docker Desktop on Windows refuses. Updating is now `docker rm -f ledger`, then the start
  line with `--pull always`. If your copy's own "How to update" box still shows a line with `&&`, use
  the two lines in the README instead.

## 0.1.29

- Links that say where a setting is now take you to the setting itself: the right section opens, the
  exact box or switch is brought into view, and it is ringed for a moment so you can see which one is
  meant. "Turn on AI", "Connect your bank", the "needs AI" messages and every "Show me" under What's
  new all work this way.

## 0.1.28

- About, "Ask for something or report a problem": on a copy you run yourself, this now opens this
  project's issues page on GitHub, where reports are read. Before, what you typed was saved on your own
  copy and reached nobody. Nothing is sent from Ledger; the button only opens the page.

## 0.1.27

- Ledger run with plain Docker now says on the dashboard when a newer version is out, with what changed
  and the two lines that update it. It looks at this project's page on GitHub once a day, sends nothing
  about your household, and can be switched off in Settings, "Updates". Nothing changes inside Home
  Assistant, which already offers updates itself.

## 0.1.26

- An account can be left out of the budget (Accounts page, "Leave out of the budget"): its balance still
  shows, and its spending stops counting toward budgets and totals. Made for personal "fun money"
  accounts and children's accounts.

## 0.1.25

- Ledger started with plain Docker and no time zone now takes its time zone from the first browser that
  opens it, so "today" is your today and not world time. Home Assistant already gives Ledger the house's
  time zone, so nothing changes there.

## 0.1.24

- Ledger now arrives ready-made. Home Assistant downloads a finished image in place of building it on
  your own machine, so installing and updating take about a minute, not ten or more on a small computer.
- For plain Docker there is a ready-made image too, started with one line (see the README).

## 0.1.23

- A page left open from before an update no longer goes blank: it reloads itself once when its files have been replaced.

## 0.1.22

- The bank section in Settings is now "SimpleFIN Sync", with SimpleFIN's logo beside it.

## 0.1.21

- On a phone, the "filed under Other" card on Transactions no longer squeezes its words into a narrow strip.
- A copy hosted behind a web sign-in with no Ledger password can reach the bank token box and the rest of Settings (this never affected the add-on).

## 0.1.20

- Settings, "Bank connection" is now "Bank connection (SimpleFIN)", with numbered steps and a full-width box plainly marked "SimpleFIN setup token".

## 0.1.19

- Sensors: the page and these notes now say plainly that a sensor you switch on can be read by every Home Assistant login, not only administrators.
- A sensor with nothing to report says what it needs (a checking account, a payday, a budget).
- The number sensors carry units and classes, so Home Assistant can graph them and keep statistics. "Left before payday" is in USD.
- Switching off a sensor that was never on no longer creates it in Home Assistant.

## 0.1.18

- Optional sensors for your automations: a bill due tomorrow, checking forecast to run low, a budget over, days until payday, what is left before payday, and budget used. Each is off until you switch it on in Settings, "Home Assistant sensors".

## 0.1.17

- Settings, "Download your data" and these notes now explain how Ledger is backed up: it is part of Home Assistant's own backups, which can keep an encrypted copy off your machine.

## 0.1.16

- The first Ledger password can only be set from inside Home Assistant. A port you open yourself can never be used to claim the copy.

## 0.1.15

- Setup guide, first step: on a computer the Save button lines up with its boxes, and the closing sentence reads correctly.

## 0.1.14

- Answering "which job was this deposit for?" only accepts money in, and says so plainly when it is sent something else.

## 0.1.13

- A job is now matched to money you typed in yourself, such as cash in hand: a deposit that carries the gig's words counts even when it was filed as plain Income, and is moved under the gig once matched.
- Reading a calendar with no word filter no longer keeps its events' titles, only their times.
- Home Assistant is asked for your calendars only while a gig is set to "By booked sessions".
- Clearer message when a chosen Home Assistant calendar can't be read, and a note when the forecast has nothing to estimate from.
- The notes say how to switch on Watchdog.

## 0.1.12

- Every side gig can now say how it pays (Settings, "Side gig"): the average of its deposits as before; about the same each week or month; booked sessions read from a calendar at your own rate; or jobs you type in with what you expect and when.
- A booking calendar can be one of your Home Assistant calendars, with nothing to paste, or a private iCal address. For the first, the add-on reads that calendar's events from Home Assistant: a third call, read-only like the other two.
- The forecast uses a labelled estimate past your last booked session and in weeks with no job typed in.
- Jobs past their pay day move to "Owed to you" and stay until you say what happened; the dashboard mentions them.
- A deposit close to a job's amount ticks it off only when it is the one job it could be; otherwise Ledger asks.
- With no budgets set, an AI-written recap no longer reports spending against "a $0 budget".
- Fetching shops' logos from the internet can be switched off in Settings, "AI recap and logos", and the setup guide's last step says so and offers the switch.
- If Ledger stops answering, Home Assistant now starts it again.
- Everyone who installs this version builds from the same pinned base.
- The notes are corrected on who can open Ledger: Home Assistant administrators, and nobody else.

## 0.1.11

- With no debts recorded, the recap no longer mentions a debt-free date or a mortgage.
- The basic CFO sees the Cash account in the same list as your other accounts.

## 0.1.10

- The basic CFO now sees your Cash account as well, so what it says agrees with the Accounts page.
- An answer from Home Assistant that Ledger can't read is reported in Ledger's own words.

## 0.1.9

- Tightened how Ledger uses its permission to call Home Assistant: its token only ever goes to Home Assistant itself, only two calls can be made with it (listing the AI Tasks, and asking one), and the chosen AI is checked to be an AI Task before every call.
- Settings shows the AI as "On" when Home Assistant's AI is in use.

## 0.1.8

- A second way to the AI features: Ledger can use the AI already set up in your Home Assistant (its AI Task), with no second key. Choose it in Settings, "AI recap and logos". It gives the basics: the dashboard recap, category suggestions and a CFO that answers from your month's figures. An Anthropic key of your own still gives everything, and works best.
- For this the add-on now asks for permission to call Home Assistant. It uses it for the AI Task only, and only if you switch that on.
- With a model that isn't Claude, the CFO is your "Chief Financial Officer".

## 0.1.7

- The state menu has "Not in the United States", in the setup guide and on the Taxes page. Choosing it switches the tax section off; choosing a state later switches it back on.
- The setup guide follows that choice: it leaves out the questions about filing taxes and passes over its Taxes step.
- The setup guide's welcome now says the copy lives on your own machine.
- "Suggest budgets for me" works on a new copy again, with or without an AI key: from your spending once a month of it is in, otherwise from your paydays.

## 0.1.6

- No state is assumed any more. The Taxes page asks you to choose yours first, from a map of the United States or a list, and shows nothing else until you do.
- Not in the United States? The tax section can be switched off, on that first screen or in Settings, "Tax section". It leaves the menu, and Ledger stops holding money back for tax and asking for pay stubs.

## 0.1.5

- Ledger now stops cleanly when Home Assistant asks it to (a backup, an update, a restart). Before, it was shut off after a ten-second wait and showed as "error" for a moment during backups.
- This changelog.

## 0.1.4

- A new copy starts on the plain look. The holiday and season scenes are still in Settings, Appearance.

## 0.1.3

- A new copy starts with no budgets set, and the dashboard's summary says so, in place of starter amounts nobody chose.
- Added a clock check, so you can see which time zone Ledger is working by.

## 0.1.2

- "Today" in the checking estimate always follows your Home Assistant's time zone.
- The Apple Pay section is hidden here, since it cannot work inside Home Assistant.
- The guided tour leaves out the stop about adding Ledger to a phone's home screen.
- Home Assistant pauses Ledger for the few seconds a backup takes, so the database is always copied whole.

## 0.1.1

- Settings now shows every section straight away. Home Assistant signs you in, so no Ledger password is needed; before, most of Settings stayed hidden until one was set.

## 0.1.0

- First version as a Home Assistant add-on: opens from the sidebar, keeps its data in the add-on's own folder, and opens no network port unless you choose one.
