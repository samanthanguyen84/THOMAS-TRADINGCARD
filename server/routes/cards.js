import express from 'express';
import db from '../db.js';

const router = express.Router();

const SORT_COLUMNS = ['name', 'set_name', 'quantity', 'market_price', 'cost_basis', 'created_at'];
const PATCH_COLUMNS = [
  'name', 'set_name', 'card_number', 'variant', 'condition', 'quantity',
  'cost_basis', 'market_price', 'price_updated_at', 'image_url', 'tcg_card_id', 'notes',
];

const getCardStmt = db.prepare('SELECT * FROM cards WHERE id = ?');
const showExistsStmt = db.prepare('SELECT id FROM shows WHERE id = ?');
const getTransactionStmt = db.prepare('SELECT * FROM transactions WHERE id = ?');
const insertTransactionStmt = db.prepare(`
  INSERT INTO transactions (type, card_id, show_id, quantity, unit_price, total, description, date)
  VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
`);

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
}

// Validates the optional show_id/date pair used by purchase/sale logging.
// Returns an error string or null; writes parsed values onto `out`.
function checkShowAndDate(body, out) {
  out.show_id = null;
  out.date = null;
  if (body.show_id !== undefined && body.show_id !== null) {
    const showId = Number(body.show_id);
    if (!Number.isInteger(showId) || !showExistsStmt.get(showId)) return 'show not found';
    out.show_id = showId;
  }
  if (body.date !== undefined && body.date !== null) {
    if (typeof body.date !== 'string' || body.date.trim() === '') return 'date must be a non-empty string';
    out.date = body.date;
  }
  return null;
}

