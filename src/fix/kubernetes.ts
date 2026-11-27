import { defineCodemod } from "./kit/define.js";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { looksLikeHelmTemplateOutput } from "../detectors/kubernetes/index.js";
import { parseTemplate } from "../detectors/kubernetes/parse-helm.js";
import { patchFor } from "./codemods/shared/edits.js";
import type { Edit } from "./codemods/shared/edits.js";
import { readManifest, structuralApi, structuralEdits } from "./codemods/shared/kubernetes-schema.js";
import type { StructuralApi } from "./codemods/shared/kubernetes-schema.js";
import { splitApiVersion } from "../detectors/kubernetes/api-version.js";
import type { Finding, ScanResult } from "../domain.js";
import type { FilePatch, Refuse } from "./types.js";

/**
 * The removed `apiVersion` values the Kubernetes deprecation guide moves with no schema change,
 * by group/kind: the new API holds the same object, so rewriting the line is the whole migration.
 * Migrations with renamed, added, or reinterpreted fields use a structural codemod.
 * This table lists the cases that need only the literal API version change.
 * Source:
 * https://kubernetes.io/docs/reference/using-api/deprecation-guide/
 */
const API_VERSIONS: Record<string, Record<string, string>> = {
  "apiregistration.k8s.io/APIService": { "apiregistration.k8s.io/v1beta1": "apiregistration.k8s.io/v1" },
  "authentication.k8s.io/TokenReview": { "authentication.k8s.io/v1beta1": "authentication.k8s.io/v1" },
  "batch/CronJob": { "batch/v1beta1": "batch/v1" },
  "coordination.k8s.io/Lease": { "coordination.k8s.io/v1beta1": "coordination.k8s.io/v1" },
  "extensions/NetworkPolicy": { "extensions/v1beta1": "networking.k8s.io/v1" },
  "flowcontrol.apiserver.k8s.io/FlowSchema": {
    "flowcontrol.apiserver.k8s.io/v1beta1": "flowcontrol.apiserver.k8s.io/v1",
    "flowcontrol.apiserver.k8s.io/v1beta2": "flowcontrol.apiserver.k8s.io/v1",
    "flowcontrol.apiserver.k8s.io/v1beta3": "flowcontrol.apiserver.k8s.io/v1",
  },
  "networking.k8s.io/IngressClass": { "networking.k8s.io/v1beta1": "networking.k8s.io/v1" },
  "node.k8s.io/RuntimeClass": { "node.k8s.io/v1beta1": "node.k8s.io/v1" },
  "rbac.authorization.k8s.io/ClusterRole": { "rbac.authorization.k8s.io/v1beta1": "rbac.authorization.k8s.io/v1" },
  "rbac.authorization.k8s.io/ClusterRoleBinding": {
    "rbac.authorization.k8s.io/v1beta1": "rbac.authorization.k8s.io/v1",
  },
  "rbac.authorization.k8s.io/Role": { "rbac.authorization.k8s.io/v1beta1": "rbac.authorization.k8s.io/v1" },
  "rbac.authorization.k8s.io/RoleBinding": { "rbac.authorization.k8s.io/v1beta1": "rbac.authorization.k8s.io/v1" },
  "scheduling.k8s.io/PriorityClass": { "scheduling.k8s.io/v1beta1": "scheduling.k8s.io/v1" },
  "storage.k8s.io/CSIDriver": { "storage.k8s.io/v1beta1": "storage.k8s.io/v1" },
  "storage.k8s.io/CSINode": { "storage.k8s.io/v1beta1": "storage.k8s.io/v1" },
  "storage.k8s.io/CSIStorageCapacity": { "storage.k8s.io/v1beta1": "storage.k8s.io/v1" },
  "storage.k8s.io/StorageClass": { "storage.k8s.io/v1beta1": "storage.k8s.io/v1" },
  "storage.k8s.io/VolumeAttachment": { "storage.k8s.io/v1beta1": "storage.k8s.io/v1" },
};

