// Best Buy stock checker backed by the official products API.
// Requires the `bestbuy_api_key` setting. Returns
// { status: 'in_stock'|'out_of_stock'|'unknown'|'error', detail? }.
import { getSetting } from '../../db.js';

// undici hides the root cause (e.g. ECONNREFUSED) behind "fetch failed".
function errorDetail(err) {
  const cause = err?.cause?.code || err?.cause?.message;
  return cause ? `${err.message} (${cause})` : err.message;
}

export async function check(watch) {
  const apiKey = (getSetting('bestbuy_api_key') || '').trim();
  if (!apiKey) {
    return { status: 'error', detail: 'Best Buy API key not configured (Settings page)' };
  }

  const base = process.env.BESTBUY_BASE_URL || 'https://api.bestbuy.com';
  const params = new URLSearchParams({
    apiKey,
    format: 'json',
    show: 'sku,name,onlineAvailability,inStoreAvailability',
  });
  const url = `${base}/v1/products(sku=${encodeURIComponent(String(watch.sku))})?${params}`;

  let data;
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return { status: 'error', detail: `Best Buy returned HTTP ${res.status}` };
    }
    data = await res.json();
  } catch (err) {
    return { status: 'error', detail: errorDetail(err) };
  }

  const products = Array.isArray(data?.products) ? data.products : null;
  if (!products) {
    return { status: 'unknown', detail: 'unrecognized Best Buy response shape' };
  }
  if (products.length === 0) {
    return { status: 'unknown', detail: `no Best Buy product found for SKU ${watch.sku}` };
  }

  const product = products[0];
  if (typeof product.onlineAvailability === 'boolean') {
    return { status: product.onlineAvailability ? 'in_stock' : 'out_of_stock' };
  }
  if (typeof product.inStoreAvailability === 'boolean') {
    return { status: product.inStoreAvailability ? 'in_stock' : 'out_of_stock' };
  }
  return { status: 'unknown', detail: 'Best Buy product has no availability fields' };
}
