import express from 'express';
import db from '../db.js';

const router = express.Router();

const PATCH_COLUMNS = ['name', 'date', 'venue', 'table_fee', 'notes'];

const getShowStmt = db.prepare('SELECT * FROM shows WHERE id = ?');
const TOTALS_SELECT = `
  COALESCE(SUM(CASE WHEN t.type = 'sale' THEN t.total END), 0) AS sales_total,
  COALESCE(SUM(CASE WHEN t.type = 'purchase' THEN t.total END), 0) AS purchases_total,
  COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.total END), 0) AS expenses_total
`;

function round2(n) {
  return Math.round(n * 100) / 100;
}

function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
}

function withNet(row) {
  return {
    ...row,
    sales_total: round2(row.sales_total),
    purchases_total: round2(row.purchases_total),
    expenses_total: round2(row.expenses_total),
    net: round2(row.sales_total - row.purchases_total - row.expenses_total - row.table_fee),
  };
}

// GET /api/shows
router.get('/', (req, res) => {
  const rows = db
    .prepare(`
      SELECT s.*, ${TOTALS_SELECT}
      FROM shows s
      LEFT JOIN transactions t ON t.show_id = s.id
      GROUP BY s.id
      ORDER BY s.date DESC, s.id DESC
    `)
    .all();
  res.json({ shows: rows.map(withNet) });
});

// POST /api/shows
router.post('/', (req, res) => {
  const body = req.body || {};
  if (typeof body.name !== 'string' || body.name.trim() === '') {
    return res.status(400).json({ error: 'name is required' });
  }
  let tableFee = 0;
  if (body.table_fee !== undefined && body.table_fee !== null) {
    tableFee = toNumber(body.table_fee);
    if (!Number.isFinite(tableFee) || tableFee < 0) {
      return res.status(400).json({ error: 'table_fee must be a number >= 0' });
    }
  }
  const info = db
    .prepare('INSERT INTO shows (name, date, venue, table_fee, notes) VALUES (?, ?, ?, ?, ?)')
    .run(body.name.trim(), body.date ?? '', body.venue ?? '', tableFee, body.notes ?? '');
  res.status(201).json(getShowStmt.get(info.lastInsertRowid));
});

// GET /api/shows/:id
router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const show = Number.isInteger(id) ? getShowStmt.get(id) : undefined;
  if (!show) return res.status(404).json({ error: 'show not found' });
  const totals = db
    .prepare(`
      SELECT ${TOTALS_SELECT}
      FROM transactions t
      WHERE t.show_id = ?
    `)
    .get(id);
  const transactions = db
    .prepare(`
      SELECT t.*, c.name AS card_name
      FROM transactions t
      LEFT JOIN cards c ON c.id = t.card_id
      WHERE t.show_id = ?
      ORDER BY t.date DESC, t.id DESC
    `)
    .all(id);
  res.json({ ...withNet({ ...show, ...totals }), transactions });
});

// PATCH /api/shows/:id
router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const show = Number.isInteger(id) ? getShowStmt.get(id) : undefined;
  if (!show) return res.status(404).json({ error: 'show not found' });
  const body = req.body || {};
  const sets = [];
  const params = [];
  for (const [key, value] of Object.entries(body)) {
    if (!PATCH_COLUMNS.includes(key)) {
      return res.status(400).json({ error: `unknown field: ${key}` });
    }
    if (key === 'name') {
      if (typeof value !== 'string' || value.trim() === '') {
        return res.status(400).json({ error: 'name must be a non-empty string' });
      }
      params.push(value.trim());
    } else if (key === 'table_fee') {
      const fee = toNumber(value);
      if (!Number.isFinite(fee) || fee < 0) {
        return res.status(400).json({ error: 'table_fee must be a number >= 0' });
      }
      params.push(fee);
    } else {
      if (value !== null && typeof value !== 'string') {
        return res.status(400).json({ error: `${key} must be a string` });
      }
      params.push(value ?? '');
    }
    sets.push(`${key} = ?`);
  }
  if (sets.length === 0) return res.status(400).json({ error: 'no fields to update' });
  params.push(id);
  db.prepare(`UPDATE shows SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  res.json(getShowStmt.get(id));
});

// DELETE /api/shows/:id — transactions keep existing via show_id -> NULL.
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const show = Number.isInteger(id) ? getShowStmt.get(id) : undefined;
  if (!show) return res.status(404).json({ error: 'show not found' });
  db.prepare('DELETE FROM shows WHERE id = ?').run(id);
  res.json({ ok: true });
});

export default router;
