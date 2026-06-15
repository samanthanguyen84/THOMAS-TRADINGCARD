// Pokémon TCG API v2 client with a 12-hour SQLite cache (price_cache table).
// Successful upstream responses are cached keyed by the full upstream URL.
import db, { getSetting } from '../db.js';

const CACHE_TTL_MODIFIER = '-12 hours';
const TIMEOUT_MS = 15_000;
const RETRIES = 2; // total attempts on timeout / network / 5xx

const selectFreshCache = db.prepare(
  `SELECT payload FROM price_cache WHERE query = ? AND fetched_at > datetime('now', '${CACHE_TTL_MODIFIER}')`
);
const upsertCache = db.prepare(
  `INSERT INTO price_cache (query, payload, fetched_at) VALUES (?, ?, datetime('now'))
   ON CONFLICT(query) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`
);

function baseUrl() {
  return process.env.POKEMONTCG_BASE_URL || 'https://api.pokemontcg.io/v2';
}

function upstreamError(message) {
  const err = new Error(message);
  err.status = 502;
  return err;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fetch an upstream URL with caching + retry. Returns the parsed JSON body, or
// null when notFoundOk is true and the upstream responds 404. Throws Error with
// .status = 502 on any other failure (network, timeout, non-2xx, bad JSON).
// The Pokémon TCG API is occasionally slow/flaky (it is migrating to Scrydex),
// so transient timeouts and 5xx responses are retried before giving up.
async function fetchUpstream(url, { notFoundOk = false } = {}) {
  const cached = selectFreshCache.get(url);
  if (cached) {
    return JSON.parse(cached.payload);
  }

  const headers = { Accept: 'application/json' };
  const apiKey = getSetting('pokemontcg_api_key');
  if (apiKey) headers['X-Api-Key'] = apiKey;

  let lastError = null;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    let res;
    try {
      res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      // Timeout (TimeoutError) or network error — worth retrying.
      lastError = upstreamError(`price API request failed: ${err.message}`);
      if (attempt < RETRIES) {
        await sleep(400 * attempt);
        continue;
      }
      throw lastError;
    }

    if (res.status === 404 && notFoundOk) {
      return null;
    }
    if (res.status >= 500) {
      lastError = upstreamError(`price API returned ${res.status}`);
      if (attempt < RETRIES) {
        await sleep(400 * attempt);
        continue;
      }
      throw lastError;
    }
    if (!res.ok) {
      throw upstreamError(`price API returned ${res.status}`);
    }

    let data;
    try {
      data = await res.json();
    } catch (err) {
      throw upstreamError(`price API returned invalid JSON: ${err.message}`);
    }
    upsertCache.run(url, JSON.stringify(data));
    return data;
  }
  throw lastError || upstreamError('price API request failed');
}

// Normalize a pokemontcg.io card object to the shape in docs/API.md.
function normalizeCard(card) {
  return {
    tcg_card_id: card.id,
    name: card.name,
    set_name: card.set?.name ?? '',
    set_id: card.set?.id ?? '',
    card_number: card.number ?? '',
    rarity: card.rarity ?? '',
    release_date: card.set?.releaseDate ?? '',
    image_url: card.images?.small || card.images?.large || '',
    tcgplayer_url: card.tcgplayer?.url ?? '',
    prices: card.tcgplayer?.prices || {},
  };
}

// Split a typed query into a name and an optional collector number, so a vendor
// can type a card the way it reads on the card — "pikachu 051/162" or
// "charizard 4". Returns { name, number }.
export function parseQuery(raw) {
  let s = String(raw).replace(/"/g, ' ').trim();
  let number = '';

  // Collector number written as <num>/<setSize>, e.g. 051/162 or TG12/TG30.
  const frac = s.match(/\b([A-Za-z]{0,4}\d+[A-Za-z]?)\s*\/\s*[A-Za-z]{0,4}\d+\b/);
  if (frac) {
    number = frac[1];
    s = (s.slice(0, frac.index) + ' ' + s.slice(frac.index + frac[0].length)).trim();
  } else {
    // A trailing standalone number/code ("charizard 4", "pikachu sm210"), but
    // only if a real name is left over once it's removed.
    const tail = s.match(/\s#?([A-Za-z]{0,4}\d+[A-Za-z]?)\s*$/);
    if (tail) {
      const remaining = s.slice(0, tail.index).trim();
      if (/[A-Za-z]/.test(remaining)) {
        number = tail[1];
        s = remaining;
      }
    }
  }
  return { name: s.replace(/\s+/g, ' ').trim(), number };
}

// Lucene clause for a collector number, tolerating leading zeros (the API
// stores some sets as "051" and others as "51").
function numberClause(number) {
  if (!number) return '';
  const stripped = number.replace(/^0+/, '') || number;
  return stripped !== number
    ? `(number:${number} OR number:${stripped})`
    : `number:${number}`;
}

async function runSearch(name, number, page, pageSize) {
  const term = name.replace(/"/g, '');
  const q = number ? `name:"*${term}*" ${numberClause(number)}` : `name:"*${term}*"`;
  const url = new URL(`${baseUrl()}/cards`);
  url.searchParams.set('q', q);
  url.searchParams.set('page', String(page));
  url.searchParams.set('pageSize', String(pageSize));
  url.searchParams.set('orderBy', '-set.releaseDate');

  const data = await fetchUpstream(url.toString());
  const rows = Array.isArray(data.data) ? data.data : [];
  return {
    cards: rows.map(normalizeCard),
    page: data.page ?? Number(page),
    totalCount: data.totalCount ?? rows.length,
  };
}

// Search cards by name (and optional collector number). Returns { cards, page,
// totalCount }. If a number was given but matched nothing, falls back to a
// name-only search so the vendor still sees candidates instead of an empty page.
export async function searchCards({ q, page = 1, pageSize = 20 }) {
  const { name, number } = parseQuery(q);
  const term = name || String(q).replace(/"/g, '').trim();

  let result = await runSearch(term, number, page, pageSize);
  if (number && result.totalCount === 0) {
    result = await runSearch(term, '', page, pageSize);
  }
  return result;
}

// Fetch a single card by its pokemontcg.io id. Returns the normalized card,
// or null when the upstream says the card does not exist.
export async function getCardPrices(tcgCardId) {
  const url = `${baseUrl()}/cards/${encodeURIComponent(tcgCardId)}`;
  const data = await fetchUpstream(url, { notFoundOk: true });
  if (!data || !data.data) return null;
  return normalizeCard(data.data);
}
