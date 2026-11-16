export const VERSION_PATTERN = /^v?(\d+)(?:\.\d+){0,2}$/;
export const SHA_PATTERN = /^[a-fA-F0-9]{40}$/;

/**
 * A version declared by a trailing comment on a SHA-pinned reference. The version must start the
 * comment (after the `#` and any whitespace), in one of these forms: `# v4`, `# v4.1`, `# v4.1.1`,
 * `#v4.1.1`, `# 4.1.1`, `# v4.1.1 (pinned for security)`, `# tag=v4.1.1`, or `# version: v4.1.1`.
 * The `(?![.\d])` stopper rejects typos such as `# v4..1` and `# v4.1.1.1`, which would otherwise
 * truncate to a plausible version.
 */
const COMMENT_VERSION = /^#\s*(?:(v?\d+(?:\.\d+){0,2})(?![.\d])|(?:tag=|version:\s*)(v?\d+(?:\.\d+){0,2})(?![.\d]))/;

/**
 * A second version token later in the same comment signals conflicting versions (for example
 * `# v3 -> v4`). The `v` prefix is required, so a bare year in a trailing explanation such as
 * `# v4.1.1 (pinned in 2024)` is not mistaken for a version.
 */
const CONFLICTING_VERSION = /\bv\d+(?:\.\d+){0,2}\b/;

/** The version a trailing comment declares, or undefined when it is missing or ambiguous. */
function commentVersion(comment: string | undefined): string | undefined {
  if (!comment) return undefined;
  const match = COMMENT_VERSION.exec(comment);
  const version = match?.[1] ?? match?.[2];
  if (!version || !match) return undefined;
  const rest = comment.slice(match[0].length);
  return CONFLICTING_VERSION.test(rest) ? undefined : version;
}

export interface ResolvedReference {
  version: string;
  source: "tag" | "comment" | "map";
}

/**
 * Resolves an action reference to the version it pins.
 * - A full commit SHA is classified from its trailing comment when present, then from the bundled
 *   map when the SHA is known. A SHA with neither is left unclassified.
 * - A tag ref is classified from the ref itself; its trailing comment is ignored.
 */
export function resolveReference(
  ref: string,
  comment: string | undefined,
  versions: ReadonlyMap<string, string> | undefined,
): ResolvedReference | undefined {
  if (SHA_PATTERN.test(ref)) {
    const version = commentVersion(comment);
    if (version) return { version, source: "comment" };
    if (comment) return undefined;
    const mapped = versions?.get(ref.toLowerCase());
    return mapped ? { version: mapped, source: "map" } : undefined;
  }
  return VERSION_PATTERN.test(ref) ? { version: ref, source: "tag" } : undefined;
}
