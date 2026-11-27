import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";

import { isSafeTreePath } from "./git.js";
import { FleetHostError, type FleetSelection } from "./host.js";

const decompress = promisify(gunzip);
const MAX_COMPRESSED_BYTES = 32 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const BLOCK = 512;

async function archiveBytes(response: Response): Promise<Buffer> {
  if (!response.body) throw new FleetHostError("Fleet archive has no body.");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(parts, bytes);
      bytes += value.byteLength;
      if (bytes > MAX_COMPRESSED_BYTES) throw new FleetHostError("Fleet archive exceeds the 32 MiB download limit.");
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function field(header: Buffer, offset: number, length: number): string {
  return (
    header
      .subarray(offset, offset + length)
      .toString("utf8")
      .split("\0", 1)[0] ?? ""
  );
}

function paxPath(body: Buffer): string | undefined {
  let offset = 0;
  while (offset < body.length) {
    const space = body.indexOf(32, offset);
    if (space === -1) break;
    const length = Number(body.toString("ascii", offset, space));
    if (!Number.isSafeInteger(length) || length <= space - offset + 1 || offset + length > body.length) break;
    const item = body.toString("utf8", space + 1, offset + length - 1);
    if (item.startsWith("path=")) return item.slice(5);
    offset += length;
  }
  return undefined;
}

/** Extract only regular files, without asking an archive utility to create links or paths. */
async function writeInputs(tar: Buffer, directory: string, selection: FleetSelection): Promise<void> {
  let override: string | undefined;
  for (let offset = 0; offset + BLOCK <= tar.length; ) {
    const header = tar.subarray(offset, offset + BLOCK);
    const name = field(header, 0, 100);
    if (!name) return;
    const sizeField = field(header, 124, 12).trim();
    const bytes = Number.parseInt(sizeField, 8);
    if (!/^[0-7]+$/.test(sizeField) || offset + BLOCK + bytes > tar.length)
      throw new FleetHostError("Fleet archive contains a malformed entry.");
    const body = tar.subarray(offset + BLOCK, offset + BLOCK + bytes);
    offset += BLOCK + Math.ceil(bytes / BLOCK) * BLOCK;
    const type = field(header, 156, 1);
    if (type === "x" || type === "L") {
      override = type === "x" ? paxPath(body) : field(body, 0, body.length);
      continue;
    }
    const prefix = field(header, 345, 155);
    const archivePath = override ?? (prefix ? `${prefix}/${name}` : name);
    override = undefined;
    const slash = archivePath.indexOf("/");
    if ((type !== "" && type !== "0") || slash <= 0 || !isSafeTreePath(archivePath)) continue;
    const path = archivePath.slice(slash + 1);
    if (!selection.includes(path)) continue;
    const destination = join(directory, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, body, { flag: "wx" });
  }
  throw new FleetHostError("Fleet archive is missing its end marker.");
}

export async function fetchArchiveTree(
  response: Response,
  directory: string,
  selection: FleetSelection,
): Promise<number> {
  const compressed = await archiveBytes(response);
  const tar = await decompress(compressed, { maxOutputLength: MAX_ARCHIVE_BYTES }).catch(() => {
    throw new FleetHostError("Fleet archive is invalid or exceeds the 128 MiB decompression limit.");
  });
  await writeInputs(tar, directory, selection);
  return compressed.length;
}
