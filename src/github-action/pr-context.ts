import { realpath, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { git } from "../diff.js";
import type { Finding } from "../domain.js";
import { buildReceipt } from "../receipt.js";
import { scanRefWithBuiltIns } from "../scan-builtins.js";
import { changedLines, selectChangedAnnotations } from "./diff.js";
import type { PullRequestCountdown } from "./pr-countdown.js";
import type { GitHubActionOutcome } from "./types.js";

const commitSha = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu;

function checkoutRefs(repo: string, base: string, head: string, diffMode: boolean) {
  if (!diffMode) {
    const [commit, first, second] = git(repo, ["show", "-s", "--format=%H %P", "HEAD"]).toString().trim().split(" ");
    if (commit && first === base && second === head) return { before: base, after: commit };
    if (commit !== head) throw new Error("The checkout does not match the pull request head or merge commit.");
  }
  const before = git(repo, ["merge-base", base, head]).toString().trim();
  return { before, after: head };
}

async function scanReceiptTree(repo: string, ref: string, prefix: string): Promise<Finding[]> {
  if (!prefix) return scanRefWithBuiltIns(repo, ref);
  const entry = git(repo, ["--literal-pathspecs", "ls-tree", ref, "--", prefix]).toString();
  const tree = /^040000 tree ([0-9a-f]+)\t/u.exec(entry)?.[1];
  return tree ? scanRefWithBuiltIns(repo, tree) : [];
}

async function writeReceipt(
  outcome: GitHubActionOutcome,
  repo: string,
  before: string,
  prefix: string,
  afterFindings: Finding[],
  includes: (finding: Finding) => boolean,
): Promise<string> {
  const beforeFindings = (await scanReceiptTree(repo, before, prefix)).filter(includes);
  const after = { ...outcome.result, findings: afterFindings.filter(includes) };
  const receipt = buildReceipt({ ...after, findings: beforeFindings }, after, { data: { before: null, after: null } });
  const path = join(dirname(outcome.reportPath), "offing-receipt.json");
  await writeFile(path, JSON.stringify(receipt, null, 2) + "\n", "utf8");
  return path;
}

export async function preparePullRequestCountdown(
  outcome: GitHubActionOutcome,
  refs: { base?: string | undefined; head?: string | undefined },
  receiptUrl?: string,
): Promise<{ countdown: PullRequestCountdown; receiptPath?: string }> {
  const { base, head } = refs;
  if (!base || !head || !commitSha.test(base) || !commitSha.test(head)) throw new Error("Missing pull request SHAs.");
  const { root, findings, scannedAt } = outcome.result;
  const scanRoot = await realpath(root);
  const repo = git(scanRoot, ["rev-parse", "--show-toplevel"]).toString().trimEnd();
  const { before, after } = checkoutRefs(repo, base, head, outcome.diff !== undefined);
  const timelineFindings = outcome.diff ? await scanRefWithBuiltIns(repo, after) : findings;
  const prefix = relative(repo, scanRoot).replaceAll("\\", "/");
  const changed = changedLines(repo, `${before}..${after}`);
  const scoped = prefix
    ? new Map(
        [...changed]
          .filter(([path]) => path.startsWith(`${prefix}/`))
          .map(([path, ranges]) => [path.slice(prefix.length + 1), ranges]),
      )
    : changed;
  const dated = timelineFindings.filter((finding) => finding.deadline !== undefined);
  const selected = selectChangedAnnotations(dated, scoped).annotated;
  const countdown = { today: scannedAt.slice(0, 10), findings: selected, timelineFindings };
  if (selected.length === 0 || !receiptUrl) return { countdown };
  const paths = outcome.packages?.map(({ path }) => path) ?? ["."];
  const includes = ({ location }: Finding) =>
    paths.some((path) => path === "." || location.path.startsWith(`${path}/`));
  try {
    const afterFindings = outcome.diff ? timelineFindings : await scanReceiptTree(repo, after, prefix);
    const receiptPath = await writeReceipt(outcome, repo, before, prefix, afterFindings, includes);
    return { countdown: { ...countdown, receiptUrl }, receiptPath };
  } catch {
    console.log(
      "::warning title=Offing PR receipt skipped::Could not build the verification receipt for this pull request.",
    );
    return { countdown };
  }
}
