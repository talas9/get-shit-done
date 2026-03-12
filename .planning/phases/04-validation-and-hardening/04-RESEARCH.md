# Phase 4: Validation and Hardening - Research

**Researched:** 2026-03-12
**Domain:** End-to-end test design for a multi-agent workflow (hierarchy execution, worktree lifecycle, flat-mode regression)
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| VALID-01 | Smoke test confirming L2 can spawn L3 via Agent() tool (not blocked by nested team restrictions) | Testing must verify the standalone-subagent spawn path, not the TeamCreate path. This is a runtime confirmation of bug #32731 NOT applying to standalone subagents. |
| VALID-02 | End-to-end test — hierarchy-enabled execution produces equivalent results to flat mode | Requires a controlled fixture phase with known plans; compare SUMMARY.md outputs under both configs. |
| VALID-03 | Worktree cleanup verification — no orphaned worktrees after completion or failure | Driven by `git worktree list` output inspection after test runs; registry must also be empty. |
| VALID-04 | Feature flag off → zero behavior change for existing GSD users (regression test) | Driven by existing `npm test` suite (554 tests pass) plus a byte-level diff against flat-mode output on identical plans. |
</phase_requirements>

---

## Summary

Phase 4 is a verification phase, not a construction phase. Phases 1–3 have fully built the 3-tier hierarchy feature. What is missing is proof that the feature is correct, complete, and non-regressive. The four VALID requirements divide naturally into two categories:

**Code-level (automated unit tests, already testable today):** VALID-04 is largely satisfied by the existing 554-test suite. The hierarchy-related unit tests in `tests/hierarchy.test.cjs` and `tests/init.test.cjs` cover the CLI commands and config exposure. Phase 4 needs to close any remaining gaps in automated coverage and formalize regression assertions.

**Runtime-level (requires a live agent execution):** VALID-01, VALID-02, and VALID-03 require spawning actual Claude subagents to run. These cannot be unit-tested from Node.js — they require a real execution against a controlled test fixture. The correct approach is a purpose-built test fixture (a minimal fake phase with 2 plans and no real side effects) and a documented manual test protocol that a human or orchestrator runs and verifies by inspecting git state.

**Primary recommendation:** Create one test-fixture phase under `.planning/phases/04-e2e-fixture/`, write a documented execution checklist for the runtime behaviors, and add any missing unit-test assertions to `tests/hierarchy.test.cjs` for VALID-04 code paths not already covered.

---

## Standard Stack

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| Node.js `node:test` | Built-in (project already uses it) | Unit test runner | Established project pattern; zero new dependencies |
| `npm test` → `scripts/run-tests.cjs` | Existing | Runs all 97 test suites, 554 assertions | Already wired in project |
| `git worktree list` | Built-in git | Detect orphaned worktrees after runs | Only reliable source of truth for worktree state |
| `.planning/worktree-registry.json` | Phase 1 artifact | Secondary cleanup check | Cross-references git state |

### No New Dependencies
Phase 4 introduces zero new npm packages. All validation uses:
- Existing Node.js test runner
- Existing `gsd-tools.cjs` commands
- Standard `git` CLI
- File system inspection

---

## Architecture Patterns

### Recommended Phase Structure

```
.planning/phases/04-validation-and-hardening/
├── 04-RESEARCH.md          # this file
├── 04-PLAN.md (or 04-01-PLAN.md, 04-02-PLAN.md, ...)
├── 04-VALIDATION.md        # nyquist validation contract
└── 04-01-SUMMARY.md, etc.  # written by executor after each plan
```

A separate fixture directory (NOT a real phase, just scaffolding) should live at:
```
.planning/phases/04-e2e-fixture/
├── 04e-01-PLAN.md          # trivial plan, wave 1, touches file A
└── 04e-02-PLAN.md          # trivial plan, wave 1, touches file B (no overlap)
```

