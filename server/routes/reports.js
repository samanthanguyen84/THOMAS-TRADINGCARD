import express from 'express';
import db, { getSetting } from '../db.js';

const router = express.Router();

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Builds a transactions date-range WHERE clause. A date-only `to` bound
// includes that whole day.
function dateRange(from, to) {
  const where = [];
  const params = [];
  if (from) {
    where.push('date >= ?');
    params.push(from);
  }
  if (to) {
    if (DATE_ONLY.test(to)) {
      where.push("date < date(?, '+1 day')");
    } else {
      where.push('date <= ?');
    }
    params.push(to);
  }
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

// GET /api/reports/summary?from=&to=
router.get('/summary', (req, res) => {
  const { clause, params } = dateRange(req.query.from, req.query.to);
  const totals = db
    .prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'sale' THEN total END), 0) AS sales_total,
        COALESCE(SUM(CASE WHEN type = 'purchase' THEN total END), 0) AS purchases_total,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN total END), 0) AS expenses_total,
        COALESCE(SUM(CASE WHEN type = 'adjustment' THEN total END), 0) AS adjustments_total,
        COALESCE(SUM(CASE WHEN type = 'sale' THEN 1 END), 0) AS sales_count,
        COALESCE(SUM(CASE WHEN type = 'sale' THEN quantity END), 0) AS cards_sold
      FROM transactions ${clause}
    `)
    .get(...params);
  const inventory = db
    .prepare(`
      SELECT
        COUNT(*) AS unique_cards,
        COALESCE(SUM(quantity), 0) AS total_quantity,
        COALESCE(SUM(quantity * cost_basis), 0) AS cost_value,
        COALESCE(SUM(CASE WHEN market_price IS NOT NULL THEN quantity * market_price END), 0) AS market_value
      FROM cards
    `)
    .get();
  const sellPercentage = Number(getSetting('sell_percentage')) || 80;
  res.json({
    sales_total: round2(totals.sales_total),
    purchases_total: round2(totals.purchases_total),
    expenses_total: round2(totals.expenses_total),
    adjustments_total: round2(totals.adjustments_total),
    net_profit: round2(
      totals.sales_total - totals.purchases_total - totals.expenses_total + totals.adjustments_total
    ),
    sales_count: totals.sales_count,
    cards_sold: totals.cards_sold,
    inventory: {
      unique_cards: inventory.unique_cards,
      total_quantity: inventory.total_quantity,
      cost_value: round2(inventory.cost_value),
      market_value: round2(inventory.market_value),
      asking_value: round2((inventory.market_value * sellPercentage) / 100),
    },
    sell_percentage: sellPercentage,
  });
});

// GET /api/reports/monthly?months=12
router.get('/monthly', (req, res) => {
  let months = 12;
  if (req.query.months !== undefined) {
    months = Number(req.query.months);
    if (!Number.isInteger(months) || months < 1) {
      return res.status(400).json({ error: 'months must be an integer >= 1' });
    }
  }
  const rows = db
    .prepare(`
      SELECT
        substr(date, 1, 7) AS month,
        COALESCE(SUM(CASE WHEN type = 'sale' THEN total END), 0) AS sales,
        COALESCE(SUM(CASE WHEN type = 'purchase' THEN total END), 0) AS purchases,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN total END), 0) AS expenses,
        COALESCE(SUM(CASE WHEN type = 'adjustment' THEN total END), 0) AS adjustments
      FROM transactions
      GROUP BY month
    `)
    .all();
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  const now = new Date();
  const result = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const row = byMonth.get(key) || { sales: 0, purchases: 0, expenses: 0, adjustments: 0 };
    result.push({
      month: key,
      sales: round2(row.sales),
      purchases: round2(row.purchases),
      expenses: round2(row.expenses),
      net: round2(row.sales - row.purchases - row.expenses + row.adjustments),
    });
  }
  res.json({ months: result });
});

// GET /api/reports/top-cards?limit=10
router.get('/top-cards', (req, res) => {
  let limit = 10;
  if (req.query.limit !== undefined) {
    limit = Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1) {
      return res.status(400).json({ error: 'limit must be an integer >= 1' });
    }
  }
  const rows = db
    .prepare(`
      SELECT
        t.card_id,
        c.name,
        c.set_name,
        c.cost_basis,
        SUM(t.quantity) AS qty_sold,
        SUM(t.total) AS revenue
      FROM transactions t
      JOIN cards c ON c.id = t.card_id
      WHERE t.type = 'sale'
      GROUP BY t.card_id
      ORDER BY revenue DESC
      LIMIT ?
    `)
    .all(limit);
  res.json({
    top_cards: rows.map((r) => ({
      card_id: r.card_id,
      name: r.name,
      set_name: r.set_name,
      qty_sold: r.qty_sold,
      revenue: round2(r.revenue),
      profit: round2(r.revenue - r.qty_sold * r.cost_basis),
    })),
  });
});

export default router;
