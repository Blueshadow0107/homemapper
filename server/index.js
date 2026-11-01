// Local proxy: floorplan image -> structured wall/room extraction via OpenAI vision.
// The key lives ONLY in the environment (OPENAI_API_KEY). It is never logged, returned, or written to disk.
//   OPENAI_API_KEY=... node server/index.js        (real)      DRAFT_MOCK=1 node server/index.js   (no key, canned result)
// Env: OPENAI_MODEL (default gpt-4o), PORT (default 5176).
import http from 'node:http';

const PORT = Number(process.env.PORT || 5176);
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const MOCK = process.env.DRAFT_MOCK === '1';
const MAX_BODY = 9 * 1024 * 1024;
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ALLOWED_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/;

const pt = { type: 'object', additionalProperties: false, required: ['x', 'y'], properties: { x: { type: 'number' }, y: { type: 'number' } } };
export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rooms', 'walls', 'printed_overall_width_m', 'notes'],
  properties: {
    rooms: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['name', 'polygon'], properties: { name: { type: 'string' }, polygon: { type: 'array', items: pt } } },
    },
    walls: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['a', 'b', 'exterior'], properties: { a: pt, b: pt, exterior: { type: 'boolean' } } },
    },
    printed_overall_width_m: { type: ['number', 'null'] },
    notes: { type: 'string' },
  },
};

const PROMPT = `You are reading an architectural floorplan image of ONE storey. Extract geometry only.
Coordinates: normalized 0-1000 on BOTH axes relative to the image (x=0 left, x=1000 right, y=0 top, y=1000 bottom).
- rooms: one entry per enclosed room, name from its label (or "Room N"), polygon corners in order (rectilinear plans: 4+ corners).
- walls: straight wall centre-line segments. Shared corners must use IDENTICAL coordinates. Mark exterior=true for the outer envelope. Do not draw doors/windows as walls; skip furniture, text and dimension lines.
- printed_overall_width_m: the overall building width in metres ONLY if a dimension is printed on the plan; otherwise null. Never guess.
- notes: anything uncertain (blurry area, curved wall, missing room).`;

function cannedDraft() {
  const sq = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  const W = (ax, ay, bx, by, exterior) => ({ a: { x: ax, y: ay }, b: { x: bx, y: by }, exterior });
  return {
    rooms: [
      { name: 'Living room', polygon: sq(100, 100, 600, 500) },
      { name: 'Kitchen', polygon: sq(600, 100, 900, 500) },
      { name: 'Bedroom', polygon: sq(100, 500, 500, 900) },
      { name: 'Bathroom', polygon: sq(500, 500, 900, 900) },
    ],
    walls: [W(100, 100, 900, 100, true), W(900, 100, 900, 900, true), W(900, 900, 100, 900, true), W(100, 900, 100, 100, true), W(100, 500, 900, 500, false), W(600, 100, 600, 500, false), W(500, 500, 500, 900, false)],
    printed_overall_width_m: null,
    notes: 'MOCK extraction (DRAFT_MOCK=1) - not read from your image.',
  };
}

async function extract(imageDataUrl) {
  if (MOCK) return cannedDraft();
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw Object.assign(new Error('OPENAI_API_KEY is not set in the environment that started this server'), { status: 503 });
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: [{ type: 'text', text: 'Extract this floorplan.' }, { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } }] },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'floorplan_draft', strict: true, schema: SCHEMA } },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`OpenAI error ${res.status}: ${body?.error?.message ?? 'unknown'}`), { status: 502 }); // message never contains our key
  const text = body.choices?.[0]?.message?.content;
  if (!text) throw Object.assign(new Error('OpenAI returned no content (possible refusal)'), { status: 502 });
  return JSON.parse(text);
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
  if (req.method !== 'POST' || req.url !== '/api/draft') return send(res, 404, { error: 'not found' });

  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) return send(res, 413, { error: 'image too large (max ~8 MB)' });
    chunks.push(c);
  }
  try {
    const { image } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof image !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(image)) return send(res, 400, { error: 'send {image: data:image/png|jpeg|webp;base64,...}' });
    send(res, 200, await extract(image));
  } catch (err) {
    send(res, err.status || 500, { error: err.message });
  }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(PORT, '127.0.0.1', () => console.log(`draft server on 127.0.0.1:${PORT} · ${MOCK ? 'MOCK mode' : `model ${MODEL}, key ${process.env.OPENAI_API_KEY ? 'set' : 'NOT set'}`}`));
}
