// Formatting + small domain helpers shared across pages.

export function fmtMoney(value, { sign = false } = {}) {
  if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) {
    return '—';
  }
  const n = Number(value);
  const abs = Math.abs(n).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
  if (n < 0) return `−${abs}`;
  return sign ? `+${abs}` : abs;
}

// Parse the date shapes the API can return:
//  - "YYYY-MM-DD"            (treated as a local calendar date)
//  - "YYYY-MM-DD HH:MM:SS"   (SQLite datetime('now') — UTC)
//  - full ISO datetime
export function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) {
    return new Date(s.replace(' ', 'T') + 'Z');
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDate(value) {
  const d = parseDate(value);
  if (!d) return '—';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function fmtDateTime(value) {
  const d = parseDate(value);
  if (!d) return '—';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function timeAgo(value) {
  const d = parseDate(value);
  if (!d) return 'never';
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 45) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(d);
}

export function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "2026-06" -> "Jun"
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function monthLabel(month) {
  if (!month) return '';
  const [, m] = String(month).split('-');
  return MONTH_NAMES[Number(m) - 1] || month;
}
export function monthLabelFull(month) {
  if (!month) return '';
  const [y, m] = String(month).split('-');
  return `${MONTH_NAMES[Number(m) - 1] || m} ${y}`;
}

// TCGplayer variant keys.
export const VARIANTS = [
  'normal',
  'holofoil',
  'reverseHolofoil',
  '1stEditionHolofoil',
  '1stEditionNormal',
  'unlimitedHolofoil',
  'unlimited',
];

const VARIANT_LABELS = {
  normal: 'Normal',
  holofoil: 'Holofoil',
  reverseHolofoil: 'Reverse Holofoil',
  '1stEditionHolofoil': '1st Edition Holofoil',
  '1stEditionNormal': '1st Edition Normal',
  unlimitedHolofoil: 'Unlimited Holofoil',
  unlimited: 'Unlimited',
};

export function variantLabel(variant) {
  if (!variant) return '—';
  if (VARIANT_LABELS[variant]) return VARIANT_LABELS[variant];
  return variant
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^\w/, (c) => c.toUpperCase());
}

export const CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DMG'];

// Thomas's asking price: market price × sell percentage, rounded to cents.
export function suggestedPrice(marketPrice, sellPercentage) {
  if (marketPrice === null || marketPrice === undefined || marketPrice === '') return null;
  const m = Number(marketPrice);
  const pct = Number(sellPercentage);
  if (Number.isNaN(m) || Number.isNaN(pct)) return null;
  return Math.round(m * pct) / 100;
}

// Signed view of a transaction amount (totals are stored positive,
// type decides direction; adjustments are already signed).
export function txSigned(tx) {
  const total = Number(tx.total) || 0;
  if (tx.type === 'sale') return total;
  if (tx.type === 'purchase' || tx.type === 'expense') return -total;
  return total; // adjustment: signed as stored
}
