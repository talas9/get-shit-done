# Project Research Summary

**Project:** GSD — 3-Tier Agent Hierarchy Extension
**Domain:** Multi-agent orchestration system integration
**Researched:** 2026-03-11
**Confidence:** HIGH

## Executive Summary

GSD currently runs a 2-level flat model where an L1 orchestrator blocks on each subagent invocation and accumulates all output in its context window. The milestone adds a 3-tier hierarchy where L1 spawns multiple L2 sub-orchestrators non-blocking (each owning a git worktree), L2s sequence L3 worker agents within their stream, and results propagate upward via SendMessage with file-based fallback. The entire feature is gated by `hierarchy.enabled = false` so the existing user base is unaffected until they opt in.

The recommended implementation uses the standard Claude Code Agent tool with `run_in_background: true` and agent frontmatter fields (`isolation: worktree`, `permissionMode: plan`, `mcpServers: []`). Agent Teams (TeamCreate/SendMessage) are available as a communication mechanism but the experimental `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` feature has a hard constraint that renders it unsuitable as the primary spawning mechanism: teammates cannot call Agent(), which breaks L2→L3 delegation entirely. L2s must be spawned as standalone subagents, not as team teammates. SendMessage can still be used for result reporting back to L1 if the team is created at L1 only.

The top execution risk is that two Claude Code open bugs affect isolation guarantees: `isolation: worktree` does not correctly propagate the working directory to background agents, and the branch-already-checked-out error fails silently when worktree-create reuses an existing branch. Both require workaround code in `gsd-tools.cjs` — explicit path injection into every L2 and L3 prompt, and timestamped branch naming on every worktree-create call. Without these mitigations, parallel streams silently write to the same branch and corrupt STATE.md.

## Key Findings

### Recommended Stack

The hierarchy layer adds no new language or runtime dependencies — it is implemented entirely in Markdown agent definitions, YAML frontmatter, and extensions to the existing `gsd-tools.cjs` Node.js CJS module. The only new primitives consumed are Claude Code Agent tool parameters (`run_in_background`, agent frontmatter fields) and git worktree CLI commands.

A new `hierarchy.cjs` lib module backs the worktree and partition commands within `gsd-tools.cjs`. A new `gsd-sub-orchestrator.md` agent definition file provides the L2 persona. No changes to existing L3 agent definitions (gsd-executor, gsd-verifier, gsd-planner) are required.

