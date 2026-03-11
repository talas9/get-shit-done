# Technology Stack: 3-Tier Agent Hierarchy

**Project:** GSD — 3-Tier Agent Hierarchy Extension
**Researched:** 2026-03-11
**Scope:** Claude Code runtime primitives for building L1→L2→L3 hierarchy

---

## Overview

This stack document covers only the Claude Code primitives needed to build the hierarchy layer. GSD's existing stack (Node.js CJS, gsd-tools.cjs, Markdown/YAML workflows) is already documented in `.planning/codebase/STACK.md` and must not change. The hierarchy adds no new language dependencies — it is entirely Markdown + YAML frontmatter configurations consumed by the Claude Code runtime.

---

## Core Primitives

### 1. Agent Tool (formerly Task Tool)

The primary spawning mechanism. A subagent runs in its own 200k context window, completes work, and returns a summary to the caller's context.

**Frontmatter syntax (subagent definition files in `.claude/agents/`):**
```yaml
---
name: gsd-l2-orchestrator
description: L2 sub-orchestrator. Spawns L3 workers for an isolated work stream.
tools: Agent(gsd-executor, gsd-planner, gsd-verifier), Read
model: sonnet
background: true
isolation: worktree
---
```

**Spawning via the Agent tool (called from orchestrator prose):**
```
Agent({
  subagent_type: "gsd-l2-orchestrator",
  prompt: "...",
  team_name: "gsd-milestone-3"    # optional, for agent teams mode
})
```

**Key parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `subagent_type` | string | Agent name matching a file in `.claude/agents/` or built-in (`general-purpose`, `Explore`) |
| `prompt` | string | Instructions and context to inject at spawn time; lead's conversation history does NOT carry over |
| `team_name` | string | Assigns the spawned agent to a named team (agent teams only) |
| `run_in_background` | boolean | Non-blocking spawn; caller continues immediately. Use for all L2 spawning at L1. |

**Tool restriction (allowlist):**
```yaml
tools: Agent(gsd-executor, gsd-planner)   # only these types can be spawned
tools: Agent                               # any subagent allowed
# Omit Agent entirely to block all spawning
```

**Confidence:** HIGH — from official `code.claude.com/docs/en/sub-agents`

---

### 2. Agent Frontmatter — `isolation: worktree`

Causes the subagent to run inside a temporary git worktree automatically created and cleaned up by the runtime.

```yaml
---
name: gsd-l2-orchestrator
isolation: worktree
---
```

**Behavior:**
- Worktree created at `<repo>/.claude/worktrees/<auto-name>/` on a new branch `worktree-<name>`
- If the subagent exits without making changes: worktree + branch auto-deleted
- If changes exist: runtime prompts keep/remove (or in headless contexts, keeps)
- Subagents launched by an L2 inherit the L2's worktree as their working directory — they do NOT each get their own additional worktree unless explicitly configured

**Why this over manual worktrees:** The `--worktree` CLI flag is for interactive sessions; `isolation: worktree` is the programmatic equivalent for subagent definitions. Automatic cleanup eliminates the teardown lifecycle problem from PROJECT.md.

**Confidence:** HIGH — from official `code.claude.com/docs/en/sub-agents#supported-frontmatter-fields` and `code.claude.com/docs/en/common-workflows#run-parallel-claude-code-sessions-with-git-worktrees`

---

### 3. `background: true` Frontmatter Field

Marks a subagent to always run asynchronously (non-blocking). Equivalent to `run_in_background: true` in the Agent tool call, but baked into the subagent definition.

```yaml
---
name: gsd-l2-orchestrator
background: true
---
```

**Behavior:**
- Before launch: Claude Code prompts once for all tool permissions the subagent will need
- While running: auto-denies anything not pre-approved; cannot surface permission prompts mid-run
- On completion: result delivered to the caller's context asynchronously (idle notification fires)
- `AskUserQuestion` calls fail silently — L2s and L3s must be designed to not need user input

**Why required for L1:** L1 must spawn multiple L2s and continue managing state — blocking defeats the hierarchy. All L2 spawns from L1 use `background: true`.

**Confidence:** HIGH — from official `code.claude.com/docs/en/sub-agents#run-subagents-in-foreground-or-background`

---

### 4. `mcpServers` Frontmatter Field (MCP Isolation)

Controls which MCP servers are accessible to a subagent. Overrides what the main session has configured.

```yaml
# L2 orchestrator — no MCP access
---
name: gsd-l2-orchestrator
tools: Agent(gsd-executor, gsd-planner), Read
mcpServers: []
---

# L3 executor — MCP access
---
name: gsd-executor
mcpServers:
  - context7
  - graphiti
---
```

**Behavior:**
- Subagents inherit all MCP servers from the parent by default
- Explicitly setting `mcpServers: []` strips all MCP access
- Named entries reference already-configured servers from the session's MCP config
- Inline definitions with full MCP server config are also supported

**Why MCP isolation matters:** L2 sub-orchestrators that inadvertently call MCP tools consume expensive tokens on coordination work that should be reserved for L3. Stripping MCP from L1 and L2 agent definitions enforces the architecture rule from PROJECT.md.

**Confidence:** HIGH — from official `code.claude.com/docs/en/sub-agents#supported-frontmatter-fields`

---

### 5. `tools: Agent(subagent-name)` — Spawn Restriction

Prevents an orchestrator level from spawning unexpected agent types.

```yaml
# L2 can only spawn known L3 agent types
---
name: gsd-l2-orchestrator
tools: Agent(gsd-executor, gsd-planner, gsd-verifier, gsd-debugger), Read
---
```

