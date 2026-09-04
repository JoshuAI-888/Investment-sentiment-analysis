/** One reason a check failed. `where` is what the reader needs to go fix it. */
export type Finding = {
  readonly check: 'calc-coverage' | 'bundle' | 'copy';
  readonly where: string;
  readonly message: string;
};

export function report(name: string, findings: readonly Finding[]): number {
  if (findings.length === 0) {
    process.stdout.write(`${name}: pass\n`);
    return 0;
  }
  process.stdout.write(`${name}: ${findings.length} failure(s)\n\n`);
  for (const finding of findings) {
    process.stdout.write(`  ${finding.where}\n    ${finding.message}\n\n`);
  }
  return 1;
}
