import express from 'express';
import db from '../db.js';

const router = express.Router();

const TYPES = ['purchase', 'sale', 'expense', 'adjustment'];
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const getTransactionStmt = db.prepare('SELECT * FROM transactions WHERE id = ?');
const cardExistsStmt = db.prepare('SELECT id FROM cards WHERE id = ?');
const showExistsStmt = db.prepare('SELECT id FROM shows WHERE id = ?');

function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
}

// GET /api/transactions?type=&from=&to=&show_id=&card_id=&limit=
router.get('/', (req, res) => {
  const { type, from, to, show_id, card_id } = req.query;
  const where = [];
  const params = [];
  if (type !== undefined) {
    if (!TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${TYPES.join(', ')}` });
    }
    where.push('t.type = ?');
    params.push(type);
  }
  if (from) {
    where.push('t.date >= ?');
    params.push(from);
  }
  if (to) {
    if (DATE_ONLY.test(to)) {
      // Include the whole day for a date-only bound.
      where.push("t.date < date(?, '+1 day')");
    } else {
      where.push('t.date <= ?');
    }
    params.push(to);
  }
  if (show_id !== undefined) {
    const showId = Number(show_id);
    if (!Number.isInteger(showId)) {
      return res.status(400).json({ error: 'show_id must be an integer' });
    }
    where.push('t.show_id = ?');
    params.push(showId);
  }
  if (card_id !== undefined) {
    const cardId = Number(card_id);
    if (!Number.isInteger(cardId)) {
      return res.status(400).json({ error: 'card_id must be an integer' });
    }
    where.push('t.card_id = ?');
    params.push(cardId);
  }
  let limit = 200;
  if (req.query.limit !== undefined) {
    limit = Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1) {
      return res.status(400).json({ error: 'limit must be an integer >= 1' });
    }
  }
  const transactions = db
    .prepare(`
      SELECT t.*, c.name AS card_name, s.name AS show_name
      FROM transactions t
      LEFT JOIN cards c ON c.id = t.card_id
      LEFT JOIN shows s ON s.id = t.show_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY t.date DESC, t.id DESC
      LIMIT ?
    `)
    .all(...params, limit);
  res.json({ transactions, count: transactions.length });
});

// POST /api/transactions — manual entries (fees, gas, food, adjustments).
router.post('/', (req, res) => {
  const body = req.body || {};
  if (!TYPES.includes(body.type)) {
    return res.status(400).json({ error: `type must be one of: ${TYPES.join(', ')}` });
  }
  const total = toNumber(body.total);
  if (!Number.isFinite(total)) {
    return res.status(400).json({ error: 'total must be a number' });
  }
  if (body.type !== 'adjustment' && total < 0) {
    return res.status(400).json({ error: 'total must be >= 0 (only adjustments may be negative)' });
  }
  let quantity = 1;
  if (body.quantity !== undefined && body.quantity !== null) {
    quantity = toNumber(body.quantity);
    if (!Number.isInteger(quantity) || quantity < 0) {
      return res.status(400).json({ error: 'quantity must be an integer >= 0' });
    }
  }
  let unitPrice = 0;
  if (body.unit_price !== undefined && body.unit_price !== null) {
    unitPrice = toNumber(body.unit_price);
    if (!Number.isFinite(unitPrice)) {
      return res.status(400).json({ error: 'unit_price must be a number' });
    }
  }
  let cardId = null;
  if (body.card_id !== undefined && body.card_id !== null) {
    cardId = Number(body.card_id);
    if (!Number.isInteger(cardId) || !cardExistsStmt.get(cardId)) {
      return res.status(400).json({ error: 'card not found' });
    }
  }
  let showId = null;
  if (body.show_id !== undefined && body.show_id !== null) {
    showId = Number(body.show_id);
    if (!Number.isInteger(showId) || !showExistsStmt.get(showId)) {
      return res.status(400).json({ error: 'show not found' });
    }
  }
  const info = db
    .prepare(`
      INSERT INTO transactions (type, card_id, show_id, quantity, unit_price, total, description, date)
      VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
    `)
    .run(body.type, cardId, showId, quantity, unitPrice, total, body.description ?? '', body.date ?? null);
  res.status(201).json(getTransactionStmt.get(info.lastInsertRowid));
});

// PATCH /api/transactions/:id — edit a transaction's show, description, date,
// or amount. Does NOT change card quantities or type (use delete + re-create for
// those). The main use is assigning an existing sale to a show after the fact.
const joinedTransactionStmt = db.prepare(`
  SELECT t.*, c.name AS card_name, s.name AS show_name
  FROM transactions t
  LEFT JOIN cards c ON c.id = t.card_id
  LEFT JOIN shows s ON s.id = t.show_id
  WHERE t.id = ?
`);

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = Number.isInteger(id) ? getTransactionStmt.get(id) : undefined;
  if (!existing) return res.status(404).json({ error: 'transaction not found' });

  const body = req.body || {};
  const allowed = ['show_id', 'description', 'date', 'unit_price', 'total'];
  const keys = Object.keys(body);
  for (const key of keys) {
    if (!allowed.includes(key)) {
      return res.status(400).json({ error: `cannot edit field: ${key}` });
    }
  }
  if (keys.length === 0) {
    return res.status(400).json({ error: 'no editable fields provided' });
  }

  const sets = [];
  const params = [];

  if ('show_id' in body) {
    if (body.show_id === null || body.show_id === '') {
      sets.push('show_id = NULL');
    } else {
      const showId = Number(body.show_id);
      if (!Number.isInteger(showId) || !showExistsStmt.get(showId)) {
        return res.status(400).json({ error: 'show not found' });
      }
      sets.push('show_id = ?');
      params.push(showId);
    }
  }
  if ('description' in body) {
    sets.push('description = ?');
    params.push(String(body.description ?? ''));
  }
  if ('date' in body) {
    if (!body.date) return res.status(400).json({ error: 'date cannot be empty' });
    sets.push('date = ?');
    params.push(String(body.date));
  }
  if ('unit_price' in body) {
    const unitPrice = toNumber(body.unit_price);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return res.status(400).json({ error: 'unit_price must be a number >= 0' });
    }
    sets.push('unit_price = ?');
    params.push(unitPrice);
  }
  if ('total' in body) {
    const total = toNumber(body.total);
    if (!Number.isFinite(total)) {
      return res.status(400).json({ error: 'total must be a number' });
    }
    if (existing.type !== 'adjustment' && total < 0) {
      return res.status(400).json({ error: 'total must be >= 0 (only adjustments may be negative)' });
    }
    sets.push('total = ?');
    params.push(total);
  }

  db.prepare(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  res.json(joinedTransactionStmt.get(id));
});

// DELETE /api/transactions/:id — undo, restoring card quantities where linked.
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const tx = Number.isInteger(id) ? getTransactionStmt.get(id) : undefined;
  if (!tx) return res.status(404).json({ error: 'transaction not found' });
  const undo = db.transaction(() => {
    if (tx.card_id !== null) {
      if (tx.type === 'sale') {
        db.prepare('UPDATE cards SET quantity = quantity + ? WHERE id = ?').run(tx.quantity, tx.card_id);
      } else if (tx.type === 'purchase') {
        db.prepare('UPDATE cards SET quantity = MAX(0, quantity - ?) WHERE id = ?').run(tx.quantity, tx.card_id);
      }
    }
    db.prepare('DELETE FROM transactions WHERE id = ?').run(tx.id);
  });
  undo();
  res.json({ ok: true });
});

export default router;
