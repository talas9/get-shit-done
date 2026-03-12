---
phase: 04-validation-and-hardening
plan: "01"
subsystem: validation
tags: [tests, unit-tests, e2e-fixture, VALID-04]
dependency_graph:
  requires: []
  provides: [return-shape-unit-tests, e2e-fixture-plans]
  affects: [tests/hierarchy.test.cjs, .planning/phases/04-e2e-fixture]
tech_stack:
  added: []
  patterns: [node:test captureOutput intercept, process.stdout.write capture]
key_files:
  created:
    - .planning/phases/04-e2e-fixture/04e-01-PLAN.md
    - .planning/phases/04-e2e-fixture/04e-02-PLAN.md
  modified:
    - tests/hierarchy.test.cjs
decisions:
  - captureOutput pattern reused for return-shape assertions: intercept process.stdout.write and catch process.exit via try/catch — consistent with existing cmdHierarchyPartition test helpers in same file
  - Fixture plans reference only .planning/phases/04-e2e-fixture/scratch-{a,b}.txt: sandboxed, no real project files touched
  - Both fixture plans set wave 1 and depends_on [] with non-overlapping files_modified: partitioner will assign them to separate streams, exercising full parallel dispatch path
metrics:
  duration: 4min
  completed: 2026-03-12T11:04:00Z
  tasks_completed: 2
  files_changed: 3
---

# Phase 4 Plan 01: CLI Return-Shape Tests and E2E Fixture Plans Summary

**One-liner:** 3 unit tests for cmdWorktreeCreate/Remove/StateReconcile return shapes added to hierarchy.test.cjs; 2 sandboxed fixture plans created for E2E hierarchy dispatch validation.

## What Was Built

### Task 1: CLI Return-Value Shape Unit Tests

Added 3 new tests to `tests/hierarchy.test.cjs`:

1. **cmdWorktreeCreate return shape** — verifies `{ created: true, stream, branch, path }` using the same `process.stdout.write` intercept + `try/catch` pattern already used for `cmdHierarchyPartition` tests in that file.

2. **cmdWorktreeRemove return shape** — creates a worktree then removes it, asserting `{ removed: true, stream }`.

3. **cmdStateReconcile return shape** — sets up a main STATE.md plus one worktree STATE.md, runs reconcile, asserts `{ merged: true, worktrees_merged: 1 }`.

All 3 tests pass. Full `npm test` suite: 554 pass, 0 fail.

### Task 2: E2E Fixture Phase Plans

Created `.planning/phases/04-e2e-fixture/` with 2 fixture plans:

- **04e-01-PLAN.md**: wave 1, `files_modified: [.planning/phases/04-e2e-fixture/scratch-a.txt]`, single auto task that writes "Plan A complete" to scratch-a.txt.
- **04e-02-PLAN.md**: wave 1, `files_modified: [.planning/phases/04-e2e-fixture/scratch-b.txt]`, single auto task that writes "Plan B complete" to scratch-b.txt.

Non-overlapping files guarantee the partitioner produces 2 streams. Both plans are fully sandboxed — no real project files are touched.

## Verification Results

- `npm test`: 554 pass, 0 fail (no regressions)
- Fixture plans exist: 04e-01-PLAN.md, 04e-02-PLAN.md
- No file overlap between fixture plans confirmed
- No fixture plan references files outside `.planning/phases/04-e2e-fixture/`

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | 5d66021 | test(04-01): add CLI return-value shape unit tests for VALID-04 |
| Task 2 | 982f047 | feat(04-01): create E2E fixture phase with 2 non-overlapping plans |

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `tests/hierarchy.test.cjs` modified: FOUND (73 lines added)
- `.planning/phases/04-e2e-fixture/04e-01-PLAN.md` created: FOUND
- `.planning/phases/04-e2e-fixture/04e-02-PLAN.md` created: FOUND
- Commit 5d66021 exists: FOUND
- Commit 982f047 exists: FOUND
- npm test: 554 pass, 0 fail
