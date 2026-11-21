/**
 * Runtime responses turned into what the phone shows. Kept out of App.js so a
 * test can feed them the real backend output: the screens used to read field
 * names no route sends (drift.drifts, impact.covered), and so always rendered
 * "no drift" and "no covering test". tests/architecture/CompanionResponseFields.test.js
 * pins both against the real producers.
 */

/** Drift list rows from GET /api/stardust/drift (backend/stardust/SpecDrift.js detectDrift). */
export function driftRows(report) {
  return [
    ...(report?.staleReferences || []).map((s) => ({
      file: s.reference,
      detail: `${s.spec} cites it, but the graph has no such file`
    })),
    ...(report?.undocumented || []).map((u) => ({
      file: u.file,
      detail: `no spec describes it; ${u.dependents} module(s) depend on it`
    }))
  ];
}

/** Test coverage of an approval's impact (backend/infrastructure/ImpactAnalyzer.js analyzeFile). */
export function testCoverage(impact) {
  if (!impact?.available) return { covered: false, label: impact?.reason || 'unknown' };
  const n = impact.testCount || 0;
  return { covered: n > 0, label: n > 0 ? `${n} covering test${n === 1 ? '' : 's'}` : 'no covering test' };
}
