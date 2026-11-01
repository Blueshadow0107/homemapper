export function frequencyDetails(frequencyHz) {
  if (!Number.isFinite(frequencyHz)) return {};
  let band = 'unknown';
  if (frequencyHz >= 2300e6 && frequencyHz <= 2500e6) band = '2.4';
  else if (frequencyHz >= 4900e6 && frequencyHz < 5925e6) band = '5';
  else if (frequencyHz >= 5925e6 && frequencyHz <= 7125e6) band = '6';
  return { frequency_hz: frequencyHz, freq_mhz: frequencyHz / 1e6, band };
}
