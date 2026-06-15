// Identify a trading card from a photo. Returns { found, name, set_name,
// card_number }. Used by POST /api/prices/scan so a vendor can snap a photo
// instead of typing the card name.
//
// Two providers are supported, chosen by which API key is set in Settings:
//   - Google Gemini (free tier — recommended; no per-scan cost)
//   - Anthropic Claude (paid; better accuracy)
// Gemini wins when both are configured. Base URLs are env-overridable for tests.
import Anthropic from '@anthropic-ai/sdk';
import { getSetting } from '../db.js';

const SUPPORTED_MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const SYSTEM_PROMPT =
  'You identify a single trading card (usually a Pokémon card) from a photo for a ' +
  "vendor's pricing tool. Read the card's printed name exactly as shown, its set/expansion " +
  'name if visible, and its collector number (e.g. "215/203" or "4"). Set found=false with ' +
  'empty strings if no card is clearly visible or the name is not legible. Return only the name ' +
  'of the card itself — ignore any background, sleeve, or other cards.';

const USER_PROMPT = 'What Pokémon card is this? Identify its name, set, and number.';

function scanError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function normalize(parsed) {
  return {
    found: Boolean(parsed.found),
    name: String(parsed.name || '').trim(),
    set_name: String(parsed.set_name || '').trim(),
    card_number: String(parsed.card_number || '').trim(),
  };
}

// --- Google Gemini (free tier) ---------------------------------------------

async function identifyWithGemini(apiKey, imageBase64, media) {
  const base = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
  const model = getSetting('scan_model_gemini') || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      {
        role: 'user',
        parts: [
          { inline_data: { mime_type: media, data: imageBase64 } },
          { text: USER_PROMPT },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          found: { type: 'BOOLEAN' },
          name: { type: 'STRING' },
          set_name: { type: 'STRING' },
          card_number: { type: 'STRING' },
        },
        required: ['found', 'name', 'set_name', 'card_number'],
      },
    },
  };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw scanError(`Card scan failed: ${err.message || 'could not reach Google'}`, 502);
  }
  if (res.status === 400 || res.status === 403) {
    throw scanError('Google Gemini key was rejected — check it in Settings.', 502);
  }
  if (!res.ok) {
    throw scanError(`Card scan failed: Gemini returned ${res.status}.`, 502);
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw scanError('The scanner returned an unreadable result. Try again.', 502);
  }
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw scanError('The scanner could not read that image. Try a clearer photo.', 502);
  }
  return normalize(parsed);
}

// --- Anthropic Claude (paid) -----------------------------------------------

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

async function identifyWithAnthropic(apiKey, imageBase64, media) {
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
      output_config: { effort: 'low', format: { type: 'json_schema', schema: CARD_SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: media, data: imageBase64 } },
            { type: 'text', text: USER_PROMPT },
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
  return normalize(parsed);
}

// --- public ----------------------------------------------------------------

// imageBase64 is the raw base64 (no data: prefix). mediaType like 'image/jpeg'.
export async function identifyCard(imageBase64, mediaType) {
  if (!imageBase64) {
    throw scanError('No image data received.', 400);
  }
  const media = SUPPORTED_MEDIA.includes(mediaType) ? mediaType : 'image/jpeg';

  const geminiKey = getSetting('gemini_api_key');
  if (geminiKey) {
    return identifyWithGemini(geminiKey, imageBase64, media);
  }
  const anthropicKey = getSetting('anthropic_api_key');
  if (anthropicKey) {
    return identifyWithAnthropic(anthropicKey, imageBase64, media);
  }
  throw scanError(
    'Photo scan needs an API key. Add a FREE Google Gemini key in Settings ' +
      '(get one at aistudio.google.com — no credit card).',
    400
  );
}
