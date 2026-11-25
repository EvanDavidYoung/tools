// tools.evanyoung.dev is static assets (see wrangler.jsonc). This script only runs for
// the paths listed in assets.run_worker_first, plus requests that match no asset.
//
// POST /ics-to-gcal/api/extract — reads a calendar screenshot with Workers AI (free plan).
// Gated by a shared password in the ICS_TO_GCAL_PASSWORD secret, sent as x-tool-password.
// Unset secret = route off. Set it with: npx wrangler secret put ICS_TO_GCAL_PASSWORD
import { EXTRACT_SCHEMA, buildPrompt, parseModelJson, normalizeExtraction, validDate, validZone } from './ics-to-gcal/events.js';

const MODEL = '@cf/google/gemma-4-26b-a4b-it';
const MAX_BODY = 4 * 1024 * 1024; // the page sends a downscaled JPEG, well under this

const json = (data, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });

async function samePassword(given, expected) {
  // Compare digests so the time taken doesn't depend on where the strings differ.
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([given, expected].map(s => crypto.subtle.digest('SHA-256', enc.encode(s))));
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function modelText(out) {
  if (out?.response !== undefined) return out.response;
  if (out?.choices?.[0]?.message?.content !== undefined) return out.choices[0].message.content;
  return out;
}

async function extract(request, env) {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (!env.ICS_TO_GCAL_PASSWORD) return json({ error: 'The free reader is switched off.' }, 503);
  if (!(await samePassword(request.headers.get('x-tool-password') || '', env.ICS_TO_GCAL_PASSWORD))) {
    return json({ error: 'Wrong password.' }, 401);
  }
  if (+(request.headers.get('content-length') || 0) > MAX_BODY) return json({ error: 'Image too large.' }, 413);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send JSON.' }, 400); }
  const { image, today, timeZone, hint } = body || {};
  if (typeof image !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(image) || image.length > MAX_BODY) {
    return json({ error: 'Send the screenshot as a PNG, JPEG or WebP data URL.' }, 400);
  }
  if (!validDate(today)) return json({ error: 'Send today as YYYY-MM-DD.' }, 400);

  const prompt = buildPrompt({
    today,
    timeZone: validZone(timeZone) || 'UTC',
    hint: typeof hint === 'string' ? hint.slice(0, 2000) : ''
  });

  let out;
  try {
    out = await env.AI.run(MODEL, {
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: image } },
        { type: 'text', text: prompt }
      ] }],
      response_format: { type: 'json_schema', json_schema: EXTRACT_SCHEMA },
      max_tokens: 2048,
      chat_template_kwargs: { enable_thinking: false }
    });
  } catch (e) {
    return json({ error: `The free model failed: ${e?.message || e}` }, 502);
  }

  try {
    return json(normalizeExtraction(parseModelJson(modelText(out))));
  } catch (e) {
    return json({ error: `The free model's answer couldn't be read: ${e.message}` }, 502);
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/ics-to-gcal/api/extract') return extract(request, env);
    return env.ASSETS.fetch(request);
  }
};
