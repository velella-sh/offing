---
title: Stack context at agent session start
description: Add an offline evidence view for agent hosts without changing edit-hook responses.
---

# 0069 Stack context at agent session start

## Status

Accepted.

## Context

An agent starting a session can make better dependency choices when its host knows which runtime lines a project uses and which reviewed lifecycle rules apply.

## Decision

Publish the [stack context v1](../spec/stack-context/v1.md) JSON document and schema. Add an MCP tool and resource, plus a bounded summary in stdio MCP startup instructions. Agent session-start hooks use the host's context field and preserve existing file-write hook responses. Startup reads only the current workspace and reuses verified local cache evidence when available. Explicit MCP requests can read the workspace afresh.

Only observed runtime declarations and applicable reviewed lifecycle evidence enter the report. The token cap keeps the highest-ranked items and makes omission visible.

## Consequences

Existing tools and hook configurations retain their interfaces. Agents can request the bounded document again through MCP. A hook without a usable local scan cache reports one diagnostic and allows the host session to continue.
