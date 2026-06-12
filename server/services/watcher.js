// Restock watcher: per-watch retailer checks plus the background polling loop.
import db, { getSetting } from '../db.js';
import { sendDiscordMessage } from './discord.js';
import { check as checkTarget } from './retailers/target.js';
import { check as checkBestBuy } from './retailers/bestbuy.js';
import { check as checkBarnesNoble } from './retailers/barnesnoble.js';

const CHECKERS = {
  target: checkTarget,
  bestbuy: checkBestBuy,
  barnesnoble: checkBarnesNoble,
};

const RETAILER_LABELS = {
  target: 'Target',
  bestbuy: 'Best Buy',
  barnesnoble: 'Barnes & Noble',
};

const VALID_STATUSES = new Set(['in_stock', 'out_of_stock', 'unknown', 'error']);

const STAGGER_MS = 2_000;
const FIRST_CYCLE_DELAY_MS = 5_000;
const DEFAULT_POLL_MINUTES = 5;

function productUrl(watch) {
  switch (watch.retailer) {
    case 'target':
      return `https://www.target.com/p/-/A-${watch.sku}`;
    case 'bestbuy':
      return `https://www.bestbuy.com/site/searchpage.jsp?st=${watch.sku}`;
    case 'barnesnoble':
      return `https://www.barnesandnoble.com/w/?ean=${watch.sku}`;
    default:
      return '';
  }
}

// Run the retailer check for one watch, persist the outcome, and fire an
// alert + Discord message on a transition into in_stock. Returns the updated
// watch row.
export async function checkWatch(watch) {
  const checker = CHECKERS[watch.retailer];
  let result;
  if (!checker) {
    result = { status: 'error', detail: `unknown retailer: ${watch.retailer}` };
  } else {
    try {
      result = await checker(watch);
    } catch (err) {
      result = { status: 'error', detail: err.message };
    }
  }

  const status = VALID_STATUSES.has(result?.status) ? result.status : 'unknown';
  const detail = result?.detail || '';
  const lastError = status === 'error' || status === 'unknown' ? detail : '';

  // Re-read the previous status so transitions are detected against the
  // freshest row (and so a watch deleted mid-cycle is skipped).
  const previous = db.prepare('SELECT last_status FROM watches WHERE id = ?').get(watch.id);
  if (!previous) return null;

  db.prepare(
    'UPDATE watches SET last_status = ?, last_checked = ?, last_error = ? WHERE id = ?'
  ).run(status, new Date().toISOString(), lastError, watch.id);

  if (previous.last_status !== 'in_stock' && status === 'in_stock') {
    const name = watch.product_name || watch.sku;
    const retailerLabel = RETAILER_LABELS[watch.retailer] || watch.retailer;
    const message = `🚨 RESTOCK: ${name} is IN STOCK at ${retailerLabel} — ${productUrl(watch)}`;
    db.prepare('INSERT INTO alerts (watch_id, message) VALUES (?, ?)').run(watch.id, message);
    try {
      const sent = await sendDiscordMessage(getSetting('discord_webhook_url'), message);
      if (!sent.ok) {
        console.warn(`[watcher] Discord notification failed for watch ${watch.id}: ${sent.error}`);
      }
    } catch (err) {
      console.warn(`[watcher] Discord notification failed for watch ${watch.id}: ${err.message}`);
    }
  }

  return db.prepare('SELECT * FROM watches WHERE id = ?').get(watch.id);
}

function pollDelayMs() {
  const minutes = Number(getSetting('watch_poll_minutes'));
  const safe = Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_POLL_MINUTES;
  return safe * 60_000;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

async function runCycle() {
  const watches = db.prepare('SELECT * FROM watches WHERE active = 1 ORDER BY id').all();
  let inStock = 0;
  let errors = 0;
  for (let i = 0; i < watches.length; i++) {
    if (i > 0) await sleep(STAGGER_MS);
    try {
      const updated = await checkWatch(watches[i]);
      if (updated?.last_status === 'in_stock') inStock++;
      if (updated?.last_status === 'error') errors++;
    } catch (err) {
      errors++;
      console.error(`[watcher] check failed for watch ${watches[i].id}: ${err.message}`);
    }
  }
  console.log(
    `[watcher] cycle done: checked ${watches.length} active watch(es), ${inStock} in stock, ${errors} error(s)`
  );
}

let started = false;

// Self-rescheduling loop (setTimeout chain, not setInterval) so a slow cycle
// never overlaps the next one. Re-reads watch_poll_minutes every cycle.
export function startWatcher() {
  if (started) return;
  started = true;
  console.log(`[watcher] started; polling every ${pollDelayMs() / 60_000} minute(s)`);
  const tick = async () => {
    try {
      await runCycle();
    } catch (err) {
      console.error(`[watcher] cycle error: ${err.message}`);
    }
    setTimeout(tick, pollDelayMs()).unref();
  };
  setTimeout(tick, FIRST_CYCLE_DELAY_MS).unref();
}
