import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { campaignBoard } from "../src/campaign-board/model.js";
import { readCampaignState } from "../src/campaign/document.js";

export async function buildCampaignDemo(
  output = "docs/_data",
  fixture = "tests/fixtures/campaign-20/state.json",
): Promise<void> {
  const state = await readCampaignState(fixture);
  const board = campaignBoard(state);
  const records = {
    summary: [{ ...board.summary, id: "demo" }],
    repositories: state.repositories.map(({ name, batch, status }, index) => ({
      id: board.repositories[index]?.id,
      name,
      batch,
      status,
    })),
    owners: board.owners,
    activity: board.activity,
  };
  await mkdir(output, { recursive: true });
  for (const [name, rows] of Object.entries(records)) {
    await writeFile(join(output, `campaign-demo-${name}.json`), JSON.stringify(rows, null, 2) + "\n");
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await buildCampaignDemo(process.argv[2]);
}