This fixture gives the partitioner two non-overlapping plans, guaranteeing it produces 2 streams — exercising the full L1→L2→L3 dispatch path. The plans must be self-contained and idempotent so re-running the test does not corrupt project state.

### Pattern 1: Unit Tests for Code-Level Regression (VALID-04)

**What:** Add assertions to `tests/hierarchy.test.cjs` that prove `hierarchy.enabled: false` (or absent) causes no observable difference in execution path.

**When to use:** VALID-04 — the feature-flag-off regression guarantee.

**What to test:**
- `cmdHierarchyPartition` still works when called directly (already tested in Phase 1)
- `loadConfig()` returns `hierarchy.enabled: false` by default (already tested in Phase 3)
- The `init execute-phase` output has `hierarchy_enabled: false` by default (already tested in Phase 3)

**Gap check:** Run `npm test` — all 554 tests pass. The unit coverage for flat-mode behavior is already green. Phase 4 should add assertions only for behaviors not yet tested, specifically:
- Verifying `worktree-create` returns the `path` field correctly (used by execute-phase to build absolute paths)
- Verifying `state-reconcile` returns `{ merged: true }` success output correctly
- Verifying `worktree-remove` returns `{ removed: true }` on successful removal

### Pattern 2: E2E Test Fixture for Runtime Behaviors (VALID-01, VALID-02, VALID-03)

**What:** A minimal fixture phase with 2 trivial plans that can be run end-to-end.

**Fixture plan requirements:**
- Plans must have valid GSD frontmatter (`phase:`, `plan:`, `wave:`, `depends_on: []`, `files_modified: []`)
- Plans must NOT modify real project files (use fixture-only scratch files like `.planning/phases/04-e2e-fixture/scratch-a.txt`)
- Plans must produce a SUMMARY.md when executed (so L2 completion check passes)
- The two plans must have non-overlapping `files_modified` (so partitioner assigns them to separate streams)

**Runtime verification checklist (manual):**
1. Set `hierarchy.enabled: true` in `.planning/config.json`
2. Run `/gsd:execute-phase 04-e2e-fixture`
3. Verify: partitioner splits 2 plans into 2 streams (visible in L1 output)
4. Verify: both L2s spawn with `run_in_background: true` (visible in L1 output)
5. Verify: each L2 spawns its L3 and returns `STREAM_COMPLETE`
6. Verify: `git worktree list` shows no worktrees after completion (VALID-03)
7. Verify: `.planning/worktree-registry.json` shows `worktrees: []` after cleanup
8. Verify: SUMMARY.md exists for both plans (VALID-02 partial)
9. Verify: both SUMMARYs are equivalent to what flat-mode would produce on same plans (VALID-02 full)
10. Verify: `hierarchy_enabled: false` run of same plans produces same SUMMARY.md content (VALID-04 byte check)
11. Verify: standalone L2 subagent successfully called `Agent()` to spawn L3 — confirming bug #32731 workaround holds (VALID-01)

### Pattern 3: Bug Status Rechecks

**What:** Per STATE.md `## Blockers/Concerns`, two open bugs were known at Phase 3 exit:
- Bug #27749: worktree isolation path injection
- Bug #32731: teammates cannot call Agent()

**Before writing tests, re-verify:**
- Does bug #32731 still apply? If it has been patched, the "standalone subagent" constraint may no longer be required, but the code already correctly uses `Task()` (standalone), so tests should still confirm this path works.
- Does bug #27749 still apply? If patched, `isolation: worktree` frontmatter might now work, but tests should confirm the `<worktree>` tag workaround continues to function regardless.

**Approach for Phase 4:** Tests should document the expected behavior of the workaround (L2 uses absolute paths from `<worktree>` tag), not test whether the underlying bug is fixed. The bug status is a human concern; the code behavior is the test concern.

### Anti-Patterns to Avoid

