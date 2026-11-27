import { resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import { OffingError } from "../offing-error.js";
import { runContainerTests } from "../test-runners/consumer.js";
import type { CommandContext } from "../commands/types.js";

const usage = "offing autopilot [path] --test-only [--container]";

/** Execute an expressly requested test-only operation with no migration phases. */
export async function runTestOnly(args: string[], ctx: CommandContext): Promise<number> {
  let options: ReturnType<typeof parseArgs>;
  try {
    options = parseArgs({
      args,
      allowPositionals: true,
      options: { "test-only": { type: "boolean" }, container: { type: "boolean" } },
    });
  } catch {
    return ctx.fail("usage", "Usage: " + usage);
  }
  const { positionals, values } = options;
  if (values["test-only"] !== true || positionals.length > 1) return ctx.fail("usage", "Usage: " + usage);
  try {
    const result = await runContainerTests(resolve(positionals[0] ?? "."));
    process.stdout.write("Pinned Docker tests\n" + result.output);
    return result.passed ? 0 : 1;
  } catch (error) {
    if (error instanceof OffingError) return ctx.failError(error);
    return ctx.fail(
      "data",
      "Pinned Docker test execution is unavailable. Check that Docker and the pinned image are accessible.",
    );
  }
}
