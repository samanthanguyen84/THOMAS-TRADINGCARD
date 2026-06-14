// Identify a trading card from a photo using Claude's vision API. Returns
// { found, name, set_name, card_number }. Used by POST /api/prices/scan so a
// vendor can snap a photo instead of typing the card name.
import Anthropic from '@anthropic-ai/sdk';
import { getSetting } from '../db.js';

const SUPPORTED_MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Structured-output schema: the model must return exactly these fields, so the
// response is always valid JSON we can parse without guessing.
const CARD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    found: { type: 'boolean' },
    name: { type: 'string' },
    set_name: { type: 'string' },
    card_number: { type: 'string' },
  },
  required: ['found', 'name', 'set_name', 'card_number'],
};

const SYSTEM_PROMPT =
  'You identify a single trading card (usually a Pokémon card) from a photo for a ' +
  "vendor's pricing tool. Read the card's printed name exactly as shown, its set/expansion " +
  'name if visible, and its collector number (e.g. "215/203" or "4"). Set found=false with ' +
  'empty strings if no card is clearly visible or the name is not legible. Return only the name ' +
  'of the card itself — ignore any background, sleeve, or other cards.';

function scanError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// imageBase64 is the raw base64 (no data: prefix). mediaType like 'image/jpeg'.
export async function identifyCard(imageBase64, mediaType) {
  const apiKey = getSetting('anthropic_api_key');
  if (!apiKey) {
    throw scanError(
      'Photo scan needs an Anthropic API key — add one in Settings (get it from console.anthropic.com).',
      400
    );
  }
  if (!imageBase64) {
    throw scanError('No image data received.', 400);
  }
  const media = SUPPORTED_MEDIA.includes(mediaType) ? mediaType : 'image/jpeg';
  const model = getSetting('scan_model') || 'claude-opus-4-8';

  const client = new Anthropic({
    apiKey,
    baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
    timeout: 30_000,
    maxRetries: 1,
  });

  let response;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 300,
      // Fast, cheap scan: low effort, no extended thinking, JSON-constrained output.
      output_config: { effort: 'low', format: { type: 'json_schema', schema: CARD_SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: media, data: imageBase64 } },
            { type: 'text', text: 'What Pokémon card is this? Identify its name, set, and number.' },
          ],
        },
      ],
    });
  } catch (err) {
    const status = typeof err?.status === 'number' ? err.status : 502;
    if (status === 401 || status === 403) {
      throw scanError('Anthropic API key was rejected — check it in Settings.', 502);
    }
    throw scanError(`Card scan failed: ${err.message || 'could not reach Anthropic'}`, 502);
  }

  if (response.stop_reason === 'refusal') {
    throw scanError('The scanner could not process that image. Try a clearer photo.', 502);
  }

  const textBlock = (response.content || []).find((b) => b.type === 'text');
  if (!textBlock) {
    throw scanError('The scanner returned no result. Try again.', 502);
  }
  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    throw scanError('The scanner returned an unreadable result. Try again.', 502);
  }
  return {
    found: Boolean(parsed.found),
    name: String(parsed.name || '').trim(),
    set_name: String(parsed.set_name || '').trim(),
    card_number: String(parsed.card_number || '').trim(),
  };
}
