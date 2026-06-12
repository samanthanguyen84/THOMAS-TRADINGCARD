import { Router } from 'express';
import db from '../db.js';
import { checkWatch } from '../services/watcher.js';

const router = Router();

const RETAILERS = ['target', 'bestbuy', 'barnesnoble'];

function getWatch(id) {
  return db.prepare('SELECT * FROM watches WHERE id = ?').get(id);
}

// GET /api/watches — all watches, newest first.
router.get('/', (req, res) => {
  const watches = db.prepare('SELECT * FROM watches ORDER BY created_at DESC, id DESC').all();
  res.json({ watches });
});

// POST /api/watches — create a watch.
router.post('/', (req, res) => {
  const { retailer, sku, product_name, zip_code, store_id } = req.body || {};
  if (!RETAILERS.includes(retailer)) {
    return res.status(400).json({ error: `retailer must be one of: ${RETAILERS.join(', ')}` });
  }
  if (sku === undefined || sku === null || String(sku).trim() === '') {
    return res.status(400).json({ error: 'sku is required' });
  }
  const info = db
    .prepare(
      'INSERT INTO watches (retailer, sku, product_name, zip_code, store_id) VALUES (?, ?, ?, ?, ?)'
    )
    .run(
      retailer,
      String(sku).trim(),
      product_name != null ? String(product_name) : '',
      zip_code != null ? String(zip_code) : '',
      store_id != null ? String(store_id) : ''
    );
  res.status(201).json(getWatch(info.lastInsertRowid));
});

// PATCH /api/watches/:id — update a subset of fields.
router.patch('/:id', (req, res) => {
  const watch = getWatch(req.params.id);
  if (!watch) return res.status(404).json({ error: 'watch not found' });

  const body = req.body || {};
  const sets = [];
  const values = [];

  if ('sku' in body) {
    if (body.sku === undefined || body.sku === null || String(body.sku).trim() === '') {
      return res.status(400).json({ error: 'sku cannot be empty' });
    }
    sets.push('sku = ?');
    values.push(String(body.sku).trim());
  }
  for (const field of ['product_name', 'zip_code', 'store_id']) {
    if (field in body) {
      sets.push(`${field} = ?`);
      values.push(body[field] != null ? String(body[field]) : '');
    }
  }
  if ('active' in body) {
    sets.push('active = ?');
    values.push(body.active === true || body.active === 1 || body.active === '1' ? 1 : 0);
  }

  if (sets.length === 0) {
    return res.status(400).json({ error: 'no updatable fields provided' });
  }
  values.push(watch.id);
  db.prepare(`UPDATE watches SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  res.json(getWatch(watch.id));
});

// DELETE /api/watches/:id — remove the watch (alerts cascade).
router.delete('/:id', (req, res) => {
  const watch = getWatch(req.params.id);
  if (!watch) return res.status(404).json({ error: 'watch not found' });
  db.prepare('DELETE FROM watches WHERE id = ?').run(watch.id);
  res.json({ ok: true });
});

// POST /api/watches/:id/check — run the retailer check now.
router.post('/:id/check', async (req, res, next) => {
  const watch = getWatch(req.params.id);
  if (!watch) return res.status(404).json({ error: 'watch not found' });
  try {
    const updated = await checkWatch(watch);
    if (!updated) return res.status(404).json({ error: 'watch not found' });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
