# 0039 — Include replacement guidance in snippet findings

Status: proposed

The CLI and MCP snippet checks share a response schema. Agents need the flagged line, the reviewed replacement, and a source they can cite when they revise a proposed write.

Keep `offing.check-snippet.v1` and the existing finding fields. Each finding adds `code` for the trimmed source line and `source` for the first entry in `sources`. Each finding now includes `replacement`. It is a string when the rule supplies one and `null` when it does not. The repository scan schema retains its existing optional string.

This changes validation of snippet documents under the same schema identifier. A stored response from an earlier release can omit the new fields and may need that release's schema to validate. Consumers of current output should handle `null` as the absence of a reviewed replacement.
