import http from 'node:http';
import { sampleRssiFromIw } from './node.js';

const port = Number(process.env.WIFI_SAMPLER_PORT || 5175);

function localOrigin(origin) {
  return origin && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
}

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (localOrigin(origin)) response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Accept');

  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }
  if (request.method !== 'GET' || request.url !== '/sample') {
    response.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'not found' }));
    return;
  }

  try {
    const reading = await sampleRssiFromIw();
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(reading));
  } catch (error) {
    response.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error.message }));
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Wi-Fi sampler listening on http://127.0.0.1:${port}/sample`);
});
