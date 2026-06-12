import { Router } from 'express';
import { getSetting } from '../db.js';
import { searchCards, getCardPrices } from '../services/prices.js';

const router = Router();

function sellPercentage() {
  const value = Number(getSetting('sell_percentage'));
  return Number.isFinite(value) ? value : 80;
}

// Attach suggested asking prices, computed at request time from the current
// sell_percentage setting (never cached): round(market * pct/100, 2).
function withSuggested(card, pct) {
  const suggested = {};
  for (const [variant, prices] of Object.entries(card.prices || {})) {
    const market = prices?.market;
    if (typeof market === 'number' && Number.isFinite(market)) {
      suggested[variant] = Math.round(market * pct) / 100;
    }
  }
  return { ...card, suggested };
}

function positiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}

// GET /api/prices/search?q=&page=&pageSize=
router.get('/search', async (req, res, next) => {
  try {
    const raw = typeof req.query.q === 'string' ? req.query.q : '';
    const q = raw.replace(/"/g, '').trim();
    if (!q) {
      return res.status(400).json({ error: 'query parameter q is required' });
    }
    const page = positiveInt(req.query.page, 1);
    const pageSize = positiveInt(req.query.pageSize, 20);
    const result = await searchCards({ q, page, pageSize });
    const pct = sellPercentage();
    res.json({
      cards: result.cards.map((card) => withSuggested(card, pct)),
      page: result.page,
      totalCount: result.totalCount,
      sell_percentage: pct,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/prices/card/:tcgCardId
router.get('/card/:tcgCardId', async (req, res, next) => {
  try {
    const card = await getCardPrices(req.params.tcgCardId);
    if (!card) {
      return res.status(404).json({ error: 'card not found' });
    }
    const pct = sellPercentage();
    res.json({ ...withSuggested(card, pct), sell_percentage: pct });
  } catch (err) {
    next(err);
  }
});

export default router;
