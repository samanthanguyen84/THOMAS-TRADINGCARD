#!/usr/bin/env node
// End-to-end test for Thomas Trading Card.
//
// Self-contained: creates a temp database, starts mock upstreams (Pokemon TCG
// API, Target/Best Buy/Barnes & Noble retailers, Discord webhook) on ephemeral
// ports, boots the real server as a child process with env overrides, runs
// every endpoint in docs/API.md plus the integration flows, then tears it all
// down. Exits 0 on success, 1 on any failure.
//
// Run from the repo root: npm run test:e2e

import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'thomas-e2e-'));
const DB_MAIN = path.join(TMP_DIR, 'main.db');
const DB_SEED = path.join(TMP_DIR, 'seed.db');

// Make sure a later dynamic import of server/db.js (used for the one direct
// DB write the watcher-loop test needs) opens the main temp DB.
process.env.DB_PATH = DB_MAIN;

// ---------------------------------------------------------------------------
// Tiny test harness
// ---------------------------------------------------------------------------

const results = [];

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  PASS  ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err });
    const msg = String(err && err.message ? err.message : err)
      .split('\n')
      .join('\n        ');
    console.log(`  FAIL  ${name}\n        ${msg}`);
  }
}

function skip(name, reason) {
  results.push({ name, ok: true, skipped: reason });
  console.log(`  SKIP  ${name} (${reason})`);
}

function approx(actual, expected, label) {
  assert.ok(
    typeof actual === 'number' && Math.abs(actual - expected) < 0.005,
    `${label}: expected ~${expected}, got ${actual}`
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, { timeout = 20_000, interval = 150, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    let value = null;
    try {
      value = await fn();
    } catch {
      // keep polling
    }
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeout}ms waiting for ${label}`);
    await sleep(interval);
  }
}

// ---------------------------------------------------------------------------
// Mock upstreams
// ---------------------------------------------------------------------------

function jsonOut(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function startMock(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port, url: `http://127.0.0.1:${port}` });
    });
  });
}

// --- Pokemon TCG API mock (pokemontcg.io v2 shape) -------------------------

const TCG_FIXTURES = [
  {
    id: 'base1-4',
    name: 'Charizard',
    number: '4',
    rarity: 'Rare Holo',
    set: { id: 'base1', name: 'Base', releaseDate: '1999/01/09' },
    images: {
      small: 'https://images.pokemontcg.io/base1/4.png',
      large: 'https://images.pokemontcg.io/base1/4_hires.png',
    },
    tcgplayer: {
      url: 'https://prices.pokemontcg.io/tcgplayer/base1-4',
      updatedAt: '2026/06/10',
      prices: {
        holofoil: { low: 100, mid: 200, high: 400, market: 220.5, directLow: null },
        unlimitedHolofoil: { low: 90, mid: 180, high: 350, market: 201.25, directLow: null },
      },
    },
  },
  {
    id: 'sv3pt5-6',
    name: 'Charizard ex',
    number: '6',
    rarity: 'Double Rare',
    set: { id: 'sv3pt5', name: '151', releaseDate: '2023/09/22' },
    images: {
      small: 'https://images.pokemontcg.io/sv3pt5/6.png',
      large: 'https://images.pokemontcg.io/sv3pt5/6_hires.png',
    },
    tcgplayer: {
      url: 'https://prices.pokemontcg.io/tcgplayer/sv3pt5-6',
      updatedAt: '2026/06/10',
      prices: {
        holofoil: { low: 60, mid: 85, high: 150, market: 89.99, directLow: 79.99 },
      },
    },
  },
  {
    id: 'smp-SM210',
    name: 'Charizard GX',
    number: 'SM210',
    rarity: 'Promo',
    set: { id: 'smp', name: 'SM Black Star Promos', releaseDate: '2018/01/01' },
    images: {
      small: 'https://images.pokemontcg.io/smp/SM210.png',
      large: 'https://images.pokemontcg.io/smp/SM210_hires.png',
    },
    // No tcgplayer block at all -> normalized prices must be {}.
  },
  {
    id: 'base1-58',
    name: 'Pikachu',
    number: '58',
    rarity: 'Common',
    set: { id: 'base1', name: 'Base', releaseDate: '1999/01/09' },
    images: {
      small: 'https://images.pokemontcg.io/base1/58.png',
      large: 'https://images.pokemontcg.io/base1/58_hires.png',
    },
    tcgplayer: {
      url: 'https://prices.pokemontcg.io/tcgplayer/base1-58',
      updatedAt: '2026/06/10',
      prices: {
        normal: { low: 0.5, mid: 1.5, high: 5, market: 1.85, directLow: 0.99 },
      },
    },
  },
  {
    id: 'sv2-185',
    name: 'Iono',
    number: '185',
    rarity: 'Ultra Rare',
    set: { id: 'sv2', name: 'Paldea Evolved', releaseDate: '2023/06/09' },
    images: {
      small: 'https://images.pokemontcg.io/sv2/185.png',
      large: 'https://images.pokemontcg.io/sv2/185_hires.png',
    },
    tcgplayer: {
      url: 'https://prices.pokemontcg.io/tcgplayer/sv2-185',
      updatedAt: '2026/06/10',
      prices: {
        normal: { low: 0.15, mid: 0.35, high: 2, market: 0.21, directLow: 0.18 },
        reverseHolofoil: { low: 0.4, mid: 0.8, high: 3, market: 0.65, directLow: 0.5 },
      },
    },
  },
];

const tcgState = { fail: false };

function tcgHandler(req, res) {
  if (tcgState.fail) {
    return jsonOut(res, 500, { error: 'mock upstream is down' });
  }
  const u = new URL(req.url, 'http://mock');
  if (u.pathname === '/v2/cards') {
    const q = u.searchParams.get('q') || '';
    const m = q.match(/name:"\*?([^*"]*)\*?"/);
    const term = (m ? m[1] : q).toLowerCase();
    const matches = TCG_FIXTURES.filter((c) => c.name.toLowerCase().includes(term)).sort((a, b) =>
      (b.set.releaseDate || '').localeCompare(a.set.releaseDate || '')
    );
    const page = Number(u.searchParams.get('page')) || 1;
    const pageSize = Number(u.searchParams.get('pageSize')) || 20;
    const data = matches.slice((page - 1) * pageSize, page * pageSize);
    return jsonOut(res, 200, { data, page, pageSize, count: data.length, totalCount: matches.length });
  }
  const single = u.pathname.match(/^\/v2\/cards\/(.+)$/);
  if (single) {
    const card = TCG_FIXTURES.find((c) => c.id === decodeURIComponent(single[1]));
    if (!card) return jsonOut(res, 404, { error: 'Card not found' });
    return jsonOut(res, 200, { data: card });
  }
  jsonOut(res, 404, { error: 'not found' });
}

