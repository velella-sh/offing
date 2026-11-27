import { z } from "zod";

import type { Finding } from "../../domain.js";
import { diffFor } from "../codemods/shared/edits.js";
import { readRepositoryFile } from "../codemods/shared/source.js";
import type { FilePatch, Refuse } from "../types.js";
import { defineCodemod } from "./define.js";

const line = z
  .string()
  .min(1)
  .regex(/^[^\r\n]+$/u)
  .refine((text) => !text.includes("\0"), "Expected a line without NUL bytes");
const safePath = /^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/u;

function repositoryPath(path: string): boolean {
  return safePath.test(path) && path.split("/").every((part) => part !== "." && part !== ".." && part !== ".git");
}

export const declarationSchema = z
  .strictObject({
    schemaVersion: z.literal("offing.codemod.v1"),
    id: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*$/u),
    ruleId: z.string().regex(/^[a-zA-Z0-9.-]+$/u),
    expectedReplacement: z.string().min(1),
    path: z.string().refine(repositoryPath, "Expected a portable repository-relative path"),
    before: line,
    after: line,
  })
  .refine((declaration) => declaration.before !== declaration.after, "The old and new lines must differ");

export type Declaration = z.infer<typeof declarationSchema>;

async function replacementPatch(
  root: string,
  change: Declaration,
  findings: Finding[],
  refuse: Refuse | undefined,
): Promise<FilePatch[]> {
  if (findings.length === 0) return [];
  const source = await readRepositoryFile(root, change.path);
  if ("reason" in source) {
    for (const finding of findings) refuse?.(finding, source.reason);
    return [];
  }
  const lines = source.text.split("\n");
  const offsets = new Set<number>();
  for (const finding of findings) {
    const index = (finding.location.line ?? 0) - 1;
    const current = lines[index]?.replace(/\r$/u, "");
    if (current === change.before) offsets.add(index);
    else if (current !== change.after)
      refuse?.(finding, "The finding line does not match the codemod's exact old line.");
  }
  for (const index of offsets) lines[index] = change.after + (lines[index]?.endsWith("\r") ? "\r" : "");
  const patch = diffFor(change.path, source.text, lines.join("\n"));
  return patch === undefined ? [] : [patch];
}

export function declarativeCodemod(change: Declaration) {
  const trusted = defineCodemod({
    id: change.id,
    rules: [{ id: change.ruleId, replacement: change.expectedReplacement }],
    plan(result, refuse) {
      return replacementPatch(result.root, change, result.findings, refuse);
    },
  });
  return {
    id: trusted.id,
    plan(result: Parameters<typeof trusted.plan>[0], refuse?: Refuse) {
      return trusted.plan(
        { ...result, findings: result.findings.filter((finding) => finding.location.path === change.path) },
        refuse,
      );
    },
  };
}
