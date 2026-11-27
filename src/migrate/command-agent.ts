// Preserve the command adapter entry point used by the migration benchmark.
export { createCommandAgent, type CommandAgentOptions } from "../agent-drivers/command.js";
export type { AgentAdapter, AgentRunInput } from "../agent-drivers/contract.js";
export { DEFAULT_AGENT_TIMEOUT_MS, runShell, truncate, type AgentRunOutput } from "../agent-drivers/process.js";