**Core technologies:**
- Agent tool with `run_in_background: true` — non-blocking L2 spawn — the only production-ready parallel spawning primitive in Claude Code
- `isolation: worktree` frontmatter — automatic worktree assignment per L2 — but requires explicit path injection workaround (bug #27749)
- `permissionMode: plan` frontmatter — enforces read-only at L2 — simpler than enumerating all disallowed write tools
- `mcpServers: []` frontmatter — strips MCP access from L2 — prevents MCP context pollution at the coordination tier
- `disallowedTools: Bash, Write, Edit` + `permissionMode: plan` — defense-in-depth for L2 tool restriction
- `gsd-tools.cjs` worktree-* commands — lifecycle management with orphan detection — required because runtime isolation has bugs
- `hierarchy.cjs` new module — stream partitioning + state reconcile — keeps hierarchy logic out of core.cjs

**What NOT to use:**
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` / agent teammates for L2 — teammates cannot spawn subagents (confirmed bug #32731), blocks L2→L3 chain
- `claude --worktree` CLI flag — interactive sessions only, not available programmatically
- Docker isolation per worktree — out of scope per PROJECT.md

### Expected Features

The minimum viable hierarchy requires 7 features; 4 additional differentiators add meaningful value and should be included if build cost is low.

**Must have (table stakes):**
- Feature flag (`hierarchy.enabled`) — zero risk to existing users; gates entire code path
- L2 sub-orchestrator agent definition (`gsd-sub-orchestrator.md`) — enforces "no direct work" constraint; without it L2s drift into doing implementation and exhaust context
- Non-blocking L1 spawn (`run_in_background: true` on all L2 Agent calls) — eliminates the entire parallelism benefit if missed
- TeamCreate / SendMessage result reporting (L2 → L1) — structured result propagation; L1 has no other way to know when streams complete
- Worktree lifecycle management (create / teardown with orphan check) — without isolation, parallel L3 commits race and corrupt STATE.md
- MCP isolation via frontmatter (`mcpServers: []` on L2) — prevents L2 context inflation from inadvertent MCP calls
- Structured L3 result schema — typed output format; L2 cannot synthesize results from free-form text

**Should have (differentiators):**
- Shutdown acknowledgment protocol (sentinel file + timeout fallback) — SendMessage delivery is best-effort; file-based completion detection is the reliable fallback
- STATE.md hierarchy tracking (`hierarchy.active_l2s` field) — enables manual recovery after crash; low additional cost if worktree registry is already being written
- Wave-aware L2 stream assignment — assign L2 streams to match wave dependency groups; prevents dependent plans landing in parallel streams (correctness risk, not just performance)
- Per-toggle feature flags (`mcp_isolation`, `worktree_isolation`, `team_communication`) — incremental adoption path; acceptable to defer to v2 if timeline is tight

**Defer (v2+):**
- Dynamic L2 scaling mid-run — distributed systems complexity without evidence of need
- Automatic fault recovery / L2 restart — cascading retries are a known failure pattern; surface failures to human instead
- Observable dashboard / metrics — STATE.md is sufficient observability for a single-developer tool
- Docker isolation per worktree — explicitly out of scope per PROJECT.md

### Architecture Approach

The recommended architecture promotes `execute-phase.md` to a dispatch router: if `hierarchy.enabled`, it partitions plans into streams, creates a team, spawns one L2 per stream non-blocking, and collects results via SendMessage. If disabled, it falls through to the existing wave-based Task() loop unchanged. The only new file that orchestrates coordination is a `hierarchy dispatch branch` added to the top of `execute-phase.md`'s execute_waves step. L1, L2, and L3 have hard context budgets (≤15% each) enforced by agent definition constraints and instruction discipline, not by runtime enforcement.

**Major components:**
1. `execute-phase.md` (modified L1 workflow) — hierarchy dispatch branch; partition → team create → parallel L2 spawn → SendMessage collect → merge → teardown
2. `gsd-sub-orchestrator.md` (new L2 agent) — tools: Agent, SendMessage, Read only; no Bash, no MCP; sequences L3 agents for its assigned stream; sends stream_complete/stream_failed to L1
3. `gsd-executor.md` / `gsd-verifier.md` / `gsd-planner.md` (unchanged L3 agents) — all implementation work; commit to stream's worktree branch; write SUMMARY.md
4. `hierarchy.cjs` (new lib module) — worktree-create (timestamped branch), worktree-teardown, worktree-merge, hierarchy-partition (dependency-aware), state-reconcile (union strategy for task lists)
5. `gsd-tools.cjs` (extended) — exposes worktree-*, hierarchy-*, team-name, state-reconcile command groups backed by hierarchy.cjs
6. `.planning/hierarchy-state.json` (new registry file) — tracks active worktrees; enables orphan cleanup on restart; written by worktree-create, read by orphan-check on startup

### Critical Pitfalls

1. **Teammates cannot spawn subagents (Agent tool stripped)** — Spawn L2s as standalone subagents via Agent() from L1, not as agent team teammates. Teammates have ~20 tools vs ~25 for subagents; Agent() is absent. If L2 is a teammate, L3 spawning silently fails. Source: GitHub issue #32731, confirmed.

2. **Worktree isolation does not propagate to background agents** — Do not rely on `isolation: worktree` in the Agent tool call. Use `gsd-tools.cjs worktree-create` manually and inject the absolute worktree path via a `<worktree>` tag in every L2 and L3 prompt. L3 must `cd` to that path before any file operation. Source: GitHub issue #27749, open bug.

3. **SendMessage delivery is best-effort** — L1 must not block indefinitely waiting for SendMessage from L2. Implement a timeout and file-based completion detection: L2 writes `STREAM_COMPLETE.md` or `STREAM_FAILED.md` into its worktree before sending the message; L1 checks file presence as the authoritative signal.

4. **L2 context bloat from file reads (fat middle tier)** — L2 must receive plan file paths only, never file content. L2 validates L3 completion by checking existence of SUMMARY.md (not reading it). Even 5 plans × 3 files ≈ 30–80k tokens — enough to exhaust the 15% budget before the stream is half done. Enforce in gsd-sub-orchestrator.md system prompt: "receive plan IDs, spawn L3 with paths, check file existence, report up."

5. **Branch already checked out — worktree-create fails** — `git worktree add` fails if the branch is already checked out in any workspace. Always create a new branch per stream (e.g., `gsd-phase-3-auth-<timestamp>`). Never reuse main or an existing branch name. The `worktree-create` command must check exit code and surface the error to L1 before attempting L2 spawn.

## Implications for Roadmap

Based on combined research, the architecture document's suggested build order is well-validated. Four phases are recommended, with a hard dependency chain: Phase 3 cannot start until Phase 1 and Phase 2 are both complete.

### Phase 1: Foundation Utilities

**Rationale:** All hierarchy features depend on worktree lifecycle, stream partitioning, and state reconciliation. These are infrastructure — building Phase 2 or 3 without them means wiring L2 agents to non-existent tooling.

**Delivers:** `gsd-tools.cjs` worktree-* commands (create with timestamped branch, teardown, merge), hierarchy-partition command (dependency-aware, wave-respecting), state-reconcile command, hierarchy-state.json registry, orphan-check on startup.

**Addresses:** Table stakes — worktree lifecycle management, feature flag foundation.

**Avoids:** Pitfalls 2 (worktree isolation bug — explicit path injection), 5 (branch already checked out — timestamped branches), 6 (STATE.md merge conflict — union reconcile strategy), 8 (orphaned worktrees — registry + orphan-check), 10 (dependent plans in different streams — dependency-aware partition).

**Note:** Phase 1 and Phase 2 can be worked in parallel.

### Phase 2: L2 Agent Definition

**Rationale:** The L2 sub-orchestrator persona must be defined before Phase 3 can wire L1 dispatch to it. Also requires verification that the Agent tool is available in a spawned-subagent (not teammate) context.

**Delivers:** `agents/gsd-sub-orchestrator.md` with `tools: Agent, SendMessage, Read`, `permissionMode: plan`, `mcpServers: []`, explicit system prompt enforcing "no file reads, no direct work, spawn L3 only"; `bin/install.js` registration.

**Addresses:** Table stakes — L2 sub-orchestrator agent definition, MCP isolation.

**Avoids:** Pitfalls 1 (teammate restriction — spawn as standalone subagent, verify Agent tool present), 4 (L2 context bloat — system prompt discipline), 9 (MCP context pollution — frontmatter tool restriction).

### Phase 3: L1 Dispatch Integration

**Rationale:** Depends on Phase 1 (worktree commands exist) and Phase 2 (L2 agent definition exists). Wires the dispatch branch into execute-phase.md and registers hierarchy config keys.

**Delivers:** `execute-phase.md` hierarchy dispatch branch (partition → TeamCreate → parallel L2 spawn → SendMessage collect with timeout + file-based fallback → merge → teardown); `core.cjs` loadConfig defaults for `hierarchy.*` keys; `gsd-tools.cjs` team-name helper; TeamCreate graceful fallback to flat mode on failure.

**Addresses:** Table stakes — non-blocking L1 spawn, TeamCreate/SendMessage result reporting, feature flag gating; differentiator — shutdown acknowledgment protocol, STATE.md hierarchy tracking.

**Avoids:** Pitfalls 3 (SendMessage best-effort — timeout + sentinel file), 7 (experimental agent teams breakage — TeamCreate failure falls back to flat mode), 12 (checkpoint deadlock — non-blocking receive loop), 13 (config key silently ignored — schema registration in loadConfig before execute-phase reads it).

### Phase 4: Validation and Hardening

**Rationale:** The two open runtime bugs (worktree isolation, background pwd) make integration testing non-optional. Silent failure modes (L2 silently skipping L3 spawn, worktrees writing to main branch) require explicit verification before the feature can be considered correct.

**Delivers:** Test suite: hierarchy.enabled=false produces identical behavior to pre-feature; hierarchy.enabled=true completes L1→L2→L3 flow with real plans; parallel commits land in correct worktree branches (not main); teardown leaves no orphaned worktrees; checkpoint bubbling pauses only the affected stream; STATE.md reconcile produces correct union of completed tasks.

**Addresses:** All table stakes features validated end-to-end.

**Avoids:** All pitfalls — Phase 4 is the verification that mitigations from Phases 1–3 actually work at runtime.

### Phase Ordering Rationale

- Phase 1 before Phase 3: hierarchy-partition and worktree-* commands are called directly from execute-phase.md L1 dispatch; they must exist first.
- Phase 2 before Phase 3: gsd-sub-orchestrator.md must be registered before L1 can spawn it; attempting to spawn a non-existent agent type fails silently.
- Phase 1 and Phase 2 can run in parallel: they have no shared files and no dependencies on each other.
- Phase 4 after Phase 3: end-to-end validation requires the complete system to exist.
- L3 agents (gsd-executor, gsd-verifier, gsd-planner) require no modifications — this is a deliberate constraint from ARCHITECTURE.md that keeps hierarchy logic isolated to L1/L2 dispatch and prevents coupling.

### Research Flags

Phases with well-documented patterns (skip research-phase):
- **Phase 1 (Foundation Utilities):** Pure Node.js CJS code extending existing gsd-tools.cjs patterns. Git worktree CLI commands are stable and well-documented. No research needed.
- **Phase 2 (L2 Agent Definition):** Agent frontmatter fields are documented with HIGH confidence. System prompt patterns for coordination-only agents are established. No research needed.

Phases likely needing deeper research during planning:
- **Phase 3 (L1 Dispatch Integration):** TeamCreate and SendMessage are in the experimental agent teams feature. Behavior may differ between Claude Code versions. Recommend verifying current state of experimental flag and whether SendMessage works without full agent teams mode active (i.e., for L2→L1 reporting without full teammate infrastructure). The receive-loop pattern for non-blocking SendMessage collection has no documented reference implementation — needs design validation.
- **Phase 4 (Validation):** The two open runtime bugs (#27749, #32731) may have been patched or behavior may have shifted. Recommend re-checking bug status before writing tests that assume the workarounds are still necessary.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All primitives sourced from official Claude Code docs; experimental agent teams ruled out with HIGH confidence from both docs and confirmed GitHub issues |
| Features | HIGH | Table stakes derived from architectural necessity (system breaks without them); anti-features validated against PROJECT.md constraints and documented failure modes |
| Architecture | HIGH | All findings derived from direct codebase reading (execute-phase.md, core.cjs, existing agent definitions); no external sources needed |
| Pitfalls | HIGH | Top 5 critical pitfalls sourced from official docs or confirmed open GitHub issues; moderate pitfalls from codebase analysis with clear failure scenarios |

**Overall confidence:** HIGH

### Gaps to Address

- **SendMessage without full agent teams mode:** Research confirmed that SendMessage is part of the experimental agent teams feature. It is unclear whether L2 can send a message to a team created by L1 if L2 was spawned as a standalone subagent (not a teammate). This is the central communication assumption of the architecture. Validate this in Phase 3 before committing to the SendMessage-based result reporting design. Fallback: file-based completion detection (sentinel files) as the primary mechanism, SendMessage as optional enhancement.

- **`tools: Agent(...)` restriction scope:** STACK.md notes that the `tools: Agent(subagent-name)` allowlist restriction only applies when running via `claude --agent`, not when spawned as a subagent of another agent. This means L2 frontmatter restricting spawnable L3 types may have no effect in the actual execution context. Design must not depend on this restriction for correctness — it is defense-in-depth only. Validate during Phase 2 implementation.

- **STATE.md reconcile merge strategy edge cases:** The union strategy for task completion lists is correct for the typical case. Edge case: if two streams mark the same task complete with different metadata (e.g., different commit hashes), last-writer-wins is ambiguous. Define the reconcile tiebreaker rule explicitly in Phase 1 before the command is implemented.

## Sources

### Primary (HIGH confidence)
- https://code.claude.com/docs/en/sub-agents — Agent frontmatter fields, isolation, permissionMode, background, mcpServers
- https://code.claude.com/docs/en/agent-teams — TeamCreate, SendMessage, experimental status, teammate tool restrictions
- https://code.claude.com/docs/en/common-workflows#run-parallel-claude-code-sessions-with-git-worktrees — worktree isolation patterns
- GitHub Issue #32731 (anthropics/claude-code) — confirmed teammate tool count discrepancy (Agent tool absent from teammates)
- GitHub Issue #27749 (anthropics/claude-code) — confirmed background worktree member pwd not updated
- `.planning/codebase/ARCHITECTURE.md`, `STACK.md`, `STRUCTURE.md`, `CONCERNS.md` — existing GSD architecture (direct codebase reads)
- `get-shit-done/workflows/execute-phase.md` — current dispatch pattern (direct codebase read)
- `get-shit-done/bin/lib/core.cjs` — loadConfig, model profiles (direct codebase read)
- `PROJECT.md` — requirements and out-of-scope constraints

### Secondary (MEDIUM confidence)
- https://alexop.dev/posts/from-tasks-to-swarms-agent-teams-in-claude-code/ — agent teams parameter breakdown (cross-checked against official docs)
- https://github.blog/ai-and-ml/generative-ai/multi-agent-workflows-often-fail-heres-how-to-engineer-ones-that-dont/ — typed schemas as table stakes, treat agents like code
- https://developers.googleblog.com/developers-guide-to-multi-agent-patterns-in-adk/ — hierarchical decomposition, start simple, parallel fan-out/gather
- https://devcenter.upsun.com/posts/git-worktrees-for-parallel-ai-coding-agents/ — worktree isolation benefits and limitations
- https://towardsdatascience.com/why-your-multi-agent-system-is-failing-escaping-the-17x-error-trap-of-the-bag-of-agents/ — coordination overhead, cascading retry failures, context explosion

### Tertiary (MEDIUM confidence, verify at implementation)
- https://claudefa.st/blog/guide/agents/agent-teams — pitfall patterns (verified against official docs but third-party)
- https://claudefa.st/blog/guide/development/worktree-guide — merge conflict and port conflict patterns

---
*Research completed: 2026-03-11*
*Ready for roadmap: yes*
