import { constants } from "node:fs";
import { open } from "node:fs/promises";

/** Reads one bounded regular file, with no final symlink following or FIFO blocking. */
export async function readRunnerText(path: string, limit = 1024 * 1024): Promise<string | undefined> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(
    () => undefined,
  );
  if (!file) return undefined;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > limit) return undefined;
    const buffer = Buffer.alloc(info.size + 1);
    const { bytesRead } = await file.read(buffer);
    return bytesRead === info.size ? buffer.toString("utf8", 0, bytesRead) : undefined;
  } finally {
    await file.close();
  }
}
