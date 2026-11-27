---
title: Agent Guard v1 protocol
---

# 0045. Agent Guard v1 protocol

**Status:** accepted

Agent hosts need the same evidence-backed decision before adding a package or
writing a file. Specify one request and response across standard input and
output, MCP, and host adapters. A client can exercise an implementation with
the standalone fixtures.

Use new, versioned Agent Guard schemas and the opt-in `offing guard --protocol`
and `agent_guard` MCP tool. Existing install commands, MCP finding documents,
and native hook responses keep their current contracts. The shared check
returns the original findings for those existing surfaces.

[Agent Guard protocol v1](../spec/agent-guard/v1.md)
