import assert from "node:assert/strict";
import { test } from "node:test";

import { loadImageRules } from "../src/detectors/container/image-lifecycle.js";
import { parseDockerfileBuild } from "../src/detectors/container/parse-dockerfile.js";
import { buildImageLineage } from "../src/lineage/index.js";
import type { LineageInputs } from "../src/lineage/inputs.js";
import { resolveLineageDigests } from "../src/lineage/registry.js";

const a = `sha256:${"a".repeat(64)}`;
const b = `sha256:${"b".repeat(64)}`;
const c = `sha256:${"c".repeat(64)}`;

function declarations(...images: string[]): LineageInputs {
  return {
    builds: [],
    documents: images.map((image, index) => ({
      kind: "dockerfile",
      path: `Dockerfile.${index}`,
      ...parseDockerfileBuild(`FROM ${image}`),
    })),
  };
}

test("opt-in resolution caches a registry listing and follows exact manifest digests only", async () => {
  const rules = await loadImageRules();
  const sources = [declarations(`node@${a}`, `node@${b}`, `node@${a}`, `node:18@${c}`, `localhost:5000/test@${a}`)];
  const offline = buildImageLineage(sources, rules);
  const calls: URL[] = [];
  const request = async (input: URL | RequestInfo, init?: RequestInit) => {
    assert.equal(init?.redirect, "error");
    const url = new URL(String(input));
    calls.push(url);
    assert.equal(url.origin, "https://hub.docker.com");
    assert.match(url.pathname, /\/library\/repositories\/node\/tags$/);
    if (url.searchParams.get("page") === "1") {
      return Response.json({ next: "https://bad.example/", results: [{ name: "18", digest: a }] });
    }
    return Response.json({
      next: null,
      results: [
        { name: "20", digest: b },
        { name: "lts", digest: b },
        { name: "later", digest: c, images: [{ digest: a }] },
      ],
    });
  };
  const tags = await resolveLineageDigests(offline, request);
  assert.equal(calls.length, 2);
  const result = buildImageLineage(sources, rules, tags);
  assert.equal(result.chains[0]?.links[0]?.ruleId, "container.node.eol-21-and-older");
  assert.deepEqual(result.chains[1]?.links[0]?.matchingTags, ["20", "lts"]);
  assert.equal(result.chains[1]?.links[0]?.status, "unknown");
  assert.equal(result.chains[3]?.links[0]?.matchingTags, undefined);
  assert.equal(result.chains[4]?.links[0]?.status, "unknown");
});

test("incomplete enumeration and errors preserve unknown instead of guessing", async () => {
  const rules = await loadImageRules();
  const sources = [declarations(`node@${a}`, `ghcr.io/acme/base@${b}`)];
  const offline = buildImageLineage(sources, rules);
  const tags = await resolveLineageDigests(offline, async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "ghcr.io") return new Response(null, { status: 403 });
    return Response.json({ next: "more", results: [{ name: "18", digest: a }] });
  });
  const result = buildImageLineage(sources, rules, tags);
  assert.equal(result.chains[0]?.links[0]?.tagLookupIncomplete, true);
  assert.deepEqual(result.chains[0]?.links[0]?.matchingTags, ["18"]);
  assert.deepEqual(
    result.chains.map(({ links }) => links[0]?.status),
    ["unknown", "unknown"],
  );
});

test("GHCR only associates a tag if its manifest header names the digest", async () => {
  const rules = await loadImageRules();
  const sources = [declarations(`ghcr.io/acme/base@${a}`, `ghcr.io/acme/base@${c}`)];
  const offline = buildImageLineage(sources, rules);
  const tags = await resolveLineageDigests(offline, async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://ghcr.io");
    if (url.pathname === "/token") {
      assert.equal(url.searchParams.get("scope"), "repository:acme/base:pull");
      return Response.json({ token: "read_only" });
    }
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer read_only");
    if (url.pathname.endsWith("/tags/list")) return Response.json({ tags: ["v2", "v3", "bad tag"] });
    assert.equal(init?.method, "HEAD");
    const digest = url.pathname.endsWith("/v3") ? a : b;
    return new Response(null, { headers: { "docker-content-digest": digest } });
  });
  assert.deepEqual([...tags.values()], [{ tags: ["v3"], complete: true }]);
});
