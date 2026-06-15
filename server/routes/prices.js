import { Router } from 'express';
import { getSetting } from '../db.js';
import { searchCards, getCardPrices } from '../services/prices.js';
import { identifyCard } from '../services/scan.js';

const router = Router();

// Pull the base64 payload + media type out of either a data: URL or explicit fields.
function parseImage(body) {
  if (typeof body?.image === 'string') {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(body.image.trim());
    if (match) return { data: match[2], mediaType: match[1] };
    return { data: body.image.trim(), mediaType: body.media_type || 'image/jpeg' };
  }
  if (typeof body?.image_base64 === 'string') {
    return { data: body.image_base64, mediaType: body.media_type || 'image/jpeg' };
  }
  return null;
}

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

// POST /api/prices/scan — identify a card from a photo, then price it.
// Body: { image: "data:image/jpeg;base64,…" } (or { image_base64, media_type }).
router.post('/scan', async (req, res, next) => {
  try {
    const image = parseImage(req.body);
    if (!image || !image.data) {
      return res.status(400).json({ error: 'an image is required (data URL or base64)' });
    }
    const identified = await identifyCard(image.data, image.mediaType);
    const pct = sellPercentage();
    if (!identified.found || !identified.name) {
      return res.json({ identified, cards: [], page: 1, totalCount: 0, sell_percentage: pct });
    }
    // Search by the recognized name plus number (falls back to name-only if the
    // number doesn't match), so a scan lands on the exact printing.
    const q = [identified.name, identified.card_number].filter(Boolean).join(' ');
    const result = await searchCards({ q, page: 1, pageSize: 20 });
    res.json({
      identified,
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
