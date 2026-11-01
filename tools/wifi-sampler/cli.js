import { parseArgs } from 'node:util';
import { sampleRssiFromIw } from './node.js';

const { values } = parseArgs({
  options: {
    x: { type: 'string' },
    z: { type: 'string' },
    id: { type: 'string' },
    interface: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  console.log('Usage: node tools/wifi-sampler/cli.js --x <metres> --z <metres> [--id sample-001] [--interface wlan0]');
  process.exit(0);
}

const x = Number(values.x);
const z = Number(values.z);
if (!Number.isFinite(x) || !Number.isFinite(z)) {
  console.error('Both --x and --z must be finite metre coordinates. Use --help for usage.');
  process.exit(2);
}

try {
  const reading = await sampleRssiFromIw({ interfaceName: values.interface });
  const sample = {
    id: values.id || `sample-${Date.now()}`,
    position_m: [x, z],
    ...reading,
    sampled_at: new Date().toISOString(),
  };
  console.log(JSON.stringify(sample, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
