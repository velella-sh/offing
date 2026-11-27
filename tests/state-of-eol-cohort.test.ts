import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { collectCohort, verifyCohort } from "../tools/state-of-eol/cohort.js";

const startedAt = "2026-11-27T07:00:00.000Z";
const finish = () => "2026-11-27T07:01:00.000Z";

function repository(name: string, stars: number) {
  return {
    nameWithOwner: `sample/${name}`,
    stargazerCount: stars,
    pushedAt: "2026-11-20T00:00:00Z",
    isArchived: false,
    isDisabled: false,
    isFork: false,
    isPrivate: false,
    defaultBranchRef: { name: "main", target: { oid: "a".repeat(40) } },
  };
}

test("enumerates the complete cutoff tie before ranking by repository name", async () => {
  const above = Array.from({ length: 99 }, (_, i) => repository(`other-${i}`, 199 - i));
  const beta = repository("Beta", 100);
  const alpha = repository("alpha", 100);
  const search: Parameters<typeof collectCohort>[0] = async (query, cursor) => {
    assert.match(query, /is:public fork:false archived:false pushed:>=2025-11-27 sort:stars-desc/);
    if (!query.includes("stars:100")) {
      return { repositoryCount: 1000, nodes: [...above, beta], pageInfo: { endCursor: "unused", hasNextPage: true } };
    }
    return cursor
      ? { repositoryCount: 2, nodes: [alpha], pageInfo: { endCursor: null, hasNextPage: false } }
      : { repositoryCount: 2, nodes: [beta], pageInfo: { endCursor: "next", hasNextPage: true } };
  };
  const cohort = await collectCohort(search, startedAt, finish, 100);
  assert.equal(cohort.repositories.at(-1)?.repository, "sample/alpha");
  assert.deepEqual(cohort.cutoff, { stars: 100, available: 2, selected: 1 });
  verifyCohort(cohort, 100);
});

test("refuses a partial tie rather than saving a non-reproducible cutoff", async () => {
  const nodes = Array.from({ length: 100 }, (_, i) => repository(`repo-${i}`, 200 - i));
  await assert.rejects(
    collectCohort(
      async (query) =>
        query.includes("stars:101")
          ? { repositoryCount: 2, nodes: nodes.slice(-1), pageInfo: { endCursor: null, hasNextPage: false } }
          : { repositoryCount: 150, nodes, pageInfo: { endCursor: "unused", hasNextPage: true } },
      startedAt,
      finish,
      100,
    ),
    /complete 101-star tie/,
  );
});

test("excludes ineligible repositories and rejects invalid activity or unpinned rows", async () => {
  const nodes = [
    { ...repository("archived", 300), isArchived: true },
    { ...repository("private", 240), isPrivate: true },
    { ...repository("disabled", 220), isDisabled: true },
    { ...repository("fork", 200), isFork: true },
    repository("selected", 150),
  ];
  const cohort = await collectCohort(
    async () => ({ repositoryCount: nodes.length, nodes, pageInfo: { endCursor: null, hasNextPage: false } }),
    startedAt,
    finish,
    1,
  );
  const row = cohort.repositories.at(0);
  assert.ok(row);
  assert.equal(row.repository, "sample/selected");
  verifyCohort(cohort, 1);
  assert.throws(() => verifyCohort({ ...cohort, repositories: [{ ...row, commit: "main" }] }, 1), /Invalid cohort row/);
  assert.throws(
    () => verifyCohort({ ...cohort, repositories: [{ ...row, pushedAt: "2024-11-20T00:00:00Z" }] }, 1),
    /Invalid cohort row/,
  );
});

test("verifies the recorded cohort entirely offline", async () => {
  const cohort = JSON.parse(await readFile("benchmarks/state-of-eol/2027-cohort.json", "utf8")) as Parameters<
    typeof verifyCohort
  >[0];
  verifyCohort(cohort);
  const [first, ...rest] = cohort.repositories;
  assert.ok(first);
  assert.throws(() => verifyCohort({ ...cohort, repositories: [first, first, ...rest.slice(1)] }), /Invalid rank/);
});
