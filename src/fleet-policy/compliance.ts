import { createHash } from "node:crypto";

import { loadConfig } from "../config.js";
import type { ScanResult } from "../domain.js";
import { applyPolicy } from "../policy.js";
import { loadFleetPolicy, type FleetPolicyOptions } from "./load.js";
import { FleetPolicyError } from "./merge.js";

export interface FleetPolicyCompliance {
  readonly status: "compliant" | "violation" | "invalid";
  readonly policy: string;
  readonly violations: number;
  readonly reason: "rule-threshold" | "invalid-policy" | "expired-exception" | "unauthorized-override" | null;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Aggregate policy outcomes without publishing source paths, exception text, credentials, or private rule IDs. */
export async function fleetPolicyCompliance(
  report: ScanResult,
  options: FleetPolicyOptions & { reference: string },
): Promise<FleetPolicyCompliance> {
  const policy = hash(options.reference);
  try {
    const config = options.config ?? (await loadConfig(options.root));
    const effective = await loadFleetPolicy({ ...options, config });
    if (!effective) return { status: "invalid", policy, violations: 0, reason: "invalid-policy" };
    const result = applyPolicy(report, effective.policy, options.today);
    const violations = result.policy?.violations.length ?? 0;
    return {
      status: violations > 0 ? "violation" : "compliant",
      policy: hash(JSON.stringify(effective.policy)),
      violations,
      reason: violations > 0 ? "rule-threshold" : null,
    };
  } catch (error) {
    return {
      status: "invalid",
      policy,
      violations: 0,
      reason: error instanceof FleetPolicyError ? error.reason : "invalid-policy",
    };
  }
}