- **Don't test execute-phase.md as code.** It is a workflow prompt, not executable code. Verify it by inspection (grep patterns already established in Phase 3 verification). Don't try to execute it from Node.js.
- **Don't use `assert.equal` for SUMMARY.md content byte-parity.** Execution produces different timestamps, token counts, and prose. Test for structural equivalence (same required sections, same key facts) not byte equality.
- **Don't create plans that modify real project files.** The fixture plans must be sandboxed — use only files inside `.planning/phases/04-e2e-fixture/`.
- **Don't orphan worktrees during test runs.** If a test fixture run fails mid-way, cleanup must happen before declaring failure. Always run `worktree-remove` in the failure path.
- **Don't re-run flat execution after merge conflicts.** This is already handled in execute-phase.md (lines 183–190) — tests must NOT trigger a flat re-run after plans have been committed to worktrees.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Worktree state inspection | Custom registry parser | `git worktree list --porcelain` + existing `readRegistry()` | Already implemented; consistent source of truth |
| Fixture plan execution | New executor scaffolding | Real `/gsd:execute-phase` with fixture phase arg | Validates the actual production code path |
| Byte-diff of SUMMARY content | Custom diff tool | Section-header grep checks | Execution output is not deterministic text |
| Bug #32731 verification | Simulated agent spawn in unit test | Real end-to-end run with L2→L3 spawn and log inspection | The bug is a runtime platform behavior, not unit-testable |

---

## Common Pitfalls

### Pitfall 1: Treating E2E as Unit Tests
**What goes wrong:** Writing Node.js unit tests that try to simulate multi-agent execution by mocking `Agent()` calls. These tests pass without actually proving the runtime behavior.
**Why it happens:** Wanting automated CI coverage for everything.
**How to avoid:** Accept that VALID-01, VALID-02, VALID-03 are integration/manual tests. Document them clearly as such in the VALIDATION.md. Unit tests cover the CLI tools (hierarchy.cjs); runtime tests cover the agent chain.
**Warning signs:** If you find yourself mocking `Task()` or `Agent()` calls in a unit test, stop.

### Pitfall 2: Fixture Plans That Touch Real Files
**What goes wrong:** Fixture plans modify real project files (e.g., `bin/gsd-tools.cjs`). When run in worktrees, this creates real changes on hierarchy branches. Merge back to main corrupts the repo.
**Why it happens:** Copy-pasting a real plan as the fixture template.
**How to avoid:** Fixture plans must use `files_modified: [".planning/phases/04-e2e-fixture/scratch-a.txt"]` only. The executor's task should create or modify only those scratch files.

### Pitfall 3: Forgetting to Reset Config After E2E Test
**What goes wrong:** Leaving `hierarchy.enabled: true` in `.planning/config.json` after the E2E test run. All subsequent GSD commands run in hierarchy mode unexpectedly.
**Why it happens:** E2E test mutates config without restoring it.
**How to avoid:** The test checklist must include a step to restore `hierarchy.enabled: false` as the final step, or use a separate test config file.

### Pitfall 4: Missing the state-reconcile/worktree-remove Order
**What goes wrong:** Calling `worktree-remove` before `state-reconcile`. The reconcile reads the registry; if the registry is cleared first, it has nothing to merge.
**Why it happens:** Cleanup order seems arbitrary.
**How to avoid:** This is already documented in execute-phase.md (line 216 "CRITICAL ORDER"). The Phase 4 test fixture should verify this order is preserved by checking STATE.md content after a run.

### Pitfall 5: Conflating VALID-01 with a Unit Test
**What goes wrong:** Writing a test that checks "L2 agent definition has `tools: Agent, Read`" and declaring VALID-01 satisfied. That proves the definition allows Agent() calls but does NOT prove a live L2 can successfully invoke Agent() to spawn L3 in practice.
**Why it happens:** Wanting to close VALID-01 cheaply.
**How to avoid:** VALID-01 requires a live run. The test protocol must observe an L3 executor actually completing work after being spawned by an L2.

