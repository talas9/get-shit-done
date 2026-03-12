---
phase: 1
slug: foundation-utilities
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-12
---

# Phase 1 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| Framework | Node.js built-in test runner (`node:test` module) |
| Test runner script | `node scripts/run-tests.cjs` |
| Suite command | `npm test` |
| Quick filter | `npm test 2>&1 \| grep -E "hierarchy\|pass\|fail"` |
| Test files location | `tests/` directory |
| Test naming | `{module}.test.cjs` (e.g., `hierarchy.test.cjs`) |

**No new dependencies required.** Framework already installed in project.

---

## Sampling Rate

- **Per task commit:** Run full test suite via `npm test`
- **Per wave merge:** Run full test suite before merge
- **Phase gate:** All automated tests must pass green before `/gsd:verify-work`
- **Regression:** Run full suite before any manual verification of production commands

---

## Per-Task Verification Map

Maps each FOUND requirement (FOUND-01 through FOUND-07) to test type, command, and file location.

| Req ID | Behavior | Test Type | Test File | Command | Wave 0 Status |
|--------|----------|-----------|-----------|---------|---------------|
| FOUND-01a | `loadConfig()` returns `hierarchy` key with defaults when absent from config | unit | `tests/core.test.cjs` | `npm test 2>&1 \| grep core` | Need to add |
| FOUND-01b | `loadConfig()` reads `hierarchy.enabled: true` when set in config.json | unit | `tests/core.test.cjs` | `npm test 2>&1 \| grep core` | Need to add |
| FOUND-01c | `loadConfig()` reads `hierarchy.max_l2_agents: N` when set in config.json | unit | `tests/core.test.cjs` | `npm test 2>&1 \| grep core` | Need to add |
| FOUND-02a | `hierarchy-partition` groups plans by ascending wave order | unit | `tests/hierarchy.test.cjs` | `npm test 2>&1 \| grep hierarchy` | Need to create |
| FOUND-02b | `hierarchy-partition` keeps cross-wave dependencies sequential (same stream) | unit | `tests/hierarchy.test.cjs` | `npm test 2>&1 \| grep hierarchy` | Need to create |
| FOUND-02c | `hierarchy-partition` splits same-wave non-overlapping plans into separate streams | unit | `tests/hierarchy.test.cjs` | `npm test 2>&1 \| grep hierarchy` | Need to create |
| FOUND-02d | `hierarchy-partition` respects `max_l2_agents` cap on stream count | unit | `tests/hierarchy.test.cjs` | `npm test 2>&1 \| grep hierarchy` | Need to create |
| FOUND-03a | `worktree-create` generates timestamped branch name matching pattern `gsd/hierarchy/YYYY-MM-DDTHH-MM-SS-{streamName}` | unit | `tests/hierarchy.test.cjs` | `npm test 2>&1 \| grep hierarchy` | Need to create |
| FOUND-03b | `worktree-create` calls `git worktree add` with `-b` flag and timestamped branch | unit | `tests/hierarchy.test.cjs` | `npm test 2>&1 \| grep hierarchy` | Need to create |
| FOUND-03c | `worktree-create` registers entry in worktree registry with correct fields | unit | `tests/hierarchy.test.cjs` | `npm test 2>&1 \| grep hierarchy` | Need to create |
| FOUND-04a | `worktree-remove --force` succeeds even when worktree directory is missing (orphaned) | unit | `tests/hierarchy.test.cjs` | `npm test 2>&1 \| grep hierarchy` | Need to create |
| FOUND-04b | `worktree-remove` deletes branch via `git branch -D` | unit | `tests/hierarchy.test.cjs` | `npm test 2>&1 \| grep hierarchy` | Need to create |
| FOUND-04c | `worktree-remove` removes registry entry for cleaned-up stream | unit | `tests/hierarchy.test.cjs` | `npm test 2>&1 \| grep hierarchy` | Need to create |
| FOUND-05a | `readRegistry()` returns `{ worktrees: [] }` when registry file is missing | unit | `tests/hierarchy.test.cjs` | `npm test 2>&1 \| grep hierarchy` | Need to create |
| FOUND-05b | `readRegistry()` returns `{ worktrees: [] }` when registry file is corrupted JSON | unit | `tests/hierarchy.test.cjs` | `npm test 2>&1 \| grep hierarchy` | Need to create |
| FOUND-05c | `writeRegistry()` writes valid JSON that `readRegistry()` can parse | unit | `tests/hierarchy.test.cjs` | `npm test 2>&1 \| grep hierarchy` | Need to create |
| FOUND-06a | `state-reconcile` reads STATE.md from worktree branches | unit | `tests/hierarchy.test.cjs` | `npm test 2>&1 \| grep hierarchy` | Need to create |
| FOUND-06b | `state-reconcile` appends task completion records from multiple worktrees | unit | `tests/hierarchy.test.cjs` | `npm test 2>&1 \| grep hierarchy` | Need to create |
| FOUND-06c | `state-reconcile` uses last-write-wins for scalar fields (current_phase, last_activity) | unit | `tests/hierarchy.test.cjs` | `npm test 2>&1 \| grep hierarchy` | Need to create |
| FOUND-06d | `state-reconcile` preserves YAML frontmatter structure without duplicates | unit | `tests/hierarchy.test.cjs` | `npm test 2>&1 \| grep hierarchy` | Need to create |
| FOUND-07a | `cmdConfigEnsureSection()` writes `hierarchy` key in created config.json | unit | `tests/config.test.cjs` | `npm test 2>&1 \| grep config` | Need to add |
| FOUND-07b | `cmdConfigEnsureSection()` sets `hierarchy.enabled: false` by default | unit | `tests/config.test.cjs` | `npm test 2>&1 \| grep config` | Need to add |
| FOUND-07c | `cmdConfigEnsureSection()` sets `hierarchy.max_l2_agents: 3` by default | unit | `tests/config.test.cjs` | `npm test 2>&1 \| grep config` | Need to add |

