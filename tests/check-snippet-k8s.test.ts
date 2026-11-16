import assert from "node:assert/strict";
import { test } from "node:test";

import { checkSnippet } from "../src/check-snippet.js";

test("checks removed Kubernetes APIs in a multi-document manifest", async () => {
  const cases = [
    ["extensions/v1beta1", "Ingress", "networking.k8s.io/v1"],
    ["apps/v1beta1", "Deployment", "apps/v1"],
    ["apps/v1beta1", "StatefulSet", "apps/v1"],
    ["batch/v1beta1", "CronJob", "batch/v1"],
    ["policy/v1beta1", "PodDisruptionBudget", "policy/v1"],
  ];
  const path = "deploy/app.yaml";
  const { findings } = await checkSnippet({
    path,
    content: cases.map(([api, kind]) => `apiVersion: ${api}\nkind: ${kind}\nmetadata: {name: demo}\n`).join("---\n"),
  });
  assert.equal(findings.length, cases.length);
  for (const [index, [api, kind, replacement]] of cases.entries()) {
    const found = findings.find((finding) => finding.location.line === 1 + index * 4);
    assert.ok(found, kind);
    assert.equal(found.location.path, path);
    assert.equal(found.code, `apiVersion: ${api}`);
    assert.ok(replacement && found.replacement?.startsWith(`${replacement} ${kind}`));
    assert.deepEqual(found.source, found.sources[0]);
  }
});
