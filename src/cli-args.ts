/** Offing's options end at the manager token. Values can contain words that look like commands. */
export function guardOptionCount(args: readonly string[]): number {
  let index = 0;
  while (index < args.length) {
    const argument = args[index];
    if (!argument?.startsWith("-")) break;
    const takesValue = argument === "--allow" || argument === "--fail-on" || argument === "--data-version";
    index += takesValue && index + 1 < args.length ? 2 : 1;
  }
  return index;
}

export function cliOptionArgs(args: readonly string[]): readonly string[] {
  const commandIndex = args.findIndex((argument) => argument !== "--debug");
  const start = commandIndex + 1;
  return args[commandIndex] === "guard" ? args.slice(0, start + guardOptionCount(args.slice(start))) : args;
}