---

## Wave 0 Requirements (Test Stubs)

Tests that must be created or added before implementation begins.

### New Test File: `tests/hierarchy.test.cjs`

Create with stubs for:
- `hierarchy-partition` algorithm tests (FOUND-02a–d)
- `worktree-create` command tests (FOUND-03a–c)
- `worktree-remove` command tests (FOUND-04a–c)
- Registry read/write tests (FOUND-05a–c)
- `state-reconcile` merge tests (FOUND-06a–d)

**Test count goal:** 20 tests (one per behavior in the map above)

**Test structure template:**
```javascript
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { cmdHierarchyPartition, cmdWorktreeCreate, ... } from '../bin/lib/hierarchy.cjs';

test('FOUND-02a: hierarchy-partition groups plans by ascending wave', async t => {
  // Arrange: mock plan files with wave: 1, 2, 3
  // Act: call partition
  // Assert: output streams respect wave order
  assert.ok(true); // TODO: implement
});

test('FOUND-03a: worktree-create generates timestamped branch', async t => {
  // TODO: implement
});

// ... 18 more tests
```

### Additions to `tests/core.test.cjs`

Add three tests to existing `loadConfig()` test section:
- FOUND-01a: Default `hierarchy` key when absent
- FOUND-01b: Read `hierarchy.enabled` when present
- FOUND-01c: Read `hierarchy.max_l2_agents` when present

### Additions to `tests/config.test.cjs`

Add three tests to existing `cmdConfigEnsureSection()` test section:
- FOUND-07a: Write `hierarchy` key in created config
- FOUND-07b: Default `hierarchy.enabled: false`
- FOUND-07c: Default `hierarchy.max_l2_agents: 3`

---

## Manual-Only Verifications

None for Phase 1. All requirements are either testable via unit tests or verified through code inspection during PR review.

---

## Validation Sign-Off Checklist

Use this checklist during phase completion to confirm all verifications are done.

- [ ] **Test file created:** `tests/hierarchy.test.cjs` exists with 20+ test stubs (FOUND-02 through FOUND-06)
- [ ] **Core tests updated:** `tests/core.test.cjs` has 3 new assertions for `loadConfig()` and `hierarchy` key (FOUND-01)
- [ ] **Config tests updated:** `tests/config.test.cjs` has 3 new assertions for `cmdConfigEnsureSection()` and `hierarchy` key (FOUND-07)
- [ ] **Full suite passes:** `npm test` returns 0 (all tests pass, including existing tests)
- [ ] **Hierarchy tests pass:** `npm test 2>&1 | grep hierarchy` shows all FOUND-02 through FOUND-06 tests passing
- [ ] **No regressions:** Existing tests in `core.test.cjs`, `config.test.cjs`, etc. still pass
- [ ] **Code inspection:** PR review confirms:
  - [ ] `lib/hierarchy.cjs` module created with all four command handlers exported
  - [ ] `gsd-tools.cjs` has four new switch cases calling the handlers
  - [ ] `core.cjs` `loadConfig()` returns `hierarchy` key with correct defaults
  - [ ] `config.cjs` `cmdConfigEnsureSection()` writes `hierarchy` key with correct defaults
  - [ ] No new npm dependencies added
- [ ] **Registry schema review:** `.planning/worktree-registry.json` structure matches research spec (required fields: `stream`, `branch`, `path`, `created_at`, `status`)
- [ ] **Timestamp format verified:** Branch names follow `gsd/hierarchy/YYYY-MM-DDTHH-MM-SS-{streamName}` pattern (colons removed from ISO time)
- [ ] **Error handling review:** All four commands handle missing files, corrupt JSON, and git failures gracefully
- [ ] **Documentation generated:** Each command has help text via `--help` (standard gsd-tools pattern)

---

## Nyquist Sampling & Wave Completion

**Nyquist compliant:** false (Wave 0 tests not yet created)

**Wave 0 completion criteria:**
- [ ] All test files created with passing stubs
- [ ] Full `npm test` suite passes
- [ ] No regressions in existing tests

**Wave 1 completion criteria:** (after implementation)
- [ ] All 26 test assertions passing
- [ ] Code review sign-off on all four commands
- [ ] Worktree registry file created and correct after `worktree-create` call
- [ ] `state-reconcile` produces merge-conflict-free output

---

## Traceability

| Requirement | Test ID | File | Status |
|-------------|---------|------|--------|
| FOUND-01 | FOUND-01a, 01b, 01c | tests/core.test.cjs | To add |
| FOUND-02 | FOUND-02a, 02b, 02c, 02d | tests/hierarchy.test.cjs | To create |
| FOUND-03 | FOUND-03a, 03b, 03c | tests/hierarchy.test.cjs | To create |
| FOUND-04 | FOUND-04a, 04b, 04c | tests/hierarchy.test.cjs | To create |
| FOUND-05 | FOUND-05a, 05b, 05c | tests/hierarchy.test.cjs | To create |
| FOUND-06 | FOUND-06a, 06b, 06c, 06d | tests/hierarchy.test.cjs | To create |
| FOUND-07 | FOUND-07a, 07b, 07c | tests/config.test.cjs | To add |

