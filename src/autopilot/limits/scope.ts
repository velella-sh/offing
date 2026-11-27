import type { MigrationPacket } from "../../migration-packet.js";
import { isAutopilotPath, type AutopilotConfig } from "./config.js";

const lockfile =
  /(?:^bun\.lockb$|^go(?:\.work)?\.sum$|^npm-shrinkwrap\.json$|(?:\.|-)lock(?:\.json|\.ya?ml|\.hcl)?$|\.lockfile$)/;

// Case and trailing dots/spaces can alias other paths on supported filesystems.
function canonical(path: string): string {
  return path
    .toLowerCase()
    .split("/")
    .map((part) => part.replace(/[ .]+$/, ""))
    .join("/");
}

function protectedPath(path: string): boolean {
  const parts = path.split("/");
  const name = parts.at(-1) ?? "";
  return (
    path === ".github/workflows" ||
    path.startsWith(".github/workflows/") ||
    parts.some((part) => part.startsWith(".env") || part === ".git" || /^\.?git~\d+$/u.test(part)) ||
    /(?:^id_(?:rsa|dsa|ecdsa|ed25519)(?:_sk)?$|\.(?:pem|key|ppk|p12|pfx|keystore|jks)$)/.test(name) ||
    lockfile.test(name)
  );
}

export function createPathScope(
  config: Pick<AutopilotConfig, "allowedPaths" | "deniedPaths">,
  packets: readonly Pick<MigrationPacket, "affectedFiles">[],
  testFiles: readonly string[],
) {
  const allowed = new Set(config.allowedPaths ?? [...packets.flatMap((packet) => packet.affectedFiles), ...testFiles]);
  const denied = new Set(config.deniedPaths.map(canonical));
  return (path: string): boolean => {
    if (!allowed.has(path) || !isAutopilotPath(path) || /[ .](?:\/|$)/u.test(path)) return false;
    const candidate = canonical(path);
    return !denied.has(candidate) && !protectedPath(candidate);
  };
}
