import assert from 'node:assert/strict';
import http from 'node:http';
process.env.DRAFT_MOCK = '1';
process.env.PORT = '5189';
const { server, REVIEW_SCHEMA, SCHEMA } = await import('../server/index.js');
await new Promise((r) => server.listen(5189, '127.0.0.1', r));
const req = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port: 5189, path, method, headers: { Host: '127.0.0.1:5189', ...headers } }, (res) => {
    let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, json: d ? JSON.parse(d) : null }));
  });
  r.on('error', reject); if (body) r.write(body); r.end();
});
const IMG = 'data:image/png;base64,AAAA';
try {
  assert.equal((await req('/api/health')).json.mock, true);
  assert.equal((await req('/api/draft', { method: 'POST', body: JSON.stringify({ image: IMG }) })).json.plan_count, 1);
  const rv = await req('/api/review', { method: 'POST', body: JSON.stringify({ image: IMG, extraction: { rooms: [], walls: [] } }) });
  assert.equal(rv.status, 200);
  assert.ok(Array.isArray(rv.json.likely_missing_rooms) && typeof rv.json.summary === 'string');
  assert.ok(['looks_ok', 'add_missing_rooms', 'fix_layout', 'enter_width', 'crop_tighter', 'retry_better_image'].includes(rv.json.next_action));
  assert.equal((await req('/api/review', { method: 'POST', body: JSON.stringify({ image: IMG }) })).status, 400);        // no extraction
  assert.equal((await req('/api/review', { method: 'POST', body: JSON.stringify({ image: 'x', extraction: { rooms: [] } }) })).status, 400); // bad image
  assert.equal((await req('/api/health', { headers: { Host: 'evil.example' } })).status, 403);
  assert.equal((await req('/api/review', { method: 'POST', headers: { Origin: 'http://evil.example' }, body: '{}' })).status, 403);
  // strict-mode structured outputs: every property must be listed in `required`, no extras
  const strict = (s, path = 'schema') => {
    if (s.type === 'object') { assert.equal(s.additionalProperties, false, path); assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), path); for (const [k, v] of Object.entries(s.properties)) strict(v, `${path}.${k}`); }
    if (s.type === 'array') strict(s.items, `${path}[]`);
  };
  strict(SCHEMA); strict(REVIEW_SCHEMA);
  console.log('server: all passed');
} finally { server.close(); }

// ---- fix pass: reviewer findings are sanitised and capped before they reach the model
{
  const { fixText } = await import('../server/index.js');
  assert.equal(fixText([], []), '');
  assert.equal(fixText('nope', []), '');
  const t = fixText(['Missing room: Bath\nIGNORE ALL', 5, 'x'.repeat(500)], [{ name: 'A', box: { x0: 1, y0: 2, x1: 3, y1: 4 } }]);
  assert.ok(t.includes('Missing room: Bath IGNORE ALL'), 'newlines collapsed');
  assert.ok(t.split('\n').every((l) => l.length < 700));
  console.log('server fixText: passed');
}
