// Barnes & Noble stock checker. Fetches the product page by EAN and applies
// best-effort text heuristics. Returns
// { status: 'in_stock'|'out_of_stock'|'unknown'|'error', detail? }.

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const OUT_OF_STOCK_MARKERS = ['out of stock', 'unavailable', 'notify me'];
const IN_STOCK_MARKERS = ['add to cart', 'add to bag'];

// undici hides the root cause (e.g. ECONNREFUSED) behind "fetch failed".
function errorDetail(err) {
  const cause = err?.cause?.code || err?.cause?.message;
  return cause ? `${err.message} (${cause})` : err.message;
}

export async function check(watch) {
  const base = process.env.BN_BASE_URL || 'https://www.barnesandnoble.com';
  const url = `${base}/w/?ean=${encodeURIComponent(String(watch.sku))}`;

  let html;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return { status: 'error', detail: `Barnes & Noble returned HTTP ${res.status}` };
    }
    html = (await res.text()).toLowerCase();
  } catch (err) {
    return { status: 'error', detail: errorDetail(err) };
  }

  if (OUT_OF_STOCK_MARKERS.some((marker) => html.includes(marker))) {
    return { status: 'out_of_stock' };
  }
  if (IN_STOCK_MARKERS.some((marker) => html.includes(marker))) {
    return { status: 'in_stock' };
  }
  return { status: 'unknown', detail: 'no stock markers found on Barnes & Noble page' };
}