**Important constraint:** This restriction only applies when an agent is launched via `claude --agent`. It has no effect on subagent definitions spawned via the Agent tool from the main session. Design accordingly: use it on L2 definitions that will be spawned as `claude --agent gsd-l2-orchestrator`.

**Confidence:** MEDIUM — documented officially, but the "only applies when running as main thread with `claude --agent`" constraint means L2s spawned as subagents of L1 are NOT restricted by this field. Validate in implementation.

---

### 6. Agent Teams (TeamCreate / SendMessage) — EXPLICIT NON-RECOMMENDATION

**What it is:** A separate multi-agent system (experimental, requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) where a "team lead" spawns "teammates" that share a task list and can send peer-to-peer messages via SendMessage.

**Why NOT to use for this milestone:**

| Concern | Detail |
|---------|--------|
| Experimental, opt-in env var required | Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` — an extra runtime dependency GSD would force on users |
| Known limitations block recovery | No session resumption for in-process teammates; task status can lag and block dependent tasks |
| One team per session | A lead can only manage one team at a time; no nested teams; teammates cannot spawn teammates |
| "No nested teams" constraint | Teammates cannot spawn their own teams. This directly breaks L2→L3 spawning in a team context |
| Different communication model | Agent teams use a shared task list + mailbox; GSD already uses file-based coordination (STATE.md, PLAN.md) which is more portable and auditable |
| Subagent `Agent` tool is sufficient | The standard subagent model with `run_in_background: true` already gives non-blocking parallel spawning without the experimental surface area |

**What PROJECT.md says:** "Must use TeamCreate, SendMessage, Agent tool as they exist." Based on current official docs (2026-03-11), TeamCreate and SendMessage are part of the agent teams system, not standalone primitives. The Agent tool is standalone and production-ready. The correct interpretation: use the Agent tool (non-experimental), not the agent teams system (experimental).

**Confidence:** HIGH — official docs confirm agent teams are experimental with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` required. The constraint "no nested teams" is a hard blocker for L2→L3 hierarchy within the teams system.

---

### 7. `disallowedTools` Frontmatter Field (L2 Bash/MCP Restriction)

Explicitly removes tools from the inherited set.

```yaml
---
name: gsd-l2-orchestrator
disallowedTools: Bash, Write, Edit, mcp__context7__query-docs, mcp__graphiti__search
---
```

Combine with the `tools` allowlist for defense-in-depth. `disallowedTools` removes specific tools from whatever `tools` grants.

**Confidence:** HIGH — official docs.

---

### 8. `permissionMode: plan` (L2 Read-Only Enforcement)

Forces an agent into read-only planning mode — it can explore but not modify files.

```yaml
---
name: gsd-l2-orchestrator
permissionMode: plan
---
```

This is an alternative to `disallowedTools: Write, Edit` — simpler to specify, covers all write tools. Use if L2s only need to read state files and coordinate, which is the intended behavior.

**Confidence:** HIGH — official docs.

---

## Recommended Subagent Definition Strategy

### L2 Sub-Orchestrator Definition

```yaml
---
name: gsd-l2-orchestrator
description: L2 sub-orchestrator. Coordinates a single work stream by spawning L3 workers. Never does implementation work directly.
tools: Agent(gsd-executor, gsd-planner, gsd-verifier, gsd-debugger, gsd-phase-researcher), Read
model: sonnet
background: true
isolation: worktree
permissionMode: plan
mcpServers: []
---
```

**Rationale for each field:**
- `tools: Agent(...)` — restricts to known L3 types (defense against accidental general-purpose spawn)
- `model: sonnet` — coordination work does not need Opus; saves cost at the orchestrator level
- `background: true` — L1 must not block on L2 completion
- `isolation: worktree` — each L2 work stream gets its own git namespace
- `permissionMode: plan` — L2 must not write; enforces "coordinators don't do work"
- `mcpServers: []` — MCP calls belong to L3 only

### L3 Worker Definitions

Existing agent definitions (`gsd-executor.md`, `gsd-planner.md`, etc.) require minimal changes:
- Add `mcpServers: [context7, graphiti]` if MCP tools needed (currently inherited from session)
- No `background` flag needed — L2 decides foreground vs background per spawn
- No `isolation: worktree` needed — L3 runs in L2's worktree

---

## Configuration Schema Extension

The `hierarchy` block goes into `.planning/config.json` (no new files needed):

```json
{
  "hierarchy": {
    "enabled": false,
    "mcp_isolation": true,
    "worktree_isolation": true
  }
}
```

Existing `parallelization` and `model_profile` settings continue to apply. GSD reads this via `gsd-tools.cjs config-get hierarchy.enabled`.

---

## What NOT to Use

| Primitive | Reason to Avoid |
|-----------|----------------|
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` / TeamCreate / SendMessage | Experimental, requires opt-in env var, blocks nested team spawning (no L2→L3 in team context) |
| `claude --worktree` CLI flag | Interactive sessions only; use `isolation: worktree` in frontmatter for programmatic spawning |
| Custom inter-agent communication layer | Agent tool return values already carry summaries back to callers; file-based coordination (STATE.md) handles persistent state |
| Docker stack isolation per L2 | Out of scope per PROJECT.md; OS-level worktrees are sufficient for git isolation |

---

## Sources

- Official subagents docs: https://code.claude.com/docs/en/sub-agents (HIGH confidence)
- Official agent teams docs: https://code.claude.com/docs/en/agent-teams (HIGH confidence — used to rule OUT this primitive)
- Git worktrees workflow: https://code.claude.com/docs/en/common-workflows#run-parallel-claude-code-sessions-with-git-worktrees (HIGH confidence)
- Agent teams parameter breakdown: https://alexop.dev/posts/from-tasks-to-swarms-agent-teams-in-claude-code/ (MEDIUM — third-party, cross-checked against official docs)
