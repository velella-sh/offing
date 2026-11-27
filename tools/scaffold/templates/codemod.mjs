export function codemodTemplate(id) {
  const name = id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  return `import { defineCodemod } from "../kit/define.js";

export const ${name}Fixer = defineCodemod({
  id: "${id}",
  rules: [{ id: "replace-with-ebb-rule-id", replacement: "replace-with-exact-rule-replacement" }],
  async plan() {
    // Return unified diffs and report any recognized finding you cannot repair exactly.
    return [];
  },
});
`;
}

export const fixtureTemplate = new Map([
  ["before/example.txt", "Replace this with the original evidence.\n"],
  ["after/example.txt", "Replace this with the expected result.\n"],
  ["expect.json", '{ "refusals": [] }\n'],
]);