// GET /api/cards?search=&sort=&order=
router.get('/', (req, res) => {
  const { search, sort = 'created_at', order = 'desc' } = req.query;
  if (!SORT_COLUMNS.includes(sort)) {
    return res.status(400).json({ error: `sort must be one of: ${SORT_COLUMNS.join(', ')}` });
  }
  if (order !== 'asc' && order !== 'desc') {
    return res.status(400).json({ error: 'order must be asc or desc' });
  }
  const params = [];
  let where = '';
  if (search) {
    where = 'WHERE name LIKE ? OR set_name LIKE ? OR card_number LIKE ?';
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  const cards = db
    .prepare(`SELECT * FROM cards ${where} ORDER BY ${sort} ${order.toUpperCase()}, id DESC`)
    .all(...params);
  res.json({ cards, count: cards.length });
});

// POST /api/cards
router.post('/', (req, res) => {
  const body = req.body || {};
  if (typeof body.name !== 'string' || body.name.trim() === '') {
    return res.status(400).json({ error: 'name is required' });
  }
  const quantity = body.quantity === undefined ? 0 : toNumber(body.quantity);
  if (!Number.isInteger(quantity) || quantity < 0) {
    return res.status(400).json({ error: 'quantity must be an integer >= 0' });
  }
  const costBasis = body.cost_basis === undefined ? 0 : toNumber(body.cost_basis);
  if (!Number.isFinite(costBasis) || costBasis < 0) {
    return res.status(400).json({ error: 'cost_basis must be a number >= 0' });
  }
  let marketPrice = null;
  if (body.market_price !== undefined && body.market_price !== null) {
    marketPrice = toNumber(body.market_price);
    if (!Number.isFinite(marketPrice) || marketPrice < 0) {
      return res.status(400).json({ error: 'market_price must be a number >= 0' });
    }
  }
  const opts = {};
  const optsError = checkShowAndDate(body, opts);
  if (optsError) return res.status(400).json({ error: optsError });
  const logPurchase = body.log_purchase !== false && body.log_purchase !== 0;

  const insertCard = db.prepare(`
    INSERT INTO cards (name, set_name, card_number, variant, condition, quantity,
                       cost_basis, market_price, price_updated_at, image_url, tcg_card_id, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const create = db.transaction(() => {
    const info = insertCard.run(
      body.name.trim(),
      body.set_name ?? '',
      body.card_number ?? '',
      body.variant ?? 'normal',
      body.condition ?? 'NM',
      quantity,
      costBasis,
      marketPrice,
      marketPrice === null ? null : new Date().toISOString(),
      body.image_url ?? '',
      body.tcg_card_id ?? '',
      body.notes ?? ''
    );
    const cardId = info.lastInsertRowid;
    if (logPurchase && quantity > 0) {
      insertTransactionStmt.run(
        'purchase', cardId, opts.show_id, quantity, costBasis,
        quantity * costBasis, `Bought ${quantity}x ${body.name.trim()}`, opts.date
      );
    }
    return cardId;
  });
  const cardId = create();
  res.status(201).json(getCardStmt.get(cardId));
});

// GET /api/cards/:id
router.get('/:id', (req, res) => {
  const card = getCardStmt.get(parseId(req.params.id));
  if (!card) return res.status(404).json({ error: 'card not found' });
  res.json(card);
});

// PATCH /api/cards/:id
router.patch('/:id', (req, res) => {
  const card = getCardStmt.get(parseId(req.params.id));
  if (!card) return res.status(404).json({ error: 'card not found' });
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
    } else if (key === 'quantity') {
      const quantity = toNumber(value);
      if (!Number.isInteger(quantity) || quantity < 0) {
        return res.status(400).json({ error: 'quantity must be an integer >= 0' });
      }
      params.push(quantity);
    } else if (key === 'cost_basis' || key === 'market_price') {
      if (key === 'market_price' && value === null) {
        params.push(null);
      } else {
        const num = toNumber(value);
        if (!Number.isFinite(num) || num < 0) {
          return res.status(400).json({ error: `${key} must be a number >= 0` });
        }
        params.push(num);
      }
    } else {
      if (value !== null && typeof value !== 'string') {
        return res.status(400).json({ error: `${key} must be a string` });
      }
      params.push(value ?? '');
    }
    sets.push(`${key} = ?`);
  }
  if (sets.length === 0) return res.status(400).json({ error: 'no fields to update' });
  params.push(card.id);
  db.prepare(`UPDATE cards SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  res.json(getCardStmt.get(card.id));
});

// DELETE /api/cards/:id
router.delete('/:id', (req, res) => {
  const card = getCardStmt.get(parseId(req.params.id));
  if (!card) return res.status(404).json({ error: 'card not found' });
  db.prepare('DELETE FROM cards WHERE id = ?').run(card.id);
  res.json({ ok: true });
});

// POST /api/cards/:id/sell
router.post('/:id/sell', (req, res) => {
  const card = getCardStmt.get(parseId(req.params.id));
  if (!card) return res.status(404).json({ error: 'card not found' });
  const body = req.body || {};
  const quantity = toNumber(body.quantity);
  if (!Number.isInteger(quantity) || quantity < 1) {
    return res.status(400).json({ error: 'quantity must be an integer >= 1' });
  }
  const unitPrice = toNumber(body.unit_price);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    return res.status(400).json({ error: 'unit_price must be a number >= 0' });
  }
  if (quantity > card.quantity) {
    return res.status(400).json({ error: `only ${card.quantity} in stock` });
  }
  const opts = {};
  const optsError = checkShowAndDate(body, opts);
  if (optsError) return res.status(400).json({ error: optsError });
  const description =
    typeof body.notes === 'string' && body.notes.trim() !== ''
      ? body.notes
      : `Sold ${quantity}x ${card.name}`;

  const sell = db.transaction(() => {
    db.prepare('UPDATE cards SET quantity = quantity - ? WHERE id = ?').run(quantity, card.id);
    const info = insertTransactionStmt.run(
      'sale', card.id, opts.show_id, quantity, unitPrice,
      quantity * unitPrice, description, opts.date
    );
    return info.lastInsertRowid;
  });
  const txId = sell();
  res.json({ card: getCardStmt.get(card.id), transaction: getTransactionStmt.get(txId) });
});

// POST /api/cards/:id/restock
router.post('/:id/restock', (req, res) => {
  const card = getCardStmt.get(parseId(req.params.id));
  if (!card) return res.status(404).json({ error: 'card not found' });
  const body = req.body || {};
  const quantity = toNumber(body.quantity);
  if (!Number.isInteger(quantity) || quantity < 1) {
    return res.status(400).json({ error: 'quantity must be an integer >= 1' });
  }
  const unitCost = toNumber(body.unit_cost);
  if (!Number.isFinite(unitCost) || unitCost < 0) {
    return res.status(400).json({ error: 'unit_cost must be a number >= 0' });
  }
  const opts = {};
  const optsError = checkShowAndDate(body, opts);
  if (optsError) return res.status(400).json({ error: optsError });

  const newQuantity = card.quantity + quantity;
  const newCostBasis = (card.quantity * card.cost_basis + quantity * unitCost) / newQuantity;
  const restock = db.transaction(() => {
    db.prepare('UPDATE cards SET quantity = ?, cost_basis = ? WHERE id = ?')
      .run(newQuantity, newCostBasis, card.id);
    const info = insertTransactionStmt.run(
      'purchase', card.id, opts.show_id, quantity, unitCost,
      quantity * unitCost, `Bought ${quantity}x ${card.name}`, opts.date
    );
    return info.lastInsertRowid;
  });
  const txId = restock();
  res.json({ card: getCardStmt.get(card.id), transaction: getTransactionStmt.get(txId) });
});

// POST /api/cards/:id/refresh-price
router.post('/:id/refresh-price', async (req, res) => {
  const card = getCardStmt.get(parseId(req.params.id));
  if (!card) return res.status(404).json({ error: 'card not found' });
  if (!card.tcg_card_id) {
    return res.status(400).json({ error: 'card has no tcg_card_id' });
  }
  let priced;
  try {
    const { getCardPrices } = await import('../services/prices.js');
    priced = await getCardPrices(card.tcg_card_id);
  } catch (err) {
    const message =
      err.code === 'ERR_MODULE_NOT_FOUND'
        ? 'price service unavailable'
        : err.message || 'price service unavailable';
    return res.status(err.status || 502).json({ error: message });
  }
  if (!priced) return res.status(404).json({ error: 'card not found on price service' });
  const prices = priced.prices || {};
  let market = prices[card.variant]?.market;
  if (market === undefined || market === null) {
    for (const variant of Object.keys(prices)) {
      if (prices[variant]?.market !== undefined && prices[variant]?.market !== null) {
        market = prices[variant].market;
        break;
      }
    }
  }
  if (market === undefined || market === null) {
    return res.status(400).json({ error: 'no market price available for this card' });
  }
  db.prepare("UPDATE cards SET market_price = ?, price_updated_at = datetime('now') WHERE id = ?")
    .run(market, card.id);
  res.json(getCardStmt.get(card.id));
});

export default router;
