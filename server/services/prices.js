// Pokémon TCG API v2 client with a 12-hour SQLite cache (price_cache table).
// Successful upstream responses are cached keyed by the full upstream URL.
import db, { getSetting } from '../db.js';

const CACHE_TTL_MODIFIER = '-12 hours';

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

// Fetch an upstream URL with caching. Returns the parsed JSON body, or null
// when notFoundOk is true and the upstream responds 404. Throws Error with
// .status = 502 on any other failure (network, timeout, non-2xx, bad JSON).
async function fetchUpstream(url, { notFoundOk = false } = {}) {
  const cached = selectFreshCache.get(url);
  if (cached) {
    return JSON.parse(cached.payload);
  }

  const headers = { Accept: 'application/json' };
  const apiKey = getSetting('pokemontcg_api_key');
  if (apiKey) headers['X-Api-Key'] = apiKey;

  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    throw upstreamError(`price API request failed: ${err.message}`);
  }
  if (res.status === 404 && notFoundOk) {
    return null;
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

// Search cards by name. Returns { cards, page, totalCount }.
export async function searchCards({ q, page = 1, pageSize = 20 }) {
  const name = String(q).replace(/"/g, '');
  const url = new URL(`${baseUrl()}/cards`);
  url.searchParams.set('q', `name:"*${name}*"`);
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

// Fetch a single card by its pokemontcg.io id. Returns the normalized card,
// or null when the upstream says the card does not exist.
export async function getCardPrices(tcgCardId) {
  const url = `${baseUrl()}/cards/${encodeURIComponent(tcgCardId)}`;
  const data = await fetchUpstream(url, { notFoundOk: true });
  if (!data || !data.data) return null;
  return normalizeCard(data.data);
}
