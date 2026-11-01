import { frequencyDetails } from './bands.js';

const DEFAULT_ENDPOINT = 'http://127.0.0.1:5175/sample';

function normalizeReading(reading) {
  if (!Number.isFinite(reading?.rssi_dbm)) {
    throw new Error('sampler returned no valid RSSI reading');
  }
  return {
    rssi_dbm: reading.rssi_dbm,
    ...frequencyDetails(reading.frequency_hz),
    source: 'iw',
  };
}

async function sampleFromEndpoint(endpoint) {
  let response;
  try {
    response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
  } catch {
    throw new Error('local Wi-Fi sampler is unavailable; start tools/wifi-sampler/server.js or enter RSSI manually');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `local Wi-Fi sampler returned HTTP ${response.status}`);
  return normalizeReading(body);
}

export async function sampleRssi(options = {}) {
  if (typeof window !== 'undefined') {
    return sampleFromEndpoint(options.endpoint || DEFAULT_ENDPOINT);
  }
  const nodeModule = './node.js';
  const { sampleRssiFromIw } = await import(/* @vite-ignore */ nodeModule);
  return normalizeReading(await sampleRssiFromIw(options));
}
