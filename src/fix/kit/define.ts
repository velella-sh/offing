import type { Finding } from "../../domain.js";
import type { Fixer } from "../types.js";

interface Rule {
  id: string;
  detector?: string;
  replacement?: string;
  reason?: string;
}

interface Definition extends Fixer {
  rules: readonly (string | Rule)[];
}

function matches(finding: Finding, rule: Rule): boolean {
  if (rule.detector !== undefined && finding.detector !== rule.detector) return false;
  return rule.id.endsWith("*") ? finding.ruleId.startsWith(rule.id.slice(0, -1)) : finding.ruleId === rule.id;
}

/** Dispatches only declared rules and refuses a finding when its rule no longer names the expected replacement. */
export function defineCodemod(definition: Definition): Fixer {
  const declared = definition.rules.map((rule) => (typeof rule === "string" ? { id: rule } : rule));
  return {
    id: definition.id,
    plan(result, refuse) {
      const findings = result.findings.filter((finding) => {
        const rule = declared.find((candidate) => matches(finding, candidate));
        if (rule === undefined) return false;
        if (rule.replacement === undefined || finding.replacement === rule.replacement) return true;
        refuse?.(finding, rule.reason ?? "The rule no longer names the replacement this codemod expects.");
        return false;
      });
      return definition.plan({ ...result, findings }, refuse);
    },
  };
}
