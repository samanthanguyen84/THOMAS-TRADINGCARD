# Thomas Trading Card — API Contract

This document is the single source of truth for the backend API. Backend route
modules and the frontend are built against this contract. Do not deviate from
it without updating this file.

## Conventions

- Base URL: `http://localhost:3001` (dev). The Vite dev server proxies `/api` here.
- All bodies are JSON. All responses are JSON.
- Errors: appropriate HTTP status with body `{ "error": "human readable message" }`.
  - 400 for validation problems, 404 for missing resources, 502 for upstream
    (price API / retailer) failures.
- Money is stored and returned in dollars as numbers (e.g. `12.5`).
- Dates are ISO strings (`YYYY-MM-DD` or full ISO datetime). SQLite stores
  `datetime('now')` UTC strings.
- Route modules live in `server/routes/<name>.js` and `export default` an
  Express `Router`. They are mounted by `server/index.js` (already written):
  cards→`/api/cards`, transactions→`/api/transactions`, shows→`/api/shows`,
  reports→`/api/reports`, settings→`/api/settings`, prices→`/api/prices`,
  watches→`/api/watches`, alerts→`/api/alerts`.
- DB access: `import db, { getSetting, getAllSettings, setSettings } from '../db.js'`
  (better-sqlite3, synchronous prepared statements). Schema is already defined
  in `server/db.js` — read it.
- `GET /api/health` → `{ ok: true }` (already implemented in index.js).

## Domain background

Thomas sells trading cards at weekend card shows. He prices cards at a
percentage (default **80%**) of market price. He needs: fast price lookup,
inventory in/out tracking, financial reports (overall and per show), and
restock alerts for local retail stores (Target, Best Buy, Barnes & Noble)
delivered via Discord webhook.

---

## Cards (inventory) — `server/routes/cards.js`

Card object (DB row, returned as-is):
`{ id, name, set_name, card_number, variant, condition, quantity, cost_basis,
market_price, price_updated_at, image_url, tcg_card_id, notes, created_at }`

- `variant`: TCGplayer price variant key — `normal`, `holofoil`,
  `reverseHolofoil`, `1stEditionHolofoil`, `unlimitedHolofoil`, etc.
- `condition`: free text, default `NM` (NM/LP/MP/HP/DMG common).
- `cost_basis`: average cost **per unit** Thomas paid.
- `market_price`: last known market price per unit (nullable).

### `GET /api/cards?search=&sort=&order=`
List all cards. `search` does case-insensitive LIKE match on name/set_name/card_number.
`sort` ∈ `name|set_name|quantity|market_price|cost_basis|created_at` (default
`created_at`), `order` ∈ `asc|desc` (default `desc`). Returns
`{ cards: [...], count: <number of rows> }`.

### `POST /api/cards`
Body: `{ name (required), set_name?, card_number?, variant?, condition?,
quantity? (default 0, int ≥ 0), cost_basis? (default 0, ≥ 0), market_price?,
image_url?, tcg_card_id?, notes?, log_purchase? (default true), show_id?, date? }`
Creates the card. If `log_purchase` is true and `quantity > 0`, also inserts a
`purchase` transaction (`quantity`, `unit_price = cost_basis`,
`total = quantity * cost_basis`, optional `show_id`/`date`, description
`Bought <qty>x <name>`). Returns 201 with the card object.

### `GET /api/cards/:id` → card object or 404.

### `PATCH /api/cards/:id`
Body: any subset of card columns except `id`/`created_at`. Direct edit, no
transaction logging (for fixing typos/condition/notes/manual price). Validates
`quantity` int ≥ 0, prices ≥ 0. Returns updated card.

### `DELETE /api/cards/:id`
Deletes the card. Its transactions remain (card_id becomes NULL via FK).
Returns `{ ok: true }`.

### `POST /api/cards/:id/sell`
Body: `{ quantity (int ≥ 1), unit_price (≥ 0), show_id?, date?, notes? }`.
400 if `quantity` exceeds available stock. Decrements card quantity, inserts a
`sale` transaction (`total = quantity * unit_price`, description
`Sold <qty>x <name>` or the provided notes). Returns
`{ card, transaction }`.

