import { text } from "node:stream/consumers";

import { required } from "../../required.js";
import { blockNetwork } from "./network-guard.js";

const verifyNetwork = blockNetwork();
const { builtInDetectors } = await import("../../detectors/index.js");
const { scanRepository } = await import("../../engine/index.js");
const { fixers, planFixReport } = await import("../index.js");
const root = required(process.argv[2], "fixture root");
const builtIn = process.argv[3];
const fixer =
  builtIn === undefined
    ? await readDeclaration()
    : required(
        fixers.find(({ id }) => id === builtIn),
        "built-in codemod",
      );
const result = await scanRepository(root, builtInDetectors, { noCache: true });
const plan = await planFixReport(result, [fixer]);
verifyNetwork();
process.stdout.write(JSON.stringify(plan));

async function readDeclaration() {
  const { declarativeCodemod, declarationSchema } = await import("./declaration.js");
  return declarativeCodemod(declarationSchema.parse(JSON.parse(await text(process.stdin))));
}
