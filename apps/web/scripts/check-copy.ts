import path from 'node:path';
import { checkCopy } from './checks/copy';
import { loadRegistry, readFiles, walk, WEB_ROOT } from './checks/load';
import { report } from './checks/types';

/** Where user-facing copy lives: the App Router tree and the shared UI components. */
const SURFACES = [
  path.join(WEB_ROOT, 'app'),
  path.join(WEB_ROOT, 'src/ui'),
  path.join(WEB_ROOT, 'src/rni/ui'),
];

/**
 * Individual non-surface files that build a real user-facing string outside `app/`/`src/ui/` —
 * round-14 lane-review finding 4. `services/attention/leaderboard.ts` composes
 * `degradedMessage`'s three full sentences itself (a state derivation, not a rendering
 * component), so it shipped real copy this check never scanned. Named individually rather than
 * folding its whole directory into `SURFACES`: `services/attention/compute.ts` — a sibling in
 * that same directory — throws internal error strings that happen to use the word "divergence"
 * for an unrelated data-integrity meaning (`computeAndStore`'s content-comparison check), which
 * would fail `rendersDivergenceState`'s check for the product's actual divergence-state disclosure
 * with no real defect behind it. `leaderboard.ts` is the one place in this directory that returns
 * a value ever rendered to a reader.
 */
const EXTRA_FILES = [path.join(WEB_ROOT, 'src/services/attention/leaderboard.ts')];

const paths = [
  ...(await Promise.all(SURFACES.map((dir) => walk(dir, ['.ts', '.tsx'])))).flat(),
  ...EXTRA_FILES,
];
const files = await readFiles(paths);
const methods = await loadRegistry();

process.stdout.write(
  `check:copy — scanning ${files.length} surface file(s) against ${methods.length} registered method(s)\n`,
);

process.exitCode = report('check:copy', checkCopy({ files, methods }));
