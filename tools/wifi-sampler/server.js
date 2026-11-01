import http from 'node:http';
import { sampleRssiFromIw } from './node.js';

const port = Number(process.env.WIFI_SAMPLER_PORT || 5175);
const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const allowedOrigin = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/;

function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

export const server = http.createServer(async (request, response) => {
  if (!allowedHosts.has(request.headers.host)) return send(response, 403, { error: 'bad host' });
  const origin = request.headers.origin;
  if (origin && !allowedOrigin.test(origin)) return send(response, 403, { error: 'bad origin' });
  if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Accept');

  if (request.method === 'OPTIONS') return send(response, 204, {});
  if (request.method !== 'GET' || request.url !== '/sample') {
    return send(response, 404, { error: 'not found' });
  }

  try {
    const reading = await sampleRssiFromIw();
    return send(response, 200, reading);
  } catch (error) {
    return send(response, 503, { error: error.message });
  }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(port, '127.0.0.1', () => {
    console.log(`Wi-Fi sampler listening on http://127.0.0.1:${port}/sample`);
  });
}
