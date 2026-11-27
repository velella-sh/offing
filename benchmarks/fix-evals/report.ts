import { type Evidence, metrics } from "./evaluate.js";

export function summarize(evidence: readonly Evidence[], fixers: readonly string[]) {
  const checks = evidence.flatMap(({ id, cases }) => cases.map((entry) => ({ id, entry })));
  return {
    schemaVersion: "offing.fix-evals.v1",
    repositories: evidence.filter(({ repository, excluded }) => repository !== null && excluded === undefined).length,
    excluded: evidence
      .filter(({ excluded }) => excluded !== undefined)
      .map(({ id, excluded }) => ({ id, reason: excluded, evidence: `${id}/evidence.json` })),
    fixers: [...fixers].sort().map((id) => {
      const cases = checks.filter(({ entry }) => entry.fixer === id);
      return {
        id,
        cases: cases.length,
        status: cases.length < 5 ? "too few cases" : "measured",
        metrics: Object.fromEntries(
          metrics.map((metric) => {
            const values = cases.map(({ entry }) => entry.metrics[metric]).filter((value) => value !== null);
            const passed = values.filter(Boolean).length;
            return [
              metric,
              {
                passed,
                applicable: values.length,
                percent: values.length >= 5 ? (100 * passed) / values.length : null,
              },
            ];
          }),
        ),
        failures: cases.flatMap(({ id: repository, entry }) => {
          const failures = metrics.filter((metric) => entry.metrics[metric] === false);
          return failures.length > 0 ? [{ repository, failures, evidence: `${repository}/evidence.json` }] : [];
        }),
      };
    }),
  };
}
