import express from 'express';
import { getSetting, getAllSettings, setSettings } from '../db.js';
import { sendDiscordMessage } from '../services/discord.js';

const router = express.Router();

const KNOWN_KEYS = [
  'sell_percentage',
  'discord_webhook_url',
  'pokemontcg_api_key',
  'bestbuy_api_key',
  'watch_poll_minutes',
  'anthropic_api_key',
  'scan_model',
  'gemini_api_key',
  'scan_model_gemini',
];

// GET /api/settings
router.get('/', (req, res) => {
  res.json(getAllSettings());
});

// PUT /api/settings
router.put('/', (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'body must be an object of settings' });
  }
  for (const [key, value] of Object.entries(body)) {
    if (!KNOWN_KEYS.includes(key)) {
      return res.status(400).json({ error: `unknown setting: ${key}` });
    }
    if (key === 'sell_percentage') {
      const pct = Number(value);
      if (!Number.isFinite(pct) || pct < 1 || pct > 100) {
        return res.status(400).json({ error: 'sell_percentage must be a number between 1 and 100' });
      }
    }
    if (key === 'watch_poll_minutes') {
      const minutes = Number(value);
      if (!Number.isFinite(minutes) || minutes < 1) {
        return res.status(400).json({ error: 'watch_poll_minutes must be a number >= 1' });
      }
    }
  }
  if (Object.keys(body).length === 0) {
    return res.json(getAllSettings());
  }
  res.json(setSettings(body));
});

// POST /api/settings/test-discord
router.post('/test-discord', async (req, res) => {
  const webhookUrl = getSetting('discord_webhook_url');
  const result = await sendDiscordMessage(
    webhookUrl,
    '✅ Test message from Thomas Trading Card — your Discord webhook is working!'
  );
  if (result.ok) return res.json({ ok: true });
  res.status(502).json({ error: result.error || 'failed to send Discord message' });
});

export default router;