// --- Retailer mock (Target redsky / Best Buy products API / B&N page) ------

const retailState = { stock: new Map() }; // `${retailer}:${sku}` -> boolean

function setStock(retailer, sku, inStock) {
  retailState.stock.set(`${retailer}:${sku}`, inStock);
}

function inStock(retailer, sku) {
  return retailState.stock.get(`${retailer}:${sku}`) === true;
}

function retailHandler(req, res) {
  const u = new URL(req.url, 'http://mock');

  if (u.pathname === '/redsky_aggregations/v1/web/pdp_fulfillment_v1') {
    const tcin = u.searchParams.get('tcin');
    const available = inStock('target', tcin);
    return jsonOut(res, 200, {
      data: {
        product: {
          __typename: 'Product',
          tcin,
          fulfillment: {
            is_out_of_stock_in_all_store_locations: !available,
            shipping_options: {
              availability_status: available ? 'IN_STOCK' : 'OUT_OF_STOCK',
              loyalty_availability_status: available ? 'IN_STOCK' : 'OUT_OF_STOCK',
              available_to_promise_quantity: available ? 32 : 0,
            },
          },
        },
      },
    });
  }

  const bb = u.pathname.match(/^\/v1\/products\(sku=([^)]+)\)$/);
  if (bb) {
    const sku = decodeURIComponent(bb[1]);
    const available = inStock('bestbuy', sku);
    return jsonOut(res, 200, {
      from: 1,
      to: 1,
      total: 1,
      products: [
        {
          sku: Number(sku) || sku,
          name: `Mock Best Buy product ${sku}`,
          onlineAvailability: available,
          inStoreAvailability: false,
        },
      ],
    });
  }

  if (u.pathname === '/w/') {
    const ean = u.searchParams.get('ean');
    const available = inStock('barnesnoble', ean);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(
      available
        ? `<html><body><h1>Mock B&amp;N product ${ean}</h1><button class="add-to-cart">ADD TO CART</button></body></html>`
        : `<html><body><h1>Mock B&amp;N product ${ean}</h1><p>Out of Stock Online</p></body></html>`
    );
    return;
  }

  jsonOut(res, 404, { error: 'not found' });
}

// --- Anthropic Messages API mock (vision card scan) ------------------------

// mode: 'found' returns a Charizard identification; 'notfound' returns found:false;
// 'fail' returns a 500 so the scan route surfaces a 502.
const anthropicState = { mode: 'found', calls: 0 };

function anthropicHandler(req, res) {
  if (req.method !== 'POST') return jsonOut(res, 404, { error: 'not found' });
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    anthropicState.calls += 1;
    if (anthropicState.mode === 'fail') {
      return jsonOut(res, 500, { type: 'error', error: { type: 'api_error', message: 'mock anthropic down' } });
    }
    const card =
      anthropicState.mode === 'notfound'
        ? { found: false, name: '', set_name: '', card_number: '' }
        : { found: true, name: 'Charizard', set_name: 'Base', card_number: '4' };
    jsonOut(res, 200, {
      id: 'msg_e2e',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-4-8',
      stop_reason: 'end_turn',
      stop_sequence: null,
      content: [{ type: 'text', text: JSON.stringify(card) }],
      usage: { input_tokens: 12, output_tokens: 12 },
    });
  });
}

// 1x1 transparent PNG, as a data URL — stand-in for a card photo.
const SAMPLE_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// --- Discord webhook mock ---------------------------------------------------

const discordState = { posts: [] };

function discordHandler(req, res) {
  if (req.method === 'POST' && req.url.startsWith('/webhooks/')) {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      let content = null;
      try {
        content = JSON.parse(body).content;
      } catch {
        // record the raw body if it wasn't JSON
        content = body;
      }
      discordState.posts.push({ content, at: Date.now() });
      res.writeHead(204);
      res.end();
    });
    return;
  }
  jsonOut(res, 404, { error: 'not found' });
}

// ---------------------------------------------------------------------------
// App server child processes
// ---------------------------------------------------------------------------

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

let mockEnv = {}; // filled once the mocks are listening

async function startApp({ dbPath, watcher = false }) {
  const port = await freePort();
  const env = {
    ...process.env,
    ...mockEnv,
    DB_PATH: dbPath,
    PORT: String(port),
  };
  if (watcher) {
    delete env.DISABLE_WATCHER;
  } else {
    env.DISABLE_WATCHER = '1';
  }
  const child = spawn(process.execPath, [path.join('server', 'index.js')], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitFor(
      async () => {
        const res = await fetch(`${base}/api/health`);
        return res.ok;
      },
      { timeout: 15_000, label: `server on :${port}` }
    );
  } catch (err) {
    child.kill('SIGKILL');
    throw new Error(`${err.message}\n--- server output ---\n${output}`);
  }
  return { child, base, port, getOutput: () => output };
}

function stopApp(app) {
  if (!app || app.child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      app.child.kill('SIGKILL');
      resolve();
    }, 3_000);
    app.child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    app.child.kill('SIGTERM');
  });
}