---

## Code Examples

Verified patterns from existing codebase:

### Running the test suite
```bash
# Full suite (all 554 tests, ~3 seconds)
npm test

# Filtered to hierarchy-related tests
npm test 2>&1 | grep -E "hierarchy|FAIL|pass|fail"

# Filtered to init-related tests
npm test 2>&1 | grep -E "init|hierarchy_enabled|FAIL|pass|fail"
```

### Checking worktree state after a run
```bash
# Should show only the main worktree after successful hierarchy run
git worktree list

# Cross-check registry
cat .planning/worktree-registry.json
# Expected: { "worktrees": [] }
```

### Fixture plan frontmatter (safe fixture, no real file modifications)
```yaml
---
phase: 04-e2e-fixture
plan: "01"
type: execute
wave: 1
depends_on: []
files_modified:
  - .planning/phases/04-e2e-fixture/scratch-a.txt
autonomous: true
---
```

### Checking hierarchy_enabled from init output (established pattern)
```bash
INIT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" init execute-phase "04-e2e-fixture")
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
# Parse hierarchy_enabled and hierarchy_max_l2_agents from $INIT JSON
```

### Unit test structure for returnValue shape verification
```javascript
// Source: existing tests/hierarchy.test.cjs pattern
test('cmdWorktreeRemove returns { removed: true } on success (VALID-04 CLI shape)', () => {
  // Create then remove
  const createResult = cmdWorktreeCreate(tmpDir, 'test-stream', false);
  const removeResult = cmdWorktreeRemove(tmpDir, 'test-stream', false, false);
  assert.strictEqual(removeResult.removed, true);
  assert.strictEqual(removeResult.stream, 'test-stream');
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Agent Teams (TeamCreate/SendMessage) | Standalone Task() subagents | Phase 2 decision | L2→L3 chain works; no nested team restriction |
| `isolation: worktree` frontmatter | Explicit `<worktree>` tag path injection | Phase 2 decision (bug #27749) | Worktrees get correct absolute paths |
| Sentinel file for L2 completion | L2 return text as primary signal | Phase 2 decision | L2 has no Write tool; return text IS the signal |
| Flat single-stream execution always | Hierarchy dispatch when both flags true | Phase 3 | Parallel worktree execution gated by `parallelization: true AND hierarchy.enabled: true` |

**Deprecated/outdated:**
- `TeamCreate`/`SendMessage` for L2 spawning: blocked by bug #32731 for teammate-agents; workaround is standalone Task() and return text

---

## Open Questions

1. **Bug #32731 and #27749 current status**
   - What we know: Both bugs were open at Phase 3 completion (2026-03-12). Workarounds are implemented.
   - What's unclear: Whether either bug has been patched since then.
   - Recommendation: Before writing VALID-01 test protocol, re-check bug status. If #32731 is patched, standalone Task() still works (code path unchanged), but the test description can be updated to note the bug is resolved. If #27749 is patched, `isolation: worktree` now works, but the `<worktree>` tag injection is harmless and can remain.

2. **What counts as "equivalent" in VALID-02**
   - What we know: SUMMARY.md files are prose written by an LLM. Two runs of the same plan produce different words.
   - What's unclear: The exact equivalence criterion for byte-for-byte comparison mentioned in the success criteria.
   - Recommendation: Interpret "byte-for-byte equivalent" as "structurally equivalent" — same required sections, same task completion status, same files modified. Not literally identical bytes. Document this interpretation in the PLAN.

3. **Whether execute-phase correctly handles single-plan phases in hierarchy mode**
   - What we know: Step 1 of hierarchy_dispatch falls back to flat mode when `streams.length === 1` (Claude's Discretion optimization, per Phase 3 plan).
   - What's unclear: The fixture must have 2+ non-overlapping plans to exercise hierarchy path.
   - Recommendation: Fixture must use exactly 2 plans with no shared files. Verify partitioner splits them into 2 streams before declaring the test valid.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js `node:test` (built-in) |
| Config file | None — invoked via `scripts/run-tests.cjs` |
| Quick run command | `npm test 2>&1 \| grep -E "hierarchy\|FAIL\|pass\|fail"` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VALID-01 | L2 (standalone subagent) successfully calls Agent() to spawn L3 | manual/integration | n/a — requires live agent session | ❌ E2E checklist (no file) |
| VALID-02 | hierarchy-enabled run produces structurally equivalent SUMMARY.md to flat run | manual/integration | n/a — compare output after two runs | ❌ E2E checklist (no file) |
| VALID-03 | No orphaned worktrees after completion | manual/integration | `git worktree list` — must show 1 line (main only) | ❌ E2E checklist (no file) |
| VALID-04 (flat behavior) | `hierarchy.enabled: false` → flat execute_waves path unchanged | unit | `npm test` — existing 554 tests pass | ✅ exists (tests/hierarchy.test.cjs, tests/init.test.cjs) |
| VALID-04 (CLI return shapes) | `worktree-remove` returns `{ removed: true, stream }` | unit | `npm test 2>&1 \| grep hierarchy` | ❌ Wave 0 gap |
| VALID-04 (CLI return shapes) | `state-reconcile` returns `{ merged: true, worktrees_merged: N }` | unit | `npm test 2>&1 \| grep hierarchy` | ❌ Wave 0 gap |
| VALID-04 (CLI return shapes) | `worktree-create` returns `{ created: true, stream, branch, path }` | unit | `npm test 2>&1 \| grep hierarchy` | ❌ Wave 0 gap |

### Sampling Rate
- **Per task commit:** `npm test 2>&1 | grep -E "hierarchy|FAIL|pass|fail"`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green + E2E checklist completed and signed off before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] Add 3 unit tests to `tests/hierarchy.test.cjs` for CLI return-value shapes (VALID-04): `cmdWorktreeCreate` return, `cmdWorktreeRemove` return, `cmdStateReconcile` return
- [ ] Create `.planning/phases/04-e2e-fixture/` directory with 2 fixture plan files
- [ ] Create E2E test checklist document (can be part of the plan itself or a separate `04-E2E-CHECKLIST.md`)

*(All other test infrastructure already exists and passes.)*

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection: `tests/hierarchy.test.cjs` — 679 lines of existing unit tests
- Direct code inspection: `tests/agent-frontmatter.test.cjs` — existing MCP isolation assertion
- Direct code inspection: `tests/init.test.cjs` lines 861–914 — hierarchy_enabled/max_l2_agents tests
- Direct code inspection: `get-shit-done/workflows/execute-phase.md` — hierarchy_dispatch step
- Direct code inspection: `agents/gsd-sub-orchestrator.md` — L2 constraints and completion protocol
- `.planning/REQUIREMENTS.md` — VALID-01 through VALID-04 definitions
- `.planning/STATE.md` — Known bugs #27749 and #32731, Phase 3 decisions
- `.planning/phases/03-l1-dispatch-integration/03-VERIFICATION.md` — confirmed Phase 3 artifacts

### Secondary (MEDIUM confidence)
- ROADMAP.md Phase 4 success criteria — definition of "byte-for-byte equivalent" interpreted as structural equivalence

### Tertiary (LOW confidence)
- Bug #32731 and #27749 current status — unknown as of research date; treated as still active per last known state

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all tools verified in codebase
- Architecture patterns: HIGH — derived directly from Phase 1–3 artifacts and decisions
- Pitfalls: HIGH — derived from documented decisions and anti-patterns in PLAN files
- E2E runtime behaviors: MEDIUM — correct by design analysis; actual runtime proof is the point of Phase 4

**Research date:** 2026-03-12
**Valid until:** 2026-04-12 (stable project; bugs #32731 and #27749 may change status)
