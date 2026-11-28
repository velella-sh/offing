import { readFile } from "node:fs/promises";

import { z } from "zod";

import { profiles } from "../../src/test-runners/profiles.js";
import type { Commands, Input } from "./evaluate.js";

const command = z.tuple([z.string().min(1)]).rest(z.string());
const sha = z.string().regex(/^[a-f0-9]{40}$/u);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const selection = z.object({
  offingCommit: sha,
  repositories: z
    .array(
      z.object({
        repository: z.string().regex(/^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*$/iu),
        commit: sha,
        patches: z.array(z.object({ paths: z.array(z.string()).min(1) })).min(1),
        baseline: z.discriminatedUnion("kind", [
          z.object({
            kind: z.literal("isolated"),
            image: z.string(),
            lockSha256: z.string().optional(),
            checks: z.array(z.object({ command })).min(1),
            provider: z
              .object({
                url: z
                  .string()
                  .regex(
                    /^https:\/\/github\.com\/digitalocean\/terraform-provider-digitalocean\/releases\/download\/[\w.]+\/terraform-provider-digitalocean_[\w.]+_linux_amd64\.zip$/u,
                  ),
                sha256: digest,
              })
              .optional(),
            schemas: z
              .object({
                repository: z.literal("yannh/kubernetes-json-schema"),
                commit: sha,
                directory: z.string().regex(/^v[\d.]+-standalone-strict$/u),
                files: z.array(z.string().regex(/^[a-z0-9-]+\.json$/u)).min(1),
              })
              .optional(),
          }),
          z.object({ kind: z.literal("upstream") }),
        ]),
      }),
    )
    .min(60),
});

export interface Candidate {
  input: Input;
  commands?: Commands;
  paths?: ReadonlySet<string>;
  image?: string;
  assets?: readonly Asset[];
}

export interface Asset {
  url: string;
  path: string;
  sha256?: string;
}

type Baseline = z.infer<typeof selection>["repositories"][number]["baseline"];

const goCheck = (action: "build" | "test"): Commands["build"] => [
  "sh",
  "-ec",
  "mkdir -p /work/go-tmp /work/go-cache && export GOTMPDIR=/work/go-tmp GOCACHE=/work/go-cache && go " +
    action +
    " -mod=vendor ./...",
];

function execution(baseline: Baseline): Omit<Candidate, "input" | "paths"> & { profile: Input["profile"] } {
  if (baseline.kind === "upstream") return { profile: null };
  if (baseline.image === profiles["github-actions"].image) return { profile: "github-actions" };
  if (baseline.image === profiles.go.image) {
    return { profile: "go", commands: { build: goCheck("build"), test: goCheck("test") } };
  }
  const [first, second] = baseline.checks;
  if (baseline.provider && first && /^docker\.io\/hashicorp\/terraform@sha256:[a-f0-9]{64}$/u.test(baseline.image)) {
    return {
      profile: "terraform",
      image: baseline.image,
      commands: { build: first.command },
      assets: [{ ...baseline.provider, path: ".offing-tool.zip" }],
    };
  }
  if (baseline.schemas && first?.command[0] === "/usr/local/bin/kubeconform") {
    const { repository, commit, directory, files } = baseline.schemas;
    const assets = [...new Set([...files, "ingress-networking-v1.json"])].map((file) => ({
      url: `https://raw.githubusercontent.com/${repository}/${commit}/${directory}/${file}`,
      path: `.offing-kubeconform-schemas/${file}`,
    }));
    return { profile: "kubernetes", commands: { build: first.command }, assets };
  }
  if (
    baseline.image === profiles.npm.image &&
    baseline.lockSha256 === undefined &&
    baseline.checks.length === 2 &&
    first?.command[0] === "node" &&
    first.command[1] === "--check" &&
    second !== undefined
  ) {
    return { profile: "npm", commands: { build: first.command, test: second.command } };
  }
  return { profile: null };
}

export async function readCohort(): Promise<{ revision: string; candidates: Candidate[] }> {
  const data = selection.parse(JSON.parse(await readFile("benchmarks/fix-evals/selection.json", "utf8")));
  const candidates = data.repositories.map(({ repository, commit, baseline, patches }) => {
    const id = repository.toLowerCase().replace(/[^a-z0-9]+/gu, "-");
    const { profile, ...setup } = execution(baseline);
    return {
      input: { id, repository, commit, profile },
      paths: new Set(patches.flatMap(({ paths }) => paths)),
      ...setup,
    };
  });
  if (new Set(candidates.map(({ input }) => input.id)).size !== candidates.length) {
    throw new Error("Duplicate fix-evals case ID.");
  }
  return { revision: data.offingCommit, candidates };
}
