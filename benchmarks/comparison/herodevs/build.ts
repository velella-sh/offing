import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { purlIdentity, parsePurl } from "@velella/ebb/purl";
import semver from "semver";

import type { BuiltComparison } from "../reproduce.js";
import {
  CLAIMS_PATH,
  type ClaimsSnapshot,
  type DatedClaim,
  INPUT_PATH,
  type OffingDate,
  RESULT_DIR,
  type SbomCapture,
} from "./types.js";

type Outcome = "agree" | "date-differs" | "hero-only" | "ambiguous-offing";

interface DatedRow {
  repository: string;
  commit: string;
  purl: string;
  claim: DatedClaim;
  offing: OffingDate[];
  outcome: Outcome;
}

function key(purl: string, major: number): string {
  return `${purl}:${major}`;
}

function outcomeFor(claim: DatedClaim, offing: OffingDate[]): Outcome {
  const dates = new Set(offing.map((item) => item.eol));
  if (dates.size === 0) return "hero-only";
  if (dates.size > 1) return "ambiguous-offing";
  return dates.has(claim.eol) ? "agree" : "date-differs";
}

export function comparePublicClaims(capture: SbomCapture, snapshot: ClaimsSnapshot) {
  const byLine = new Map(snapshot.claims.map((claim) => [key(claim.purl, claim.major), claim]));
  if (byLine.size !== snapshot.claims.length) throw new Error("Duplicate HeroDevs package release claim.");

  const rows: DatedRow[] = [];
  let inventoried = 0;
  let excluded = 0;
  for (const sample of capture.cases) {
    inventoried += sample.packages.length;
    excluded += sample.excluded;
    for (const purl of sample.packages) {
      const version = semver.parse(parsePurl(purl).version);
      if (!version || version.prerelease.length > 0) continue;
      const claim = byLine.get(key(purlIdentity(purl), version.major));
      if (!claim) continue;
      const offing = sample.offing.filter((date) => date.purl === purl);
      rows.push({
        repository: sample.repository,
        commit: sample.commit,
        purl,
        claim,
        offing,
        outcome: outcomeFor(claim, offing),
      });
    }
  }
  const outcomes: Record<Outcome, number> = { agree: 0, "date-differs": 0, "hero-only": 0, "ambiguous-offing": 0 };
  for (const row of rows) outcomes[row.outcome]++;
  return {
    checkedAt: snapshot.checkedAt,
    totals: {
      repositories: capture.cases.length,
      inventoried,
      excluded,
      matched: rows.length,
      noPublicDate: inventoried - rows.length,
      ...outcomes,
    },
    rows,
  };
}

function markdown(report: ReturnType<typeof comparePublicClaims>): string {
  const { totals, rows, checkedAt } = report;
  return [
    "# HeroDevs public lifecycle dates",
    "",
    `Public claims checked ${checkedAt}. The ${totals.repositories} pinned SBOMs contain ${totals.inventoried} repository and npm package-version pairs after filtering and deduplication within each repository. ${totals.excluded} original artifacts were outside that scope or duplicates.`,
    `Public dates cover ${totals.matched} package-version and repository pairs. ${totals.noPublicDate} pairs have no matching date in the reviewed articles.`,
    "",
    "| Repository and commit | Package | HeroDevs date | Offing date | Outcome |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map(({ repository, commit, purl, claim, offing, outcome }) => {
      const pin = `[${repository}@${commit.slice(0, 8)}](https://github.com/${repository}/tree/${commit})`;
      const dates = offing.map((item) => `[${item.eol}](${item.source})`).join(", ") || "No dated match";
      return `| ${pin} | \`${purl}\` | [${claim.eol}](${claim.source}) | ${dates} | ${outcome} |`;
    }),
    "",
  ].join("\n");
}

function digest(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export async function buildHeroDevs(root: string): Promise<BuiltComparison> {
  const [input, claims] = await Promise.all([
    readFile(resolve(root, INPUT_PATH), "utf8"),
    readFile(resolve(root, CLAIMS_PATH), "utf8"),
  ]);
  const capture = JSON.parse(input) as SbomCapture;
  const result = comparePublicClaims(capture, JSON.parse(claims) as ClaimsSnapshot);
  return {
    name: "herodevs",
    pins: {
      offing: capture.offingVersion,
      offingCommit: capture.offingCommit,
      dataVersion: capture.dataVersion,
      syft: capture.syftVersion,
      claimsChecked: result.checkedAt,
      claimsSha256: digest(claims),
      sbomCaptureSha256: digest(input),
    },
    inputs: { repositories: result.totals.repositories, packageVersions: result.totals.inventoried },
    known: result.totals,
    files: [
      { path: `${RESULT_DIR}/herodevs.json`, contents: `${JSON.stringify(result, null, 2)}\n` },
      { path: `${RESULT_DIR}/herodevs.md`, contents: markdown(result) },
    ],
  };
}
