// Target stock checker backed by the public redsky web API.
// Returns { status: 'in_stock'|'out_of_stock'|'unknown'|'error', detail? }.

// Well-known public web key used by target.com itself.
const PUBLIC_WEB_KEY = '9f36aeafbe60771e321a7cc95a78140772ab3e96';
const DEFAULT_STORE_ID = '3991';

const IN_STOCK_STATUSES = new Set([
  'IN_STOCK',
  'AVAILABLE',
  'PRE_ORDER_SELLABLE',
  'BACKORDER_SELLABLE',
]);
const OUT_OF_STOCK_STATUSES = new Set([
  'OUT_OF_STOCK',
  'UNAVAILABLE',
  'TEMPORARILY_OUT_OF_STOCK',
  'NOT_SOLD_ONLINE',
  'DISCONTINUED',
]);

// undici hides the root cause (e.g. ECONNREFUSED) behind "fetch failed".
function errorDetail(err) {
  const cause = err?.cause?.code || err?.cause?.message;
  return cause ? `${err.message} (${cause})` : err.message;
}

function interpretAvailabilityStatus(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase().replace(/\s+/g, '_');
  if (IN_STOCK_STATUSES.has(normalized)) return 'in_stock';
  if (OUT_OF_STOCK_STATUSES.has(normalized)) return 'out_of_stock';
  return null;
}

// Derive a status from a fulfillment-ish object. Handles the full redsky
// fulfillment shape as well as simpler shapes (available/in_stock booleans).
function interpretStock(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.sold_out === true || obj.is_out_of_stock_in_all_store_locations === true) {
    return 'out_of_stock';
  }
  const shipping = obj.shipping_options;
  if (shipping && typeof shipping === 'object') {
    const byStatus = interpretAvailabilityStatus(shipping.availability_status);
    if (byStatus) return byStatus;
    if (typeof shipping.available_to_promise_quantity === 'number') {
      return shipping.available_to_promise_quantity > 0 ? 'in_stock' : 'out_of_stock';
    }
  }
  const byStatus = interpretAvailabilityStatus(obj.availability_status ?? obj.availability);
  if (byStatus) return byStatus;
  if (typeof obj.available_to_promise_quantity === 'number') {
    return obj.available_to_promise_quantity > 0 ? 'in_stock' : 'out_of_stock';
  }
  if (typeof obj.available === 'boolean') return obj.available ? 'in_stock' : 'out_of_stock';
  if (typeof obj.in_stock === 'boolean') return obj.in_stock ? 'in_stock' : 'out_of_stock';
  if (obj.sold_out === false) return 'in_stock';
  return null;
}

export async function check(watch) {
  const base = process.env.TARGET_BASE_URL || 'https://redsky.target.com';
  const storeId = watch.store_id || DEFAULT_STORE_ID;
  const params = new URLSearchParams({
    key: PUBLIC_WEB_KEY,
    tcin: String(watch.sku),
    store_id: storeId,
    pricing_store_id: storeId,
  });
  if (watch.zip_code) params.set('zip', watch.zip_code);
  const url = `${base}/redsky_aggregations/v1/web/pdp_fulfillment_v1?${params}`;

  let data;
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return { status: 'error', detail: `Target returned HTTP ${res.status}` };
    }
    try {
      data = await res.json();
    } catch {
      return { status: 'unknown', detail: 'Target response was not valid JSON' };
    }
  } catch (err) {
    return { status: 'error', detail: errorDetail(err) };
  }

  // Try the canonical redsky shape first, then progressively simpler ones.
  const candidates = [
    data?.data?.product?.fulfillment,
    data?.product?.fulfillment,
    data?.fulfillment,
    data,
  ];
  for (const candidate of candidates) {
    const status = interpretStock(candidate);
    if (status) return { status };
  }
  return { status: 'unknown', detail: 'unrecognized Target response shape' };
}
