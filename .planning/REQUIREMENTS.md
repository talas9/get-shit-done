# Requirements: GSD 3-Tier Agent Hierarchy

**Defined:** 2026-03-11
**Core Value:** Orchestrators coordinate, only leaf agents work — keeping context clean and enabling true parallel execution within phases.

**Activation:** Hierarchy applies to **execution only** (not research, planning, or verification). All three conditions must be met:
1. `parallelization: true` (config.json)
2. `hierarchy.enabled: true` (config.json)
3. Worktrees are implicit — required when hierarchy is on, not a separate toggle

If any condition is false → original flat execution workflow, zero changes.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Foundation

- [x] **FOUND-01**: Feature flag `hierarchy.enabled` in config.json, default false — zero behavior change when disabled. Hierarchy activates ONLY when both `parallelization: true` AND `hierarchy.enabled: true`. Worktrees are implicit (required, not optional)
- [x] **FOUND-02**: `hierarchy-partition` command in gsd-tools.cjs — dependency-aware plan grouping into non-conflicting streams
- [x] **FOUND-03**: `worktree-create` command with timestamped branch names to avoid "branch already checked out" errors
- [x] **FOUND-04**: `worktree-remove` command with force-cleanup for failed/orphaned worktrees
- [x] **FOUND-05**: Worktree registry file (`.planning/worktree-registry.json`) tracking active worktrees for cleanup
- [x] **FOUND-06**: `state-reconcile` command for merging STATE.md changes from multiple worktrees back to main
- [x] **FOUND-07**: Config schema extension — `hierarchy` section with `enabled` (bool) and `max_l2_agents` (int) fields. No separate worktree toggle — worktrees are required when hierarchy is on

### Agent Definition

- [x] **AGNT-01**: `gsd-sub-orchestrator.md` agent definition with restricted tools (Agent + Read only)
- [x] **AGNT-02**: `mcpServers: []` in L2 frontmatter to enforce MCP isolation — only L3 agents access MCP
- [x] **AGNT-03**: L2 receives explicit worktree path in prompt via `<worktree>` tag (workaround for bug #27749)
- [x] **AGNT-04**: L2 validates L3 completion by file existence, not by reading content (context budget enforcement)
- [x] **AGNT-05**: L2 spawns L3 executors for its assigned plan group and reports completion status to L1

### Partitioner

- [x] **PART-01**: L3 partitioner agent spawned by L1 before L2 dispatch — analyzes all plans in a phase
- [x] **PART-02**: Partitioner reads plan dependencies and file overlap to group plans into non-conflicting streams
- [x] **PART-03**: Partitioner returns structured partition map (which L2 gets which plans)
- [x] **PART-04**: Partition respects existing wave ordering — plans in the same wave can be split across L2s, cross-wave dependencies stay sequential

### Dispatch Integration

- [x] **DISP-01**: Conditional branch in `execute-phase.md` — checks `parallelization: true` AND `hierarchy.enabled: true`, otherwise uses existing flat path unchanged. Hierarchy applies to execution workflow ONLY (not research, planning, or verification)
- [ ] **DISP-02**: L1 spawns all L2s with `run_in_background: true` — L1 never blocks
- [ ] **DISP-03**: Each L2 spawned in its own worktree (worktrees are required, not optional, when hierarchy is active)
- [ ] **DISP-04**: File-based completion detection — L2 writes sentinel file before returning (fallback for unreliable SendMessage)
- [ ] **DISP-05**: L1 merges worktrees back to main branch after all L2s complete
- [ ] **DISP-06**: Graceful fallback — any hierarchy failure auto-falls back to flat execution mode with user notification

### Validation

- [ ] **VALID-01**: Smoke test confirming L2 can spawn L3 via Agent() tool (not blocked by nested team restrictions)
- [ ] **VALID-02**: End-to-end test — hierarchy-enabled execution produces equivalent results to flat mode
- [ ] **VALID-03**: Worktree cleanup verification — no orphaned worktrees after completion or failure
- [ ] **VALID-04**: Feature flag off → zero behavior change for existing GSD users (regression test)

## v2 Requirements

### Execution Strategy

- **EXEC-01**: User-selectable hierarchy strategy — Option A (L2 per phase, parallel phases) vs Option B (L2 per plan group within phase). V1 implements Option B only; v2 lets user choose at execution time.

<!-- NOTE: Option A (parallel phases) is architecturally viable for phases with no
     cross-dependencies. Future work: add strategy selection to execute-phase workflow
     so user can pick A or B based on their phase dependency graph. -->

### Differentiators

- **DIFF-01**: L1 progress dashboard from L2 status files (real-time progress view)
- **DIFF-02**: L2 context budget monitoring via maxTurns tuning
- **DIFF-03**: Hierarchy for research/planning workflows (if parallelism use case emerges)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Hierarchy for non-execution workflows | Research, planning, verification already work fine flat — no file contention |
| Hierarchy when sequential mode | Only activates with `parallelization: true` — sequential mode uses flat path |
| Separate worktree toggle | Worktrees are required when hierarchy is on, not independently configurable |
| Multi-user team coordination | Single-developer tool — multi-agent, not multi-user |
| Specialized L2 types | L2s are generic coordinators; specialization happens at L3 |
| Cross-repo worktrees | Worktrees stay within project repo boundary |
| Docker stack isolation per L2 | Too complex for v1 — worktree git isolation is sufficient |
| Dynamic scaling / load balancing | Distributed systems failure modes exceed complexity budget |
| Fault recovery with retry loops | Anti-pattern — fall back to flat mode instead of cascading retries |
| Agent Teams (TeamCreate/SendMessage) | Experimental, "no nested teams" constraint blocks L2→L3 spawning (bug #32731) |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 1 | Complete |
| FOUND-02 | Phase 1 | Complete |
| FOUND-03 | Phase 1 | Complete |
| FOUND-04 | Phase 1 | Complete |
| FOUND-05 | Phase 1 | Complete |
| FOUND-06 | Phase 1 | Complete |
| FOUND-07 | Phase 1 | Complete |
| AGNT-01 | Phase 2 | Complete |
| AGNT-02 | Phase 2 | Complete |
| AGNT-03 | Phase 2 | Complete |
| AGNT-04 | Phase 2 | Complete |
| AGNT-05 | Phase 2 | Complete |
| PART-01 | Phase 2 | Complete |
| PART-02 | Phase 2 | Complete |
| PART-03 | Phase 2 | Complete |
| PART-04 | Phase 2 | Complete |
| DISP-01 | Phase 3 | Complete |
| DISP-02 | Phase 3 | Pending |
| DISP-03 | Phase 3 | Pending |
| DISP-04 | Phase 3 | Pending |
| DISP-05 | Phase 3 | Pending |
| DISP-06 | Phase 3 | Pending |
| VALID-01 | Phase 4 | Pending |
| VALID-02 | Phase 4 | Pending |
| VALID-03 | Phase 4 | Pending |
| VALID-04 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 23 total
- Mapped to phases: 23
- Unmapped: 0

---
*Requirements defined: 2026-03-11*
*Last updated: 2026-03-11 after initial definition*
