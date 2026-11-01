import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function iw(...args) {
  try {
    const { stdout } = await execFileAsync('iw', args);
    return stdout;
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('iw is not installed; enter RSSI manually');
    throw error;
  }
}

function parseLink(output) {
  if (!output.includes('Connected to')) return null;
  const signal = output.match(/signal:\s*(-?\d+(?:\.\d+)?)\s*dBm/);
  if (!signal) return null;
  const frequency = output.match(/^\s*freq:\s*(\d+(?:\.\d+)?)\s*$/m);
  return {
    rssi_dbm: Number(signal[1]),
    ...(frequency ? { frequency_hz: Math.round(Number(frequency[1]) * 1e6) } : {}),
    source: 'iw',
  };
}

export async function sampleRssiFromIw({ interfaceName } = {}) {
  let interfaces;
  if (interfaceName) {
    interfaces = [interfaceName];
  } else {
    const devices = await iw('dev');
    interfaces = [...devices.matchAll(/^\s*Interface\s+(\S+)\s*$/gm)].map((match) => match[1]);
  }

  for (const name of interfaces) {
    const output = await iw('dev', name, 'link');
    const reading = parseLink(output);
    if (reading) return reading;
  }
  throw new Error('no connected Wi-Fi interface reported an RSSI reading; enter RSSI manually');
}
