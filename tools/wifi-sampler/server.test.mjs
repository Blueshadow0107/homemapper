import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { server } from './server.js';

let port;
test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function request({ host, origin, method = 'GET' }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/sample',
      method,
      headers: { Host: host, ...(origin ? { Origin: origin } : {}) },
    }, (response) => {
      response.resume();
      response.on('end', () => resolve(response));
    });
    req.on('error', reject);
    req.end();
  });
}

test('rejects a spoofed Host before returning sampler data', async () => {
  const response = await request({ host: 'evil.example:5175' });
  assert.equal(response.statusCode, 403);
});

test('rejects a foreign Origin even with a local Host', async () => {
  const response = await request({ host: '127.0.0.1:5175', origin: 'http://evil.example' });
  assert.equal(response.statusCode, 403);
  assert.equal(response.headers['access-control-allow-origin'], undefined);
});

test('rejects a Host for the wrong local port', async () => {
  const response = await request({ host: 'localhost:5176' });
  assert.equal(response.statusCode, 403);
});

test('allows a local preflight from the Vite origin', async () => {
  const response = await request({ host: 'localhost:5175', origin: 'http://localhost:5174', method: 'OPTIONS' });
  assert.equal(response.statusCode, 204);
  assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:5174');
});