// JSON request helper. Returns { status, data, headers, text }.
function apiAt(base) {
  return async (method, pathname, body) => {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(base + pathname, opts);
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { status: res.status, data, text, headers: res.headers };
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const cleanups = [];

async function main() {
  console.log('Thomas Trading Card — end-to-end test');
  console.log(`  temp dir: ${TMP_DIR}\n`);

  // Mocks
  const tcg = await startMock(tcgHandler);
  const retail = await startMock(retailHandler);
  const discord = await startMock(discordHandler);
  const anthropic = await startMock(anthropicHandler);
  cleanups.push(() => tcg.server.close());
  cleanups.push(() => retail.server.close());
  cleanups.push(() => discord.server.close());
  cleanups.push(() => anthropic.server.close());
  const discordWebhookUrl = `${discord.url}/webhooks/1234567890/e2e-test-token`;

  mockEnv = {
    POKEMONTCG_BASE_URL: `${tcg.url}/v2`,
    TARGET_BASE_URL: retail.url,
    BESTBUY_BASE_URL: retail.url,
    BN_BASE_URL: retail.url,
    ANTHROPIC_BASE_URL: anthropic.url,
  };

  // Real server (watcher disabled; the loop gets its own dedicated sub-test)
  const app = await startApp({ dbPath: DB_MAIN });
  cleanups.push(() => stopApp(app));
  const api = apiAt(app.base);

  const todayUTC = new Date().toISOString().slice(0, 10);
  const state = {};

  // ---------------------------------------------------------------- basics

  await test('GET /api/health returns { ok: true }', async () => {
    const r = await api('GET', '/api/health');
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { ok: true });
  });

  await test('GET /api/settings returns all default keys', async () => {
    const r = await api('GET', '/api/settings');
    assert.equal(r.status, 200);
    assert.equal(r.data.sell_percentage, '80');
    assert.equal(r.data.watch_poll_minutes, '5');
    for (const key of ['discord_webhook_url', 'pokemontcg_api_key', 'bestbuy_api_key']) {
      assert.ok(key in r.data, `missing settings key ${key}`);
    }
  });

  await test('PUT /api/settings stores the Discord webhook URL', async () => {
    const r = await api('PUT', '/api/settings', { discord_webhook_url: discordWebhookUrl });
    assert.equal(r.status, 200);
    assert.equal(r.data.discord_webhook_url, discordWebhookUrl);
    assert.equal(r.data.sell_percentage, '80'); // full settings object comes back
  });

  await test('POST /api/settings/test-discord posts to the webhook', async () => {
    const before = discordState.posts.length;
    const r = await api('POST', '/api/settings/test-discord');
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { ok: true });
    assert.equal(discordState.posts.length, before + 1, 'exactly one webhook POST');
    assert.match(discordState.posts.at(-1).content, /test/i);
  });

  // ------------------------------------------- photo scan (Claude vision)

  await test('POST /api/prices/scan without an API key returns 400', async () => {
    const r = await api('POST', '/api/prices/scan', { image: SAMPLE_IMAGE });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /api key/i);
  });

  await test('POST /api/prices/scan with no image returns 400', async () => {
    await api('PUT', '/api/settings', { anthropic_api_key: 'sk-ant-test' });
    const r = await api('POST', '/api/prices/scan', {});
    assert.equal(r.status, 400);
    assert.match(r.data.error, /image/i);
  });

  await test('POST /api/prices/scan identifies a card and prices it', async () => {
    anthropicState.mode = 'found';
    const before = anthropicState.calls;
    const r = await api('POST', '/api/prices/scan', { image: SAMPLE_IMAGE });
    assert.equal(r.status, 200);
    assert.equal(anthropicState.calls, before + 1, 'vision API called exactly once');
    assert.equal(r.data.identified.found, true);
    assert.equal(r.data.identified.name, 'Charizard');
    assert.equal(r.data.sell_percentage, 80);
    assert.ok(r.data.cards.length >= 1, 'identified card was priced');
    const card = r.data.cards.find((c) => c.tcg_card_id === 'base1-4');
    assert.ok(card, 'base1-4 in scan results');
    approx(card.suggested.holofoil, 176.4, 'scan result carries suggested price');
  });

  await test('POST /api/prices/scan returns no cards when nothing is recognized', async () => {
    anthropicState.mode = 'notfound';
    const r = await api('POST', '/api/prices/scan', { image: SAMPLE_IMAGE });
    assert.equal(r.status, 200);
    assert.equal(r.data.identified.found, false);
    assert.deepEqual(r.data.cards, []);
    anthropicState.mode = 'found';
  });

  await test('POST /api/prices/scan returns 502 when the vision API fails', async () => {
    anthropicState.mode = 'fail';
    const r = await api('POST', '/api/prices/scan', { image: SAMPLE_IMAGE });
    assert.equal(r.status, 502);
    assert.ok(r.data.error, 'JSON error body on vision failure');
    anthropicState.mode = 'found';
    await api('PUT', '/api/settings', { anthropic_api_key: '' });
  });

  // ------------------------------------------- transaction edit (assign show)

  await test('PATCH /api/transactions/:id assigns a sale to a show', async () => {
    const show = await api('POST', '/api/shows', { name: 'Edit-Test Show' });
    const showId = show.data.id;
    const created = await api('POST', '/api/transactions', {
      type: 'expense',
      total: 12.5,
      description: 'gas',
    });
    const txId = created.data.id;
    assert.equal(created.data.show_id, null);

    const patched = await api('PATCH', `/api/transactions/${txId}`, {
      show_id: showId,
      description: 'gas to show',
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.data.show_id, showId);
    assert.equal(patched.data.show_name, 'Edit-Test Show');
    assert.equal(patched.data.description, 'gas to show');
    assert.equal(patched.data.total, 12.5, 'untouched fields preserved');

    // Clearing the show with null detaches it again.
    const cleared = await api('PATCH', `/api/transactions/${txId}`, { show_id: null });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.data.show_id, null);
    assert.equal(cleared.data.show_name, null);

    // Clean up so later exact-total assertions see an unperturbed DB.
    await api('DELETE', `/api/transactions/${txId}`);
    await api('DELETE', `/api/shows/${showId}`);
  });

  await test('PATCH /api/transactions/:id rejects bad input', async () => {
    const created = await api('POST', '/api/transactions', { type: 'expense', total: 5 });
    const txId = created.data.id;
    const unknown = await api('PATCH', `/api/transactions/${txId}`, { type: 'sale' });
    assert.equal(unknown.status, 400);
    const empty = await api('PATCH', `/api/transactions/${txId}`, {});
    assert.equal(empty.status, 400);
    const badShow = await api('PATCH', `/api/transactions/${txId}`, { show_id: 999999 });
    assert.equal(badShow.status, 400);
    const missing = await api('PATCH', '/api/transactions/999999', { description: 'x' });
    assert.equal(missing.status, 404);
    await api('DELETE', `/api/transactions/${txId}`);
  });

  // ------------------------------------------- Flow 1: full vendor flow

  await test('GET /api/prices/search returns market + suggested prices', async () => {
    const r = await api('GET', '/api/prices/search?q=charizard');
    assert.equal(r.status, 200);
    assert.equal(r.data.sell_percentage, 80);
    assert.equal(r.data.totalCount, 3);
    assert.equal(r.data.page, 1);
    const card = r.data.cards.find((c) => c.tcg_card_id === 'base1-4');
    assert.ok(card, 'base1-4 present in results');
    assert.equal(card.name, 'Charizard');
    assert.equal(card.set_name, 'Base');
    assert.equal(card.card_number, '4');
    assert.equal(card.rarity, 'Rare Holo');
    assert.ok(card.image_url.includes('base1/4'));
    approx(card.prices.holofoil.market, 220.5, 'holofoil market');
    approx(card.suggested.holofoil, 176.4, 'suggested holofoil (80% of 220.50)');
    approx(card.suggested.unlimitedHolofoil, 161, 'suggested unlimitedHolofoil (80% of 201.25)');
    const promo = r.data.cards.find((c) => c.tcg_card_id === 'smp-SM210');
    assert.ok(promo, 'promo card present');
    assert.deepEqual(promo.prices, {}, 'card without tcgplayer block has empty prices');
    assert.deepEqual(promo.suggested, {}, 'no suggested prices without market data');
    state.searchCard = card;
  });

  await test('GET /api/prices/search paginates', async () => {
    const r = await api('GET', '/api/prices/search?q=charizard&page=2&pageSize=1');
    assert.equal(r.status, 200);
    assert.equal(r.data.page, 2);
    assert.equal(r.data.totalCount, 3);
    assert.equal(r.data.cards.length, 1);
    // ordered by -set.releaseDate: sv3pt5-6 (2023), smp-SM210 (2018), base1-4 (1999)
    assert.equal(r.data.cards[0].tcg_card_id, 'smp-SM210');
  });

  await test('POST /api/cards from a search result logs a purchase', async () => {
    const c = state.searchCard;
    const r = await api('POST', '/api/cards', {
      name: c.name,
      set_name: c.set_name,
      card_number: c.card_number,
      variant: 'holofoil',
      condition: 'NM',
      quantity: 4,
      cost_basis: 100,
      market_price: c.prices.holofoil.market,
      image_url: c.image_url,
      tcg_card_id: c.tcg_card_id,
    });
    assert.equal(r.status, 201);
    state.cardId = r.data.id;
    assert.equal(r.data.quantity, 4);
    approx(r.data.cost_basis, 100, 'cost_basis');
    approx(r.data.market_price, 220.5, 'market_price');
    assert.equal(r.data.tcg_card_id, 'base1-4');

    const tx = await api('GET', `/api/transactions?card_id=${state.cardId}`);
    assert.equal(tx.status, 200);
    assert.equal(tx.data.count, 1, 'exactly one purchase transaction');
    const p = tx.data.transactions[0];
    assert.equal(p.type, 'purchase');
    assert.equal(p.quantity, 4);
    approx(p.unit_price, 100, 'purchase unit_price');
    approx(p.total, 400, 'purchase total');
    assert.equal(p.description, 'Bought 4x Charizard');
    assert.equal(p.card_name, 'Charizard');
  });

  await test('POST /api/shows creates a show', async () => {
    const r = await api('POST', '/api/shows', {
      name: 'E2E Card Show',
      date: todayUTC,
      venue: 'Expo Hall',
      table_fee: 25,
      notes: 'created by e2e',
    });
    assert.equal(r.status, 201);
    state.showId = r.data.id;
    assert.equal(r.data.name, 'E2E Card Show');
    approx(r.data.table_fee, 25, 'table_fee');
  });

  await test('POST /api/cards/:id/sell at the suggested price, linked to the show', async () => {
    const r = await api('POST', `/api/cards/${state.cardId}/sell`, {
      quantity: 2,
      unit_price: 176.4,
      show_id: state.showId,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.card.quantity, 2, 'stock decremented');
    assert.equal(r.data.transaction.type, 'sale');
    assert.equal(r.data.transaction.quantity, 2);
    approx(r.data.transaction.total, 352.8, 'sale total');
    assert.equal(r.data.transaction.show_id, state.showId);
    assert.equal(r.data.transaction.description, 'Sold 2x Charizard');
    state.saleTxId = r.data.transaction.id;
  });

  await test('POST /api/transactions records a manual expense at the show', async () => {
    const r = await api('POST', '/api/transactions', {
      type: 'expense',
      total: 12.5,
      description: 'Gas to the show',
      show_id: state.showId,
      date: `${todayUTC} 08:00:00`,
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.type, 'expense');
    approx(r.data.total, 12.5, 'expense total');
    assert.equal(r.data.show_id, state.showId);
  });

  await test('GET /api/reports/summary math is exact after the vendor flow', async () => {
    const r = await api('GET', '/api/reports/summary');
    assert.equal(r.status, 200);
    const s = r.data;
    approx(s.sales_total, 352.8, 'sales_total');
    approx(s.purchases_total, 400, 'purchases_total');
    approx(s.expenses_total, 12.5, 'expenses_total');
    approx(s.adjustments_total, 0, 'adjustments_total');
    approx(s.net_profit, 352.8 - 400 - 12.5, 'net_profit');
    assert.equal(s.sales_count, 1);
    assert.equal(s.cards_sold, 2);
    assert.equal(s.inventory.unique_cards, 1);
    assert.equal(s.inventory.total_quantity, 2);
    approx(s.inventory.cost_value, 200, 'cost_value (2 x 100)');
    approx(s.inventory.market_value, 441, 'market_value (2 x 220.50)');
    approx(s.inventory.asking_value, 352.8, 'asking_value (80%)');
    assert.equal(s.sell_percentage, 80);
  });

  await test('GET /api/shows/:id P&L reflects the sale, expense and table fee', async () => {
    const r = await api('GET', `/api/shows/${state.showId}`);
    assert.equal(r.status, 200);
    approx(r.data.sales_total, 352.8, 'show sales_total');
    approx(r.data.purchases_total, 0, 'show purchases_total');
    approx(r.data.expenses_total, 12.5, 'show expenses_total');
    approx(r.data.net, 352.8 - 12.5 - 25, 'show net');
    assert.equal(r.data.transactions.length, 2);
    const sale = r.data.transactions.find((t) => t.type === 'sale');
    assert.equal(sale.card_name, 'Charizard', 'transactions joined with card_name');
  });

  await test('GET /api/shows list includes the same computed totals', async () => {
    const r = await api('GET', '/api/shows');
    assert.equal(r.status, 200);
    const show = r.data.shows.find((s) => s.id === state.showId);
    assert.ok(show, 'show in list');
    approx(show.sales_total, 352.8, 'list sales_total');
    approx(show.expenses_total, 12.5, 'list expenses_total');
    approx(show.net, 315.3, 'list net');
  });

  await test('GET /api/reports/top-cards reflects exactly the sale', async () => {
    const r = await api('GET', '/api/reports/top-cards?limit=10');
    assert.equal(r.status, 200);
    assert.equal(r.data.top_cards.length, 1);
    const top = r.data.top_cards[0];
    assert.equal(top.card_id, state.cardId);
    assert.equal(top.name, 'Charizard');
    assert.equal(top.qty_sold, 2);
    approx(top.revenue, 352.8, 'revenue');
    approx(top.profit, 352.8 - 2 * 100, 'profit (revenue - qty * cost_basis)');
  });

  await test('GET /api/transactions filters by show_id, type, date range, limit', async () => {
    const byShow = await api('GET', `/api/transactions?show_id=${state.showId}`);
    assert.equal(byShow.data.count, 2);
    const sales = await api('GET', `/api/transactions?show_id=${state.showId}&type=sale`);
    assert.equal(sales.data.count, 1);
    assert.equal(sales.data.transactions[0].show_name, 'E2E Card Show', 'joined show_name');
    const ranged = await api('GET', `/api/transactions?from=${todayUTC}&to=${todayUTC}`);
    assert.equal(ranged.data.count, 3, 'date-only to= includes the whole day');
    const limited = await api('GET', '/api/transactions?limit=1');
    assert.equal(limited.data.count, 1);
  });

  await test('DELETE /api/transactions/:id (undo sale) restores stock and reports', async () => {
    const del = await api('DELETE', `/api/transactions/${state.saleTxId}`);
    assert.equal(del.status, 200);
    assert.deepEqual(del.data, { ok: true });
    const card = await api('GET', `/api/cards/${state.cardId}`);
    assert.equal(card.data.quantity, 4, 'sold quantity returned to inventory');
    const s = (await api('GET', '/api/reports/summary')).data;
    approx(s.sales_total, 0, 'sales_total back to 0');
    assert.equal(s.cards_sold, 0);
    approx(s.net_profit, -412.5, 'net_profit (-400 purchase - 12.50 expense)');
    const top = (await api('GET', '/api/reports/top-cards')).data;
    assert.equal(top.top_cards.length, 0, 'top-cards empty after undo');
  });

  // ------------------------------------------------ remaining CRUD coverage

  await test('GET /api/cards/:id returns the card', async () => {
    const r = await api('GET', `/api/cards/${state.cardId}`);
    assert.equal(r.status, 200);
    assert.equal(r.data.id, state.cardId);
    assert.equal(r.data.name, 'Charizard');
    assert.equal(r.data.variant, 'holofoil');
  });

  await test('PATCH /api/cards/:id edits fields without logging a transaction', async () => {
    const before = (await api('GET', `/api/transactions?card_id=${state.cardId}`)).data.count;
    const r = await api('PATCH', `/api/cards/${state.cardId}`, {
      condition: 'LP',
      notes: 'edited by e2e',
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.condition, 'LP');
    assert.equal(r.data.notes, 'edited by e2e');
    const after = (await api('GET', `/api/transactions?card_id=${state.cardId}`)).data.count;
    assert.equal(after, before, 'no new transaction from PATCH');
  });

  await test('POST /api/cards/:id/restock uses weighted-average cost basis', async () => {
    const r = await api('POST', `/api/cards/${state.cardId}/restock`, {
      quantity: 4,
      unit_cost: 50,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.card.quantity, 8);
    approx(r.data.card.cost_basis, 75, 'weighted average (4x100 + 4x50) / 8');
    assert.equal(r.data.transaction.type, 'purchase');
    approx(r.data.transaction.total, 200, 'restock purchase total');
  });

  await test('GET /api/cards supports search and sort', async () => {
    const created = await api('POST', '/api/cards', {
      name: 'Pikachu',
      set_name: 'Base',
      card_number: '58',
      quantity: 0,
      log_purchase: false,
    });
    assert.equal(created.status, 201);
    state.pikachuId = created.data.id;

    const found = await api('GET', '/api/cards?search=pika');
    assert.equal(found.data.count, 1);
    assert.equal(found.data.cards[0].name, 'Pikachu');

    const sorted = await api('GET', '/api/cards?sort=name&order=asc');
    const names = sorted.data.cards.map((c) => c.name);
    assert.deepEqual(names, [...names].sort(), 'sorted by name ascending');

    const bad = await api('GET', '/api/cards?sort=evil');
    assert.equal(bad.status, 400);
    assert.ok(bad.data.error, '400 carries a JSON error');
  });

  await test('PATCH /api/shows/:id updates fields', async () => {
    const r = await api('PATCH', `/api/shows/${state.showId}`, { venue: 'Hall B', table_fee: 30 });
    assert.equal(r.status, 200);
    assert.equal(r.data.venue, 'Hall B');
    approx(r.data.table_fee, 30, 'table_fee updated');
  });

  await test('DELETE /api/shows/:id keeps its transactions (show_id -> NULL)', async () => {
    const show = await api('POST', '/api/shows', { name: 'Throwaway Show', table_fee: 5 });
    const expense = await api('POST', '/api/transactions', {
      type: 'expense',
      total: 30,
      description: 'Table fee paid cash',
      show_id: show.data.id,
    });
    const del = await api('DELETE', `/api/shows/${show.data.id}`);
    assert.deepEqual(del.data, { ok: true });
    const list = await api('GET', '/api/transactions?limit=500');
    const kept = list.data.transactions.find((t) => t.id === expense.data.id);
    assert.ok(kept, 'transaction survived show deletion');
    assert.equal(kept.show_id, null);
    const shows = await api('GET', '/api/shows');
    assert.ok(!shows.data.shows.some((s) => s.id === show.data.id), 'show is gone');
  });

  await test('POST /api/transactions accepts signed adjustments', async () => {
    const before = (await api('GET', '/api/reports/summary')).data;
    const r = await api('POST', '/api/transactions', {
      type: 'adjustment',
      total: -4.5,
      description: 'Cash drawer came up short',
    });
    assert.equal(r.status, 201);
    approx(r.data.total, -4.5, 'adjustment stays signed');
    const after = (await api('GET', '/api/reports/summary')).data;
    approx(after.adjustments_total, before.adjustments_total - 4.5, 'adjustments_total');
    approx(after.net_profit, before.net_profit - 4.5, 'net_profit moves with adjustment');
    const filtered = await api('GET', '/api/transactions?type=adjustment');
    assert.ok(filtered.data.count >= 1);
    assert.ok(filtered.data.transactions.every((t) => t.type === 'adjustment'));
  });

  await test('DELETE /api/cards/:id keeps transactions (card_id -> NULL)', async () => {
    const card = await api('POST', '/api/cards', {
      name: 'Throwaway Card',
      quantity: 1,
      cost_basis: 5,
      show_id: state.showId,
      date: `${todayUTC} 09:00:00`,
    });
    const logged = (await api('GET', `/api/transactions?card_id=${card.data.id}`)).data
      .transactions[0];
    assert.equal(logged.show_id, state.showId, 'card POST passes show_id to the purchase');
    assert.equal(logged.date, `${todayUTC} 09:00:00`, 'card POST passes date to the purchase');
    const txId = logged.id;
    const del = await api('DELETE', `/api/cards/${card.data.id}`);
    assert.deepEqual(del.data, { ok: true });
    assert.equal((await api('GET', `/api/cards/${card.data.id}`)).status, 404);
    const list = await api('GET', '/api/transactions?limit=500');
    const kept = list.data.transactions.find((t) => t.id === txId);
    assert.ok(kept, 'purchase transaction survived card deletion');
    assert.equal(kept.card_id, null);
  });

  await test('GET /api/reports/monthly is oldest-first, zero-filled, and matches summary', async () => {
    const r = await api('GET', '/api/reports/monthly?months=3');
    assert.equal(r.status, 200);
    assert.equal(r.data.months.length, 3);
    const currentKey = todayUTC.slice(0, 7);
    const months = r.data.months;
    assert.equal(months.at(-1).month, currentKey, 'newest month last');
    approx(months[0].sales, 0, 'quiet month sales are zero');
    approx(months[0].purchases, 0, 'quiet month purchases are zero');
    const s = (await api('GET', '/api/reports/summary')).data;
    const cur = months.at(-1);
    approx(cur.sales, s.sales_total, 'current month sales == summary');
    approx(cur.purchases, s.purchases_total, 'current month purchases == summary');
    approx(cur.expenses, s.expenses_total, 'current month expenses == summary');
    approx(cur.net, s.net_profit, 'current month net == summary net');
  });

  await test('GET /api/prices/card/:tcgCardId returns one card with suggested prices', async () => {
    const r = await api('GET', '/api/prices/card/base1-58');
    assert.equal(r.status, 200);
    assert.equal(r.data.name, 'Pikachu');
    assert.equal(r.data.set_id, 'base1');
    approx(r.data.prices.normal.market, 1.85, 'normal market');
    approx(r.data.suggested.normal, 1.48, 'suggested (80% of 1.85)');
    assert.equal(r.data.sell_percentage, 80);
    const missing = await api('GET', '/api/prices/card/nope-404');
    assert.equal(missing.status, 404);
    assert.ok(missing.data.error, '404 carries a JSON error');
  });

  // -------------------------------------------------- Flow 3: settings flow

  await test('changing sell_percentage changes suggested prices everywhere', async () => {
    const put = await api('PUT', '/api/settings', { sell_percentage: 50 });
    assert.equal(put.status, 200);
    assert.equal(put.data.sell_percentage, '50');
    const half = await api('GET', '/api/prices/search?q=charizard');
    assert.equal(half.data.sell_percentage, 50);
    const card = half.data.cards.find((c) => c.tcg_card_id === 'base1-4');
    approx(card.suggested.holofoil, 110.25, 'suggested at 50% of 220.50');
    // restore and re-verify
    await api('PUT', '/api/settings', { sell_percentage: 80 });
    const back = await api('GET', '/api/prices/search?q=charizard');
    const again = back.data.cards.find((c) => c.tcg_card_id === 'base1-4');
    approx(again.suggested.holofoil, 176.4, 'suggested back at 80%');
  });

  await test('POST /api/cards/:id/refresh-price pulls market price from the API', async () => {
    await api('PATCH', `/api/cards/${state.cardId}`, { market_price: 1 }); // stale on purpose
    const r = await api('POST', `/api/cards/${state.cardId}/refresh-price`);
    assert.equal(r.status, 200);
    approx(r.data.market_price, 220.5, 'market_price refreshed (holofoil variant)');
    assert.ok(r.data.price_updated_at, 'price_updated_at set');
    const noId = await api('POST', `/api/cards/${state.pikachuId}/refresh-price`);
    assert.equal(noId.status, 400, '400 without a tcg_card_id');
  });

  // -------------------------------------------------- Flow 2: restock flow

  await test('POST /api/watches creates a watch', async () => {
    setStock('target', '93954435', false);
    const r = await api('POST', '/api/watches', {
      retailer: 'target',
      sku: '93954435',
      product_name: 'Prismatic Evolutions ETB',
      zip_code: '78704',
      store_id: '1077',
    });
    assert.equal(r.status, 201);
    state.watchId = r.data.id;
    assert.equal(r.data.retailer, 'target');
    assert.equal(r.data.last_status, 'unknown');
    assert.equal(r.data.active, 1);
    const list = await api('GET', '/api/watches');
    assert.ok(list.data.watches.some((w) => w.id === state.watchId));
  });

  await test('check-now while out of stock: status recorded, no alert, no Discord', async () => {
    const before = discordState.posts.length;
    const r = await api('POST', `/api/watches/${state.watchId}/check`);
    assert.equal(r.status, 200);
    assert.equal(r.data.last_status, 'out_of_stock');
    assert.ok(r.data.last_checked, 'last_checked persisted');
    const alerts = await api('GET', '/api/alerts?limit=100');
    assert.equal(alerts.data.alerts.filter((a) => a.watch_id === state.watchId).length, 0);
    assert.equal(discordState.posts.length, before, 'no Discord post');
  });

  await test('check-now after restock: exactly one alert + one Discord post', async () => {
    setStock('target', '93954435', true);
    const before = discordState.posts.length;
    const r = await api('POST', `/api/watches/${state.watchId}/check`);
    assert.equal(r.data.last_status, 'in_stock');
    const alerts = (await api('GET', '/api/alerts?limit=100')).data.alerts.filter(
      (a) => a.watch_id === state.watchId
    );
    assert.equal(alerts.length, 1, 'exactly one alert');
    assert.match(alerts[0].message, /RESTOCK/);
    assert.match(alerts[0].message, /Prismatic Evolutions ETB/);
    assert.match(alerts[0].message, /Target/);
    assert.equal(discordState.posts.length, before + 1, 'exactly one Discord post');
    assert.equal(discordState.posts.at(-1).content, alerts[0].message);
    state.alertId = alerts[0].id;
  });

  await test('repeated check while still in stock does not duplicate the alert', async () => {
    const before = discordState.posts.length;
    const r = await api('POST', `/api/watches/${state.watchId}/check`);
    assert.equal(r.data.last_status, 'in_stock');
    const alerts = (await api('GET', '/api/alerts?limit=100')).data.alerts.filter(
      (a) => a.watch_id === state.watchId
    );
    assert.equal(alerts.length, 1, 'still exactly one alert');
    assert.equal(discordState.posts.length, before, 'no extra Discord post');
  });

  await test('GET /api/alerts?unseen=1 and POST /api/alerts/mark-seen', async () => {
    const unseen = await api('GET', '/api/alerts?unseen=1&limit=50');
    const mine = unseen.data.alerts.find((a) => a.id === state.alertId);
    assert.ok(mine, 'alert is unseen');
    assert.equal(mine.retailer, 'target', 'alert joined with watch retailer');
    assert.equal(mine.product_name, 'Prismatic Evolutions ETB', 'alert joined with product_name');
    assert.equal(mine.sku, '93954435', 'alert joined with sku');

    const marked = await api('POST', '/api/alerts/mark-seen', { ids: [state.alertId] });
    assert.equal(marked.status, 200);
    assert.equal(marked.data.ok, true);
    assert.equal(marked.data.updated, 1);

    const after = await api('GET', '/api/alerts?unseen=1');
    assert.ok(!after.data.alerts.some((a) => a.id === state.alertId), 'alert no longer unseen');

    const all = await api('POST', '/api/alerts/mark-seen', {});
    assert.equal(all.data.ok, true, 'mark-seen without ids marks all unseen');
  });

  await test('Best Buy watch errors without an API key, works once configured', async () => {
    const created = await api('POST', '/api/watches', {
      retailer: 'bestbuy',
      sku: '6614325',
      product_name: '151 Ultra Premium Collection',
    });
    state.bestbuyWatchId = created.data.id;
    const noKey = await api('POST', `/api/watches/${state.bestbuyWatchId}/check`);
    assert.equal(noKey.data.last_status, 'error');
    assert.match(noKey.data.last_error, /key/i, 'last_error explains the missing key');

    await api('PUT', '/api/settings', { bestbuy_api_key: 'E2E-TEST-KEY' });
    setStock('bestbuy', '6614325', true);
    const before = discordState.posts.length;
    const withKey = await api('POST', `/api/watches/${state.bestbuyWatchId}/check`);
    assert.equal(withKey.data.last_status, 'in_stock');
    assert.equal(discordState.posts.length, before + 1, 'error -> in_stock fires one alert');
  });

  await test('Barnes & Noble checker + DELETE /api/watches cascades alerts', async () => {
    const created = await api('POST', '/api/watches', {
      retailer: 'barnesnoble',
      sku: '9780000000000',
      product_name: 'BN Mock Box',
    });
    const id = created.data.id;
    setStock('barnesnoble', '9780000000000', false);
    const out = await api('POST', `/api/watches/${id}/check`);
    assert.equal(out.data.last_status, 'out_of_stock');
    setStock('barnesnoble', '9780000000000', true);
    const back = await api('POST', `/api/watches/${id}/check`);
    assert.equal(back.data.last_status, 'in_stock');
    const alerts = (await api('GET', '/api/alerts?limit=100')).data.alerts.filter(
      (a) => a.watch_id === id
    );
    assert.equal(alerts.length, 1);

    const del = await api('DELETE', `/api/watches/${id}`);
    assert.deepEqual(del.data, { ok: true });
    const after = (await api('GET', '/api/alerts?limit=100')).data.alerts.filter(
      (a) => a.watch_id === id
    );
    assert.equal(after.length, 0, 'alerts cascade-deleted with the watch');
    const watches = await api('GET', '/api/watches');
    assert.ok(!watches.data.watches.some((w) => w.id === id));
  });

  await test('PATCH /api/watches/:id updates fields and toggles active', async () => {
    const r = await api('PATCH', `/api/watches/${state.watchId}`, {
      active: 0,
      product_name: 'Prismatic Evolutions ETB (paused)',
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.active, 0);
    assert.equal(r.data.product_name, 'Prismatic Evolutions ETB (paused)');
    await api('PATCH', `/api/watches/${state.bestbuyWatchId}`, { active: 0 });
    const empty = await api('PATCH', `/api/watches/${state.watchId}`, {});
    assert.equal(empty.status, 400, 'PATCH with no fields is a 400');
  });

  // ------------------------------------------------------- error surface

  await test('overselling returns 400 with a JSON error', async () => {
    const r = await api('POST', `/api/cards/${state.cardId}/sell`, {
      quantity: 999,
      unit_price: 1,
    });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /stock/i);
  });

  await test('invalid retailer returns 400', async () => {
    const r = await api('POST', '/api/watches', { retailer: 'walmart', sku: '123' });
    assert.equal(r.status, 400);
    assert.ok(r.data.error);
  });

  await test('unknown settings key returns 400', async () => {
    const r = await api('PUT', '/api/settings', { favorite_color: 'blue' });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /favorite_color/);
  });

  await test('missing card returns 404', async () => {
    const r = await api('GET', '/api/cards/999999');
    assert.equal(r.status, 404);
    assert.ok(r.data.error);
  });

  await test('empty price query returns 400', async () => {
    const r = await api('GET', '/api/prices/search?q=');
    assert.equal(r.status, 400);
    assert.ok(r.data.error);
  });

  await test('price upstream failure returns 502 with a JSON error', async () => {
    tcgState.fail = true;
    try {
      const search = await api('GET', '/api/prices/search?q=upstream-down-unique-query');
      assert.equal(search.status, 502);
      assert.ok(search.data && search.data.error, '502 body is JSON with error');
      // refresh-price path too (uncached tcg id so the cache can't mask the outage)
      const card = await api('POST', '/api/cards', {
        name: 'Refresh Fail Probe',
        tcg_card_id: 'sv9-999',
        quantity: 0,
        log_purchase: false,
      });
      const refresh = await api('POST', `/api/cards/${card.data.id}/refresh-price`);
      assert.equal(refresh.status, 502);
      assert.ok(refresh.data && refresh.data.error);
      await api('DELETE', `/api/cards/${card.data.id}`);
    } finally {
      tcgState.fail = false;
    }
  });

  await test('malformed JSON body returns 4xx JSON, not an HTML crash page', async () => {
    const res = await fetch(`${app.base}/api/cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"name": "Broken"',
    });
    assert.ok(res.status >= 400 && res.status < 500, `expected 4xx, got ${res.status}`);
    assert.match(res.headers.get('content-type') || '', /application\/json/);
    const data = await res.json();
    assert.ok(typeof data.error === 'string' && data.error.length > 0);
  });

  // ------------------------------------------------- Flow 5: watcher loop

  await test('watcher loop detects the restock on its own and posts to Discord', async () => {
    // Quiet every other watch so the loop only touches our test watch.
    const all = (await api('GET', '/api/watches')).data.watches;
    for (const w of all) {
      if (w.active) await api('PATCH', `/api/watches/${w.id}`, { active: 0 });
    }

    // watch_poll_minutes < 1 is rejected by the API on purpose, so write the
    // tiny test interval (0.05 min = 3s) directly to the DB.
    const { default: db } = await import(pathToFileURL(path.join(ROOT, 'server', 'db.js')).href);
    db.prepare("UPDATE settings SET value = '0.05' WHERE key = 'watch_poll_minutes'").run();

    setStock('target', 'LOOP-1', false);
    const created = await api('POST', '/api/watches', {
      retailer: 'target',
      sku: 'LOOP-1',
      product_name: 'Watcher Loop Test Box',
    });
    const watchId = created.data.id;
    const before = discordState.posts.length;

    // Boot a second server instance against the same DB with the watcher ON.
    const watcherApp = await startApp({ dbPath: DB_MAIN, watcher: true });
    try {
      await waitFor(
        async () => {
          const w = (await api('GET', '/api/watches')).data.watches.find((x) => x.id === watchId);
          return w && w.last_status === 'out_of_stock' ? w : null;
        },
        { timeout: 25_000, interval: 300, label: 'first watcher cycle (out_of_stock)' }
      );
      assert.equal(discordState.posts.length, before, 'no alert while out of stock');

      setStock('target', 'LOOP-1', true);
      await waitFor(
        async () => {
          const w = (await api('GET', '/api/watches')).data.watches.find((x) => x.id === watchId);
          return w && w.last_status === 'in_stock' ? w : null;
        },
        { timeout: 25_000, interval: 300, label: 'watcher loop restock detection (in_stock)' }
      );
      const alerts = (await api('GET', '/api/alerts?limit=100')).data.alerts.filter(
        (a) => a.watch_id === watchId
      );
      assert.equal(alerts.length, 1, 'loop fired exactly one alert');
      assert.match(alerts[0].message, /RESTOCK/);
      assert.equal(discordState.posts.length, before + 1, 'loop fired exactly one Discord post');
      assert.match(discordState.posts.at(-1).content, /Watcher Loop Test Box/);
    } finally {
      await stopApp(watcherApp);
      await api('PATCH', `/api/watches/${watchId}`, { active: 0 });
      await api('PUT', '/api/settings', { watch_poll_minutes: 5 });
    }
  });

  // --------------------------------------------------------- Flow 6: seed

  await test('server/seed.js populates a fresh DB and prints a summary', async () => {
    const { stdout } = await execFileAsync(process.execPath, [path.join('server', 'seed.js')], {
      cwd: ROOT,
      env: { ...process.env, DB_PATH: DB_SEED },
    });
    assert.match(stdout, /Seed complete/);
  });

  {
    let seedApp = null;
    let sApi = null;
    await test('seeded data is served by the list endpoints', async () => {
      seedApp = await startApp({ dbPath: DB_SEED });
      cleanups.push(() => stopApp(seedApp));
      sApi = apiAt(seedApp.base);

      const cards = await sApi('GET', '/api/cards');
      assert.equal(cards.data.count, 10, '10 seeded cards');
      const shows = await sApi('GET', '/api/shows');
      assert.equal(shows.data.shows.length, 2, '2 seeded shows');
      const watches = await sApi('GET', '/api/watches');
      assert.equal(watches.data.watches.length, 2, '2 seeded watches');
      const alerts = await sApi('GET', '/api/alerts');
      assert.equal(alerts.data.alerts.length, 1, '1 seeded alert');
      assert.equal(alerts.data.alerts[0].seen, 0);
      const txs = await sApi('GET', '/api/transactions?limit=500');
      assert.equal(txs.data.count, 18, '18 seeded transactions');
    });

    await test('seeded reports/summary is internally consistent with /api/transactions', async () => {
      assert.ok(sApi, 'seed server is up');
      const summary = (await sApi('GET', '/api/reports/summary')).data;
      const txs = (await sApi('GET', '/api/transactions?limit=1000')).data.transactions;

      const totals = { sale: 0, purchase: 0, expense: 0, adjustment: 0 };
      let salesCount = 0;
      let cardsSold = 0;
      for (const t of txs) {
        totals[t.type] += t.total;
        if (t.type === 'sale') {
          salesCount += 1;
          cardsSold += t.quantity;
        }
      }
      approx(summary.sales_total, totals.sale, 'sales_total recomputed');
      approx(summary.purchases_total, totals.purchase, 'purchases_total recomputed');
      approx(summary.expenses_total, totals.expense, 'expenses_total recomputed');
      approx(summary.adjustments_total, totals.adjustment, 'adjustments_total recomputed');
      approx(
        summary.net_profit,
        totals.sale - totals.purchase - totals.expense + totals.adjustment,
        'net_profit recomputed'
      );
      assert.equal(summary.sales_count, salesCount, 'sales_count recomputed');
      assert.equal(summary.cards_sold, cardsSold, 'cards_sold recomputed');

      const cards = (await sApi('GET', '/api/cards')).data.cards;
      const cost = cards.reduce((sum, c) => sum + c.quantity * c.cost_basis, 0);
      const market = cards.reduce(
        (sum, c) => sum + (c.market_price != null ? c.quantity * c.market_price : 0),
        0
      );
      assert.equal(summary.inventory.unique_cards, cards.length);
      assert.equal(
        summary.inventory.total_quantity,
        cards.reduce((sum, c) => sum + c.quantity, 0)
      );
      approx(summary.inventory.cost_value, cost, 'inventory cost_value recomputed');
      approx(summary.inventory.market_value, market, 'inventory market_value recomputed');
      approx(
        summary.inventory.asking_value,
        (market * summary.sell_percentage) / 100,
        'asking_value recomputed'
      );

      // Per-show net must equal its own components.
      const shows = (await sApi('GET', '/api/shows')).data.shows;
      for (const s of shows) {
        approx(
          s.net,
          s.sales_total - s.purchases_total - s.expenses_total - s.table_fee,
          `show "${s.name}" net`
        );
      }
    });

    if (seedApp) {
      await stopApp(seedApp);
    }
  }

  // ------------------------------------------------ production SPA smoke

  const distIndex = path.join(ROOT, 'client', 'dist', 'index.html');
  if (fs.existsSync(distIndex)) {
    await test('production: / serves the SPA HTML', async () => {
      const res = await fetch(`${app.base}/`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') || '', /text\/html/);
      const html = await res.text();
      assert.match(html, /<div id="root">/);
    });

    await test('production: deep route /inventory serves the SPA HTML (fallback)', async () => {
      const res = await fetch(`${app.base}/inventory`);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.match(html, /<div id="root">/);
    });

    await test('production: /api/health still returns JSON alongside the SPA', async () => {
      const res = await fetch(`${app.base}/api/health`);
      assert.match(res.headers.get('content-type') || '', /application\/json/);
      assert.deepEqual(await res.json(), { ok: true });
    });
  } else {
    skip('production SPA smoke (3 checks)', 'client/dist not built — run `npm run build` first');
  }
}

// ---------------------------------------------------------------------------

let fatal = null;
try {
  await main();
} catch (err) {
  fatal = err;
} finally {
  for (const fn of cleanups.reverse()) {
    try {
      await fn();
    } catch {
      // best effort
    }
  }
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
}

const passed = results.filter((r) => r.ok && !r.skipped).length;
const skipped = results.filter((r) => r.skipped).length;
const failed = results.filter((r) => !r.ok);

console.log('\n==================== E2E SUMMARY ====================');
for (const r of results) {
  console.log(`  ${r.skipped ? 'SKIP' : r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
}
console.log('------------------------------------------------------');
console.log(`  ${passed} passed, ${failed.length} failed${skipped ? `, ${skipped} skipped` : ''}`);
if (fatal) {
  console.error('\nFATAL:', fatal);
}
process.exit(failed.length > 0 || fatal ? 1 : 0);
