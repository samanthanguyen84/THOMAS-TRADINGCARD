import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
// Generous limit so a downscaled phone photo (base64) fits for /api/prices/scan.
app.use(express.json({ limit: '12mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Route modules are mounted dynamically so the server still boots while
// individual modules are under development.
const ROUTES = [
  ['cards', '/api/cards'],
  ['transactions', '/api/transactions'],
  ['shows', '/api/shows'],
  ['reports', '/api/reports'],
  ['settings', '/api/settings'],
  ['prices', '/api/prices'],
  ['watches', '/api/watches'],
  ['alerts', '/api/alerts'],
];

for (const [name, mountPath] of ROUTES) {
  try {
    const mod = await import(`./routes/${name}.js`);
    app.use(mountPath, mod.default);
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND') {
      console.warn(`[server] route module routes/${name}.js not found, skipping`);
    } else {
      throw err;
    }
  }
}

// Serve the built frontend when it exists (production mode).
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// JSON error handler so API consumers never get an HTML error page.
app.use((err, req, res, next) => {
  console.error('[server]', err);
  res.status(err.status || 500).json({ error: err.message || 'internal server error' });
});

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  console.log(`[server] listening on http://localhost:${port}`);
});

// Start the restock watcher loop if the module exists.
try {
  const watcher = await import('./services/watcher.js');
  if (typeof watcher.startWatcher === 'function' && process.env.DISABLE_WATCHER !== '1') {
    watcher.startWatcher();
  }
} catch (err) {
  if (err.code === 'ERR_MODULE_NOT_FOUND') {
    console.warn('[server] services/watcher.js not found, restock watcher disabled');
  } else {
    throw err;
  }
}
