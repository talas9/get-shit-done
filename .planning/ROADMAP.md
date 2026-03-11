# Roadmap: GSD 3-Tier Agent Hierarchy

## Overview

This milestone adds an optional 3-tier execution hierarchy (L1 orchestrator → L2 sub-orchestrators → L3 workers) to GSD. The feature is entirely gated by `hierarchy.enabled` so existing users see zero behavior change. Four phases build bottom-up: Phase 1 creates the worktree and partition tooling that everything else calls, Phase 2 defines the L2 and partitioner agent personas, Phase 3 wires L1 dispatch to use them, and Phase 4 verifies the full stack holds under the two known open runtime bugs.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation Utilities** - Worktree lifecycle, stream partitioning, and state reconciliation tooling in gsd-tools.cjs
- [ ] **Phase 2: Agent Definitions** - L2 sub-orchestrator and L3 partitioner agent personas with correct tool restrictions
- [ ] **Phase 3: L1 Dispatch Integration** - execute-phase.md hierarchy dispatch branch wiring L1 to L2 streams
- [ ] **Phase 4: Validation and Hardening** - End-to-end tests proving hierarchy correctness and zero regression on flat mode

## Phase Details

### Phase 1: Foundation Utilities
**Goal**: All gsd-tools.cjs commands required by higher phases exist and handle the two known worktree bug workarounds
**Depends on**: Nothing (first phase)
**Requirements**: FOUND-01, FOUND-02, FOUND-03, FOUND-04, FOUND-05, FOUND-06, FOUND-07
**Success Criteria** (what must be TRUE):
  1. `gsd-tools.cjs worktree-create` creates a worktree with a timestamped branch name and registers it in `.planning/worktree-registry.json`
  2. `gsd-tools.cjs worktree-remove` tears down a worktree and removes its entry from the registry, including force-cleanup for orphaned entries
  3. `gsd-tools.cjs hierarchy-partition` groups a set of plans into non-conflicting streams that respect existing wave dependencies
  4. `gsd-tools.cjs state-reconcile` merges STATE.md task-completion entries from multiple worktrees back to main without data loss
  5. Running GSD with `hierarchy.enabled: false` (the default) produces behavior identical to today — no new code paths are reachable
**Plans**: TBD

### Phase 2: Agent Definitions
**Goal**: The L2 sub-orchestrator persona and the L3 partitioner agent exist with enforced tool restrictions so L1 can spawn them correctly
**Depends on**: Phase 1
**Requirements**: AGNT-01, AGNT-02, AGNT-03, AGNT-04, AGNT-05, PART-01, PART-02, PART-03, PART-04
**Success Criteria** (what must be TRUE):
  1. `agents/gsd-sub-orchestrator.md` exists with `tools: Agent, Read` and `mcpServers: []` in frontmatter — L2 cannot call Bash or MCP tools
  2. When an L2 sub-orchestrator is spawned, it receives the worktree path via a `<worktree>` tag and uses it for all path references (bug #27749 workaround in place)
  3. A spawned L2 validates L3 completion by checking for the existence of `SUMMARY.md` in the worktree, not by reading its content
  4. `agents/gsd-partitioner.md` exists as an L3 agent that accepts a phase's plan list and returns a structured partition map assigning each plan to a named stream
  5. The partitioner output correctly keeps cross-wave dependencies sequential — plans in different dependency waves are never assigned to the same parallel stream
**Plans**: TBD

### Phase 3: L1 Dispatch Integration
**Goal**: execute-phase.md routes hierarchy-enabled runs through L2 streams and falls back to flat mode on any failure
**Depends on**: Phase 1, Phase 2
**Requirements**: DISP-01, DISP-02, DISP-03, DISP-04, DISP-05, DISP-06
**Success Criteria** (what must be TRUE):
  1. When `parallelization: true` AND `hierarchy.enabled: true`, execute-phase.md spawns one L2 per partition stream with `run_in_background: true` — L1 never blocks on a single L2
  2. Each L2 runs in its own worktree (explicit path injected, not relying on `isolation: worktree` bug)
  3. L1 detects L2 completion via sentinel file presence (`STREAM_COMPLETE.md` or `STREAM_FAILED.md`) rather than blocking on SendMessage delivery
  4. After all L2 streams complete, L1 merges all worktree branches back to main and removes the worktrees
  5. Any hierarchy failure (worktree creation, L2 spawn, merge conflict) automatically falls back to flat execution mode and notifies the user
**Plans**: TBD

### Phase 4: Validation and Hardening
**Goal**: The full L1→L2→L3 execution chain is verified correct and the flat-mode regression is proven
**Depends on**: Phase 3
**Requirements**: VALID-01, VALID-02, VALID-03, VALID-04
**Success Criteria** (what must be TRUE):
  1. A test run with `hierarchy.enabled: false` produces output byte-for-byte equivalent to a pre-feature run on the same plans
  2. A test run with `hierarchy.enabled: true` completes an L1→L2→L3 flow with real plans, all commits landing in the correct worktree branches (not main)
  3. After a successful hierarchy run, `git worktree list` shows no orphaned worktrees
  4. An L2 spawned as a standalone subagent (not a teammate) successfully calls `Agent()` to spawn an L3 — confirming the teammate tool restriction (bug #32731) does not apply here
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

Note: Phase 1 and Phase 2 have no shared files and no cross-dependencies — they can be worked in parallel if parallelization is active, but each is a complete unit.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation Utilities | 0/TBD | Not started | - |
| 2. Agent Definitions | 0/TBD | Not started | - |
| 3. L1 Dispatch Integration | 0/TBD | Not started | - |
| 4. Validation and Hardening | 0/TBD | Not started | - |
