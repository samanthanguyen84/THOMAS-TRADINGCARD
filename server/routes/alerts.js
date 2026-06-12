import { Router } from 'express';
import db from '../db.js';

const router = Router();

// GET /api/alerts?unseen=1&limit=50 — newest first, joined with watch info.
router.get('/', (req, res) => {
  const unseenOnly = req.query.unseen === '1' || req.query.unseen === 'true';
  let limit = Number.parseInt(req.query.limit, 10);
  if (!Number.isInteger(limit) || limit < 1) limit = 50;

  const alerts = db
    .prepare(
      `SELECT a.*, w.retailer, w.product_name, w.sku
       FROM alerts a
       LEFT JOIN watches w ON w.id = a.watch_id
       ${unseenOnly ? 'WHERE a.seen = 0' : ''}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ?`
    )
    .all(limit);
  res.json({ alerts });
});

// POST /api/alerts/mark-seen — body { ids?: number[] }; all unseen if omitted.
router.post('/mark-seen', (req, res) => {
  const { ids } = req.body || {};
  if (ids === undefined || ids === null) {
    const info = db.prepare('UPDATE alerts SET seen = 1 WHERE seen = 0').run();
    return res.json({ ok: true, updated: info.changes });
  }
  if (!Array.isArray(ids) || ids.some((id) => !Number.isInteger(id))) {
    return res.status(400).json({ error: 'ids must be an array of integers' });
  }
  if (ids.length === 0) {
    return res.json({ ok: true, updated: 0 });
  }
  const placeholders = ids.map(() => '?').join(', ');
  const info = db
    .prepare(`UPDATE alerts SET seen = 1 WHERE seen = 0 AND id IN (${placeholders})`)
    .run(...ids);
  res.json({ ok: true, updated: info.changes });
});

export default router;
