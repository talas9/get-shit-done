# GSD: 3-Tier Agent Hierarchy

## What This Is

An extension to the GSD multi-agent orchestration system that adds a 3-tier hierarchy (L1→L2→L3) with team-based communication, MCP isolation, and parallel sub-orchestrator coordination. This replaces the current flat orchestrator→subagent model with a structured hierarchy where orchestrators coordinate and only leaf agents do work.

## Core Value

Orchestrators at any level never do work directly — only L3 subagents execute, keeping orchestrator context clean and enabling true parallel coordination across independent work streams.

## Requirements

### Validated

<!-- Existing GSD capabilities that must be preserved -->

- ✓ Wave-based parallel executor spawning — existing
- ✓ Atomic per-task commits — existing
- ✓ STATE.md tracking across sessions — existing
- ✓ Checkpoint protocol (human-verify, decision, human-action) — existing
- ✓ gsd-planner / gsd-executor / gsd-verifier agent pipeline — existing
- ✓ `.planning/config.json` configuration system — existing
- ✓ Skill system (.claude/skills/) — existing
- ✓ Quick task mode (/gsd:quick) — existing

### Active

- [ ] 3-tier hierarchy: L1 (main orchestrator) → L2 (sub-orchestrators) → L3 (subagents)
- [ ] TeamCreate integration — all L1/L2/L3 agents on shared team
- [ ] SendMessage communication across hierarchy levels (L3→L2→L1)
- [ ] MCP isolation — only L3 agents allowed to call MCP tools
- [ ] Non-blocking L1 — all agent spawns use run_in_background
- [ ] L2 sub-orchestrators own git worktrees for isolation
- [ ] L1 maximizes parallel L2 spawning for independent work streams
- [ ] Feature flag in config.json (hierarchy.enabled, default: false)
- [ ] Individual toggles: mcp_isolation, worktree_isolation, team_communication
- [ ] Graceful fallback — when hierarchy disabled, GSD works exactly as today
- [ ] L2 tool restrictions — no Bash, no MCP, only Agent + SendMessage + Read
- [ ] Worktree setup/teardown lifecycle management

### Out of Scope

- Multi-user team coordination — this is for single-developer multi-agent orchestration
- Custom L2 agent definitions — L2s are generic sub-orchestrators, not specialized
- Cross-repo worktree support — worktrees stay within the project repo
- Docker stack isolation per worktree — mentioned in CLAUDE.md but too complex for v1

## Context

GSD currently uses a 2-level architecture: orchestrator commands (in workflows/) spawn specialized subagents (in agents/) via Task(). Subagents get fresh 200k context, do work, and return summaries. The orchestrator blocks while waiting.

The user's CLAUDE.md already defines the 3-tier hierarchy pattern for their own projects. This integration brings that pattern into GSD itself, so any GSD-managed project can optionally use hierarchical orchestration.

Key existing patterns to preserve:
- Wave-based execution grouping by dependency analysis
- File-based context passing via `<files_to_read>` blocks
- gsd-tools.cjs CLI for state management
- Agent frontmatter format (name, description, tools, color)

## Constraints

- **Backwards compatibility**: hierarchy.enabled defaults to false — zero behavior change for existing users
- **Claude Code primitives**: Must use TeamCreate, SendMessage, Agent tool as they exist — no custom communication layer
- **Agent tool limits**: Claude Code's Agent tool constraints (subagent_type, run_in_background, team_name)
- **Context budget**: L2 sub-orchestrators must stay under 15% context usage — they coordinate, not work

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Feature-flagged, off by default | Backwards compatibility for all existing users | — Pending |
| L2s are generic, not specialized | Keeps the system simple; specialization happens at L3 | — Pending |
| SendMessage for all cross-level comms | Uses Claude Code's built-in team primitives | — Pending |
| Worktree per L2 | Git isolation prevents merge conflicts between parallel L2 streams | — Pending |
| Only L3 touches MCP | Prevents context pollution at orchestrator levels | — Pending |

---
*Last updated: 2026-03-11 after initialization*
