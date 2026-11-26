import { readFile, readdir } from "node:fs/promises";

const schemaDir = new URL("../schemas/", import.meta.url);
const schemaSuffix = ".v1.schema.json";
const publishedPrefix = "https://velella.sh/offing/schemas/";

async function publicSchemas() {
  const files = (await readdir(schemaDir)).filter((file) => file.endsWith(schemaSuffix)).sort();
  const schemas = await Promise.all(
    files.map(async (file) => ({
      file,
      schema: JSON.parse(await readFile(new URL(file, schemaDir), "utf8")),
    })),
  );
  return Object.fromEntries(
    schemas
      .filter(({ file, schema }) => schema.$id === publishedPrefix + file)
      .map(({ file, schema }) => [file.slice(0, -schemaSuffix.length), schema]),
  );
}

export default {
  plugins: [
    {
      name: "offing-public-schemas",
      // The package schemas live outside docs/. Mizzen rebuilds so it always reads their current contents.
      async model(site: { readonly data: Record<string, unknown> }) {
        return { ...site, data: { ...site.data, publicSchemas: await publicSchemas() } };
      },
    },
  ],
};
