# 0040 — Keep MCP tool answers short, and say what is missing

Status: proposed; accepted when the maintainer merges the pull request for #115.

## Problem

An MCP tool answer goes straight into a model's context, and the server used to return whole documents. On this
repository a scan answer is about 915 KB: 74 findings of 1,200 to 3,700 characters each and a coverage list of
about 10,800 file paths. Three things made that worse than a cost problem:

- A long answer says nothing about being long. An agent cannot tell a complete list from the part a host truncated.
- `check_dependency` kept the replacement an agent should use inside `findings[]`, after the status and the purl.
- Tool descriptions ran up to 133 words and described what a tool does without saying when to call it.

The MCP SDK validates a tool's structured content against the `outputSchema` it advertises, so an answer that is
cut cannot change shape: it has to stay valid for the tool's own published schema.

## Options compared

| Option | What it does | Cost |
| --- | --- | --- |
| Replace a long answer with `{ summary, more }` | One envelope for every tool. | It fails the SDK's output validation, and it is a twelfth shape an agent has to learn. |
| Keep a fixed number of items per tool | Ten findings, fifty usages. | Items differ in size by a factor of three, so a fixed count either breaks the cap or wastes it. |
| Add `offset` and `limit` inputs to every tool | The agent pages through the full answer. | Eleven input contracts change, and an agent must loop to learn there is nothing else. The CLI already prints each document in full. |
| Cut the answer in place, against its own schema | Keep the document, the summary fields, and the schema. | The cut has to be described, so the answer carries a pointer. |

## Decision

1. **Every successful answer is held under 2,000 estimated tokens.** Three characters of the JSON text count as one
   token, indentation included. The estimate is deliberately higher than what common tokenizers count for such text,
   so a real answer is shorter than the number. A failed call is a message, not an answer, and is not cut.
2. **An answer is cut in place and stays valid for its schema.** Only three things go: elements from the end of an
   array, the texts inside those elements with them, and texts too long to fit. `status` and `replacement` are never
   shortened, wherever they appear.
3. **An element comes back whole or not at all.** A finding is never shown with some of its migration steps. The
   first element of each array is the one exception: every array shows its first element before any array grows,
   with the arrays inside it still cut, and those come back in the order below. A list always shows what it starts
   with, and the first element is the one that can end up with arrays cut.
4. **When elements carry a `severity`, the most severe are kept.** Scan results are ordered by finding id, so a
   prefix would keep the alphabetically first findings. Kept elements stay in the order the full answer has them.
5. **Arrays are restored in a fixed order.** Every array gets its first element first. Then arrays that cost at
   most a quarter of the cap are restored whole, then the longer arrays of objects, then the longer arrays of plain
   values; inside each group, in the order the answer lists them. A list never drops below the `minItems` of its
   schema.
6. **A cut answer ends with a `more` pointer.** It says where to read the rest (`hint`), and counts what is missing:
   one `omitted` entry per array pattern, such as `findings` or `findings[].usages`, with the elements shown and the
   elements the full answer has; `clipped` names every text that was shortened, and `estimatedTokens` is the size
   of the answer as returned. `more` is optional in every tool's output schema, so answers that predate it still
   validate.
7. **The pointer is defined once and carried by every schema file.** `schemas/more.v1.schema.json` is the published
   definition. Each of the eleven tool schemas holds an equal copy inline, so a file still validates on its own and
   needs no new sibling; a test fails when a copy drifts from the definition.
8. **`check_dependency` answers with the replacement first.** When the most severe finding names a replacement, it
   is the first field of the answer and `status` is the second; every other field keeps its place, and each finding
   keeps its own replacement. With no replacement the status leads. The field is optional in `offing.check.v1`;
   `offing check --json` is unchanged.
9. **Every description opens with when to call the tool and stays under 60 words**, and the server's instructions
   state the cap and the pointer once for all tools.

An answer can still be over the cap only when a `status` or `replacement` is itself longer than the cap. Those two
are never cut, and the pointer then reports the answer's true size.

## Why

- **The schema is the contract.** Cutting against the schema the tool advertises is the same schema the SDK
  validates with, so a cut answer cannot fail validation, and a client written against the published schema reads
  it without change.
- **A cut answer must say so.** Counting what is missing per array lets an agent tell "12 findings" from "12 of
  601 findings", and the hint gives it the next call or command instead of a dead end.
- **Whole elements are safer than more elements.** Measured on this repository, a finding with its arrays cut is
  still about two thirds of the whole one, so showing cut findings would add at most half again as many, at the
  price of migration steps that look complete and are not.
- **Severity is the right order for a cut list.** A scan is ordered by id so that output is deterministic, which is
  right for a document and wrong for the part of it that fits.

## Consequences

- On a large repository `scan_repository` returns a few whole findings and `list_deprecations` a few lines; the rest
  is counted in `more`, and the hint names `list_deprecations`, `explain_deprecation`, or the CLI command that prints
  the full document. Documentation must say this where it describes the tools.
- `more` adds about 60 tokens to a cut answer plus about 15 per omitted array pattern; the cap includes it.
- The MCP server is no longer the same document as the CLI once an answer is over the cap. `tests/adapter-parity.test.ts`
  reads parity through `list_deprecations`, which fits, and holds `scan_repository` to the cap's contract: what it
  shows comes from that list, and its pointer counts exactly what it left out.
- A tool that returns a long single text, such as a rendered receipt, has that text shortened at a line break and
  named in `more.clipped`.
- The token count is an estimate, not a tokenizer. It is reproducible, which is what a test can assert, and it is
  higher than a real count, which is the safe side of a cap.
- Tool selection is measured and not assumed. `benchmarks/skill-trigger-eval.ts` ranks the eleven tools for 56
  prompts by the words they share with a request, and reports how often the right tool ranks first: 29 of 56 with
  the descriptions of `main` at `e502f98`, 32 of 56 with these. It is a lexical stand-in that no host took part in,
  far under the floor the trigger evals are held to, so `docs/MCP.md` reports it and no check is gated on it.
