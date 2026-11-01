import test from 'node:test';
import assert from 'node:assert/strict';
import { frequencyDetails } from './bands.js';
import { parseLink } from './node.js';

test('classifies 2.4, 5 and 6 GHz frequencies without dropping Hz/MHz', () => {
  assert.deepEqual(frequencyDetails(2412e6), { frequency_hz: 2412e6, freq_mhz: 2412, band: '2.4' });
  assert.deepEqual(frequencyDetails(5640e6), { frequency_hz: 5640e6, freq_mhz: 5640, band: '5' });
  assert.deepEqual(frequencyDetails(6175e6), { frequency_hz: 6175e6, freq_mhz: 6175, band: '6' });
  assert.equal(frequencyDetails(5800e6).band, '5');
});

test('parses iw link output and does not persist SSID/BSSID', () => {
  const reading = parseLink(`Connected to aa:bb:cc:dd:ee:ff (on wlan0)\n\tSSID: private-network\n\tfreq: 5640\n\tsignal: -65 dBm\n`);
  assert.equal(reading.rssi_dbm, -65);
  assert.equal(reading.frequency_hz, 5640e6);
  assert.equal(reading.freq_mhz, 5640);
  assert.equal(reading.band, '5');
  assert.equal(reading.SSID, undefined);
  assert.equal(reading.BSSID, undefined);
});

test('unknown or missing frequency leaves band detection unavailable', () => {
  assert.deepEqual(frequencyDetails(undefined), {});
  assert.equal(frequencyDetails(4000e6).band, 'unknown');
});
