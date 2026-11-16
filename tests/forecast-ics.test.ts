import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import ICAL from "ical.js";

import { runCli } from "./cli-runner.js";

test("--ics exports the same calendar to stdout and to a file, with explicit overwrite", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "offing-forecast-ics-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "package.json"), JSON.stringify({ engines: { node: "22" } }));
  const options = { cwd: root };
  const args = ["forecast", "--as-of", "2026-10-25", "--data-version", "bundled", "--ics"];
  const stdout = await runCli(args, options);
  assert.equal(stdout.code, 0, stdout.stderr);
  assert.match(stdout.stdout, /^BEGIN:VCALENDAR\r\n/);
  const calendar = new ICAL.Component(ICAL.parse(stdout.stdout));
  const events = calendar.getAllSubcomponents("vevent");
  assert.deepEqual(
    events.map((event) => event.getFirstPropertyValue("uid")),
    ["nodejs.runtime.eol-22-2027-04-30@offing"],
  );

  const file = join(root, "forecast.ics");
  const save = async (...flags: string[]) => runCli([...args, "forecast.ics", ...flags], options);
  const created = await save();
  assert.equal(created.code, 0, created.stderr);
  assert.equal(created.stdout, "");
  assert.equal(await readFile(file, "utf8"), stdout.stdout);

  await writeFile(file, "existing");
  const refused = await save();
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /--force/);
  assert.equal(await readFile(file, "utf8"), "existing");

  const replaced = await save("--force");
  assert.equal(replaced.code, 0, replaced.stderr);
  assert.equal(await readFile(file, "utf8"), stdout.stdout);

  const conflict = await runCli([...args, "--json"], options);
  assert.equal(conflict.code, 2);
  assert.match(conflict.stderr, /--ics/);

  const forceWithoutFile = await runCli([...args, "--force"], options);
  assert.equal(forceWithoutFile.code, 2);
  assert.match(forceWithoutFile.stderr, /--force needs --ics <file>/);
});

test("--ics cleans up a staged calendar when the destination cannot be replaced", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "offing-forecast-ics-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const destination = join(root, "forecast.ics");
  await mkdir(destination);
  await writeFile(join(destination, "keep.txt"), "existing content");

  const result = await runCli(
    ["forecast", "--as-of", "2026-10-25", "--data-version", "bundled", "--ics", destination, "--force"],
    { cwd: root },
  );
  assert.equal(result.code, 5);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /forecast\.ics/);
  assert.equal(await readFile(join(destination, "keep.txt"), "utf8"), "existing content");
  assert.ok((await readdir(root)).every((name) => !name.startsWith(".offing-calendar-")));
});
