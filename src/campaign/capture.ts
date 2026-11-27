import type { ScanResult } from "../domain.js";
import { planFixReport } from "../fix/index.js";
import { detectTestPlan } from "../test-runners/detect.js";
import { readRuntimePins } from "../upgrade/target-lifecycle.js";
import type { PlannedCheck } from "./document.js";

export interface CampaignEvidence {
  date: string;
  runtimePins: { runtime: string; version: string }[];
  codemods: string[];
  checks: PlannedCheck[];
}

export const campaignInputPaths = [
  "requirements.txt",
  "pytest.ini",
  ".pytest.ini",
  "mvnw",
  "mvnw.cmd",
  "gradlew",
  "gradlew.bat",
] as const;

export async function captureCampaignEvidence(report: ScanResult, date: string): Promise<CampaignEvidence> {
  const [pins, repairs, checks] = await Promise.all([
    readRuntimePins(report.root),
    planFixReport(report),
    detectTestPlan(report.root),
  ]);
  const runtimePins = [...new Set(pins.map(({ runtime, normalized }) => `${runtime}@${normalized}`))]
    .sort()
    .flatMap((pin) => {
      const [runtime, version] = pin.split("@");
      return runtime && version ? [{ runtime, version }] : [];
    });
  return {
    date,
    runtimePins,
    codemods: [...new Set(repairs.patches.map(({ fixer }) => fixer))].sort(),
    checks: checks.steps
      .filter(({ command }) => command.every((argument) => argument.length <= 512 && !/\p{Cc}/u.test(argument)))
      .map(({ kind, command }) => ({ kind, command })),
  };
}
