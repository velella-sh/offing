import type { Finding } from "./domain.js";
import type { FixerPatch, FixRefusal } from "./fix/index.js";
import { ATTRIBUTION_LINE } from "./github-action/render.js";
import type { Receipt } from "./receipt.js";
import { renderReceiptMarkdown } from "./receipt-markdown.js";
import {
  renderVerifyResultArtifactBlock,
  renderVerifyResultBlock,
  VERIFY_RESULT_ARTIFACT,
  type VerifyResult,
} from "./verify-result.js";

export const FIX_PR_PATCH = "offing-fix.patch";
export const FIX_PR_PLAN = "offing-fix-plan.json";
const MAX_BODY_BYTES = 64_000;
const DETAILS_AFTER = 5;

interface FixPullRequestBody {
  fixed: readonly Finding[];
  patches: readonly FixerPatch[];
  refusals: readonly FixRefusal[];
  receipt: Receipt;
  verification: VerifyResult;
  attribution: boolean;
  artifactUrl?: string;
}

function cell(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character] ?? character)
    .replace(/[\\|`[\]*_]/g, (character) => "\\" + character)
    .trim();
}

function code(value: string): string {
  const flat = value.replace(/[\r\n]+/g, " ").replaceAll("|", "\\|");
  const longest = (flat.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "`".repeat(longest + 1);
  const pad = flat.startsWith("`") || flat.endsWith("`") ? " " : "";
  return fence + pad + flat + pad + fence;
}

function evidence(finding: Finding): string {
  const source = finding.sources[0];
  if (!source) return "—";
  const url = URL.parse(source.url);
  return url && (url.protocol === "https:" || url.protocol === "http:")
    ? `[${cell(source.title)}](<${url.href.replaceAll("<", "%3C").replaceAll(">", "%3E")}>)`
    : cell(source.title);
}

function fixRows(input: FixPullRequestBody, limit: number): string[] {
  const rows = ["| Finding | Location | Evidence |", "|---|---|---|"];
  for (const finding of input.fixed.slice(0, limit)) {
    const { path, line } = finding.location;
    rows.push(
      `| ${cell(finding.title)} | ${code(line === undefined ? path : `${path}:${line}`)} | ${evidence(finding)} |`,
    );
  }
  return rows;
}

function details(title: string, labels: readonly string[], limit: number): string[] {
  if (labels.length === 0) return [];
  const rows = labels.slice(0, limit);
  if (labels.length > rows.length)
    rows.push(`_Showing ${rows.length} of ${labels.length}. See the workflow artifact for the full list._`);
  return labels.length > DETAILS_AFTER
    ? ["<details>", `<summary>${title} (${labels.length})</summary>`, "", ...rows, "", "</details>"]
    : [`### ${title}`, "", ...rows];
}

function patchRows(patches: readonly FixerPatch[]): string[] {
  const byFixer = new Map<string, Set<string>>();
  for (const { fixer, path } of patches) {
    const paths = byFixer.get(fixer) ?? new Set<string>();
    paths.add(path);
    byFixer.set(fixer, paths);
  }
  return [...byFixer]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([fixer, paths]) => `- ${code(fixer)} · ${[...paths].sort().map(code).join(", ")}`);
}

function refusalRows(refusals: readonly FixRefusal[]): string[] {
  return refusals.map(({ fixer, findingId, reason }) => {
    const command = `offing context '${findingId.replaceAll("'", "'\"'\"'")}'`;
    return `- ${code(fixer)} · ${cell(reason)} · ${code(command)}`;
  });
}

function artifactLine(artifactUrl: string | undefined): string {
  const files = [VERIFY_RESULT_ARTIFACT, FIX_PR_PATCH, FIX_PR_PLAN];
  const labels = files.map((name) => (artifactUrl ? `[${code(name)}](${artifactUrl})` : code(name)));
  return `Workflow artifact ` + code("offing-fix-pr") + ` contains ${labels.join(", ")}.`;
}

/** The evidence table stays first, and the workflow artifact retains records omitted from the body. */
export function renderFixPullRequestBody(input: FixPullRequestBody): string {
  const count = input.fixed.length;
  const heading = `## Offing lifecycle fixes\n\nThis pull request applies **${count}** deterministic lifecycle fix${count === 1 ? "" : "es"} found by Offing.`;
  const fixes = patchRows(input.patches);
  const refusals = refusalRows(input.refusals);
  const artifact = artifactLine(input.artifactUrl);
  const attribution = input.attribution ? ATTRIBUTION_LINE : "";
  const receipt = renderReceiptMarkdown(input.receipt).trimEnd();
  const verification = renderVerifyResultBlock(input.verification).trimEnd();
  const body = [
    heading,
    fixRows(input, DETAILS_AFTER).join("\n"),
    count > DETAILS_AFTER
      ? `_Showing ${DETAILS_AFTER} of ${count} resolved findings. See the verification artifact for the rest._`
      : "",
    details("Changes by fixer", fixes, 40).join("\n"),
    details("Refusals", refusals, 40).join("\n"),
    receipt,
    verification,
    artifact,
    attribution,
  ]
    .filter(Boolean)
    .join("\n\n");
  if (Buffer.byteLength(body, "utf8") <= MAX_BODY_BYTES) return body + "\n";
  const { resolved, remaining, introduced } = input.receipt.counts;
  return (
    [
      heading,
      fixRows(input, 0).join("\n"),
      `<!-- offing-receipt -->\n## Offing receipt\n\nResolved ${resolved}, remaining ${remaining}, introduced ${introduced}.`,
      `The workflow artifact includes the patch. The plan lists all ${refusals.length} refusal(s).`,
      renderVerifyResultArtifactBlock().trimEnd(),
      artifact,
      attribution,
    ]
      .filter(Boolean)
      .join("\n\n") + "\n"
  );
}
