import * as z from "zod/v4";

import { findMarkedIssue, TRACKING_ISSUE_BODY_LIMIT } from "../action-tracking-issue.js";
import { digest } from "../proof/document.js";
import { type CampaignState, invalidCampaign, publicationUrl } from "./document.js";
import { campaignCredential, type readOperationsPermission } from "./host-config.js";
import { campaignHttp, type HostHttpOptions } from "./host-http.js";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const account = z.object({ id });
const issue = z.object({
  number: id,
  state: z.enum(["open", "closed"]),
  body: z.string().nullable(),
  user: account,
  pull_request: z.unknown().optional(),
});
const repository = z.object({ private: z.literal(true), full_name: z.string(), has_issues: z.literal(true) });

function read<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalidCampaign("Operations host response lacked required fields.");
  return parsed.data;
}

function render(state: CampaignState, marker: string) {
  const counts = new Map<string, number>();
  let last = state.asOf + "T00:00:00.000Z";
  const requests: string[] = [];
  for (const row of state.repositories) {
    counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
    for (const at of [row.transitions.at(-1)?.at, row.publication?.observed?.at]) {
      if (at && at > last) last = at;
    }
    const url = publicationUrl(row);
    if (url) requests.push(`- [${row.name}](${url}) · ${row.status}`);
  }
  const totals = [...counts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => `- ${status} · ${count}`);
  return [
    marker,
    "",
    `Last recorded update · ${last}`,
    "",
    `Selected repositories · ${state.repositories.length}`,
    `Omitted repositories · ${state.omissions.length}`,
    ...totals,
    "",
    ...requests,
  ].join("\n");
}

export async function trackCampaign(
  state: CampaignState,
  scope: Awaited<ReturnType<typeof readOperationsPermission>>,
  options: HostHttpOptions & { env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  if (scope.campaign !== state.id) throw invalidCampaign("Operations permission does not match this campaign.");
  const token = campaignCredential(options.env ?? process.env, scope.tokenEnv);
  const http = campaignHttp(
    new URL("https://api.github.com/"),
    {
      authorization: "Bearer " + token,
      "x-github-api-version": "2022-11-28",
    },
    options,
  );
  const root = "repos/" + scope.repository;
  const target = read(repository, await http(root));
  if (target.full_name !== scope.repository || read(account, await http("user")).id !== scope.actorId) {
    throw invalidCampaign("Operations host or token does not match the approved repository and actor.");
  }
  const endpoint = root + "/issues";
  const marker = `<!-- offing-campaign-tracking:${digest(state.id)} -->`;
  const body = render(state, marker);
  if (Buffer.byteLength(body) > TRACKING_ISSUE_BODY_LIMIT || body.includes(token)) {
    throw invalidCampaign("Campaign tracking body exceeded its size or data boundary.");
  }
  const { issue: existing, exhausted } = await findMarkedIssue(
    async (page) =>
      read(
        z.array(issue).max(100),
        await http(`${endpoint}?state=all&sort=updated&direction=desc&per_page=100&page=${page}`),
      ),
    marker,
    (item) => item.user.id === scope.actorId,
  );
  if (exhausted) throw invalidCampaign("Could not determine whether the operations issue already exists.");
  const title = "Offing campaign: " + state.id;
  let number = existing?.number;
  if (!existing) {
    const created = read(issue, await http(endpoint, { method: "POST", body: { title, body } }));
    if (created.user.id !== scope.actorId || created.body !== body) {
      throw invalidCampaign("Operations host did not confirm the created issue.");
    }
    number = created.number;
  } else if (existing.body !== body) {
    await http(`${endpoint}/${existing.number}`, { method: "PATCH", body: { title, body } });
  }
  return `https://github.com/${scope.repository}/issues/${number}`;
}
