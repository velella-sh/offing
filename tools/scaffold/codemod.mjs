import { access, mkdir, rm, rmdir, writeFile } from "node:fs/promises";
import process from "node:process";

import { codemodTemplate, fixtureTemplate } from "./templates/codemod.mjs";

async function scaffold(id) {
  if (!/^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*$/u.test(id ?? "")) {
    throw new Error("Usage: npm run new:codemod <kebab-case-id>");
  }
  await access("src/fix/kit/define.ts").catch(() => {
    throw new Error("Run new:codemod from the Offing checkout root.");
  });
  const fixture = `tests/fixtures/codemods/${id}`;
  const source = `src/fix/codemods/${id}.ts`;
  await mkdir(fixture);
  const files = [];
  const directories = [fixture];
  try {
    const starter = `${fixture}/example`;
    for (const directory of [starter, `${starter}/before`, `${starter}/after`]) {
      await mkdir(directory);
      directories.push(directory);
    }
    for (const [relative, text] of fixtureTemplate) {
      const path = `${starter}/${relative}`;
      await writeFile(path, text, { flag: "wx" });
      files.push(path);
    }
    await writeFile(source, codemodTemplate(id), { flag: "wx" });
    process.stdout.write(
      `Created ${source} and ${starter}. Complete the planner and fixtures, then run npm run check.\n`,
    );
  } catch (error) {
    await Promise.all(files.map((file) => rm(file, { force: true })));
    for (const directory of directories.reverse()) await rmdir(directory);
    throw error;
  }
}

try {
  if (process.argv.length !== 3) throw new Error("Usage: npm run new:codemod <kebab-case-id>");
  await scaffold(process.argv[2]);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
