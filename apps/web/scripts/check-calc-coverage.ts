import { checkCalcCoverage } from './checks/calc-coverage';
import { loadMetricManifest, loadRegistry } from './checks/load';
import { report } from './checks/types';

const methods = await loadRegistry();
const metrics = await loadMetricManifest();

process.stdout.write(
  `check:calc-coverage — ${methods.length} registered method(s), ${metrics.length} rendered metric(s)\n`,
);

process.exitCode = report('check:calc-coverage', checkCalcCoverage({ methods, metrics }));
