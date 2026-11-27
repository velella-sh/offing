import { matchesAgentAuthor, type AgentAttribution } from "../agent-pr.js";
import { git } from "../diff.js";

export interface AgentPullRequest {
  author?: string;
  /** A branch in the base repository, taken from the pull request event. */
  sameRepositoryBranch?: string;
  /** Logins authenticated by the host, never from a raw commit's committer fields. */
  verifiedCommitters?: readonly string[];
}

const branchAgents = new Map([
  ["claude", "claude[bot]"],
  ["codex", "chatgpt-codex-connector[bot]"],
  ["copilot", "Copilot"],
  ["devin", "devin-ai-integration[bot]"],
  ["jules", "google-labs-jules[bot]"],
]);

function trailerAgent(trailer: string): string | undefined {
  const address = / <([^ <>]+)>$/u.exec(trailer)?.[1]?.toLowerCase();
  if (address === "noreply@anthropic.com" && /^claude /iu.test(trailer)) return "claude[bot]";
  return address && /^(?:\d+\+)?([a-z\d-]+(?:\[bot\])?)@users\.noreply\.github\.com$/u.exec(address)?.[1];
}

/** A match describes authorship evidence for a report. It never grants permissions to a pull request. */
export function agentAttribution(
  root: string,
  range: string,
  pullRequest: AgentPullRequest,
  authors: ReadonlySet<string>,
): AgentAttribution | undefined {
  if (authors.size === 0) return undefined;
  const { author, verifiedCommitters, sameRepositoryBranch } = pullRequest;
  const allowed = (login: string | undefined): login is string => matchesAgentAuthor(login, authors);
  if (allowed(author)) return { signal: "author-login", login: author };
  const committer = verifiedCommitters?.find((login) => /^[-\da-z]+\[bot\]$/iu.test(login) && allowed(login));
  if (committer) return { signal: "bot-committer", login: committer };
  const prefix = /^([a-z]+)\/.+/u.exec(sameRepositoryBranch ?? "")?.[1];
  const branchLogin = prefix === undefined ? undefined : branchAgents.get(prefix);
  if (allowed(branchLogin)) return { signal: "branch-prefix", login: branchLogin };
  const trailers = git(root, [
    "log",
    "--max-count=256",
    "--no-show-signature",
    "--format=%(trailers:key=Co-authored-by,valueonly,unfold,separator=%x0a)",
    range,
    "--",
  ]).toString("utf8");
  const coauthor = trailers.split(/\r?\n/u).map(trailerAgent).find(allowed);
  return coauthor ? { signal: "co-author-trailer", login: coauthor } : undefined;
}
