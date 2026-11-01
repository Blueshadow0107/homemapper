// Local proxy: floorplan image -> structured wall/room extraction via OpenAI vision.
// The key lives ONLY in the environment (OPENAI_API_KEY). It is never logged, returned, or written to disk.
//   OPENAI_API_KEY=... node server/index.js        (real)      DRAFT_MOCK=1 node server/index.js   (no key, canned result)
// Env: OPENAI_MODEL (default gpt-5.5), PORT (default 5176).
import http from 'node:http';

const PORT = Number(process.env.PORT || 5176);
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.5';
const MOCK = process.env.DRAFT_MOCK === '1' || process.env.DRAFT_MOCK === 'weak'; // 'weak' = canned draft that scores poor, for UI tests
const MODEL_OK = /^(gpt-[a-z0-9.\-]{1,40}|o\d[a-z0-9.\-]{0,20})$/; // optional per-request model override (loopback only)
const MAX_BODY = 9 * 1024 * 1024;
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ALLOWED_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/;

const pt = { type: 'object', additionalProperties: false, required: ['x', 'y'], properties: { x: { type: 'number' }, y: { type: 'number' } } };
export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rooms', 'walls', 'printed_overall_width_m', 'plan_count', 'omitted_or_uncertain', 'notes'],
  properties: {
    rooms: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['name', 'rectangular', 'box', 'polygon'], properties: { name: { type: 'string' }, rectangular: { type: 'boolean' }, box: { type: 'object', additionalProperties: false, required: ['x0', 'y0', 'x1', 'y1'], properties: { x0: { type: 'number' }, y0: { type: 'number' }, x1: { type: 'number' }, y1: { type: 'number' } } }, polygon: { type: 'array', items: pt } } },
    },
    walls: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['a', 'b', 'exterior'], properties: { a: pt, b: pt, exterior: { type: 'boolean' } } },
    },
    printed_overall_width_m: { type: ['number', 'null'] },
    plan_count: { type: 'integer' },
    omitted_or_uncertain: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
};

const PROMPT = `You are reading an architectural floorplan image of ONE storey. Extract geometry only.
Coordinates: normalized 0-1000 on BOTH axes relative to the image (x=0 left, x=1000 right, y=0 top, y=1000 bottom).
- plan_count: how many separate floorplans (including alternative layouts or other storeys) appear in the image. If more than 1, extract ONLY the largest / most complete one, and say which in notes. Ignore elevations, sections, title blocks, legends and text.
- rooms: EVERY enclosed room, including bathrooms, toilets, closets, laundry, store rooms and circulation spaces: do not skip small ones and do not merge neighbours that have their own walls. Name from its printed label (or "Room N"). Most rooms are rectangles: set rectangular=true and give the AXIS-ALIGNED box (x0<x1, y0<y1) hugging the room's inner walls, and leave polygon empty. Only for L-shaped or otherwise non-rectangular rooms set rectangular=false, give the box of its extent and the polygon corners in order. Neighbouring rooms must share the exact same edge coordinate (e.g. one room's x1 equals the next room's x0). Never output slanted edges unless the wall is really diagonal. An open-plan zone without walls between its parts is one room.
- walls: straight wall centre-line segments. Shared corners must use IDENTICAL coordinates. Mark exterior=true for the outer envelope. Do not draw doors/windows as walls; skip furniture, text and dimension lines. Every room edge should be covered by a wall segment.
- printed_overall_width_m: the overall building width in METRES only if a dimension for it is printed (convert feet-inches: 1 ft = 0.3048 m, 1 in = 0.0254 m); otherwise null. Never guess.
- omitted_or_uncertain: short strings naming anything you left out, merged, or are unsure of (e.g. "small washroom bottom-right not extracted", "balcony outline unclear"). Empty list only if you are confident the extraction is complete.
- notes: anything else the user should know.`;

function cannedDraft() {
  const weak = process.env.DRAFT_MOCK === 'weak';
  const sq = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  const W = (ax, ay, bx, by, exterior) => ({ a: { x: ax, y: ay }, b: { x: bx, y: by }, exterior });
  return {
    rooms: [
      { name: 'Living room', rectangular: false, box: { x0: 100, y0: 100, x1: 600, y1: 500 }, polygon: sq(100, 100, 600, 500) },
      { name: 'Kitchen', rectangular: true, box: { x0: 600, y0: 100, x1: 900, y1: 500 }, polygon: [] },
      { name: 'Bedroom', rectangular: false, box: { x0: 100, y0: 500, x1: 500, y1: 900 }, polygon: sq(100, 500, 500, 900) },
      { name: 'Bathroom', rectangular: false, box: { x0: 500, y0: 500, x1: 900, y1: 900 }, polygon: sq(500, 500, 900, 900) },
    ],
    walls: [W(100, 100, 900, 100, true), W(900, 100, 900, 900, true), W(900, 900, 100, 900, true), W(100, 900, 100, 100, true), W(100, 500, 900, 500, false), W(600, 100, 600, 500, false), W(500, 500, 500, 900, false)],
    printed_overall_width_m: null,
    plan_count: weak ? 2 : 1,
    omitted_or_uncertain: weak ? ['small washroom not extracted'] : [],
    notes: weak ? 'MOCK weak extraction: limited details and some missing areas.' : 'MOCK extraction (DRAFT_MOCK=1) - not read from your image.',
  };
}

async function callVision({ system, userText, image, schema, name, model = MODEL }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw Object.assign(new Error('OPENAI_API_KEY is not set in the environment that started this server'), { status: 503 });
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: [{ type: 'text', text: userText }, { type: 'image_url', image_url: { url: image, detail: 'high' } }] },
      ],
      response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`OpenAI error ${res.status}: ${body?.error?.message ?? 'unknown'}`), { status: 502 }); // message never contains our key
  const text = body.choices?.[0]?.message?.content;
  if (!text) throw Object.assign(new Error('OpenAI returned no content (possible refusal)'), { status: 502 });
  return JSON.parse(text);
}