### `POST /api/cards/:id/restock`
Body: `{ quantity (int ≥ 1), unit_cost (≥ 0), show_id?, date? }`.
Increments quantity and updates `cost_basis` to the weighted average:
`(old_qty*old_cb + qty*unit_cost) / (old_qty + qty)`. Inserts a `purchase`
transaction. Returns `{ card, transaction }`.

### `POST /api/cards/:id/refresh-price`
No body. Requires the card to have `tcg_card_id` (400 otherwise). Calls
`getCardPrices(tcgCardId)` from `../services/prices.js`, picks the price for
the card's `variant` (fall back to the first variant that has a market price),
updates `market_price` + `price_updated_at`. Returns the updated card.
502 if the price service fails.

---

## Transactions — `server/routes/transactions.js`

Transaction object:
`{ id, type, card_id, show_id, quantity, unit_price, total, description, date,
created_at }` — `type` ∈ `purchase|sale|expense|adjustment`. Totals are stored
as **positive** numbers; `type` determines direction in reports
(sale = money in; purchase/expense = money out; adjustment = signed, may be
negative, for corrections/cash adjustments).

### `GET /api/transactions?type=&from=&to=&show_id=&card_id=&limit=`
Newest first (by `date`). `from`/`to` filter on `date` (inclusive; `to` of
`YYYY-MM-DD` must include that whole day). `limit` default 200. Each row is
joined with `card_name` (nullable) and `show_name` (nullable). Returns
`{ transactions: [...], count }`.

### `POST /api/transactions`
Body: `{ type (required), total (required number), description?, card_id?,
show_id?, quantity?, unit_price?, date? }`. For manual entries — table fees,
gas, food, cash adjustments. Does **not** touch card quantities. Returns 201
with the transaction.

### `PATCH /api/transactions/:id`
Edit an existing transaction without touching inventory. Accepts any subset of
`show_id` (integer to assign, `null`/`""` to clear — 400 if the show doesn't
exist), `description`, `date` (non-empty), `unit_price` (≥ 0), and `total`
(≥ 0 unless the transaction is an `adjustment`). 400 on any other field or an
empty body, 404 if the transaction doesn't exist. Returns the updated
transaction joined with `card_name`/`show_name`. The primary use is attaching a
sale to a show after the fact. `type`, `card_id`, and `quantity` are not
editable (they have inventory implications — delete and re-create instead).

### `DELETE /api/transactions/:id`
Undo. If the transaction is linked to an existing card: a deleted `sale`
returns its quantity to inventory; a deleted `purchase` removes the quantity
(floor at 0). Returns `{ ok: true }`.

---

## Shows — `server/routes/shows.js`

Show object: `{ id, name, date, venue, table_fee, notes, created_at }`.

### `GET /api/shows`
Newest first by `date`. Each show includes computed fields: `sales_total`,
`purchases_total`, `expenses_total` (sums of linked transactions; expenses do
NOT automatically include `table_fee`), and
`net = sales_total - purchases_total - expenses_total - table_fee`.
Returns `{ shows: [...] }`.

### `POST /api/shows`
Body: `{ name (required), date?, venue?, table_fee?, notes? }` → 201 with show.

### `GET /api/shows/:id`
Show + computed fields above + `transactions: [...]` (joined with `card_name`).

### `PATCH /api/shows/:id` / `DELETE /api/shows/:id`
Standard. Deleting a show keeps its transactions (show_id → NULL).

---

## Reports — `server/routes/reports.js`

### `GET /api/reports/summary?from=&to=`
Date range filters transactions only (defaults: all time). Returns:
```json
{
  "sales_total": 0, "purchases_total": 0, "expenses_total": 0,
  "adjustments_total": 0, "net_profit": 0,
  "sales_count": 0, "cards_sold": 0,
  "inventory": {
    "unique_cards": 0, "total_quantity": 0,
    "cost_value": 0, "market_value": 0, "asking_value": 0
  },
  "sell_percentage": 80
}
```
`net_profit = sales - purchases - expenses + adjustments`. Inventory is the
current snapshot (not date filtered): `cost_value = Σ qty*cost_basis`,
`market_value = Σ qty*market_price` (skip null prices), `asking_value =
market_value * sell_percentage/100`.

### `GET /api/reports/monthly?months=12`
Last N months including current. Returns `{ months: [ { month: "2026-06",
sales, purchases, expenses, net }, ... ] }` oldest first; include months with
no activity as zeros.

