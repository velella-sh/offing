import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const budget = 300_000;

/** Sum the gzip transfer sizes of every asset in the standalone page output. */
export async function checkWebSize(directory: string): Promise<void> {
  const files = (await readdir(directory, { recursive: true, withFileTypes: true })).filter((file) => file.isFile());
  const sizes = await Promise.all(
    files.map(async (file) => gzipSync(await readFile(join(file.parentPath, file.name))).byteLength),
  );
  const total = sizes.reduce((sum, size) => sum + size, 0);
  console.log(`Forecast web: ${total} / ${budget} gzip bytes across ${files.length} files`);
  if (total > budget) throw new Error("Forecast web exceeded the 300 KB gzip budget.");
}