async function extract(image, model) {
  if (MOCK) return cannedDraft();
  return callVision({ model, system: PROMPT, userText: 'Extract this floorplan.', image, schema: SCHEMA, name: 'floorplan_draft' });
}

// ---- review pass: a second opinion on an existing draft. Returns HINTS only; it never edits or verifies geometry.
const box = { type: 'object', additionalProperties: false, required: ['label', 'x0', 'y0', 'x1', 'y1'], properties: { label: { type: 'string' }, x0: { type: 'number' }, y0: { type: 'number' }, x1: { type: 'number' }, y1: { type: 'number' } } };
export const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'likely_missing_rooms', 'layout_notes', 'dimension_legible', 'dimension_text', 'next_action'],
  properties: {
    summary: { type: 'string' },
    likely_missing_rooms: { type: 'array', items: box },
    layout_notes: { type: 'array', items: { type: 'string' } },
    dimension_legible: { type: 'boolean' },
    dimension_text: { type: ['string', 'null'] },
    next_action: { type: 'string', enum: ['looks_ok', 'add_missing_rooms', 'fix_layout', 'enter_width', 'crop_tighter', 'retry_better_image'] },
  },
};
const REVIEW_PROMPT = `You are reviewing a machine-extracted DRAFT of one floorplan against the source image. You are a second opinion, not ground truth: say when you are unsure.
Both the draft and your answers use normalized 0-1000 image coordinates (x=0 left, y=0 top).
- likely_missing_rooms: enclosed rooms visible in the image that have NO room in the draft (bathrooms, toilets, closets, laundry, stores, kitchen...). Give the printed label if legible (else a short description) and a tight bounding box.
- layout_notes: short strings about draft rooms that look merged, split, mislabelled or misplaced (e.g. "living and dining are one open space but drawn as two rooms"). Reference room names from the draft.
- dimension_legible / dimension_text: whether an overall building dimension is printed and legible, and its text exactly as printed (e.g. 36'-10"), else null. Do not convert or guess.
- next_action: the single most useful next step for the user.
- summary: one or two sentences. Do not claim the draft is verified or correct.`;
function cannedReview() {
  return {
    summary: 'MOCK review (DRAFT_MOCK=1) - not read from your image.',
    likely_missing_rooms: [{ label: 'Washroom (mock)', x0: 700, y0: 520, x1: 880, y1: 700 }],
    layout_notes: ['Mock note: living room and kitchen may be one open space.'],
    dimension_legible: false,
    dimension_text: null,
    next_action: 'add_missing_rooms',
  };
}
async function review(image, extraction) {
  if (MOCK) return cannedReview();
  const compact = JSON.stringify({
    rooms: (extraction.rooms ?? []).slice(0, 64).map((r) => ({ name: String(r.name ?? '').slice(0, 60), polygon: (r.polygon ?? []).slice(0, 32) })),
    walls: (extraction.walls ?? []).length,
  });
  return callVision({ system: REVIEW_PROMPT, userText: `Draft rooms (normalized coords) and wall count:\n${compact}`, image, schema: REVIEW_SCHEMA, name: 'draft_review' });
}

function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

export const server = http.createServer(async (req, res) => {
  // DNS-rebinding / drive-by protection: only our own loopback host, only our own dev origins.
  if (!ALLOWED_HOSTS.has(req.headers.host)) return send(res, 403, { error: 'bad host' });
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGIN.test(origin)) return send(res, 403, { error: 'bad origin' });
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method === 'GET' && req.url === '/api/health') return send(res, 200, { ok: true, mock: MOCK, model: MOCK ? null : MODEL, key_set: Boolean(process.env.OPENAI_API_KEY) });
  if (req.method === 'GET' && req.url === '/api/models') {
    if (MOCK || !process.env.OPENAI_API_KEY) return send(res, 200, { models: [] });
    try { // names only: the key never leaves this process
      const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
      const b = await r.json();
      return send(res, 200, { models: (b.data ?? []).map((m) => m.id).filter((id) => MODEL_OK.test(id)).sort() });
    } catch (err) { return send(res, 502, { error: 'could not list models' }); }
  }
  if (req.method !== 'POST' || !['/api/draft', '/api/review'].includes(req.url)) return send(res, 404, { error: 'not found' });

  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) return send(res, 413, { error: 'image too large (max ~8 MB)' });
    chunks.push(c);
  }
  try {
    const { image, extraction, model: reqModel } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof image !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(image)) return send(res, 400, { error: 'send {image: data:image/png|jpeg|webp;base64,...}' });
    if (req.url === '/api/review') {
      if (!extraction || typeof extraction !== 'object' || !Array.isArray(extraction.rooms)) return send(res, 400, { error: 'send {image, extraction:{rooms:[...],walls:[...]}}' });
      return send(res, 200, await review(image, extraction));
    }
    if (reqModel !== undefined && !(typeof reqModel === 'string' && MODEL_OK.test(reqModel))) return send(res, 400, { error: 'bad model id' });
    send(res, 200, await extract(image, reqModel));
  } catch (err) {
    send(res, err.status || 500, { error: err.message });
  }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(PORT, '127.0.0.1', () => console.log(`draft server on 127.0.0.1:${PORT} · ${MOCK ? 'MOCK mode' : `model ${MODEL}, key ${process.env.OPENAI_API_KEY ? 'set' : 'NOT set'}`}`));
}
