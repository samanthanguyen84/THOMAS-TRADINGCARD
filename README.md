# Thomas's Card Shop 🎴

A card shop in your pocket. This app runs on your own computer and keeps track
of everything for your weekend card-show business: what cards you have, what
they're worth right now, what to charge for them, how much money you actually
made at each show, and it pings your Discord the moment a watched product comes
back in stock at Target, Best Buy, or Barnes & Noble.

**What it does:**

- **Price Lookup** — search any Pokémon card, see live market prices for every
  printing (holofoil, reverse holo, etc.) plus *your* asking price, and add
  copies straight into inventory.
- **Inventory** — every card you own, with quantity, what you paid, current
  market price, and your sell price. Sell or restock in two clicks.
- **Sales & Money** — every sale, purchase, expense, and cash adjustment.
  Delete a sale by mistake? Undo puts the cards back in inventory.
- **Shows** — tag sales and expenses to a show and see exact per-show profit
  (sales − cards bought − expenses − table fee).
- **Dashboard** — all-time profit, monthly bars, top sellers, inventory value.
- **Restock Watch** — watch retail products and get a Discord alert the moment
  they flip from out of stock to in stock.

## Quick start

You need [Node.js 18 or newer](https://nodejs.org) installed. Then, in this
folder, run these **one at a time** (copy a single line, press Enter, wait for
it to finish, then do the next):

```bash
npm run setup
```

```bash
npm run build
```

```bash
npm start
```

`npm run setup` is a one-time install (a few minutes). `npm run build` packages
the app, and `npm start` runs it.

> **Copy one line at a time, and don't paste the explanation text after a
> command.** Some terminals (zsh on Mac) treat the `#` in a trailing comment as
> part of the command and throw confusing errors like
> `Invalid tag name "#"`. Every command in this README is meant to be run on
> its own.

Optional: to load demo data so you can poke around before entering your real
cards, run this once before `npm start`:

```bash
npm run seed
```

Now open **http://localhost:3001** in your browser. That's it. Leave
`npm start` running while you want the app (and restock alerts) working.

For development (auto-reloading while editing code), use `npm run dev` instead
and open **http://localhost:5173**.

To check that everything works on your machine:

```bash
npm run test:e2e
```

This runs the whole app against fake versions of the price and retailer
services and verifies every feature end to end. You should see `50 passed`.

## Settings guide

Open the **Settings** page in the app:

- **Sell percentage** — your asking price as a percent of market price.
  Default is **80**, meaning a $100 card is priced at $80. Every "Your price"
  in the app uses this number.
- **Discord webhook URL** — where restock alerts get posted. In Discord:
  **Server Settings → Integrations → Webhooks → New Webhook**, pick a channel,
  then **Copy Webhook URL** and paste it here. Use the "Send test message"
  button to confirm it works.
- **Pokémon TCG API key** — powers Price Lookup. It works *without* a key, but
  a free key from <https://dev.pokemontcg.io> raises the rate limit a lot.
  Optional but recommended.
- **Best Buy API key** — required **only** if you want Best Buy restock
  watches. Free from <https://developer.bestbuy.com>.
- **Restock check interval** — how often watches are checked (minutes).

## How to find SKUs for restock watches

- **Target (TCIN):** open the product page and look at the URL — the TCIN is
  the number after `A-`. Example: `target.com/p/pokemon-etb/-/A-93954435` →
  TCIN is `93954435`.
- **Best Buy (SKU):** on the product page, the SKU is listed right on the page
  (near the model number, under "SKU").
- **Barnes & Noble (EAN/ISBN):** the 13-digit EAN or ISBN from the product
  page.

## Daily workflows

- **At a show, someone asks a price:** Price Lookup → type the card name →
  read them the gold "Your price" number.
- **Sold a card:** Inventory → find the card → **Sell** → it pre-fills your
  suggested price; pick the show so it counts toward that show's profit.
- **Bought a collection:** Price Lookup → search each card → **+ Add** with
  the quantity and what you paid. (Oddball cards with no listing: Inventory →
  "Add card manually".)
- **Spent money on gas / food / table fee:** Sales & Money → "Add expense" —
  tag it to the show.
- **How am I doing?** Dashboard for the big picture, Shows for per-show
  profit.
- **Fat-fingered a sale:** Sales & Money → Delete next to the transaction.
  The cards go back into inventory automatically.

## How restock alerts work

While the app is running, it checks each active watch on a loop (default every
**5 minutes**, configurable in Settings). It checks watches one at a time with
a couple of seconds between requests, so it's a polite guest on the retailers'
sites — please don't crank the interval below a few minutes.

An alert (and a Discord ping) fires **only when a product flips from
out-of-stock to in-stock** — you get one ping per restock, not a ping every
five minutes while it sits in stock. You can also hit **Check now** on any
watch to test it immediately.

## Troubleshooting

- **Price lookup says "service unavailable" (502):** the Pokémon TCG API is
  down or you're being rate limited. Wait a minute and retry; add a free API
  key in Settings to get much higher limits.
- **Best Buy watch shows "Error":** you almost certainly haven't added a Best
  Buy API key in Settings — it's required for Best Buy (and only Best Buy).
- **No restock alerts arriving:** the watcher only runs while the app is
  running — keep `npm start` running on a home PC that stays on. Also check
  the watch is toggled **Active** and use Settings → "Send test message" to
  verify the Discord webhook.
- **Page won't load:** make sure `npm start` is still running and you're on
  <http://localhost:3001>. If you just pulled new code, run `npm run build`
  again first.
- **`sh: vite: command not found` when building:** the install didn't finish
  (this usually happens when a command got pasted with its `#` comment and the
  install errored out partway). Just re-run the installer, then build again:

  ```bash
  npm run setup
  ```

  ```bash
  npm run build
  ```

- **`Invalid tag name "#"` or `unknown file attribute`:** your terminal swallowed
  a `#`-comment as part of the command. Re-run the bare command on its own line
  with nothing after it.
- **"critical/high severity vulnerabilities" after install:** these come from
  the development build tools (the dev launcher and Vite/esbuild), not from the
  running app or your data. They're safe to ignore. Do **not** run
  `npm audit fix --force` — it can upgrade the build tools to incompatible
  versions and break `npm run build`.
- **Want to verify the whole thing after a change:** `npm run test:e2e`.

## For the technically curious

- Backend: Express + better-sqlite3, `server/`, port 3001. Database file lives
  at `server/data/cards.db` (back this file up — it's your whole business).
- Frontend: React + Vite, `client/`. In production the Express server serves
  the built files from `client/dist`.
- API contract: `docs/API.md`.
- End-to-end tests: `scripts/e2e.mjs` (`npm run test:e2e`) — self-contained,
  uses a temp database and mock upstream services, touches nothing real.