### `GET /api/reports/top-cards?limit=10`
Best sellers by sale revenue. `{ top_cards: [ { card_id, name, set_name,
qty_sold, revenue, profit }, ... ] }` where `profit = revenue − qty_sold *
cost_basis` (current cost basis; null card_id sales excluded).

---

## Settings — `server/routes/settings.js`

Keys (all values stored as strings): `sell_percentage`, `discord_webhook_url`,
`pokemontcg_api_key`, `bestbuy_api_key`, `watch_poll_minutes`,
`gemini_api_key` (free Google Gemini key — preferred photo-scan provider),
`anthropic_api_key` (paid photo-scan fallback), `scan_model` (Claude model id,
default `claude-opus-4-8`), `scan_model_gemini` (Gemini model id, default
`gemini-2.5-flash`).

### `GET /api/settings` → flat object of all keys.
### `PUT /api/settings`
Body: partial object of known keys (400 on unknown keys; validate
`sell_percentage` is a number 1–100 and `watch_poll_minutes` ≥ 1). Returns the
full updated settings object.

### `POST /api/settings/test-discord`
Sends a test message via `sendDiscordMessage` from `../services/discord.js`
using the stored webhook URL. Returns `{ ok: true }` or 502 + `{ error }`.

### `POST /api/settings/test-scan`
Validates the configured photo-scan key with a tiny call (Gemini if
`gemini_api_key` is set, else Anthropic). Returns `{ ok: true, provider }`, 400
if no key is set, or 502 + `{ error }` carrying the **provider's real error
message** (e.g. Google's "API key not valid…") so the user can see exactly why a
key was rejected. Backed by `testScanProvider()` in `../services/scan.js`; scan
failures on `POST /api/prices/scan` surface the same provider message.

---

## Prices — `server/routes/prices.js` + `server/services/prices.js`

Backed by the Pokémon TCG API (`https://api.pokemontcg.io/v2`), which embeds
TCGplayer prices. Base URL must be overridable via env `POKEMONTCG_BASE_URL`
(for tests and mocks). API key header `X-Api-Key` from setting
`pokemontcg_api_key` when non-empty. Responses cached in `price_cache` table,
TTL 12 hours (cache key = full upstream URL/query). Upstream timeout 15s.

`server/services/prices.js` must export:
- `searchCards({ q, page = 1, pageSize = 20 })` → `{ cards, page, totalCount }`
- `getCardPrices(tcgCardId)` → one normalized card or `null` if not found
- Both throw `Error` with `.status = 502` on upstream failure.

Normalized card shape (built from pokemontcg.io `card` objects):
```json
{
  "tcg_card_id": "base1-4", "name": "Charizard",
  "set_name": "Base", "set_id": "base1", "card_number": "4",
  "rarity": "Rare Holo", "release_date": "1999/01/09",
  "image_url": "https://images.pokemontcg.io/base1/4.png",
  "tcgplayer_url": "https://...",
  "prices": { "holofoil": { "low": 100, "mid": 200, "high": 400, "market": 220.5, "directLow": null } }
}
```
`prices` comes from `card.tcgplayer.prices` (may be `{}` if absent).

### `GET /api/prices/search?q=&page=&pageSize=`
400 if `q` empty. The query is parsed into a name and an optional collector
number (so `pikachu 051/162` or `charizard 4` work): upstream query is
`name:"*<name>*"` plus a `number:` clause (tolerant of leading zeros) when a
number is present, ordered by `-set.releaseDate`. If the number matches nothing
the service retries name-only so the vendor still sees candidates. Upstream
calls are retried once on timeout/5xx (the Pokémon TCG API is flaky mid-Scrydex-
migration). Returns
`{ cards: [normalized + "suggested": { <variant>: round(market * pct/100, 2) }],
page, totalCount, sell_percentage }` (pct from settings at request time).
`searchCards` and `parseQuery` are exported from `server/services/prices.js`.

### `GET /api/prices/card/:tcgCardId`
Single card, same normalized shape + `suggested` + `sell_percentage`.
404 if upstream says not found, 502 on upstream failure.

### `POST /api/prices/scan`
Identify a card from a photo, then price it. Body: `{ image }` where `image` is
a data URL (`data:image/jpeg;base64,…`) or raw base64 (with optional
`media_type`). Backed by `server/services/scan.js`, which picks a vision
provider by which key is set: **Google Gemini** (`gemini_api_key`, free tier —
preferred) via the REST `generateContent` endpoint, otherwise **Anthropic
Claude** (`anthropic_api_key`, paid). Base URLs are overridable via env
`GEMINI_BASE_URL` / `ANTHROPIC_BASE_URL` for tests. The identified name+number
feed the number-aware search above.
The model returns `{ found, name, set_name, card_number }` (structured output);
when `found` and a `name` are present, the route runs `searchCards(name)` and
returns `{ identified, cards: [normalized + suggested], page, totalCount,
sell_percentage }` (same card shape as `/search`). When nothing is recognized
it returns the same shape with `cards: []`. 400 if no image is supplied or no
Anthropic key is configured; 502 on a vision-API failure or a rejected key.
Clients should downscale photos before upload (the server accepts up to a 12 MB
JSON body).

---

## Restock watches — `server/routes/watches.js`, `server/routes/alerts.js`, `server/services/watcher.js`

Watch object: `{ id, retailer, sku, product_name, zip_code, store_id, active,
last_status, last_checked, last_error, created_at }`.
`retailer` ∈ `target|bestbuy|barnesnoble`. `last_status` ∈
`unknown|in_stock|out_of_stock|error`. `active` is 0/1.

### `GET /api/watches` → `{ watches: [...] }` newest first.
### `POST /api/watches`
Body: `{ retailer (required, validated), sku (required), product_name?,
zip_code?, store_id? }` → 201 with watch.
### `PATCH /api/watches/:id` — any of `product_name, zip_code, store_id,
active, sku`. Returns updated watch.
### `DELETE /api/watches/:id` → `{ ok: true }` (cascades alerts).
### `POST /api/watches/:id/check`
Runs the retailer check immediately, persists `last_status/last_checked/
last_error`, fires alert + Discord on out→in transition (same logic as the
loop). Returns the updated watch.

### Alerts — `server/routes/alerts.js`
Alert: `{ id, watch_id, message, seen, created_at }` (+ joined `retailer`,
`product_name`, `sku` from the watch).
- `GET /api/alerts?unseen=1&limit=50` → `{ alerts: [...] }` newest first.
- `POST /api/alerts/mark-seen` body `{ ids?: number[] }` (all unseen if
  omitted) → `{ ok: true, updated: n }`.

### Watcher service — `server/services/watcher.js`
- `export function startWatcher()` — interval loop using setting
  `watch_poll_minutes` (re-read each cycle); checks all `active` watches with a
  ~2s stagger between requests (be a polite client).
- `export async function checkWatch(watch)` — dispatches to a per-retailer
  checker, returns `{ status: 'in_stock'|'out_of_stock'|'unknown'|'error',
  detail?: string }`, persists results. On transition from non-`in_stock` to
  `in_stock`: insert an alert row and send a Discord message (webhook from
  settings) like `🚨 RESTOCK: <product_name or sku> is IN STOCK at <retailer>
  — <link>`.
- Retailer checkers (each overridable base URL via env for testing):
  - **Target** (`TARGET_BASE_URL`, default `https://redsky.target.com`): use the
    public redsky web API (`/redsky_aggregations/v1/web/pdp_fulfillment_v1` or
    product summary endpoint with the well-known public web key) with `tcin=sku`;
    derive status from availability fields. If the response shape is
    unrecognized → `unknown`.
  - **Best Buy** (`BESTBUY_BASE_URL`, default `https://api.bestbuy.com`):
    official products API `/v1/products(sku=<sku>)?apiKey=<key>&format=json`
    using setting `bestbuy_api_key`; status from `onlineAvailability`. If no
    key configured → `error` with explanatory `last_error`.
  - **Barnes & Noble** (`BN_BASE_URL`, default
    `https://www.barnesandnoble.com`): fetch `/w/?ean=<sku>` product page and
    use text heuristics (add-to-cart vs out-of-stock markers). Best effort;
    unrecognized → `unknown`.
- All checkers: 15s timeout, catch network errors → status `error` with message.

---

## Seed data — `server/seed.js`

`npm run seed` (run from repo root) populates a demo dataset: ~10 realistic
Pokémon cards with quantities/cost/market prices, 2 shows, a spread of
purchase/sale/expense transactions across the last 3 months, 2 watches, 1
alert. Safe to run on an existing DB (it just inserts more rows); prints a
summary. Uses the same `db.js`.