const API_VERSION_LINE = /^(\s*(?:-\s*)?apiVersion\s*:\s*["']?)([^\s#"']+)(.*)$/;
const DECLARATION = /^.* declares (\S+) (\S+)\. /;

function rewriteTarget(finding: Finding): ApiEdit | undefined {
  const match = DECLARATION.exec(finding.summary);
  if (!match) return undefined;
  const from = match[1];
  if (from === undefined) return undefined;
  const parts = splitApiVersion(from);
  const kind = match[2] ?? "";
  const structural = structuralApi(from, kind);
  if (structural) return { from, to: structural.to, structural };
  const to = parts && API_VERSIONS[`${parts.group}/${kind}`]?.[from];
  return to ? { from, to } : undefined;
}

interface ApiEdit {
  from: string;
  to: string;
  structural?: StructuralApi;
}

interface Targets {
  lines: Map<number, ApiEdit>;
  findings: Finding[];
}

function collectTargets(result: ScanResult, refuse: Refuse | undefined): Map<string, Targets> {
  const targets = new Map<string, Targets>();
  for (const finding of result.findings) {
    if (finding.detector !== "kubernetes") continue;
    if (finding.location.line === undefined) {
      refuse?.(finding, "The finding names no line to rewrite.");
      continue;
    }
    const edit = rewriteTarget(finding);
    if (!edit) {
      refuse?.(finding, refusedReason(finding));
      continue;
    }
    if (edit.structural && !finding.replacement?.startsWith(`${edit.to} ${edit.structural.kind},`)) {
      refuse?.(finding, "The rule no longer names the expected Kubernetes replacement.");
      continue;
    }
    const entry: Targets = targets.get(finding.location.path) ?? { lines: new Map(), findings: [] };
    entry.lines.set(finding.location.line, edit);
    entry.findings.push(finding);
    targets.set(finding.location.path, entry);
  }
  return targets;
}

/** Rewrites literal API versions and the supported structural migrations of declared Kubernetes resources. */
export const kubernetesApiVersionFixer = defineCodemod({
  id: "kubernetes",
  rules: [{ id: "*", detector: "kubernetes" }],
  async plan(result, refuse) {
    const targets = collectTargets(result, refuse);

    const patches: FilePatch[] = [];
    for (const [path, { lines, findings }] of [...targets].sort(([a], [b]) => a.localeCompare(b))) {
      const decline = (reason: string) => {
        for (const finding of findings) refuse?.(finding, reason);
      };
      const absolute = resolve(result.root, path);
      const inside = relative(resolve(result.root), absolute);
      if (inside.startsWith("..") || isAbsolute(inside)) {
        decline("The path resolves outside the repository.");
        continue;
      }
      const before = await readFile(absolute, "utf8").catch(() => undefined);
      if (before === undefined) {
        decline("The manifest could not be read.");
        continue;
      }
      if (!before.endsWith("\n")) {
        decline("The manifest does not end with a newline.");
        continue;
      }
      const patch = patchFor(
        path,
        before,
        apiEdits(before, path, lines, findings, refuse),
        [...lines.values()].some(({ structural }) => structural),
      );
      if (patch) patches.push(patch);
    }
    return patches;
  },
});

function apiEdits(
  before: string,
  path: string,
  targets: ReadonlyMap<number, ApiEdit>,
  findings: readonly Finding[],
  refuse: Refuse | undefined,
): Edit[] {
  const helm = !looksLikeHelmTemplateOutput(before) && (before.includes("{{") || path.split("/").includes("templates"));
  const template = helm ? parseTemplate(before) : [];
  const manifest =
    !helm && [...targets.values()].some(({ structural }) => structural) ? readManifest(before) : undefined;
  const edits: Edit[] = [];
  let offset = 0;
  for (const [index, line] of before.split("\n").entries()) {
    const edit = targets.get(index + 1);
    if (edit) {
      const changed = apiLineEdits(edit, line, index + 1, offset, helm, template, manifest);
      if (typeof changed === "string") {
        for (const finding of findings.filter(({ location }) => location.line === index + 1))
          refuse?.(finding, changed);
      } else edits.push(...changed);
    }
    offset += line.length + 1;
  }
  return edits;
}

function apiLineEdits(
  edit: ApiEdit,
  line: string,
  number: number,
  offset: number,
  helm: boolean,
  template: ReturnType<typeof parseTemplate>,
  manifest: ReturnType<typeof readManifest> | undefined,
): Edit[] | string {
  const match = API_VERSION_LINE.exec(line);
  if (!match) return "The line is not an `apiVersion` declaration.";
  if (match[2] !== edit.from) return "The line no longer carries the API version the finding names.";
  if (helm && (line.includes("{{") || !template.some(({ line, value }) => line === number && value === edit.from)))
    return "The Helm apiVersion is not an unambiguous literal declaration.";
  if (helm && edit.structural) return "The Helm resource needs a spec migration. Review the migration packet.";
  const schema = edit.structural && manifest ? structuralEdits(manifest, number, edit.structural) : [];
  if (typeof schema === "string") return schema;
  const start = offset + (match[1]?.length ?? 0);
  return [{ start, end: start + edit.from.length, replacement: edit.to }, ...schema];
}

/** Why the finding names no safe rewrite, decided from the finding itself. */
function refusedReason(finding: Finding): string {
  const match = DECLARATION.exec(finding.summary);
  const from = match?.[1];
  if (from === undefined) return "The finding does not name the declaration's API version.";
  const kind = match?.[2];
  if (kind === "PodSecurityPolicy")
    return "PodSecurityPolicy has no equivalent API version. Review the migration packet for Pod Security Admission.";
  if (kind === "CustomResourceDefinition" && from === "apiextensions.k8s.io/v1beta1")
    return "CustomResourceDefinition v1 requires a structural schema. Review the migration packet.";
  const parts = splitApiVersion(from);
  if (!parts) return "The finding's API version could not be parsed.";
  return "The replacement needs a spec change, not only an `apiVersion` rewrite.";
}
